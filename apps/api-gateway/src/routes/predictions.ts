// ═══════════════════════════════════════════════════════════════
// FootStats — Predictions Routes
// ═══════════════════════════════════════════════════════════════

import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '@footstats/db';
import { getRedis } from '../infra/redis';
import { config } from '../config';

interface IdParams {
  id: string;
}

interface ProbabilityTicksQuerystring {
  limit?: string;
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

  // ─── GET /api/v1/predictions/live/:id ────────────────────
  // Returns the live predictions from the ML engine for a match.
  // These are the in-game win probabilities, NOT the pre-match model.
  app.get<{ Params: IdParams }>(
    '/api/v1/predictions/live/:id',
    async (req, reply) => {
      const { id } = req.params;
      const redis = getRedis();

      // Try Redis hot-cache first (predictions updated after every trigger)
      const cacheKey = `api:predictions:live:${id}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const match = await queryOne<{
        id: string;
        status: string;
        minute: number | null;
        added_time: number;
        home_score: number;
        away_score: number;
        predictions: Record<string, unknown> | null;
        home_name: string;
        away_name: string;
      }>(`
        SELECT
          m.id, m.status, m.minute, m.added_time,
          m.home_score, m.away_score, m.predictions,
          ht.name AS home_name, at2.name AS away_name
        FROM matches m
        JOIN teams ht  ON ht.id  = m.home_team_id
        JOIN teams at2 ON at2.id = m.away_team_id
        WHERE m.id = $1
      `, [id]);

      if (!match) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Match not found' },
        });
      }

      const predictions = match.predictions as {
        preMatch?: Record<string, unknown>;
        live?: {
          homeWin: number;
          draw: number;
          awayWin: number;
          updatedAt: string;
          triggerEvent?: string;
        };
      } | null;

      const response = {
        success: true,
        data: {
          matchId: match.id,
          status: match.status,
          minute: match.minute,
          homeScore: match.home_score,
          awayScore: match.away_score,
          homeTeam: match.home_name,
          awayTeam: match.away_name,
          live: predictions?.live ?? null,
          preMatch: predictions?.preMatch
            ? {
                homeWin: (predictions.preMatch as { homeWin: number }).homeWin,
                draw: (predictions.preMatch as { draw: number }).draw,
                awayWin: (predictions.preMatch as { awayWin: number }).awayWin,
                lambdaHome: (predictions.preMatch as { lambdaHome: number }).lambdaHome,
                lambdaAway: (predictions.preMatch as { lambdaAway: number }).lambdaAway,
                mostLikelyScoreline: (predictions.preMatch as { mostLikelyScoreline: [number, number] }).mostLikelyScoreline,
                over25: (predictions.preMatch as { over25: number }).over25,
                btts: (predictions.preMatch as { btts: number }).btts,
                modelVersion: (predictions.preMatch as { modelVersion: string }).modelVersion,
                calculatedAt: (predictions.preMatch as { calculatedAt: string }).calculatedAt,
              }
            : null,
        },
      };

      // Cache live predictions for 5 seconds (match is live)
      const ttl = ['1H', '2H', 'ET_1H', 'ET_2H'].includes(match.status)
        ? config.cache.liveMatch
        : config.cache.predictions;
      await redis.set(cacheKey, JSON.stringify(response), 'EX', ttl);

      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );

  // ─── GET /api/v1/predictions/probability-ticks/:id ───────
  // Returns the win probability time-series for the match chart.
  app.get<{ Params: IdParams; Querystring: ProbabilityTicksQuerystring }>(
    '/api/v1/predictions/probability-ticks/:id',
    async (req, reply) => {
      const { id } = req.params;
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit ?? '200', 10)));
      const redis = getRedis();

      const cacheKey = `api:predictions:ticks:${id}:${limit}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const ticks = await query<{
        time: string;
        minute: number | null;
        home_win_prob: number;
        draw_prob: number;
        away_win_prob: number;
        home_xg_live: number;
        away_xg_live: number;
        trigger_event: string | null;
        model_version: string;
      }>(`
        SELECT
          time, minute,
          home_win_prob, draw_prob, away_win_prob,
          home_xg_live, away_xg_live,
          trigger_event, model_version
        FROM match_probability_ticks
        WHERE match_id = $1
        ORDER BY time ASC
        LIMIT $2
      `, [id, limit]);

      const response = {
        success: true,
        data: {
          matchId: id,
          ticks: ticks.map((t) => ({
            time: t.time,
            minute: t.minute,
            homeWinProb: t.home_win_prob,
            drawProb: t.draw_prob,
            awayWinProb: t.away_win_prob,
            homeXgLive: t.home_xg_live,
            awayXgLive: t.away_xg_live,
            triggerEvent: t.trigger_event,
            modelVersion: t.model_version,
          })),
          total: ticks.length,
        },
      };

      // Cache for 5s if match is live, 10m otherwise
      await redis.set(cacheKey, JSON.stringify(response), 'EX', 10);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );

  // ─── GET /api/v1/predictions/momentum/:id ────────────────
  // Returns the recent momentum ticks for a live match.
  app.get<{ Params: IdParams; Querystring: ProbabilityTicksQuerystring }>(
    '/api/v1/predictions/momentum/:id',
    async (req, reply) => {
      const { id } = req.params;
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '50', 10)));
      const redis = getRedis();

      const cacheKey = `api:predictions:momentum:${id}:${limit}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        reply.header('X-Cache', 'HIT');
        return reply.send(JSON.parse(cached));
      }

      const ticks = await query<{
        time: string;
        minute: number | null;
        momentum_home: number;
        momentum_away: number;
        pressure_home: number;
        pressure_away: number;
        dominant_team: string;
      }>(`
        SELECT
          time, minute,
          momentum_home, momentum_away,
          pressure_home, pressure_away,
          dominant_team
        FROM match_momentum_ticks
        WHERE match_id = $1
        ORDER BY time DESC
        LIMIT $2
      `, [id, limit]);

      const response = {
        success: true,
        data: {
          matchId: id,
          ticks: ticks.reverse().map((t) => ({
            time: t.time,
            minute: t.minute,
            momentumHome: t.momentum_home,
            momentumAway: t.momentum_away,
            pressureHome: t.pressure_home,
            pressureAway: t.pressure_away,
            dominantTeam: t.dominant_team,
          })),
          total: ticks.length,
        },
      };

      await redis.set(cacheKey, JSON.stringify(response), 'EX', 10);
      reply.header('X-Cache', 'MISS');
      return reply.send(response);
    },
  );
}
