// ═══════════════════════════════════════════════════════════════
// FootStats — Canonical Enum Definitions
// ═══════════════════════════════════════════════════════════════

export const MatchStatus = {
  SCHEDULED: 'SCHEDULED',
  TOSS: 'TOSS',
  WARMUP: 'WARMUP',
  FIRST_HALF: '1H',
  HALFTIME: 'HT',
  SECOND_HALF: '2H',
  EXTRA_TIME_FIRST_HALF: 'ET_1H',
  EXTRA_TIME_HALFTIME: 'ET_HT',
  EXTRA_TIME_SECOND_HALF: 'ET_2H',
  BREAK_TIME: 'BT',
  PENALTY_SHOOTOUT: 'PEN',
  FULL_TIME: 'FT',
  AFTER_EXTRA_TIME: 'AET',
  AFTER_PENALTIES: 'AP',
  SUSPENDED: 'SUSP',
  POSTPONED: 'PST',
  ABANDONED: 'ABD',
  CANCELLED: 'CANC',
  AWARDED: 'AWARDED',
  WALKOVER: 'WO',
  TO_BE_DEFINED: 'TBD',
} as const;

export type MatchStatusType = (typeof MatchStatus)[keyof typeof MatchStatus];

export const LIVE_STATUSES: ReadonlySet<MatchStatusType> = new Set([
  MatchStatus.FIRST_HALF,
  MatchStatus.HALFTIME,
  MatchStatus.SECOND_HALF,
  MatchStatus.EXTRA_TIME_FIRST_HALF,
  MatchStatus.EXTRA_TIME_HALFTIME,
  MatchStatus.EXTRA_TIME_SECOND_HALF,
  MatchStatus.BREAK_TIME,
  MatchStatus.PENALTY_SHOOTOUT,
]);

export const FINISHED_STATUSES: ReadonlySet<MatchStatusType> = new Set([
  MatchStatus.FULL_TIME,
  MatchStatus.AFTER_EXTRA_TIME,
  MatchStatus.AFTER_PENALTIES,
]);

export const EventType = {
  GOAL: 'GOAL',
  OWN_GOAL: 'OWN_GOAL',
  PENALTY_GOAL: 'PENALTY_GOAL',
  PENALTY_MISS: 'PENALTY_MISS',
  YELLOW_CARD: 'YELLOW_CARD',
  SECOND_YELLOW: 'SECOND_YELLOW',
  RED_CARD: 'RED_CARD',
  SUBSTITUTION: 'SUBSTITUTION',
  VAR_DECISION: 'VAR_DECISION',
  VAR_GOAL_CONFIRMED: 'VAR_GOAL_CONFIRMED',
  VAR_GOAL_DISALLOWED: 'VAR_GOAL_DISALLOWED',
  VAR_PENALTY_AWARDED: 'VAR_PENALTY_AWARDED',
  VAR_PENALTY_CANCELLED: 'VAR_PENALTY_CANCELLED',
  VAR_RED_CARD: 'VAR_RED_CARD',
  PENALTY_AWARDED: 'PENALTY_AWARDED',
  KICKOFF: 'KICKOFF',
  HALFTIME: 'HALFTIME',
  SECOND_HALF_START: 'SECOND_HALF_START',
  FULLTIME: 'FULLTIME',
  EXTRA_TIME_START: 'EXTRA_TIME_START',
  PENALTY_SHOOTOUT_START: 'PENALTY_SHOOTOUT_START',
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export const GOAL_EVENTS: ReadonlySet<EventTypeValue> = new Set([
  EventType.GOAL,
  EventType.OWN_GOAL,
  EventType.PENALTY_GOAL,
]);

export const CARD_EVENTS: ReadonlySet<EventTypeValue> = new Set([
  EventType.YELLOW_CARD,
  EventType.SECOND_YELLOW,
  EventType.RED_CARD,
]);

export const STATE_ALTERING_EVENTS: ReadonlySet<EventTypeValue> = new Set([
  EventType.GOAL,
  EventType.OWN_GOAL,
  EventType.PENALTY_GOAL,
  EventType.RED_CARD,
  EventType.SECOND_YELLOW,
  EventType.PENALTY_AWARDED,
  EventType.VAR_GOAL_CONFIRMED,
  EventType.VAR_GOAL_DISALLOWED,
  EventType.VAR_PENALTY_AWARDED,
  EventType.VAR_RED_CARD,
]);

export const CompetitionTier = {
  TIER_1: 'TIER_1',
  TIER_2: 'TIER_2',
  TIER_3: 'TIER_3',
  TIER_4: 'TIER_4',
  FRIENDLY: 'FRIENDLY',
} as const;

export type CompetitionTierType = (typeof CompetitionTier)[keyof typeof CompetitionTier];

export const CompetitionType = {
  LEAGUE: 'LEAGUE',
  CUP: 'CUP',
  SUPER_CUP: 'SUPER_CUP',
  INTERNATIONAL: 'INTERNATIONAL',
} as const;

export type CompetitionTypeValue = (typeof CompetitionType)[keyof typeof CompetitionType];

export const NewsCategory = {
  BREAKING: 'BREAKING',
  TRANSFERS: 'TRANSFERS',
  INJURIES: 'INJURIES',
  MATCH_REPORTS: 'MATCH_REPORTS',
  TACTICS: 'TACTICS',
  VAR_WATCH: 'VAR_WATCH',
  FEATURES: 'FEATURES',
  INTERVIEWS: 'INTERVIEWS',
} as const;

export type NewsCategoryType = (typeof NewsCategory)[keyof typeof NewsCategory];

export const PlayerPosition = {
  GK: 'GK',
  CB: 'CB',
  LB: 'LB',
  RB: 'RB',
  LWB: 'LWB',
  RWB: 'RWB',
  CDM: 'CDM',
  CM: 'CM',
  CAM: 'CAM',
  LM: 'LM',
  RM: 'RM',
  LW: 'LW',
  RW: 'RW',
  CF: 'CF',
  ST: 'ST',
} as const;

export type PlayerPositionType = (typeof PlayerPosition)[keyof typeof PlayerPosition];

export const QualificationZone = {
  UCL_GROUP: 'UCL_GROUP',
  UCL_QUAL: 'UCL_QUAL',
  UEL_GROUP: 'UEL_GROUP',
  UEL_QUAL: 'UEL_QUAL',
  UECL_GROUP: 'UECL_GROUP',
  UECL_QUAL: 'UECL_QUAL',
  PROMOTION: 'PROMOTION',
  PROMOTION_PLAYOFF: 'PROMOTION_PLAYOFF',
  RELEGATION_PLAYOFF: 'RELEGATION_PLAYOFF',
  RELEGATION: 'RELEGATION',
  NONE: 'NONE',
} as const;

export type QualificationZoneType = (typeof QualificationZone)[keyof typeof QualificationZone];
