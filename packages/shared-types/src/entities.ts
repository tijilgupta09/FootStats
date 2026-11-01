// ═══════════════════════════════════════════════════════════════
// FootStats — Core Entity Interfaces
// ═══════════════════════════════════════════════════════════════

import type {
  MatchStatusType,
  EventTypeValue,
  CompetitionTierType,
  CompetitionTypeValue,
  NewsCategoryType,
  PlayerPositionType,
  QualificationZoneType,
} from './enums';

// ─── Base ────────────────────────────────────────────────────

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Geographic ──────────────────────────────────────────────

export interface Country extends BaseEntity {
  name: string;
  codeIso2: string | null;
  codeIso3: string | null;
  flagUrl: string | null;
  continent: string | null;
}

export interface Venue extends BaseEntity {
  name: string;
  city: string | null;
  countryId: string | null;
  capacity: number | null;
  surface: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrl: string | null;
}

// ─── Competition & Season ────────────────────────────────────

export interface Competition extends BaseEntity {
  name: string;
  shortName: string | null;
  code: string | null;
  countryId: string | null;
  country?: Country;
  tier: CompetitionTierType;
  type: CompetitionTypeValue;
  logoUrl: string | null;
  isActive: boolean;
  displayOrder: number;
}

export interface Season extends BaseEntity {
  competitionId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
}

// ─── Team ────────────────────────────────────────────────────

export interface Team extends BaseEntity {
  name: string;
  shortName: string | null;
  code: string | null;
  countryId: string | null;
  country?: Country;
  venueId: string | null;
  venue?: Venue;
  logoUrl: string | null;
  foundedYear: number | null;
  managerName: string | null;
  managerPhotoUrl: string | null;
  currentElo: number;
  marketValueEur: number | null;
}

// ─── Player ──────────────────────────────────────────────────

export interface Player extends BaseEntity {
  name: string;
  shortName: string | null;
  displayName: string | null;
  dateOfBirth: string | null;
  nationalityId: string | null;
  nationality?: Country;
  currentTeamId: string | null;
  currentTeam?: Team;
  position: PlayerPositionType | null;
  shirtNumber: number | null;
  heightCm: number | null;
  weightKg: number | null;
  preferredFoot: 'LEFT' | 'RIGHT' | 'BOTH' | null;
  photoUrl: string | null;
  marketValueEur: number | null;
  isActive: boolean;
}

// ─── Match Lineup Structures (JSONB) ────────────────────────

export interface LineupPlayer {
  playerId: string;
  playerName: string;
  shirtNumber: number;
  position: PlayerPositionType;
  gridX: number;  // 0-100 scale on pitch
  gridY: number;  // 0-100 scale on pitch
  rating: number | null;
  isCaptain?: boolean;
}

export interface SubstitutePlayer {
  playerId: string;
  playerName: string;
  shirtNumber: number;
  position: PlayerPositionType;
  subbedOnForPlayerId?: string;
  subbedOnMinute?: number;
  rating?: number | null;
}

export interface MissingPlayer {
  playerId: string;
  playerName: string;
  reason: 'INJURED' | 'SUSPENDED' | 'INTERNATIONAL' | 'PERSONAL' | 'OTHER';
  injury?: string;
  expectedReturn?: string;
}

export interface TeamLineup {
  formation: string;
  startingXi: LineupPlayer[];
  substitutes: SubstitutePlayer[];
  missing: MissingPlayer[];
  managerId?: string;
  managerName?: string;
}

export interface MatchLineups {
  home: TeamLineup | null;
  away: TeamLineup | null;
}

// ─── Match Stats Structures (JSONB) ─────────────────────────

export interface TeamMatchStats {
  possession: number | null;
  xg: number | null;
  xgot: number | null;
  totalShots: number;
  shotsOnTarget: number;
  shotsInsideBox: number;
  shotsOutsideBox: number;
  bigChancesCreated: number;
  bigChancesMissed: number;
  cornerKicks: number;
  totalPasses: number;
  passAccuracy: number | null;
  crosses: number;
  fouls: number;
  offsides: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  ppda: number | null;
}

export interface MatchStats {
  home: TeamMatchStats | null;
  away: TeamMatchStats | null;
}

// ─── xG Timeline (JSONB) ────────────────────────────────────

export interface XGTimelineEntry {
  minute: number;
  team: 'home' | 'away';
  xg: number;
  cumulativeHome: number;
  cumulativeAway: number;
  playerName?: string;
  shotType?: string;
}

// ─── Weather (JSONB) ─────────────────────────────────────────

export interface MatchWeather {
  tempC: number | null;
  condition: string | null;
  windKmh: number | null;
  humidity: number | null;
}

// ─── AI Predictions (JSONB) ──────────────────────────────────

