// ═══════════════════════════════════════════════════════════════
// FootStats — Match Routes
// ═══════════════════════════════════════════════════════════════

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@footstats/db';
import { getRedis } from '../infra/redis';
import { RedisKeys } from '@footstats/shared-types';
import { config } from '../config';

interface DateParams {
  date: string;
}

interface IdParams {
  id: string;
}

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/matches/live ─────────────────────────────
  app.get('/api/v1/matches/live', async (_req: FastifyRequest, reply: FastifyReply) => {
    const redis = getRedis();

    // Try cache first
    const cached = await redis.get('api:matches:live');
    if (cached) {
      reply.header('X-Cache', 'HIT');
      return reply.send(JSON.parse(cached));
    }

    const matches = await query(`
      SELECT
        m.id, m.competition_id, m.status, m.minute, m.added_time,
        m.home_score, m.away_score, m.home_ht_score, m.away_ht_score,
        m.home_pen_score, m.away_pen_score, m.kickoff_at,
        m.predictions,
        c.id AS comp_id, c.name AS comp_name, c.short_name AS comp_short_name,
        c.logo_url AS comp_logo, c.tier AS comp_tier, c.display_order AS comp_order,
        c.country_id AS comp_country_id,
        ht.id AS home_id, ht.name AS home_name, ht.short_name AS home_short,
        ht.logo_url AS home_logo,
        at2.id AS away_id, at2.name AS away_name, at2.short_name AS away_short,
        at2.logo_url AS away_logo
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN teams ht ON ht.id = m.home_team_id
      JOIN teams at2 ON at2.id = m.away_team_id
      WHERE m.status IN ('1H', 'HT', '2H', 'ET_1H', 'ET_HT', 'ET_2H', 'BT', 'PEN')
      ORDER BY c.tier, c.display_order, m.kickoff_at
    `);

    const response = formatCompetitionGroups(matches);

    await redis.set('api:matches:live', JSON.stringify(response), 'EX', config.cache.liveMatch);
    reply.header('X-Cache', 'MISS');
    return reply.send(response);
  });

  // ─── GET /api/v1/matches/date/:date ───────────────────────
  app.get<{ Params: DateParams }>(
    '/api/v1/matches/date/:date',
    async (req, reply) => {
      const { date } = req.params;

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_DATE', message: 'Date must be YYYY-MM-DD format' },
        });
      }

      const redis = getRedis();
      const cacheKey = RedisKeys.dashboardCache(date);
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const matches = await query(`
        SELECT
          m.id, m.competition_id, m.status, m.minute, m.added_time,
          m.home_score, m.away_score, m.home_ht_score, m.away_ht_score,
          m.home_pen_score, m.away_pen_score, m.kickoff_at,
          m.predictions,
          c.id AS comp_id, c.name AS comp_name, c.short_name AS comp_short_name,
          c.logo_url AS comp_logo, c.tier AS comp_tier, c.display_order AS comp_order,
          c.country_id AS comp_country_id,
          ht.id AS home_id, ht.name AS home_name, ht.short_name AS home_short,
          ht.logo_url AS home_logo,
          at2.id AS away_id, at2.name AS away_name, at2.short_name AS away_short,
          at2.logo_url AS away_logo
        FROM matches m
        JOIN competitions c ON c.id = m.competition_id
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        WHERE (m.kickoff_at::date) = $1
        ORDER BY c.tier, c.display_order, m.kickoff_at
      `, [date]);

      const response = formatCompetitionGroups(matches);

      // Cache longer for past dates
      const today = new Date().toISOString().split('T')[0];
      const ttl = date < (today ?? '') ? 3600 : 60;
      await redis.set(cacheKey, JSON.stringify(response), 'EX', ttl);

      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );

  // ─── GET /api/v1/matches/:id ──────────────────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/matches/:id',
    async (req, reply) => {
      const { id } = req.params;
      const redis = getRedis();

      // Check hot cache for live matches
      const cached = await redis.get(RedisKeys.matchFull(id));
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const match = await queryOne(`
        SELECT
          m.*,
          c.name AS competition_name, c.short_name AS competition_short_name,
          c.logo_url AS competition_logo, c.tier AS competition_tier,
          ht.name AS home_team_name, ht.short_name AS home_team_short,
          ht.logo_url AS home_team_logo, ht.current_elo AS home_team_elo,
          at2.name AS away_team_name, at2.short_name AS away_team_short,
          at2.logo_url AS away_team_logo, at2.current_elo AS away_team_elo,
          v.name AS venue_name, v.city AS venue_city, v.capacity AS venue_capacity
        FROM matches m
        JOIN competitions c ON c.id = m.competition_id
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        LEFT JOIN venues v ON v.id = m.venue_id
        WHERE m.id = $1
      `, [id]);

      if (!match) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Match not found' },
        });
      }

      // Fetch events
      const events = await query(`
        SELECT * FROM match_events
        WHERE match_id = $1
        ORDER BY minute ASC, added_time ASC, sort_order ASC
      `, [id]);

      // Fetch probability ticks
      const probabilityTicks = await query(`
        SELECT * FROM match_probability_ticks
        WHERE match_id = $1
        ORDER BY time ASC
      `, [id]);

      const response = {
        success: true,
        data: {
          match,
          events,
          probabilityTicks,
        },
      };

      // Cache: short for live, long for finished
      const isLive = ['1H', 'HT', '2H', 'ET_1H', 'ET_HT', 'ET_2H', 'BT', 'PEN'].includes(
        (match as Record<string, unknown>)['status'] as string,
      );
      const ttl = isLive ? config.cache.liveMatch : config.cache.finishedMatch;
      await redis.set(RedisKeys.matchFull(id), JSON.stringify(response), 'EX', ttl);

      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );

  // ─── GET /api/v1/matches/:id/timeline ─────────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/matches/:id/timeline',
    async (req, reply) => {
      const events = await query(`
        SELECT * FROM match_events
        WHERE match_id = $1
        ORDER BY minute ASC, added_time ASC, sort_order ASC
      `, [req.params.id]);

      return reply.send({ success: true, data: events });
    },
  );

  // ─── GET /api/v1/matches/:id/probabilities ────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/matches/:id/probabilities',
    async (req, reply) => {
      const ticks = await query(`
        SELECT time, minute, home_win_prob, draw_prob, away_win_prob,
               home_xg_live, away_xg_live, trigger_event, model_version
        FROM match_probability_ticks
        WHERE match_id = $1
        ORDER BY time ASC
      `, [req.params.id]);

      return reply.send({ success: true, data: ticks });
    },
  );

  // ─── GET /api/v1/matches/:id/h2h ──────────────────────────
  app.get<{ Params: IdParams }>(
    '/api/v1/matches/:id/h2h',
    async (req, reply) => {
      // First get the match to know the two teams
      const match = await queryOne<Record<string, unknown>>(
        'SELECT home_team_id, away_team_id FROM matches WHERE id = $1',
        [req.params.id],
      );

      if (!match) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Match not found' },
        });
      }

      const h2hMatches = await query(`
        SELECT m.*, ht.name AS home_team_name, at2.name AS away_team_name
        FROM matches m
        JOIN teams ht ON ht.id = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        WHERE (
          (m.home_team_id = $1 AND m.away_team_id = $2)
          OR (m.home_team_id = $2 AND m.away_team_id = $1)
        )
        AND m.status IN ('FT', 'AET', 'AP')
        ORDER BY m.kickoff_at DESC
        LIMIT 20
      `, [match['home_team_id'], match['away_team_id']]);

      return reply.send({ success: true, data: { matches: h2hMatches } });
    },
  );
}

