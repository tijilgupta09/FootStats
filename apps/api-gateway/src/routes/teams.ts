// ═══════════════════════════════════════════════════════════════
// FootStats — Team & Player Routes
// ═══════════════════════════════════════════════════════════════

import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '@footstats/db';
import { getRedis } from '../infra/redis';
import { config } from '../config';

interface IdParams {
  id: string;
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/teams/:id ────────────────────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/teams/:id',
    async (req, reply) => {
      const { id } = req.params;
      const redis = getRedis();

      const cacheKey = `api:team:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const team = await queryOne(`
        SELECT t.*,
          co.name AS country_name, co.flag_url AS country_flag,
          v.name AS venue_name, v.city AS venue_city,
          v.capacity AS venue_capacity, v.image_url AS venue_image
        FROM teams t
        LEFT JOIN countries co ON co.id = t.country_id
        LEFT JOIN venues v ON v.id = t.venue_id
        WHERE t.id = $1
      `, [id]);

      if (!team) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Team not found' },
        });
      }

      // Get recent results
      const recentMatches = await query(`
        SELECT m.id, m.kickoff_at, m.status, m.home_score, m.away_score,
          ht.name AS home_team_name, ht.short_name AS home_short, ht.logo_url AS home_logo,
          at2.name AS away_team_name, at2.short_name AS away_short, at2.logo_url AS away_logo,
          c.name AS competition_name, c.short_name AS competition_short
        FROM matches m
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        JOIN competitions c ON c.id = m.competition_id
        WHERE (m.home_team_id = $1 OR m.away_team_id = $1)
          AND m.status IN ('FT', 'AET', 'AP')
        ORDER BY m.kickoff_at DESC
        LIMIT 10
      `, [id]);

      // Get Elo history
      const eloHistory = await query(`
        SELECT date, elo, elo_delta
        FROM team_elo_history
        WHERE team_id = $1
        ORDER BY date DESC
        LIMIT 50
      `, [id]);

      // Get current squad
      const squad = await query(`
        SELECT id, name, short_name, position, shirt_number,
          date_of_birth, photo_url, market_value_eur
        FROM players
        WHERE current_team_id = $1 AND is_active = true
        ORDER BY
          CASE position
            WHEN 'GK' THEN 1
            WHEN 'CB' THEN 2 WHEN 'LB' THEN 3 WHEN 'RB' THEN 4
            WHEN 'LWB' THEN 5 WHEN 'RWB' THEN 6
            WHEN 'CDM' THEN 7 WHEN 'CM' THEN 8 WHEN 'CAM' THEN 9
            WHEN 'LM' THEN 10 WHEN 'RM' THEN 11
            WHEN 'LW' THEN 12 WHEN 'RW' THEN 13
            WHEN 'CF' THEN 14 WHEN 'ST' THEN 15
            ELSE 16
          END,
          shirt_number NULLS LAST
      `, [id]);

      const response = {
        success: true,
        data: { team, recentMatches, eloHistory, squad },
      };

      await redis.set(cacheKey, JSON.stringify(response), 'EX', config.cache.teamProfile);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );
}

export async function playerRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/players/:id ──────────────────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/players/:id',
    async (req, reply) => {
      const { id } = req.params;
      const redis = getRedis();

      const cacheKey = `api:player:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const player = await queryOne(`
        SELECT p.*,
          co.name AS nationality_name, co.flag_url AS nationality_flag,
          t.name AS team_name, t.short_name AS team_short, t.logo_url AS team_logo
        FROM players p
        LEFT JOIN countries co ON co.id = p.nationality_id
        LEFT JOIN teams t ON t.id = p.current_team_id
        WHERE p.id = $1
      `, [id]);

      if (!player) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Player not found' },
        });
      }

      // Recent match events for this player
      const recentEvents = await query(`
        SELECT me.*, m.kickoff_at,
          ht.name AS home_team_name, at2.name AS away_team_name,
          c.short_name AS competition_short
        FROM match_events me
        JOIN matches m ON m.id = me.match_id
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        JOIN competitions c ON c.id = m.competition_id
        WHERE me.player_id = $1
        ORDER BY m.kickoff_at DESC
        LIMIT 30
      `, [id]);

      const response = {
        success: true,
        data: { player, recentEvents },
      };

      await redis.set(cacheKey, JSON.stringify(response), 'EX', config.cache.playerProfile);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );
}
