// ═══════════════════════════════════════════════════════════════
// FootStats — ML Inference Engine (Kafka Consumer + BullMQ Worker)
// ═══════════════════════════════════════════════════════════════
//
// Listens on the `ml.inference.trigger` Kafka topic. For each
// trigger message:
//
//   1. Load the match from PostgreSQL (team ELOs, pre-match λ).
//   2. If pre-match predictions don't exist, run the Poisson model.
//   3. Run the live win-probability engine (recalculate every trigger).
//   4. Run the momentum calculator using recent events.
//   5. Persist:
//        - match.predictions (JSONB) ← pre-match + live
//        - match_probability_ticks (time-series row)
//        - match_momentum_ticks     (time-series row)
//   6. Publish prediction delta to Redis channel for WebSocket push.
//

import { createConsumer } from '../infra/kafka';
import { getRedis } from '../infra/redis';
import { query, queryOne } from '@footstats/db';
import { KafkaTopics, RedisChannels } from '@footstats/shared-types';
import type { EachMessagePayload } from 'kafkajs';

import { runPoissonModel, MODEL_VERSION } from './poisson';
import { calculateLiveWinProbability, defaultTeamRatings } from './live-probability';
import { calculateMomentum, type MomentumEvent, type MatchStats as MomentumMatchStats } from './momentum';

// ─── Types ───────────────────────────────────────────────────

interface InferenceTrigger {
  matchProviderId: string;
  minute: number;
  homeScore: number;
  awayScore: number;
  stats?: Record<string, unknown> | null;
  triggerReason: 'NEW_MATCH' | 'STATE_CHANGE';
  timestamp: string;
}

interface DbMatch {
  id: string;
  home_team_id: string;
  away_team_id: string;
  status: string;
  minute: number | null;
  added_time: number;
  home_score: number;
  away_score: number;
  predictions: Record<string, unknown> | null;
  stats: Record<string, unknown> | null;
  home_elo: number;
  away_elo: number;
}

interface DbEvent {
  event_type: string;
  minute: number;
  added_time: number;
  is_home: boolean | null;
}

// ─── Consumer Group ──────────────────────────────────────────

const ML_CONSUMER_GROUP = 'footstats-ml-inference';

// ─── League Average Goals ────────────────────────────────────

/**
 * Hardcoded league averages (goals per match, home + away combined).
 * In Phase 5, these will be computed dynamically from the DB.
 */
const LEAGUE_AVG_GOALS: Record<string, number> = {
  default: 2.65,
  'Premier League': 2.80,
  'La Liga': 2.60,
  'Serie A': 2.55,
  'Bundesliga': 3.10,
  'Ligue 1': 2.60,
  'Champions League': 2.85,
};

function getLeagueAvg(competitionName?: string): number {
  if (competitionName && LEAGUE_AVG_GOALS[competitionName]) {
    return LEAGUE_AVG_GOALS[competitionName]!;
  }
  return LEAGUE_AVG_GOALS['default']!;
}

// ─── Main Inference Handler ──────────────────────────────────

