// ═══════════════════════════════════════════════════════════════
// FootStats — News & Search Routes
// ═══════════════════════════════════════════════════════════════

import type { FastifyInstance } from 'fastify';
import { query } from '@footstats/db';
import { getRedis } from '../infra/redis';
import { config } from '../config';

interface NewsQuerystring {
  page?: string;
  perPage?: string;
  category?: string;
  teamId?: string;
  competitionId?: string;
}

interface SearchQuerystring {
  q: string;
  limit?: string;
}

export async function newsRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/news ─────────────────────────────────────
  app.get<{ Querystring: NewsQuerystring }>(
    '/api/v1/news',
    async (req, reply) => {
      const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
      const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage ?? '20', 10)));
      const offset = (page - 1) * perPage;
      const { category, teamId, competitionId } = req.query;

      // Build dynamic query
      const conditions: string[] = ['n.is_published = true'];
      const params: unknown[] = [];
      let paramIdx = 0;

      if (category) {
        paramIdx++;
        conditions.push(`n.category = $${paramIdx}`);
        params.push(category);
      }

      if (teamId) {
        paramIdx++;
        conditions.push(`$${paramIdx}::uuid = ANY(n.tagged_team_ids)`);
        params.push(teamId);
      }

      if (competitionId) {
        paramIdx++;
        conditions.push(`$${paramIdx}::uuid = ANY(n.tagged_competition_ids)`);
        params.push(competitionId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Count total
      const countResult = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM news_articles n ${whereClause}`,
        params,
      );
      const total = parseInt(countResult[0]?.count ?? '0', 10);

      // Fetch page
      paramIdx++;
      const limitParam = paramIdx;
      paramIdx++;
      const offsetParam = paramIdx;
      params.push(perPage, offset);

      const articles = await query(
        `SELECT n.id, n.source_name, n.source_url, n.source_tier,
                n.title, n.summary, n.thumbnail_url, n.author,
                n.published_at, n.category, n.canonical_story_id,
                n.tagged_team_ids, n.tagged_competition_ids, n.tagged_player_ids
         FROM news_articles n
         ${whereClause}
         ORDER BY n.published_at DESC
         LIMIT $${limitParam} OFFSET $${offsetParam}`,
        params,
      );

      return reply.send({
        success: true,
        data: articles,
        meta: {
          page,
          perPage,
          total,
          totalPages: Math.ceil(total / perPage),
        },
      });
    },
  );
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /api/v1/search ───────────────────────────────────
  app.get<{ Querystring: SearchQuerystring }>(
    '/api/v1/search',
    async (req, reply) => {
      const { q } = req.query;
      const limit = Math.min(25, Math.max(1, parseInt(req.query.limit ?? '10', 10)));

      if (!q || q.trim().length < 2) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_QUERY', message: 'Query must be at least 2 characters' },
        });
      }

      const redis = getRedis();
      const cacheKey = `api:search:${q.toLowerCase().trim()}:${limit}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const startTime = Date.now();

      // Search across competitions, teams, and players using pg_trgm
      const searchTerm = `%${q.trim()}%`;

      const [competitions, teams, players] = await Promise.all([
        query(`
          SELECT id, name, short_name AS subtitle, logo_url AS "imageUrl",
                 similarity(name, $1) AS score
          FROM competitions
          WHERE name % $1 OR name ILIKE $2
          ORDER BY similarity(name, $1) DESC
          LIMIT $3
        `, [q, searchTerm, limit]),
        query(`
          SELECT id, name, short_name AS subtitle, logo_url AS "imageUrl",
                 similarity(name, $1) AS score
          FROM teams
          WHERE name % $1 OR name ILIKE $2
          ORDER BY similarity(name, $1) DESC
          LIMIT $3
        `, [q, searchTerm, limit]),
        query(`
          SELECT id, name, display_name AS subtitle, photo_url AS "imageUrl",
                 similarity(name, $1) AS score
          FROM players
          WHERE (name % $1 OR name ILIKE $2) AND is_active = true
          ORDER BY similarity(name, $1) DESC
          LIMIT $3
        `, [q, searchTerm, limit]),
      ]);

      // Merge and sort by relevance score
      const results = [
        ...(competitions as Record<string, unknown>[]).map((r) => ({ type: 'COMPETITION', ...r })),
        ...(teams as Record<string, unknown>[]).map((r) => ({ type: 'TEAM', ...r })),
        ...(players as Record<string, unknown>[]).map((r) => ({ type: 'PLAYER', ...r })),
      ].sort((a, b) => (b['score'] as number) - (a['score'] as number))
       .slice(0, limit);

      const processingTimeMs = Date.now() - startTime;

      const response = {
        success: true,
        data: {
          query: q,
          results,
          total: results.length,
          processingTimeMs,
        },
      };

      await redis.set(cacheKey, JSON.stringify(response), 'EX', config.cache.search);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );
}
