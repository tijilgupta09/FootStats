// ═══════════════════════════════════════════════════════════════
// FootStats — ML Module Index
// ═══════════════════════════════════════════════════════════════

export { runPoissonModel, calculateExpectedGoals, buildScorelineMatrix, deriveOutcomes, MODEL_VERSION } from './poisson';
export type { PoissonInput, PoissonOutput, TeamRatings } from './poisson';

export { calculateLiveWinProbability, defaultTeamRatings } from './live-probability';
export type { LiveProbInput, LiveProbOutput } from './live-probability';

export { calculateMomentum } from './momentum';
export type { MomentumOutput, MomentumEvent } from './momentum';

export { startMlInferenceConsumer } from './inference.consumer';
