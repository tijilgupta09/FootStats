// ═══════════════════════════════════════════════════════════════
// FootStats — Live Momentum & Pressure Index
// ═══════════════════════════════════════════════════════════════
//
// Calculates a real-time momentum score for each team on every
// 5-second live poll cycle. Momentum is a composite index built
// from recent match events weighted by recency and importance.
//
// Formula:
//   momentum_home = Σ weight(event_i) × decay(now - event_i.time)
//   where decay(Δt) = exp(-k × Δt_minutes)  [k = 0.08]
//
// The index is normalised to [0, 100] and stored as:
//   momentumHome ∈ [0, 100]
//   momentumAway = 100 - momentumHome   (zero-sum within each pair)
//
// A "pressure index" is derived from shot and corner events only,
// representing sustained territorial pressure.
//

// ─── Types ───────────────────────────────────────────────────

export interface MomentumEvent {
  eventType: string;
  minute: number;
  addedTime: number;
  teamSide: 'home' | 'away';
}

export interface MatchStats {
  home: Partial<{
    possession: number;
    xg: number;
    totalShots: number;
    shotsOnTarget: number;
    corners: number;
  }>;
  away: Partial<{
    possession: number;
    xg: number;
    totalShots: number;
    shotsOnTarget: number;
    corners: number;
  }>;
}

export interface MomentumOutput {
  /** Home team momentum score [0–100] */
  momentumHome: number;
  /** Away team momentum score [0–100] (= 100 - momentumHome) */
  momentumAway: number;
  /**
   * Pressure index for home team [0–100] derived from
   * territorial stats (shots + corners + xG pace).
   */
  pressureHome: number;
  /** Pressure index for away team */
  pressureAway: number;
  /** Dominant team at this moment */
  dominantTeam: 'home' | 'away' | 'neutral';
  calculatedAt: string;
}

// ─── Event Weights ───────────────────────────────────────────

/**
 * Event type → momentum score contribution.
 * Positive = boost for the team that produced it.
 * Negative = drain (e.g. a red card reduces own momentum).
 */
const EVENT_WEIGHTS: Record<string, number> = {
  GOAL: 25,
  PENALTY_GOAL: 22,
  OWN_GOAL: -15,          // own goal hurts the scoring team
  PENALTY_MISS: -8,
  RED_CARD: -20,
  SECOND_YELLOW: -18,
  YELLOW_CARD: -4,
  PENALTY_AWARDED: 12,
  VAR_GOAL_CONFIRMED: 20,
  VAR_GOAL_DISALLOWED: -18,
  VAR_PENALTY_AWARDED: 10,
  VAR_PENALTY_CANCELLED: -10,
  VAR_RED_CARD: -20,
  SUBSTITUTION: 2,        // tactical change slightly boosts momentum
  KICKOFF: 0,
  HALFTIME: 0,
  SECOND_HALF_START: 0,
  FULLTIME: 0,
  EXTRA_TIME_START: 0,
  PENALTY_SHOOTOUT_START: 0,
};

/** Exponential decay constant k (per minute). Higher = faster decay. */
const DECAY_K = 0.08;

/** Lookback window in minutes — events older than this are ignored. */
const LOOKBACK_MINUTES = 20;

// ─── Core Calculation ────────────────────────────────────────

/**
 * Calculate decay factor for an event that occurred `ageMinutes` ago.
 * Returns a value in (0, 1].
 */
function decayFactor(ageMinutes: number): number {
  return Math.exp(-DECAY_K * ageMinutes);
}

/**
 * Calculate the raw (un-normalised) momentum contribution from
 * the recent events list for each side.
 */
function calculateEventMomentum(
  events: MomentumEvent[],
  currentMinute: number,
): { raw_home: number; raw_away: number } {
  let raw_home = 50; // neutral baseline
  let raw_away = 50;

  const cutoff = currentMinute - LOOKBACK_MINUTES;

  for (const event of events) {
    const eventMinute = event.minute + event.addedTime / 100;
    if (eventMinute < cutoff) continue; // too old

    const ageMinutes = Math.max(currentMinute - eventMinute, 0);
    const weight = EVENT_WEIGHTS[event.eventType] ?? 0;
    const contribution = weight * decayFactor(ageMinutes);

    if (event.teamSide === 'home') {
      raw_home += contribution;
    } else {
      raw_away += contribution;
    }
  }

  return { raw_home, raw_away };
}

/**
 * Derive pressure index from match stats (territorial dominance).
 * Uses shots on target, total shots, corners, and xG pace.
 */
function calculatePressureIndex(
  stats: MatchStats,
  currentMinute: number,
): { pressureHome: number; pressureAway: number } {
  if (currentMinute <= 0) {
    return { pressureHome: 50, pressureAway: 50 };
  }

  const h = stats.home;
  const a = stats.away;

  // Weighted sum of territorial indicators
  const homeScore =
    (h.shotsOnTarget ?? 0) * 4 +
    (h.totalShots ?? 0) * 1.5 +
    (h.corners ?? 0) * 1 +
    (h.xg ?? 0) * 8 +
    (h.possession ?? 50) * 0.2;

  const awayScore =
    (a.shotsOnTarget ?? 0) * 4 +
    (a.totalShots ?? 0) * 1.5 +
    (a.corners ?? 0) * 1 +
    (a.xg ?? 0) * 8 +
    (a.possession ?? 50) * 0.2;

  const total = homeScore + awayScore;
  if (total <= 0) {
    return { pressureHome: 50, pressureAway: 50 };
  }

  const pressureHome = Math.round((homeScore / total) * 100);
  return { pressureHome, pressureAway: 100 - pressureHome };
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Compute the full momentum & pressure snapshot for a live match.
 *
 * @param events   Recent match events (all events, function filters by recency)
 * @param stats    Current match statistics snapshot
 * @param minute   Current match minute
 */
export function calculateMomentum(
  events: MomentumEvent[],
  stats: MatchStats,
  minute: number,
): MomentumOutput {
  const { raw_home, raw_away } = calculateEventMomentum(events, minute);

  // Normalise to [0, 100] using a softmax-like approach
  const totalRaw = raw_home + raw_away;
  const momentumHome = Math.min(
    100,
    Math.max(0, Math.round((raw_home / Math.max(totalRaw, 1)) * 100)),
  );
  const momentumAway = 100 - momentumHome;

  const { pressureHome, pressureAway } = calculatePressureIndex(stats, minute);

  // Combined dominance — blend momentum (60%) and pressure (40%)
  const dominanceScore =
    momentumHome * 0.6 + pressureHome * 0.4;

  let dominantTeam: 'home' | 'away' | 'neutral';
  if (dominanceScore > 55) dominantTeam = 'home';
  else if (dominanceScore < 45) dominantTeam = 'away';
  else dominantTeam = 'neutral';

  return {
    momentumHome,
    momentumAway,
    pressureHome,
    pressureAway,
    dominantTeam,
    calculatedAt: new Date().toISOString(),
  };
}
