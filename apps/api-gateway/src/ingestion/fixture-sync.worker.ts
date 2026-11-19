// ═══════════════════════════════════════════════════════════════
// FootStats — Fixture Sync Worker (BullMQ)
// ═══════════════════════════════════════════════════════════════
//
// Periodically fetches upcoming fixtures from the data provider
// and upserts them into the matches table. Runs every 5 minutes
// for the next 7 days window. Also resolves entity aliases for
// provider → internal team/competition ID mapping.
//

import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config';
import { QueueNames } from '@footstats/shared-types';
import type { DataProvider, RawFixture } from './provider.interface';
import { query, queryOne, transaction } from '@footstats/db';

const SYNC_INTERVAL_MS = 300_000; // 5 minutes
const FIXTURE_WINDOW_DAYS = 7;

/**
 * Start the fixture sync worker.
 * Polls the provider for upcoming fixtures and upserts them into the DB.
 */
export async function startFixtureSyncWorker(
  provider: DataProvider,
): Promise<{ worker: Worker; queue: Queue }> {
  const connection = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  };

  const queue = new Queue(QueueNames.FIXTURE_SYNC, { connection });

  // Clean existing repeatable jobs
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule repeatable job
  await queue.add(
    'sync-fixtures',
    { providerName: provider.name },
    {
      repeat: { every: SYNC_INTERVAL_MS },
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  );

  // Also run immediately on startup
  await queue.add(
    'sync-fixtures-initial',
    { providerName: provider.name, initial: true },
    {
      removeOnComplete: { count: 1 },
      removeOnFail: { count: 5 },
    },
  );

  const worker = new Worker(
    QueueNames.FIXTURE_SYNC,
    async (job: Job) => {
      return await processFixtureSync(job, provider);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    const rv = job.returnvalue as Record<string, number> | null;
    if (rv) {
      console.log(
        `[FixtureSync] ✓ Synced ${rv.upserted}/${rv.total} fixtures (${rv.skipped} skipped)`,
      );
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[FixtureSync] ✗ Sync #${job?.id} failed:`, err.message);
  });

  return { worker, queue };
}

/**
 * Core fixture sync handler.
 * 1. Build date window (today → today + 7 days)
 * 2. Fetch fixtures from provider
 * 3. Resolve entity aliases (team/competition provider IDs → internal UUIDs)
 * 4. Upsert into matches table
 */
async function processFixtureSync(
  _job: Job,
  provider: DataProvider,
): Promise<{ total: number; upserted: number; skipped: number }> {
  const now = new Date();
  const from = now.toISOString().split('T')[0]!;
  const futureDate = new Date(now.getTime() + FIXTURE_WINDOW_DAYS * 86400_000);
  const to = futureDate.toISOString().split('T')[0]!;

  // 1. Fetch fixtures from provider
  const fixtures = await provider.fetchFixtures(from, to);

  let upserted = 0;
  let skipped = 0;

  // 2. Process each fixture
  for (const fixture of fixtures) {
    try {
      const result = await upsertFixture(fixture, provider.name);
      if (result) upserted++;
      else skipped++;
    } catch (err) {
      console.warn(
        `[FixtureSync] Failed to upsert fixture ${fixture.providerId}:`,
        (err as Error).message,
      );
      skipped++;
    }
  }

  return { total: fixtures.length, upserted, skipped };
}

/**
 * Resolve a provider team/competition ID to an internal UUID
 * using the entity_aliases table.
 */
async function resolveAlias(
  entityType: 'TEAM' | 'COMPETITION',
  providerName: string,
  externalId: string,
  fallbackName?: string,
): Promise<string | null> {
  const alias = await queryOne<{ internal_id: string }>(
    `SELECT internal_id FROM entity_aliases
     WHERE entity_type = $1 AND provider = $2 AND external_id = $3`,
    [entityType, providerName, externalId],
  );

  if (alias) return alias.internal_id;

  // For the mock provider, try matching by code directly
  if (providerName === 'mock') {
    if (entityType === 'TEAM') {
      const team = await queryOne<{ id: string }>(
        'SELECT id FROM teams WHERE code = $1',
        [externalId],
      );
      return team?.id ?? null;
    } else {
      const comp = await queryOne<{ id: string }>(
        'SELECT id FROM competitions WHERE code = $1',
        [externalId],
      );
      return comp?.id ?? null;
    }
  }

  return null;
}

/**
 * Upsert a single fixture into the matches table.
 * Returns true if a row was inserted/updated.
 */
async function upsertFixture(
  fixture: RawFixture,
  providerName: string,
): Promise<boolean> {
  // Resolve team and competition IDs
  const homeTeamId = await resolveAlias('TEAM', providerName, fixture.homeTeamProvId, fixture.homeTeamName);
  const awayTeamId = await resolveAlias('TEAM', providerName, fixture.awayTeamProvId, fixture.awayTeamName);
  const competitionId = await resolveAlias('COMPETITION', providerName, fixture.competitionProvId, fixture.competitionName);

  if (!homeTeamId || !awayTeamId || !competitionId) {
    console.debug(
      `[FixtureSync] Skipping fixture ${fixture.providerId}: unresolved entities ` +
      `(home=${homeTeamId ? '✓' : '✗'}, away=${awayTeamId ? '✓' : '✗'}, comp=${competitionId ? '✓' : '✗'})`,
    );
    return false;
  }

  // Get current season for this competition
  const season = await queryOne<{ id: string }>(
    `SELECT id FROM seasons WHERE competition_id = $1 AND is_current = true`,
    [competitionId],
  );

  // season_id is NOT NULL in the schema — skip fixtures with no current season
  if (!season) {
    console.debug(
      `[FixtureSync] Skipping fixture ${fixture.providerId}: no current season for competition ${competitionId}`,
    );
    return false;
  }

  // Check for existing match by provider ID to avoid duplicates
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM matches WHERE provider_ids->>'${providerName}' = $1`,
    [fixture.providerId],
  );

  if (existing) {
    // Update metadata on existing match
    await query(
      `UPDATE matches SET
        matchday = COALESCE($1, matchday),
        round_name = COALESCE($2, round_name),
        provider_ids = provider_ids || $3::jsonb,
        updated_at = NOW()
      WHERE id = $4`,
      [
        fixture.matchday,
        fixture.roundName,
        JSON.stringify({ [providerName]: fixture.providerId }),
        existing.id,
      ],
    );
    return true;
  }

  // Insert new match
  const result = await query(
    `INSERT INTO matches (
      competition_id, season_id, home_team_id, away_team_id,
      kickoff_at, status, matchday, round_name,
      provider_ids
    ) VALUES ($1, $2, $3, $4, $5, 'SCHEDULED', $6, $7, $8)
    RETURNING id`,
    [
      competitionId,
      season.id,
      homeTeamId,
      awayTeamId,
      fixture.kickoffAt,
      fixture.matchday,
      fixture.roundName,
      JSON.stringify({ [providerName]: fixture.providerId }),
    ],
  );

  return result.length > 0;
}
