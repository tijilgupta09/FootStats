// ═══════════════════════════════════════════════════════════════
// FootStats — API Response & WebSocket Protocol Types
// ═══════════════════════════════════════════════════════════════

import type {
  Match,
  MatchEvent,
  MatchStats,
  MatchPredictions,
  MatchLineups,
  StandingRow,
  NewsArticle,
  Competition,
  Team,
  Player,
  HeadToHead,
  ProbabilityTick,
} from './entities';
import type { MatchStatusType, EventTypeValue } from './enums';

// ─── API Response Wrappers ───────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: ApiMeta;
  error?: ApiError;
}

export interface ApiMeta {
  page?: number;
  perPage?: number;
  total?: number;
  totalPages?: number;
  cachedAt?: string;
  staleAfter?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: ApiMeta & {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

// ─── Dashboard API ───────────────────────────────────────────

export interface CompetitionMatchGroup {
  competition: Competition;
  matches: MatchSummary[];
}

export interface MatchSummary {
  id: string;
  competitionId: string;
  homeTeam: {
    id: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
  };
  awayTeam: {
    id: string;
    name: string;
    shortName: string | null;
    logoUrl: string | null;
  };
  kickoffAt: string;
  status: MatchStatusType;
  minute: number | null;
  addedTime: number;
  homeScore: number;
  awayScore: number;
  homeHtScore: number | null;
  awayHtScore: number | null;
  homePenScore: number | null;
  awayPenScore: number | null;
  predictions: {
    homeWin: number;
    draw: number;
    awayWin: number;
  } | null;
  recentEvents: MatchEventFlash[];
}

export interface MatchEventFlash {
  eventType: EventTypeValue;
  minute: number;
  addedTime: number;
  playerName: string | null;
  isHome: boolean | null;
}

// ─── Match Detail API ────────────────────────────────────────

export interface MatchDetailResponse {
  match: Match;
  events: MatchEvent[];
  standings: StandingRow[] | null;
  h2h: HeadToHead | null;
  probabilityTicks: ProbabilityTick[];
}

// ─── Standings API ───────────────────────────────────────────

export interface StandingsResponse {
  competition: Competition;
  seasonName: string;
  groups: StandingsGroup[];
}

export interface StandingsGroup {
  groupName: string | null;
  rows: StandingRow[];
}

// ─── Search API ──────────────────────────────────────────────

export interface SearchResult {
  type: 'COMPETITION' | 'TEAM' | 'PLAYER';
  id: string;
  name: string;
  subtitle: string | null;
  imageUrl: string | null;
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total: number;
  processingTimeMs: number;
}

// ─── News API ────────────────────────────────────────────────

export type NewsListResponse = PaginatedResponse<NewsArticle>;

// ═══════════════════════════════════════════════════════════════
// WebSocket Protocol Types
// ═══════════════════════════════════════════════════════════════

// ─── Client → Server Events ─────────────────────────────────

export interface ClientSocketEvents {
  'subscribe:dashboard': () => void;
  'unsubscribe:dashboard': () => void;
  'subscribe:match': (data: { matchId: string }) => void;
  'unsubscribe:match': (data: { matchId: string }) => void;
  'subscribe:competition': (data: { competitionId: string }) => void;
  'unsubscribe:competition': (data: { competitionId: string }) => void;
}

// ─── Server → Client Events ─────────────────────────────────

export interface ServerSocketEvents {
  'dashboard:delta': (data: DashboardDelta) => void;
  'match:event': (data: MatchEventDelta) => void;
  'match:stats': (data: MatchStatsDelta) => void;
  'match:prediction': (data: MatchPredictionDelta) => void;
  'match:lineup': (data: MatchLineupDelta) => void;
  'match:standings': (data: StandingsShiftDelta) => void;
  'match:status': (data: MatchStatusDelta) => void;
  'flash:banner': (data: FlashBannerEvent) => void;
  'connection:info': (data: ConnectionInfo) => void;
}

// ─── Delta Payloads ──────────────────────────────────────────

export interface BaseDelta {
  matchId: string;
  version: number;
  timestamp: string;
}

export interface DashboardDelta extends BaseDelta {
  type: 'SCORE_UPDATE' | 'STATUS_CHANGE' | 'EVENT_FLASH' | 'MINUTE_TICK';
  homeScore?: number;
  awayScore?: number;
  status?: MatchStatusType;
  minute?: number;
  addedTime?: number;
}

export interface MatchEventDelta extends BaseDelta {
  event: MatchEvent;
}

export interface MatchStatsDelta extends BaseDelta {
  stats: MatchStats;
}

export interface MatchPredictionDelta extends BaseDelta {
  predictions: MatchPredictions;
}

export interface MatchLineupDelta extends BaseDelta {
  lineups: MatchLineups;
}

export interface MatchStatusDelta extends BaseDelta {
  status: MatchStatusType;
  minute: number | null;
  addedTime: number;
  period: string | null;
}

export interface StandingsShiftDelta extends BaseDelta {
  competitionId: string;
  standings: StandingRow[];
}

export interface FlashBannerEvent extends BaseDelta {
  flashType: 'GOAL' | 'RED_CARD' | 'PENALTY' | 'VAR_CHECK' | 'VAR_OVERTURN';
  teamSide: 'home' | 'away';
  playerName: string | null;
  message: string;
  ttlMs: number;
}

export interface ConnectionInfo {
  socketId: string;
  subscribedRooms: string[];
  serverTime: string;
  liveMatchCount: number;
}

// ─── Provider Adapter Types ──────────────────────────────────

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  rateLimit: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  priority: number;
  enabled: boolean;
}

export interface ProviderHealthStatus {
  name: string;
  isHealthy: boolean;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  consecutiveErrors: number;
  averageLatencyMs: number;
  rateLimitRemaining: number | null;
}
