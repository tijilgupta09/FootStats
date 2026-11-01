// ═══════════════════════════════════════════════════════════════
// FootStats — API Gateway Server (Fastify + Socket.io)
// ═══════════════════════════════════════════════════════════════

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createServer } from 'http';
import { config } from './config';
import { closeRedis } from './infra/redis';
import { closeKafka } from './infra/kafka';
import { initSocketGateway } from './infra/socket';
import { matchRoutes } from './routes/matches';
import { competitionRoutes } from './routes/competitions';
import { teamRoutes, playerRoutes } from './routes/teams';
import { newsRoutes, searchRoutes } from './routes/news';
import { predictionRoutes } from './routes/predictions';
import { startIngestionPipeline } from './ingestion';

async function main(): Promise<void> {
  // ─── Build Fastify ────────────────────────────────────────
  const app = Fastify({
    logger: {
      level: config.server.logLevel,
      transport:
        process.env['NODE_ENV'] !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
          : undefined,
    },
  });

  // ─── CORS ─────────────────────────────────────────────────
  await app.register(cors, {
    origin: config.cors.origin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
  });

  // ─── Health Check ─────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ─── Register Routes ──────────────────────────────────────
  await app.register(matchRoutes);
  await app.register(competitionRoutes);
  await app.register(teamRoutes);
  await app.register(playerRoutes);
  await app.register(newsRoutes);
  await app.register(searchRoutes);
  await app.register(predictionRoutes);

  // ─── HTTP Server + Socket.io ──────────────────────────────
  // Fastify needs to share the raw HTTP server with Socket.io
  await app.ready();

  const httpServer = createServer(app.server);
  initSocketGateway(httpServer, config.cors.origin);

  // ─── Start Listening ──────────────────────────────────────
  httpServer.listen(config.server.port, config.server.host, () => {
    console.log('');
    console.log('  ⚽ FootStats API Gateway');
    console.log(`  ├─ REST API:    http://${config.server.host}:${config.server.port}`);
    console.log(`  ├─ Socket.io:   ws://${config.server.host}:${config.server.port}`);
    console.log(`  ├─ Health:      http://${config.server.host}:${config.server.port}/health`);
    console.log(`  └─ Environment: ${process.env['NODE_ENV'] ?? 'development'}`);
    console.log('');

    // Start the ingestion pipeline after server is ready
    startIngestionPipeline().catch((err) => {
      console.error('[Server] Ingestion pipeline failed to start:', err);
      // Don't crash — the REST API still works without live data
    });
  });

  // ─── Graceful Shutdown ────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

    httpServer.close(() => {
      console.log('[Server] HTTP server closed');
    });

    await Promise.allSettled([
      app.close(),
      closeRedis(),
      closeKafka(),
    ]);

    console.log('[Server] All connections closed. Goodbye.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Server] Fatal error during startup:', err);
  process.exit(1);
});
