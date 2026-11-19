// ═══════════════════════════════════════════════════════════════
// FootStats — Standings Sync Worker (BullMQ)
// ═══════════════════════════════════════════════════════════════
//
// Periodically fetches league standings from the data provider
// and updates the standings table. Runs every 5 minutes.
// Also publishes changes to Kafka for downstream consumers
// (e.g., live position delta display on the frontend).
//

import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config';
import { QueueNames, KafkaTopics, RedisChannels, RedisKeys } from '@footstats/shared-types';
import type { DataProvider, RawStandingRow } from './provider.interface';
import { query, queryOne, transaction } from '@footstats/db';
import { publishMessage } from '../infra/kafka';
import { getRedis } from '../infra/redis';

const SYNC_INTERVAL_MS = 300_000; // 5 minutes

/**
 * Start the standings sync worker.
 */
export async function startStandingsSyncWorker(
  provider: DataProvider,
): Promise<{ worker: Worker; queue: Queue }> {
  const connection = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  };

  const queue = new Queue(QueueNames.STANDINGS_SYNC, { connection });

  // Clean existing repeatable jobs
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule repeatable job
  await queue.add(
    'sync-standings',
    { providerName: provider.name },
    {
      repeat: { every: SYNC_INTERVAL_MS },
      removeOnComplete: { count: 5 },
      removeOnFail: { count: 20 },
    },
  );

  // Also run immediately on startup
  await queue.add(
    'sync-standings-initial',
    { providerName: provider.name, initial: true },
    {
      removeOnComplete: { count: 1 },
      removeOnFail: { count: 5 },
    },
  );

  const worker = new Worker(
    QueueNames.STANDINGS_SYNC,
    async (job: Job) => {
      return await processStandingsSync(job, provider);
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
        `[StandingsSync] ✓ Synced ${rv.competitionsUpdated} competitions, ${rv.rowsUpdated} rows`,
      );
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[StandingsSync] ✗ Sync #${job?.id} failed:`, err.message);
  });

  return { worker, queue };
}

/**
 * Core standings sync handler.
 * 1. Get all active competitions
 * 2. For each, fetch standings from provider
 * 3. Upsert into standings table
 * 4. Publish to Kafka + update Redis cache
 */
async function processStandingsSync(
  _job: Job,
  provider: DataProvider,
): Promise<{ competitionsUpdated: number; rowsUpdated: number }> {
  // Get all active league-type competitions with their provider aliases
  const competitions = await query<{
    id: string;
    code: string;
    name: string;
    type: string;
    external_id: string | null;
  }>(`
    SELECT c.id, c.code, c.name, c.type,
      ea.external_id
    FROM competitions c
    LEFT JOIN entity_aliases ea
      ON ea.entity_type = 'COMPETITION'
      AND ea.internal_id = c.id
      AND ea.provider = $1
    WHERE c.is_active = true AND c.type = 'LEAGUE'
    ORDER BY c.display_order
  `, [provider.name]);

  let competitionsUpdated = 0;
  let rowsUpdated = 0;

  for (const comp of competitions) {
    const providerCompId = comp.external_id ?? comp.code;

    try {
      const standings = await provider.fetchStandings(providerCompId);
      if (standings.length === 0) continue;

      const updated = await upsertStandings(comp.id, comp.code, standings, provider.name);
      rowsUpdated += updated;
      competitionsUpdated++;

      // Update Redis cache
      const season = await queryOne<{ id: string }>(
        'SELECT id FROM seasons WHERE competition_id = $1 AND is_current = true',
        [comp.id],
      );
      if (season) {
        const cacheKey = RedisKeys.standingsCache(comp.id, season.id);
        const redis = getRedis();
        await redis.set(cacheKey, JSON.stringify(standings), 'EX', config.cache.standings);
      }

      // Publish to Kafka for downstream consumers
      try {
        await publishMessage(
          KafkaTopics.STANDINGS_UPDATE,
          {
            competitionId: comp.id,
            seasonId: season?.id ?? null,
            standings: standings.map((row) => ({
              teamId: row.teamProvId,
              position: row.position,
              played: row.played,
              won: row.won,
              drawn: row.drawn,
              lost: row.lost,
              goalsFor: row.goalsFor,
              goalsAgainst: row.goalsAgainst,
              points: row.points,
              form: row.form,
            })),
          },
          comp.id,
        );
      } catch {
        // Kafka may not be running — log but don't fail
        console.debug(`[StandingsSync] Kafka publish skipped for ${comp.name}`);
      }

      // Publish to Redis pub/sub for live standings widget
      try {
        const redis = getRedis();
        await redis.publish(
          RedisChannels.competitionStandings(comp.id),
          JSON.stringify({ competitionId: comp.id, standings }),
        );
      } catch {
        // Redis pub/sub failure is non-critical
      }
    } catch (err) {
      console.warn(
        `[StandingsSync] Failed to sync standings for ${comp.name}:`,
        (err as Error).message,
      );
    }
  }

  return { competitionsUpdated, rowsUpdated };
}

/**
 * Upsert standings rows for a competition.
 */
async function upsertStandings(
  competitionId: string,
  competitionCode: string,
  standings: RawStandingRow[],
  providerName: string,
): Promise<number> {
  let updated = 0;

  // Get current season
  const season = await queryOne<{ id: string }>(
    'SELECT id FROM seasons WHERE competition_id = $1 AND is_current = true',
    [competitionId],
  );
  if (!season) return 0;

  await transaction(async (client) => {
    for (const row of standings) {
      // Resolve team ID
      let teamId: string | null = null;

      // Try entity alias first
      const alias = await queryOne<{ internal_id: string }>(
        `SELECT internal_id FROM entity_aliases
         WHERE entity_type = 'TEAM' AND provider = $1 AND external_id = $2`,
        [providerName, row.teamProvId],
      );

      if (alias) {
        teamId = alias.internal_id;
      } else if (providerName === 'mock') {
        // Fallback: match by code for mock provider
        const team = await queryOne<{ id: string }>(
          'SELECT id FROM teams WHERE code = $1',
          [row.teamProvId],
        );
        teamId = team?.id ?? null;
      }

      if (!teamId) {
        console.debug(`[StandingsSync] Skipping unresolved team: ${row.teamProvId}`);
        continue;
      }

      const result = await client.query(
        `INSERT INTO standings (
          competition_id, season_id, group_name, team_id,
          position, played, won, drawn, lost,
          goals_for, goals_against, points, form,
          updated_at
        ) VALUES ($1, $2, '', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (competition_id, season_id, COALESCE(group_name, ''), team_id)
        DO UPDATE SET
          position = EXCLUDED.position,
          played = EXCLUDED.played,
          won = EXCLUDED.won,
          drawn = EXCLUDED.drawn,
          lost = EXCLUDED.lost,
          goals_for = EXCLUDED.goals_for,
          goals_against = EXCLUDED.goals_against,
          points = EXCLUDED.points,
          form = EXCLUDED.form,
          live_position_delta = standings.position - EXCLUDED.position,
          updated_at = NOW()`,
        [
          competitionId,
          season.id,
          teamId,
          row.position,
          row.played,
          row.won,
          row.drawn,
          row.lost,
          row.goalsFor,
          row.goalsAgainst,
          row.points,
          row.form,
        ],
      );

      if (result.rowCount && result.rowCount > 0) updated++;
    }
  });

  return updated;
}
