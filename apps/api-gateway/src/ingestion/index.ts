// ═══════════════════════════════════════════════════════════════
// FootStats — Ingestion Layer Orchestrator
// ═══════════════════════════════════════════════════════════════
//
// Wires together the data provider, BullMQ workers, and Kafka
// consumers. This is the single entry point to start the entire
// real-time data pipeline.
//

import type { DataProvider } from './provider.interface';
import { MockDataProvider } from './mock.provider';
import { startLivePollerWorker } from './live-poller.worker';
import { startKafkaConsumers } from './consumers';

let isRunning = false;

/**
 * Initialize and start the full ingestion pipeline.
 *
 * Components started:
 * 1. Data Provider (Mock or real API adapter)
 * 2. BullMQ Live Poller (polls every 5s)
 * 3. Kafka Consumers (persist deltas to DB + Redis pub/sub)
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
  } catch (err) {
    console.warn('  ├─ Kafka Consumers: ⚠ Failed to start (Kafka may not be running)');
    console.warn('  │  Pipeline will still run — deltas published to Redis pub/sub only');
  }

  // 4. Start BullMQ live poller
  const { worker, queue } = await startLivePollerWorker(provider);
  console.log('  ├─ Live Poller: ✓ Started (every 5s)');

  isRunning = true;

  console.log('  └─ Pipeline: ✓ RUNNING');
  console.log('');
}

/**
 * Exports for use in server.ts — allows deferred start after
 * the HTTP server is listening.
 */
export { MockDataProvider } from './mock.provider';
export type { DataProvider } from './provider.interface';
