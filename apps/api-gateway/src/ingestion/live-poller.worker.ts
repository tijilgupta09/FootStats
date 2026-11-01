// ═══════════════════════════════════════════════════════════════
// FootStats — Live Poller Worker (BullMQ)
// ═══════════════════════════════════════════════════════════════
//
// A BullMQ repeatable job that polls the data provider for live
// match updates every 5 seconds. When state changes are detected
// via the diff engine, deltas are published to Kafka for
// downstream consumption (DB writes, Redis pub/sub, ML triggers).
//

import { Worker, Queue, type Job } from 'bullmq';
import { config } from '../config';
import { QueueNames, KafkaTopics, RedisChannels, GOAL_EVENTS, CARD_EVENTS } from '@footstats/shared-types';
import type { DataProvider, RawMatchData, RawMatchEvent } from './provider.interface';
import { detectDeltas, updateHotCache, updateLiveMatchSet, type MatchDelta } from './state-diff';
import { publishMessage } from '../infra/kafka';
import { getRedis } from '../infra/redis';

const POLL_INTERVAL_MS = 5_000;   // 5 seconds
const STALE_CLEANUP_MS = 300_000; // 5 minutes — remove stale match hashes

/**
 * Create and start the live polling worker.
 * Uses BullMQ's repeatable jobs for reliable, exactly-once scheduling.
 */
export async function startLivePollerWorker(
  provider: DataProvider,
): Promise<{ worker: Worker; queue: Queue }> {
  const connection = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
  };

  const queue = new Queue(QueueNames.LIVE_POLL, { connection });

  // Remove any existing repeatable jobs before adding a new one
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule repeatable job
  await queue.add(
    'poll-live',
    { providerName: provider.name },
    {
      repeat: { every: POLL_INTERVAL_MS },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );

  // Create the worker that processes poll jobs
  const worker = new Worker(
    QueueNames.LIVE_POLL,
    async (job: Job) => {
      return await processPollJob(job, provider);
    },
    {
      connection,
      concurrency: 1, // Must be 1 — sequential polling
      limiter: {
        max: 1,
        duration: POLL_INTERVAL_MS,
      },
    },
  );

  worker.on('completed', (job) => {
    if (job.returnvalue && (job.returnvalue as Record<string, number>).deltaCount > 0) {
      const rv = job.returnvalue as Record<string, number>;
      console.log(
        `[LivePoller] ✓ Poll #${job.id}: ${rv.totalMatches} matches, ${rv.deltaCount} deltas detected`,
      );
    }
  });

  worker.on('failed', (job, err) => {
    console.error(`[LivePoller] ✗ Poll #${job?.id} failed:`, err.message);
  });

  console.log(`[LivePoller] Worker started (provider: ${provider.name}, interval: ${POLL_INTERVAL_MS}ms)`);
  return { worker, queue };
}

/**
 * Core poll job handler.
 * 1. Fetch live matches from provider
 * 2. Run state diffing
 * 3. Publish deltas to Kafka
 * 4. Update Redis hot cache + live match set
 */
async function processPollJob(
  job: Job,
  provider: DataProvider,
): Promise<{ totalMatches: number; deltaCount: number }> {
  const startTime = Date.now();

  // 1. Fetch live matches from provider
  let matches: RawMatchData[];
  try {
    matches = await provider.fetchLiveMatches();
  } catch (err) {
    console.error(`[LivePoller] Provider ${provider.name} fetch failed:`, err);
    // Record health issue
    const redis = getRedis();
    await redis.set(
      `provider:health:${provider.name}`,
      JSON.stringify({ healthy: false, error: (err as Error).message, at: new Date().toISOString() }),
      'EX',
      60,
    );
    throw err;
  }

  // 2. Detect state changes via hash diffing
  const deltas = await detectDeltas(matches);

  // 3. Process each delta
  for (const delta of deltas) {
    await processDelta(delta);
  }

  // 4. Update the live match set in Redis
  const liveIds = matches.map((m) => m.providerId);
  await updateLiveMatchSet(liveIds);

  // 5. Update hot cache for ALL live matches (even unchanged ones)
  for (const match of matches) {
    await updateHotCache(match.providerId, match, 30);
  }

  const elapsed = Date.now() - startTime;
  if (elapsed > POLL_INTERVAL_MS * 0.8) {
    console.warn(`[LivePoller] Poll took ${elapsed}ms — approaching interval of ${POLL_INTERVAL_MS}ms`);
  }

  return { totalMatches: matches.length, deltaCount: deltas.length };
}

/**
 * Process a single match delta:
 * - Publish raw telemetry to Kafka
 * - Publish state delta to Kafka
 * - Publish individual events to Kafka
 * - Trigger ML inference for state-altering events
 * - Publish to Redis pub/sub for WebSocket bridge
 */