async function handleInferenceTrigger(payload: EachMessagePayload): Promise<void> {
  const { message } = payload;
  if (!message.value) return;

  let trigger: InferenceTrigger;
  try {
    trigger = JSON.parse(message.value.toString()) as InferenceTrigger;
  } catch {
    console.warn('[ML] Failed to parse inference trigger');
    return;
  }

  const { matchProviderId, minute, homeScore, awayScore, triggerReason } = trigger;

  try {
    // ── 1. Load match from DB ──────────────────────────────
    const match = await queryOne<DbMatch>(`
      SELECT
        m.id, m.home_team_id, m.away_team_id,
        m.status, m.minute, m.added_time,
        m.home_score, m.away_score,
        m.predictions, m.stats,
        ht.current_elo AS home_elo,
        at2.current_elo AS away_elo
      FROM matches m
      JOIN teams ht  ON ht.id  = m.home_team_id
      JOIN teams at2 ON at2.id = m.away_team_id
      WHERE m.id = $1
         OR m.provider_ids->>'mock' = $1
    `, [matchProviderId]);

    if (!match) {
      console.warn(`[ML] Match not found for trigger: ${matchProviderId}`);
      return;
    }

    const matchId = match.id;

    // ── 2. Build team ratings ──────────────────────────────
    const homeRatings = defaultTeamRatings(match.home_elo ?? 1500);
    const awayRatings = defaultTeamRatings(match.away_elo ?? 1500);

    // Count in-game red cards from recent events
    const recentEvents = await query<DbEvent>(`
      SELECT event_type, minute, added_time, is_home
      FROM match_events
      WHERE match_id = $1
      ORDER BY minute ASC, added_time ASC
    `, [matchId]);

    const homeRedCards = recentEvents.filter(
      (e) => e.is_home === true && ['RED_CARD', 'SECOND_YELLOW'].includes(e.event_type),
    ).length;
    const awayRedCards = recentEvents.filter(
      (e) => e.is_home === false && ['RED_CARD', 'SECOND_YELLOW'].includes(e.event_type),
    ).length;

    const leagueAvg = getLeagueAvg();

    // ── 3. Pre-match Poisson model ─────────────────────────
    // Run only once per match (or on NEW_MATCH trigger)
    const existingPredictions = match.predictions as {
      preMatch?: Record<string, unknown>;
      live?: Record<string, unknown>;
    } | null;

    let preMatchPrediction = existingPredictions?.preMatch ?? null;

    if (!preMatchPrediction || triggerReason === 'NEW_MATCH') {
      const poissonResult = runPoissonModel({
        home: homeRatings,
        away: awayRatings,
        leagueAvgGoals: leagueAvg,
        homeRedCards: 0,
        awayRedCards: 0,
      });
      preMatchPrediction = poissonResult as unknown as Record<string, unknown>;
    }

    // ── 4. Live win probability ────────────────────────────
    const preMatch = preMatchPrediction as {
      lambdaHome?: number;
      lambdaAway?: number;
    };

    const liveProb = calculateLiveWinProbability({
      baselineLambdaHome: preMatch.lambdaHome ?? 1.35,
      baselineLambdaAway: preMatch.lambdaAway ?? 1.10,
      homeScore: homeScore ?? match.home_score,
      awayScore: awayScore ?? match.away_score,
      minute: minute ?? match.minute ?? 0,
      addedTime: match.added_time,
      period: match.status,
      homeRedCards,
      awayRedCards,
      triggerEvent: triggerReason,
    });

    // ── 5. Momentum ────────────────────────────────────────
    const momentumEvents: MomentumEvent[] = recentEvents.map((e) => ({
      eventType: e.event_type,
      minute: e.minute,
      addedTime: e.added_time,
      teamSide: e.is_home ? 'home' : 'away',
    }));

    const matchStatsRaw = (trigger.stats ?? match.stats) as {
      home?: Partial<MomentumMatchStats['home']>;
      away?: Partial<MomentumMatchStats['away']>;
    } | null;

    const momentumStats: MomentumMatchStats = {
      home: matchStatsRaw?.home ?? {},
      away: matchStatsRaw?.away ?? {},
    };

    const momentum = calculateMomentum(
      momentumEvents,
      momentumStats,
      minute ?? match.minute ?? 0,
    );

    // ── 6. Persist predictions to match row ───────────────
    const updatedPredictions = {
      preMatch: preMatchPrediction,
      live: {
        homeWin: liveProb.homeWin,
        draw: liveProb.draw,
        awayWin: liveProb.awayWin,
        updatedAt: liveProb.updatedAt,
        triggerEvent: liveProb.triggerEvent,
      },
    };

    await query(`
      UPDATE matches
      SET predictions = $1::jsonb,
          updated_at  = NOW()
      WHERE id = $2
    `, [JSON.stringify(updatedPredictions), matchId]);

    // ── 7. Write probability tick (time-series) ────────────
    await query(`
      INSERT INTO match_probability_ticks (
        match_id, time, minute,
        home_win_prob, draw_prob, away_win_prob,
        home_xg_live, away_xg_live,
        trigger_event, model_version
      ) VALUES (
        $1, NOW(), $2,
        $3, $4, $5,
        $6, $7,
        $8, $9
      )
      ON CONFLICT DO NOTHING
    `, [
      matchId,
      minute ?? match.minute,
      liveProb.homeWin,
      liveProb.draw,
      liveProb.awayWin,
      liveProb.homeXgLive,
      liveProb.awayXgLive,
      triggerReason,
      MODEL_VERSION,
    ]);

    // ── 8. Write momentum tick (time-series) ───────────────
    await query(`
      INSERT INTO match_momentum_ticks (
        match_id, time, minute,
        momentum_home, momentum_away,
        pressure_home, pressure_away,
        dominant_team
      ) VALUES (
        $1, NOW(), $2,
        $3, $4,
        $5, $6,
        $7
      )
      ON CONFLICT DO NOTHING
    `, [
      matchId,
      minute ?? match.minute,
      momentum.momentumHome,
      momentum.momentumAway,
      momentum.pressureHome,
      momentum.pressureAway,
      momentum.dominantTeam,
    ]);

    // ── 9. Publish to Redis for WebSocket bridge ───────────
    const redis = getRedis();
    const predictionPayload = {
      matchId,
      version: Date.now(),
      timestamp: new Date().toISOString(),
      predictions: updatedPredictions,
      momentum: {
        momentumHome: momentum.momentumHome,
        momentumAway: momentum.momentumAway,
        pressureHome: momentum.pressureHome,
        pressureAway: momentum.pressureAway,
        dominantTeam: momentum.dominantTeam,
      },
    };

    await redis.publish(
      RedisChannels.matchPredictions(matchId),
      JSON.stringify(predictionPayload),
    );

    console.log(
      `[ML] ✓ ${matchId} | minute=${minute} | ` +
      `home=${(liveProb.homeWin * 100).toFixed(1)}% ` +
      `draw=${(liveProb.draw * 100).toFixed(1)}% ` +
      `away=${(liveProb.awayWin * 100).toFixed(1)}% | ` +
      `momentum=${momentum.momentumHome}/${momentum.momentumAway}`,
    );
  } catch (err) {
    console.error(`[ML] Error processing inference trigger for ${matchProviderId}:`, err);
  }
}

// ─── Consumer Starter ────────────────────────────────────────

/**
 * Start the ML inference Kafka consumer.
 * Called from the ingestion orchestrator.
 */
export async function startMlInferenceConsumer(): Promise<void> {
  await createConsumer(
    ML_CONSUMER_GROUP,
    [KafkaTopics.ML_INFERENCE_TRIGGER],
    handleInferenceTrigger,
  );
  console.log('[ML] Inference consumer started — listening on ml.inference.trigger');
}
