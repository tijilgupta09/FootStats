// ═══════════════════════════════════════════════════════════════
// FootStats — Live Win Probability Engine
// ═══════════════════════════════════════════════════════════════
//
// In-game win probability recalculated on every state-altering
// event (goal, red card, penalty awarded).
//
// Method:
//   1. Scale pre-match λ values by time remaining (minutes left / 90).
//   2. Adjust λ for in-game red card penalties.
//   3. Build the remaining-goals scoreline matrix.
//   4. Convolve with the current score to get full-time probabilities.
//   5. Apply a time-decay boost that compresses uncertainty near FT.
//
// All calculations are synchronous and pure — no I/O, easy to test.
//

import {
  calculateExpectedGoals,
  buildScorelineMatrix,
  deriveOutcomes,
  scaleForRemainingTime,
  MODEL_VERSION,
  type TeamRatings,
} from './poisson';

// ─── Types ───────────────────────────────────────────────────

export interface LiveProbInput {
  /** Pre-match baseline λ for the home team */
  baselineLambdaHome: number;
  /** Pre-match baseline λ for the away team */
  baselineLambdaAway: number;
  /** Current home score */
  homeScore: number;
  /** Current away score */
  awayScore: number;
  /** Current match minute */
  minute: number;
  /** Added time (injury time) in the current period */
  addedTime?: number;
  /** Current match period identifier */
  period?: string;
  /** Home red cards accumulated in-game */
  homeRedCards?: number;
  /** Away red cards accumulated in-game */
  awayRedCards?: number;
  /** Event that triggered recalculation */
  triggerEvent?: string;
}

export interface LiveProbOutput {
  homeWin: number;
  draw: number;
  awayWin: number;
  homeXgLive: number;
  awayXgLive: number;
  triggerEvent: string;
  modelVersion: string;
  updatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────

/** Red card reduces a team's remaining λ by this fraction. */
const RED_CARD_LAMBDA_REDUCTION = 0.18;

// ─── Live Probability Calculation ───────────────────────────

/**
 * Calculate in-game win probabilities for the given match state.
 *
 * The algorithm:
 *   a) Scale baseline λ by remaining time fraction.
 *   b) Apply red-card penalties on remaining λ.
 *   c) Build a "remaining goals" scoreline matrix.
 *   d) Convolve with current score: P(FT result | current score, remaining λ).
 *   e) Re-normalise and return.
 */
export function calculateLiveWinProbability(input: LiveProbInput): LiveProbOutput {
  const {
    baselineLambdaHome,
    baselineLambdaAway,
    homeScore,
    awayScore,
    minute,
    addedTime = 0,
    period,
    homeRedCards = 0,
    awayRedCards = 0,
    triggerEvent = 'PERIODIC',
  } = input;

  // Effective elapsed time (including added time)
  const effectiveMinute = Math.min(minute + addedTime, 120);

  // ── Step 1: scale λ for remaining time ──────────────────
  const { scaledHome: remainingLambdaHome, scaledAway: remainingLambdaAway } =
    scaleForRemainingTime(baselineLambdaHome, baselineLambdaAway, effectiveMinute, period);

  // ── Step 2: apply in-game red card penalties ─────────────
  const penalisedHome =
    remainingLambdaHome * Math.pow(1 - RED_CARD_LAMBDA_REDUCTION, homeRedCards);
  const penalisedAway =
    remainingLambdaAway * Math.pow(1 - RED_CARD_LAMBDA_REDUCTION, awayRedCards);

  // ── Step 3: build remaining-goals matrix ─────────────────
  const remainingMatrix = buildScorelineMatrix(
    Math.max(penalisedHome, 0.01),
    Math.max(penalisedAway, 0.01),
  );

  // ── Step 4: convolve with current score ──────────────────
  // For each possible additional score (dh, da), compute the
  // probability of the resulting full-time score.
  const size = remainingMatrix.length;
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let dh = 0; dh < size; dh++) {
    for (let da = 0; da < size; da++) {
      const p = remainingMatrix[dh]![da]!;
      if (p < 1e-10) continue; // skip negligible cells

      const ftHome = homeScore + dh;
      const ftAway = awayScore + da;

      if (ftHome > ftAway) homeWin += p;
      else if (ftHome === ftAway) draw += p;
      else awayWin += p;
    }
  }

  // ── Step 5: near full-time compression ───────────────────
  // When very little time is left the current score already
  // determines the outcome almost certainly. The matrix handles
  // this naturally (remaining λ → 0), but we double-check
  // normalisation.
  const total = homeWin + draw + awayWin;
  if (total > 0 && Math.abs(total - 1) > 0.001) {
    homeWin /= total;
    draw /= total;
    awayWin /= total;
  }

  // Cumulative live xG (baseline λ × elapsed fraction)
  const elapsedFraction = Math.min(effectiveMinute / 90, 1);
  const homeXgLive = Math.round(baselineLambdaHome * elapsedFraction * 100) / 100;
  const awayXgLive = Math.round(baselineLambdaAway * elapsedFraction * 100) / 100;

  return {
    homeWin: Math.round(homeWin * 10000) / 10000,
    draw: Math.round(draw * 10000) / 10000,
    awayWin: Math.round(awayWin * 10000) / 10000,
    homeXgLive,
    awayXgLive,
    triggerEvent,
    modelVersion: MODEL_VERSION,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Default Ratings for Unknown Teams ──────────────────────

/** Used when the DB has no attack/defence ratings for a team yet. */
export function defaultTeamRatings(elo = 1500): TeamRatings {
  return {
    elo,
    // Average team scores ~1.5 goals per home match, concedes ~1.3
    attackRating: 1.5,
    defenceRating: 1.3,
    redCards: 0,
  };
}
