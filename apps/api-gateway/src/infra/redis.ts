// ═══════════════════════════════════════════════════════════════
// FootStats — Redis Client Factory
// ═══════════════════════════════════════════════════════════════

import Redis from 'ioredis';
import { config } from '../config';

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;

/**
 * Returns a shared Redis client instance for caching & pub/sub publishing.
 * Creates the connection lazily on first call.
 */
export function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
      lazyConnect: false,
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Client error:', err.message);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Client connected');
    });
  }
  return redisClient;
}

/**
 * Returns a dedicated subscriber Redis instance.
 * Required because ioredis does not allow mixing sub commands with regular ones.
 */
export function getRedisSubscriber(): Redis {
  if (!redisSubscriber) {
    redisSubscriber = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
    });

    redisSubscriber.on('error', (err) => {
      console.error('[Redis] Subscriber error:', err.message);
    });

    redisSubscriber.on('connect', () => {
      console.log('[Redis] Subscriber connected');
    });
  }
  return redisSubscriber;
}

/**
 * Graceful shutdown for all Redis connections.
 */
export async function closeRedis(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (redisClient) {
    promises.push(redisClient.quit().then(() => { redisClient = null; }));
  }
  if (redisSubscriber) {
    promises.push(redisSubscriber.quit().then(() => { redisSubscriber = null; }));
  }
  await Promise.all(promises);
  console.log('[Redis] All connections closed');
}
