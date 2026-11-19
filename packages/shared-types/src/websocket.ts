// ═══════════════════════════════════════════════════════════════
// FootStats — WebSocket & Event Bus Constants
// ═══════════════════════════════════════════════════════════════

// ─── Kafka Topics ────────────────────────────────────────────

export const KafkaTopics = {
  RAW_TELEMETRY: 'raw.telemetry',
  MATCH_STATE_DELTA: 'match.state.delta',
  MATCH_EVENTS: 'match.events',
  ML_INFERENCE_TRIGGER: 'ml.inference.trigger',
  NEWS_INGESTED: 'news.ingested',
  STANDINGS_UPDATE: 'standings.update',
} as const;

export type KafkaTopic = (typeof KafkaTopics)[keyof typeof KafkaTopics];

// ─── Redis Channel Patterns ─────────────────────────────────

export const RedisChannels = {
  DASHBOARD: 'channel:dashboard',
  matchDetail: (matchId: string) => `channel:match:${matchId}` as const,
  matchPredictions: (matchId: string) => `channel:match:${matchId}:predictions` as const,
  competitionStandings: (compId: string) => `channel:competition:${compId}:standings` as const,
} as const;

// ─── Redis Cache Key Patterns ───────────────────────────────

export const RedisKeys = {
  matchFull: (matchId: string) => `match:${matchId}:full` as const,
  matchHash: (matchId: string) => `live:match:hashes:${matchId}` as const,
  liveMatchSet: () => 'live:matches:set' as const,
  dashboardCache: (date: string) => `dashboard:${date}` as const,
  standingsCache: (compId: string, seasonId: string) => `standings:${compId}:${seasonId}` as const,
  providerHealth: (provider: string) => `provider:health:${provider}` as const,
  rateLimitCounter: (provider: string) => `provider:ratelimit:${provider}` as const,
} as const;

// ─── Socket.io Room Naming ──────────────────────────────────

export const SocketRooms = {
  DASHBOARD: 'room:dashboard',
  match: (matchId: string) => `room:match:${matchId}` as const,
  competition: (compId: string) => `room:competition:${compId}` as const,
} as const;

// ─── BullMQ Queue Names ─────────────────────────────────────

export const QueueNames = {
  LIVE_POLL: 'live-poll',
  FIXTURE_SYNC: 'fixture-sync',
  STANDINGS_SYNC: 'standings-sync',
  NEWS_POLL: 'news-poll',
  HISTORICAL_SYNC: 'historical-sync',
  ML_INFERENCE: 'ml-inference',
  SEARCH_INDEX: 'search-index',
} as const;

export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

// ─── Flash Banner Push Payload (rich websocket push format) ─

/** Extended flash banner payload sent over Redis pub/sub from the live poller.
 *  Includes team context for display in the dashboard without extra DB queries. */
export interface FlashBannerPayload {
  matchId: string;
  flashType: 'GOAL' | 'RED_CARD' | 'PENALTY' | 'VAR';
  teamSide: 'home' | 'away';
  playerName: string | null;
  message: string;
  ttl: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  competition: string;
}

