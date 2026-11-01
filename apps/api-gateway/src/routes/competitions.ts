// ═══════════════════════════════════════════════════════════════
// FootStats — Competition & Standings Routes
// ═══════════════════════════════════════════════════════════════

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@footstats/db';
import { getRedis } from '../infra/redis';
import { RedisKeys } from '@footstats/shared-types';
import { config } from '../config';

interface IdParams {
  id: string;
}

export async function competitionRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/competitions ─────────────────────────────
  app.get('/api/v1/competitions', async (_req: FastifyRequest, reply: FastifyReply) => {
    const redis = getRedis();
    const cached = await redis.get('api:competitions');
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return reply.send(JSON.parse(cached));
    }

    const competitions = await query(`
      SELECT c.*, co.name AS country_name, co.flag_url AS country_flag
      FROM competitions c
      LEFT JOIN countries co ON co.id = c.country_id
      WHERE c.is_active = true
      ORDER BY c.tier, c.display_order, c.name
    `);

    const response = { success: true, data: competitions };
    await redis.set('api:competitions', JSON.stringify(response), 'EX', config.cache.competitions);

    reply.header('X-Cache', 'MISS');
    return reply.send(response);
  });

  // ─── GET /api/v1/competitions/:id/standings ───────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/competitions/:id/standings',
    async (req, reply) => {
      const { id } = req.params;
      const redis = getRedis();

      // Get current season
      const season = await queryOne<Record<string, unknown>>(
        `SELECT id, name FROM seasons WHERE competition_id = $1 AND is_current = true`,
        [id],
      );

      if (!season) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NO_CURRENT_SEASON', message: 'No active season found' },
        });
      }

      const seasonId = season['id'] as string;
      const cacheKey = RedisKeys.standingsCache(id, seasonId);
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const standings = await query(`
        SELECT
          s.*,
          t.name AS team_name, t.short_name AS team_short_name,
          t.logo_url AS team_logo, t.code AS team_code
        FROM standings s
        JOIN teams t ON t.id = s.team_id
        WHERE s.competition_id = $1 AND s.season_id = $2
        ORDER BY s.group_name NULLS FIRST, s.position ASC
      `, [id, seasonId]);

      // Group by group_name if applicable (e.g., Champions League groups)
      const groups = new Map<string, unknown[]>();
      for (const row of standings as Record<string, unknown>[]) {
        const groupName = (row['group_name'] as string | null) ?? '__default__';
        if (!groups.has(groupName)) {
          groups.set(groupName, []);
        }
        groups.get(groupName)!.push(row);
      }

      const competition = await queryOne(
        `SELECT id, name, short_name, logo_url, tier FROM competitions WHERE id = $1`,
        [id],
      );

      const response = {
        success: true,
        data: {
          competition,
          seasonName: season['name'],
          groups: Array.from(groups.entries()).map(([name, rows]) => ({
            groupName: name === '__default__' ? null : name,
            rows,
          })),
        },
      };

      await redis.set(cacheKey, JSON.stringify(response), 'EX', config.cache.standings);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );

  // ─── GET /api/v1/competitions/:id/fixtures ────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/competitions/:id/fixtures',
    async (req, reply) => {
      const { id } = req.params;

      const season = await queryOne<Record<string, unknown>>(
        `SELECT id FROM seasons WHERE competition_id = $1 AND is_current = true`,
        [id],
      );

      if (!season) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NO_CURRENT_SEASON', message: 'No active season found' },
        });
      }

      const fixtures = await query(`
        SELECT
          m.id, m.matchday, m.round_name, m.kickoff_at, m.status,
          m.home_score, m.away_score, m.minute,
          ht.id AS home_id, ht.name AS home_name, ht.short_name AS home_short,
          ht.logo_url AS home_logo,
          at2.id AS away_id, at2.name AS away_name, at2.short_name AS away_short,
          at2.logo_url AS away_logo
        FROM matches m
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        WHERE m.competition_id = $1 AND m.season_id = $2
        ORDER BY m.matchday NULLS LAST, m.kickoff_at
      `, [id, season['id']]);

      return reply.send({ success: true, data: fixtures });
    },
  );
}
