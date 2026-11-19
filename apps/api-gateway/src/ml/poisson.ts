// ═══════════════════════════════════════════════════════════════
// FootStats — Poisson / Dixon-Coles Prediction Model
// ═══════════════════════════════════════════════════════════════
//
// Pre-match scoreline probability matrix using the Poisson
// distribution. The Dixon-Coles correction is applied to the
// low-scoring cells (0-0, 1-0, 0-1, 1-1) for better calibration.
//
// References:
//   Dixon & Coles (1997) — "Modelling Association Football Scores"
//   Karlis & Ntzoufras (2003) — "Analysis of sports data by using
//     bivariate Poisson models"
//

// ─── Constants ───────────────────────────────────────────────

/** Maximum goals to include in the scoreline matrix (per side). */
const MAX_GOALS = 8;

/** Dixon-Coles correction parameter (rho). Empirically ~−0.13. */
const RHO = -0.13;

/** Home advantage multiplier applied to raw attack ratings. */
const HOME_ADVANTAGE = 1.15;

/** Elo reference rating (average team). */
const ELO_REF = 1500;

/** Elo scale factor — governs how much Elo differences shift λ. */
const ELO_SCALE = 400;

// ─── Types ───────────────────────────────────────────────────

export interface TeamRatings {
  elo: number;
  /** Season attack rating (avg goals scored per home/away match) */
  attackRating: number;
  /** Season defence rating (avg goals conceded per home/away match) */
  defenceRating: number;
  /** Count of red cards accumulated this season */
  redCards: number;
}

export interface PoissonInput {
  home: TeamRatings;
  away: TeamRatings;
  /** League average goals per match (home + away combined) */
  leagueAvgGoals: number;
  /** Whether the home team has a red card disadvantage in-game */
  homeRedCards?: number;
  /** Whether the away team has a red card disadvantage in-game */
  awayRedCards?: number;
  /** Elapsed match minute (0 = pre-match) */
  minute?: number;
  /** Current home score (live mode) */
  homeScore?: number;
  /** Current away score (live mode) */
  awayScore?: number;
}

export interface PoissonOutput {
  /** Expected goals for home team (λ_home) */
  lambdaHome: number;
  /** Expected goals for away team (λ_away) */
  lambdaAway: number;
  /** [homeGoals][awayGoals] probability matrix (MAX_GOALS+1 × MAX_GOALS+1) */
  scorelineMatrix: number[][];
  /** Most likely scoreline [homeGoals, awayGoals] */
  mostLikelyScoreline: [number, number];
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  btts: number;
  modelVersion: string;
  calculatedAt: string;
}

// ─── Math Utilities ──────────────────────────────────────────

/** Poisson probability mass: P(X = k | λ) */
function poissonPMF(lambda: number, k: number): number {
  if (k < 0) return 0;
  // Use log-space to avoid factorial overflow
  let logProb = -lambda + k * Math.log(Math.max(lambda, 1e-10));
  for (let i = 1; i <= k; i++) logProb -= Math.log(i);
  return Math.exp(logProb);
}

/**
 * Dixon-Coles correction factor τ for cells (0,0), (1,0), (0,1), (1,1).
 * Makes low-scoring draws slightly more likely — a known Poisson defect.
 */
function dixonColesTau(h: number, a: number, lh: number, la: number): number {
  if (h === 0 && a === 0) return 1 - lh * la * RHO;
  if (h === 1 && a === 0) return 1 + la * RHO;
  if (h === 0 && a === 1) return 1 + lh * RHO;
  if (h === 1 && a === 1) return 1 - RHO;
  return 1;
}

// ─── λ Calculation ───────────────────────────────────────────

/**
 * Calculate expected goals (λ) for each team using Elo ratings
 * and historical attack/defence ratings.
 *
 * Formula:
 *   λ_home = attackHome × (1/defenceAway) × leagueAvg/2 × homeAdvantage × eloFactor
 *   λ_away = attackAway × (1/defenceHome) × leagueAvg/2
 */
export function calculateExpectedGoals(
  home: TeamRatings,
  away: TeamRatings,
  leagueAvgGoals: number,
  homeRedCards = 0,
  awayRedCards = 0,
): { lambdaHome: number; lambdaAway: number } {
  const halfAvg = leagueAvgGoals / 2;

  // Elo-based strength factor: ratio vs reference
  const homeEloFactor = Math.pow(10, (home.elo - ELO_REF) / ELO_SCALE);
  const awayEloFactor = Math.pow(10, (away.elo - ELO_REF) / ELO_SCALE);

  // Base expected goals
  let lambdaHome =
    home.attackRating *
    (1 / Math.max(away.defenceRating, 0.1)) *
    halfAvg *
    HOME_ADVANTAGE *
    homeEloFactor;

  let lambdaAway =
    away.attackRating *
    (1 / Math.max(home.defenceRating, 0.1)) *
    halfAvg *
    awayEloFactor;

  // Red card penalty: each red card reduces λ by ~18%
  const RED_CARD_PENALTY = 0.18;
  lambdaHome *= Math.pow(1 - RED_CARD_PENALTY, homeRedCards);
  lambdaAway *= Math.pow(1 - RED_CARD_PENALTY, awayRedCards);

  // Clamp to sensible range [0.05, 5.0]
  lambdaHome = Math.min(5.0, Math.max(0.05, lambdaHome));
  lambdaAway = Math.min(5.0, Math.max(0.05, lambdaAway));

  return { lambdaHome, lambdaAway };
}