async function processDelta(delta: MatchDelta): Promise<void> {
  const { matchData, matchProviderId, isNewMatch } = delta;

  // ─── Kafka: Raw Telemetry ─────────────────────────────────
  await publishMessage(
    KafkaTopics.RAW_TELEMETRY,
    {
      providerId: matchProviderId,
      timestamp: new Date().toISOString(),
      data: matchData,
    },
    matchProviderId,
  );

  // ─── Kafka: Match State Delta ─────────────────────────────
  await publishMessage(
    KafkaTopics.MATCH_STATE_DELTA,
    {
      matchProviderId,
      isNewMatch,
      status: matchData.status,
      minute: matchData.minute,
      addedTime: matchData.addedTime,
      homeScore: matchData.homeScore,
      awayScore: matchData.awayScore,
      homeHtScore: matchData.homeHtScore,
      awayHtScore: matchData.awayHtScore,
      stats: matchData.stats ?? null,
      lineups: matchData.lineups ?? null,
      timestamp: new Date().toISOString(),
    },
    matchProviderId,
  );

  // ─── Kafka: Individual Events ─────────────────────────────
  if (matchData.events && matchData.events.length > 0) {
    for (const event of matchData.events) {
      await publishMessage(
        KafkaTopics.MATCH_EVENTS,
        {
          matchProviderId,
          event,
          timestamp: new Date().toISOString(),
        },
        matchProviderId,
      );
    }
  }

  // ─── Kafka: ML Inference Trigger ──────────────────────────
  // Trigger ML recalculation for state-altering events
  const hasStateAlteringEvent = matchData.events?.some(
    (e) => GOAL_EVENTS.has(e.eventType as any) || CARD_EVENTS.has(e.eventType as any),
  );

  if (hasStateAlteringEvent || isNewMatch) {
    await publishMessage(
      KafkaTopics.ML_INFERENCE_TRIGGER,
      {
        matchProviderId,
        minute: matchData.minute,
        homeScore: matchData.homeScore,
        awayScore: matchData.awayScore,
        stats: matchData.stats,
        triggerReason: isNewMatch ? 'NEW_MATCH' : 'STATE_CHANGE',
        timestamp: new Date().toISOString(),
      },
      matchProviderId,
    );
  }

  // ─── Redis Pub/Sub: Dashboard ─────────────────────────────
  const redis = getRedis();

  const dashboardPayload = buildDashboardPayload(matchData);
  await redis.publish(RedisChannels.DASHBOARD, JSON.stringify(dashboardPayload));

  // ─── Redis Pub/Sub: Match Detail ──────────────────────────
  const matchDetailPayload = {
    matchProviderId,
    status: matchData.status,
    minute: matchData.minute,
    addedTime: matchData.addedTime,
    homeScore: matchData.homeScore,
    awayScore: matchData.awayScore,
    stats: matchData.stats ?? null,
    events: matchData.events ?? [],
    lineups: matchData.lineups ?? null,
    timestamp: new Date().toISOString(),
  };
  await redis.publish(
    RedisChannels.matchDetail(matchProviderId),
    JSON.stringify(matchDetailPayload),
  );

  // ─── Flash Banner for Goals/Red Cards ─────────────────────
  const flashEvent = matchData.events?.find(
    (e) => GOAL_EVENTS.has(e.eventType as any) || e.eventType === 'RED_CARD',
  );

  if (flashEvent) {
    const flashPayload = buildFlashPayload(matchData, flashEvent);
    await redis.publish(
      RedisChannels.matchDetail(matchProviderId),
      JSON.stringify(flashPayload),
    );
  }
}

/**
 * Build the dashboard delta payload for the global ticker.
 */
function buildDashboardPayload(match: RawMatchData): Record<string, unknown> {
  const goalEvent = match.events?.find(
    (e) => GOAL_EVENTS.has(e.eventType as any),
  );

  return {
    type: goalEvent ? 'EVENT_FLASH' : 'SCORE_UPDATE',
    matchId: match.providerId,
    data: {
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      minute: match.minute,
      addedTime: match.addedTime,
      homeTeamName: match.homeTeamName,
      awayTeamName: match.awayTeamName,
      competitionName: match.competitionName,
      ...(goalEvent ? {
        flash: {
          type: goalEvent.eventType === 'RED_CARD' ? 'RED_CARD' : 'GOAL',
          teamSide: goalEvent.teamSide,
          playerName: goalEvent.playerName,
          message: `${goalEvent.playerName ?? 'Goal'} ${goalEvent.minute}'`,
          ttl: 8000,
        },
      } : {}),
    },
    version: Date.now(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a flash banner payload for dramatic events.
 */
function buildFlashPayload(
  match: RawMatchData,
  event: RawMatchEvent,
): Record<string, unknown> {
  const isGoal = GOAL_EVENTS.has(event.eventType as any);
  return {
    flashType: isGoal ? 'GOAL' : 'RED_CARD',
    matchId: match.providerId,
    teamSide: event.teamSide,
    playerName: event.playerName,
    message: isGoal
      ? `⚽ GOAL! ${event.playerName ?? ''} ${event.minute}'`
      : `🟥 RED CARD! ${event.playerName ?? ''} ${event.minute}'`,
    ttl: isGoal ? 8000 : 5000,
    homeTeam: match.homeTeamName,
    awayTeam: match.awayTeamName,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    competition: match.competitionName,
  };
}
