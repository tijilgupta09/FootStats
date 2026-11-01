// ═══════════════════════════════════════════════════════════════
// FootStats — Data Provider Adapter Interface
// ═══════════════════════════════════════════════════════════════
//
// All data providers (Sportmonks, API-Football, mock) implement
// this interface. The ingestion layer depends only on this
// abstraction, allowing hot-swapping of providers.
//

export interface RawMatchData {
  providerId: string;
  providerName: string;
  status: string;
  minute: number | null;
  addedTime: number;
  homeTeamProvId: string;
  homeTeamName: string;
  awayTeamProvId: string;
  awayTeamName: string;
  competitionProvId: string;
  competitionName: string;
  homeScore: number;
  awayScore: number;
  homeHtScore: number | null;
  awayHtScore: number | null;
  kickoffAt: string;
  stats?: RawTeamStats;
  events?: RawMatchEvent[];
  lineups?: RawLineupData;
}

export interface RawTeamStats {
  home: Partial<{
    possession: number;
    xg: number;
    totalShots: number;
    shotsOnTarget: number;
    corners: number;
    fouls: number;
    yellowCards: number;
    redCards: number;
    passes: number;
    passAccuracy: number;
  }>;
  away: Partial<{
    possession: number;
    xg: number;
    totalShots: number;
    shotsOnTarget: number;
    corners: number;
    fouls: number;
    yellowCards: number;
    redCards: number;
    passes: number;
    passAccuracy: number;
  }>;
}

export interface RawMatchEvent {
  eventType: string;
  minute: number;
  addedTime: number;
  playerName: string | null;
  relatedPlayerName: string | null;
  teamSide: 'home' | 'away';
  detail?: Record<string, unknown>;
}

export interface RawLineupData {
  home: {
    formation: string;
    players: Array<{
      name: string;
      number: number;
      position: string;
      isStarter: boolean;
    }>;
  };
  away: {
    formation: string;
    players: Array<{
      name: string;
      number: number;
      position: string;
      isStarter: boolean;
    }>;
  };
}

export interface RawStandingRow {
  teamProvId: string;
  teamName: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string | null;
}

export interface RawFixture {
  providerId: string;
  homeTeamProvId: string;
  homeTeamName: string;
  awayTeamProvId: string;
  awayTeamName: string;
  competitionProvId: string;
  competitionName: string;
  kickoffAt: string;
  matchday: number | null;
  roundName: string | null;
  venueName: string | null;
}

/**
 * Abstract data provider interface. Every external API or mock
 * data source must implement this contract.
 */
export interface DataProvider {
  readonly name: string;
  readonly priority: number;

  /** Fetch all currently live matches */
  fetchLiveMatches(): Promise<RawMatchData[]>;

  /** Fetch fixtures for a date range */
  fetchFixtures(from: string, to: string): Promise<RawFixture[]>;

  /** Fetch standings for a competition */
  fetchStandings(competitionProvId: string): Promise<RawStandingRow[]>;

  /** Check provider health / rate limit status */
  healthCheck(): Promise<{ isHealthy: boolean; rateLimitRemaining: number | null }>;
}
