// ═══════════════════════════════════════════════════════════════
// FootStats — API Gateway Configuration
// ═══════════════════════════════════════════════════════════════

import 'dotenv/config';

export const config = {
  server: {
    port: parseInt(process.env['PORT'] ?? '4000', 10),
    host: process.env['HOST'] ?? '0.0.0.0',
    logLevel: (process.env['LOG_LEVEL'] ?? 'info') as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace',
  },

  cors: {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:3000',
  },

  redis: {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
  },

  kafka: {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
    clientId: 'footstats-api-gateway',
    consumerGroupId: 'footstats-api-consumers',
  },

  database: {
    host: process.env['DATABASE_HOST'] ?? 'localhost',
    port: parseInt(process.env['DATABASE_PORT'] ?? '5432', 10),
    database: process.env['DATABASE_NAME'] ?? 'footstats',
    user: process.env['DATABASE_USER'] ?? 'footstats',
    password: process.env['DATABASE_PASSWORD'] ?? 'footstats_dev',
  },

  meilisearch: {
    host: process.env['MEILISEARCH_HOST'] ?? 'http://localhost:7700',
    apiKey: process.env['MEILISEARCH_API_KEY'] ?? 'footstats_master_key',
  },

  cache: {
    // Default TTL in seconds for various cache layers
    liveMatch: 5,
    finishedMatch: 300,
    standings: 30,
    competitions: 86400,
    teamProfile: 3600,
    playerProfile: 3600,
    search: 30,
    news: 120,
    predictions: 600,
  },
} as const;

export type AppConfig = typeof config;