// ─── Helper: Format flat match rows into competition groups ──

function formatCompetitionGroups(rows: unknown[]): Record<string, unknown> {
  const groups = new Map<string, { competition: Record<string, unknown>; matches: unknown[] }>();

  for (const row of rows as Record<string, unknown>[]) {
    const compId = row['comp_id'] as string;
    if (!groups.has(compId)) {
      groups.set(compId, {
        competition: {
          id: compId,
          name: row['comp_name'],
          shortName: row['comp_short_name'],
          logoUrl: row['comp_logo'],
          tier: row['comp_tier'],
          countryId: row['comp_country_id'],
        },
        matches: [],
      });
    }

    groups.get(compId)!.matches.push({
      id: row['id'],
      competitionId: compId,
      homeTeam: {
        id: row['home_id'],
        name: row['home_name'],
        shortName: row['home_short'],
        logoUrl: row['home_logo'],
      },
      awayTeam: {
        id: row['away_id'],
        name: row['away_name'],
        shortName: row['away_short'],
        logoUrl: row['away_logo'],
      },
      kickoffAt: row['kickoff_at'],
      status: row['status'],
      minute: row['minute'],
      addedTime: row['added_time'],
      homeScore: row['home_score'],
      awayScore: row['away_score'],
      homeHtScore: row['home_ht_score'],
      awayHtScore: row['away_ht_score'],
      homePenScore: row['home_pen_score'],
      awayPenScore: row['away_pen_score'],
      predictions: row['predictions'],
    });
  }

  return {
    success: true,
    data: Array.from(groups.values()),
    meta: { total: rows.length },
  };
}
