// ═══════════════════════════════════════════════════════════════
// FootStats — Ingestion Layer Orchestrator
// ═══════════════════════════════════════════════════════════════
//
// Wires together the data provider, BullMQ workers, and Kafka
// consumers. This is the single entry point to start the entire
// real-time data pipeline.
//
// Workers:
//   1. Live Poller      — every 5s   (live match state polling)
//   2. Fixture Sync     — every 5m   (upcoming fixtures upsert)
//   3. Standings Sync   — every 5m   (league table updates)
//   4. News Poll        — every 2m   (news article ingestion)
//   5. Kafka Consumers  — continuous (delta → DB persistence)
//

import type { DataProvider } from './provider.interface';
import { MockDataProvider } from './mock.provider';
import { startLivePollerWorker } from './live-poller.worker';
import { startFixtureSyncWorker } from './fixture-sync.worker';
import { startStandingsSyncWorker } from './standings-sync.worker';
import { startNewsPollWorker } from './news-poll.worker';
import { startKafkaConsumers } from './consumers';
import { startMlInferenceConsumer } from '../ml';

let isRunning = false;

/**
 * Initialize and start the full ingestion pipeline.
 *
 * Components started:
 * 1. Data Provider (Mock or real API adapter)
 * 2. Kafka Consumers (persist deltas to DB + Redis pub/sub)
 * 3. BullMQ Live Poller (polls every 5s)
 * 4. BullMQ Fixture Sync (polls every 5m)
 * 5. BullMQ Standings Sync (polls every 5m)
 * 6. BullMQ News Poll (polls every 2m)
 *
 * @param providerOverride — optional provider for testing
 */
export async function startIngestionPipeline(
  providerOverride?: DataProvider,
): Promise<void> {
  if (isRunning) {
    console.warn('[Ingestion] Pipeline already running — skipping duplicate start');
    return;
  }

  console.log('');
  console.log('  ⚙️  FootStats Ingestion Pipeline');
  console.log('  ────────────────────────────────────────');

  // 1. Select provider
  const provider = providerOverride ?? new MockDataProvider();
  console.log(`  ├─ Provider: ${provider.name} (priority: ${provider.priority})`);

  // 2. Health check
  const health = await provider.healthCheck();
  if (!health.isHealthy) {
    console.error(`  ├─ ✗ Provider health check FAILED`);
    throw new Error(`Provider ${provider.name} is not healthy`);
  }
  console.log(`  ├─ Health: ✓ OK`);

  // 3. Start Kafka consumers first (so they're ready to receive)
  try {
    await startKafkaConsumers();
    console.log('  ├─ Kafka Consumers: ✓ Started');
  } catch {
    console.warn('  ├─ Kafka Consumers: ⚠ Failed to start (Kafka may not be running)');
    console.warn('  │  Pipeline will still run — deltas published to Redis pub/sub only');
  }

  // 3b. Start ML inference consumer
  try {
    await startMlInferenceConsumer();
    console.log('  ├─ ML Inference:    ✓ Started (Poisson/DC + live win-prob + momentum)');
  } catch {
    console.warn('  ├─ ML Inference:    ⚠ Failed to start (Kafka may not be running)');
  }

  // 4. Start BullMQ workers (each is independent — failures are isolated)
  const { worker: _liveWorker } = await startLivePollerWorker(provider);
  console.log('  ├─ Live Poller:     ✓ Started (every 5s)');

  try {
    await startFixtureSyncWorker(provider);
    console.log('  ├─ Fixture Sync:    ✓ Started (every 5m)');
  } catch (err) {
    console.warn('  ├─ Fixture Sync:    ⚠ Failed to start:', (err as Error).message);
  }

  try {
    await startStandingsSyncWorker(provider);
    console.log('  ├─ Standings Sync:  ✓ Started (every 5m)');
  } catch (err) {
    console.warn('  ├─ Standings Sync:  ⚠ Failed to start:', (err as Error).message);
  }

  try {
    await startNewsPollWorker();
    console.log('  ├─ News Poller:     ✓ Started (every 2m)');
  } catch (err) {
    console.warn('  ├─ News Poller:     ⚠ Failed to start:', (err as Error).message);
  }

  isRunning = true;

  console.log('  └─ Pipeline: ✓ ALL WORKERS RUNNING');
  console.log('');
}

/**
 * Exports for use in server.ts — allows deferred start after
 * the HTTP server is listening.
 */
export { MockDataProvider } from './mock.provider';
export type { DataProvider } from './provider.interface';