export interface PreMatchPrediction {
  homeWin: number;
  draw: number;
  awayWin: number;
  lambdaHome: number;
  lambdaAway: number;
  over25: number;
  btts: number;
  scorelineMatrix: number[][];  // [homeGoals][awayGoals] = probability
  mostLikelyScoreline: [number, number];
  modelVersion: string;
  calculatedAt: string;
}

export interface LivePrediction {
  homeWin: number;
  draw: number;
  awayWin: number;
  updatedAt: string;
  triggerEvent?: string;
}

export interface MatchPredictions {
  preMatch: PreMatchPrediction | null;
  live: LivePrediction | null;
}

// ─── Match (Core Entity) ────────────────────────────────────

export interface Match extends BaseEntity {
  competitionId: string;
  competition?: Competition;
  seasonId: string;
  season?: Season;
  matchday: number | null;
  roundName: string | null;

  homeTeamId: string;
  homeTeam?: Team;
  awayTeamId: string;
  awayTeam?: Team;

  venueId: string | null;
  venue?: Venue;
  refereeName: string | null;

  kickoffAt: string;
  timezone: string;

  status: MatchStatusType;
  minute: number | null;
  addedTime: number;
  period: string | null;

  homeScore: number;
  awayScore: number;
  homeHtScore: number | null;
  awayHtScore: number | null;
  homeFtScore: number | null;
  awayFtScore: number | null;
  homeEtScore: number | null;
  awayEtScore: number | null;
  homePenScore: number | null;
  awayPenScore: number | null;
  homeAggScore: number | null;
  awayAggScore: number | null;

  attendance: number | null;
  pitchCondition: string | null;
  weather: MatchWeather | null;

  lineups: MatchLineups | null;
  stats: MatchStats | null;
  xgTimeline: XGTimelineEntry[];
  predictions: MatchPredictions | null;

  providerIds: Record<string, string>;
  stateHash: string | null;
  stateVersion: number;
}

// ─── Match Event ─────────────────────────────────────────────

export interface GoalEventDetail {
  bodyPart: string;
  situation: string;
  xg: number;
  shotX: number;
  shotY: number;
}

export interface VarEventDetail {
  originalDecision: string;
  varResult: string;
  reason: string;
}

export interface SubstitutionEventDetail {
  reason: string;
}

export type MatchEventDetail = GoalEventDetail | VarEventDetail | SubstitutionEventDetail | Record<string, unknown>;

export interface MatchEvent {
  id: string;
  matchId: string;
  eventType: EventTypeValue;
  minute: number;
  addedTime: number;
  period: string | null;
  playerId: string | null;
  playerName: string | null;
  relatedPlayerId: string | null;
  relatedPlayerName: string | null;
  teamId: string | null;
  isHome: boolean | null;
  detail: MatchEventDetail;
  homeScoreAtEvent: number | null;
  awayScoreAtEvent: number | null;
  sortOrder: number;
  createdAt: string;
}

// ─── Standings ───────────────────────────────────────────────

export interface StandingRow {
  id: string;
  competitionId: string;
  seasonId: string;
  groupName: string | null;
  teamId: string;
  team?: Team;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: string | null;
  qualificationStatus: QualificationZoneType | null;
  livePositionDelta: number;
  isLive: boolean;
  updatedAt: string;
}

// ─── News ────────────────────────────────────────────────────

export interface NewsArticle {
  id: string;
  sourceName: string;
  sourceUrl: string;
  sourceTier: number;
  title: string;
  summary: string | null;
  content: string | null;
  thumbnailUrl: string | null;
  author: string | null;
  publishedAt: string;
  category: NewsCategoryType | null;
  canonicalStoryId: string | null;
  taggedCompetitionIds: string[];
  taggedTeamIds: string[];
  taggedPlayerIds: string[];
  isPublished: boolean;
  createdAt: string;
}

// ─── Elo History ─────────────────────────────────────────────

export interface TeamEloEntry {
  id: string;
  teamId: string;
  date: string;
  elo: number;
  eloDelta: number | null;
  matchId: string | null;
}

// ─── H2H ─────────────────────────────────────────────────────

export interface HeadToHead {
  totalMatches: number;
  team1Wins: number;
  draws: number;
  team2Wins: number;
  avgGoalsPerMatch: number;
  bttsPercentage: number;
  over25Percentage: number;
  recentMeetings: Match[];
}

// ─── Win Probability Tick ────────────────────────────────────

export interface ProbabilityTick {
  time: string;
  matchId: string;
  minute: number | null;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  homeXgLive: number;
  awayXgLive: number;
  triggerEvent: string | null;
  modelVersion: string;
}

// ─── Entity Alias (Multi-Provider ID Mapping) ───────────────

export interface EntityAlias {
  id: string;
  entityType: 'COMPETITION' | 'TEAM' | 'PLAYER' | 'VENUE' | 'COUNTRY';
  internalId: string;
  provider: string;
  externalId: string;
  externalName: string | null;
  confidence: number;
  verified: boolean;
  createdAt: string;
}