// ─── Scoreline Matrix ────────────────────────────────────────

/**
 * Build the full (MAX_GOALS+1) × (MAX_GOALS+1) scoreline
 * probability matrix with Dixon-Coles correction.
 */
export function buildScorelineMatrix(
  lambdaHome: number,
  lambdaAway: number,
): number[][] {
  const size = MAX_GOALS + 1;
  const matrix: number[][] = Array.from({ length: size }, () =>
    new Array<number>(size).fill(0),
  );

  let totalMass = 0;

  for (let h = 0; h < size; h++) {
    for (let a = 0; a < size; a++) {
      const p =
        poissonPMF(lambdaHome, h) *
        poissonPMF(lambdaAway, a) *
        dixonColesTau(h, a, lambdaHome, lambdaAway);
      matrix[h]![a] = p;
      totalMass += p;
    }
  }

  // Renormalise so rows sum correctly after DC correction
  if (totalMass > 0) {
    for (let h = 0; h < size; h++) {
      for (let a = 0; a < size; a++) {
        matrix[h]![a]! /= totalMass;
      }
    }
  }

  return matrix;
}

// ─── Outcome Probabilities ───────────────────────────────────

export interface OutcomeProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  btts: number;
  mostLikelyScoreline: [number, number];
}

export function deriveOutcomes(matrix: number[][]): OutcomeProbabilities {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over25 = 0;
  let btts = 0;

  let maxProb = -1;
  let mostLikelyScoreline: [number, number] = [1, 1];

  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < (matrix[h]?.length ?? 0); a++) {
      const p = matrix[h]![a]!;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;

      if (h + a > 2) over25 += p; // strictly over 2.5
      if (h > 0 && a > 0) btts += p;

      if (p > maxProb) {
        maxProb = p;
        mostLikelyScoreline = [h, a];
      }
    }
  }

  return { homeWin, draw, awayWin, over25, btts, mostLikelyScoreline };
}

// ─── Main Pre-match Prediction ───────────────────────────────

export const MODEL_VERSION = 'poisson-dc-v1.0';

/**
 * Run the full pre-match Poisson model.
 * Returns the complete PoissonOutput for storage in `matches.predictions`.
 */
export function runPoissonModel(input: PoissonInput): PoissonOutput {
  const { lambdaHome, lambdaAway } = calculateExpectedGoals(
    input.home,
    input.away,
    input.leagueAvgGoals,
    input.homeRedCards ?? 0,
    input.awayRedCards ?? 0,
  );

  const matrix = buildScorelineMatrix(lambdaHome, lambdaAway);
  const { homeWin, draw, awayWin, over25, btts, mostLikelyScoreline } =
    deriveOutcomes(matrix);

  return {
    lambdaHome: Math.round(lambdaHome * 1000) / 1000,
    lambdaAway: Math.round(lambdaAway * 1000) / 1000,
    scorelineMatrix: matrix.map((row) =>
      row.map((v) => Math.round(v * 10000) / 10000),
    ),
    mostLikelyScoreline,
    homeWin: Math.round(homeWin * 10000) / 10000,
    draw: Math.round(draw * 10000) / 10000,
    awayWin: Math.round(awayWin * 10000) / 10000,
    over25: Math.round(over25 * 10000) / 10000,
    btts: Math.round(btts * 10000) / 10000,
    modelVersion: MODEL_VERSION,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Quick in-game λ rescaling.
 * After `minute` elapsed, the remaining λ for each team is:
 *   λ_remaining = λ_full × (1 - minute/90)
 * This is added to any goals already scored to get the full-time
 * expected total (for live win-probability).
 */
export function scaleForRemainingTime(
  lambdaHome: number,
  lambdaAway: number,
  minute: number,
  period?: string,
): { scaledHome: number; scaledAway: number } {
  // Clamp — don't go below 1 minute remaining
  const totalMinutes = period?.startsWith('ET') ? 120 : 90;
  const elapsed = Math.min(Math.max(minute, 0), totalMinutes);
  const remaining = Math.max(totalMinutes - elapsed, 1) / totalMinutes;

  return {
    scaledHome: lambdaHome * remaining,
    scaledAway: lambdaAway * remaining,
  };
}
