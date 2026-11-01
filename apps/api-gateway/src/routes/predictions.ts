// ═══════════════════════════════════════════════════════════════
// FootStats — Predictions Routes
// ═══════════════════════════════════════════════════════════════

import type { FastifyInstance } from 'fastify';
import { queryOne } from '@footstats/db';
import { getRedis } from '../infra/redis';
import { config } from '../config';

interface IdParams {
  id: string;
}

export async function predictionRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/predictions/pre-match/:id ────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/predictions/pre-match/:id',
    async (req, reply) => {
      const { id } = req.params;
      const redis = getRedis();

      const cacheKey = `api:predictions:prematch:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const match = await queryOne<Record<string, unknown>>(`
        SELECT
          m.id, m.kickoff_at, m.status, m.predictions,
          ht.name AS home_name, ht.short_name AS home_short,
          ht.logo_url AS home_logo, ht.current_elo AS home_elo,
          at2.name AS away_name, at2.short_name AS away_short,
          at2.logo_url AS away_logo, at2.current_elo AS away_elo
        FROM matches m
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        WHERE m.id = $1
      `, [id]);

      if (!match) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Match not found' },
        });
      }

      const response = {
        success: true,
        data: {
          matchId: id,
          kickoffAt: match['kickoff_at'],
          status: match['status'],
          homeTeam: {
            name: match['home_name'],
            shortName: match['home_short'],
            logoUrl: match['home_logo'],
            elo: match['home_elo'],
          },
          awayTeam: {
            name: match['away_name'],
            shortName: match['away_short'],
            logoUrl: match['away_logo'],
            elo: match['away_elo'],
          },
          predictions: match['predictions'],
        },
      };

      await redis.set(cacheKey, JSON.stringify(response), 'EX', config.cache.predictions);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );
}
