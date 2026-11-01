// ═══════════════════════════════════════════════════════════════
// FootStats — Socket.io Real-Time Gateway
// ═══════════════════════════════════════════════════════════════

import { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import type {
  ClientSocketEvents,
  ServerSocketEvents,
} from '@footstats/shared-types';
import { SocketRooms, RedisChannels } from '@footstats/shared-types';
import { getRedisSubscriber, getRedis } from './redis';

let io: Server<ClientSocketEvents, ServerSocketEvents> | null = null;

/**
 * Initialize Socket.io on top of an existing HTTP server.
 * Sets up room management, Redis pub/sub bridge, and client event handlers.
 */
export function initSocketGateway(
  httpServer: HttpServer,
  corsOrigin: string,
): Server<ClientSocketEvents, ServerSocketEvents> {
  io = new Server<ClientSocketEvents, ServerSocketEvents>(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1MB
  });

  io.on('connection', (socket: Socket<ClientSocketEvents, ServerSocketEvents>) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Emit connection info
    socket.emit('connection:info', {
      socketId: socket.id,
      subscribedRooms: [],
      serverTime: new Date().toISOString(),
      liveMatchCount: 0,
    });

    // ─── Dashboard Subscription ──────────────────────────────
    socket.on('subscribe:dashboard', () => {
      socket.join(SocketRooms.DASHBOARD);
      console.log(`[Socket.io] ${socket.id} joined dashboard`);
    });

    socket.on('unsubscribe:dashboard', () => {
      socket.leave(SocketRooms.DASHBOARD);
    });

    // ─── Match Detail Subscription ───────────────────────────
    socket.on('subscribe:match', ({ matchId }) => {
      const room = SocketRooms.match(matchId);
      socket.join(room);
      console.log(`[Socket.io] ${socket.id} joined match ${matchId}`);
    });

    socket.on('unsubscribe:match', ({ matchId }) => {
      socket.leave(SocketRooms.match(matchId));
    });

    // ─── Competition Subscription ────────────────────────────
    socket.on('subscribe:competition', ({ competitionId }) => {
      socket.join(SocketRooms.competition(competitionId));
    });

    socket.on('unsubscribe:competition', ({ competitionId }) => {
      socket.leave(SocketRooms.competition(competitionId));
    });

    // ─── Disconnect ──────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);
    });
  });

  // Start listening to Redis pub/sub channels and bridge to Socket.io rooms
  bridgeRedisPubSubToSocketRooms();

  console.log('[Socket.io] Gateway initialized');
  return io;
}

/**
 * Get the global Socket.io server instance.
 */
export function getIO(): Server<ClientSocketEvents, ServerSocketEvents> {
  if (!io) {
    throw new Error('[Socket.io] Gateway not initialized. Call initSocketGateway first.');
  }
  return io;
}

/**
 * Subscribe to Redis Pub/Sub channels and forward messages to Socket.io rooms.
 * This is the core bridge between the ingestion pipeline and connected clients.
 */
function bridgeRedisPubSubToSocketRooms(): void {
  const subscriber = getRedisSubscriber();

  // Pattern-subscribe to all match channels and the dashboard channel
  subscriber.psubscribe(
    RedisChannels.DASHBOARD,
    'channel:match:*',
    'channel:competition:*',
  ).catch((err) => {
    console.error('[Socket.io] Redis psubscribe error:', err);
  });

  subscriber.on('pmessage', (_pattern, channel, message) => {
    if (!io) return;

    try {
      const data = JSON.parse(message);

      if (channel === RedisChannels.DASHBOARD) {
        // Broadcast to all dashboard subscribers
        io.to(SocketRooms.DASHBOARD).emit('dashboard:delta', data);
      } else if (channel.startsWith('channel:match:')) {
        const matchId = channel.replace('channel:match:', '').replace(':predictions', '');
        const room = SocketRooms.match(matchId);

        if (channel.endsWith(':predictions')) {
          io.to(room).emit('match:prediction', data);
        } else if (data.event) {
          io.to(room).emit('match:event', data);
        } else if (data.stats) {
          io.to(room).emit('match:stats', data);
        } else if (data.lineups) {
          io.to(room).emit('match:lineup', data);
        } else if (data.status) {
          io.to(room).emit('match:status', data);
        }

        // Also emit flash banners to dashboard
        if (data.flashType) {
          io.to(SocketRooms.DASHBOARD).emit('flash:banner', data);
        }
      } else if (channel.startsWith('channel:competition:')) {
        const parts = channel.split(':');
        const compId = parts[2] ?? '';
        io.to(SocketRooms.competition(compId)).emit('match:standings', data);
      }
    } catch {
      console.error('[Socket.io] Failed to parse Redis message on channel:', channel);
    }
  });
}

/**
 * Publish a delta to the appropriate Redis channel, which then gets
 * bridged to Socket.io rooms via the subscriber above.
 */
export async function publishToChannel(
  channel: string,
  data: Record<string, unknown>,
): Promise<void> {
  const redis = getRedis();
  await redis.publish(channel, JSON.stringify(data));
}
