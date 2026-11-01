// ═══════════════════════════════════════════════════════════════
// FootStats — Mock Data Provider
// ═══════════════════════════════════════════════════════════════
//
// Generates realistic live match simulations for development
// and testing without requiring real API keys. Simulates
// multiple concurrent matches across different competitions.
//

import type {
  DataProvider,
  RawMatchData,
  RawFixture,
  RawStandingRow,
  RawMatchEvent,
  RawTeamStats,
} from './provider.interface';

// ─── Mock Competition & Team Data ────────────────────────────

const MOCK_COMPETITIONS = [
  { id: 'PL', name: 'Premier League', country: 'England' },
  { id: 'LL', name: 'La Liga', country: 'Spain' },
  { id: 'SA', name: 'Serie A', country: 'Italy' },
  { id: 'BL', name: 'Bundesliga', country: 'Germany' },
  { id: 'L1', name: 'Ligue 1', country: 'France' },
  { id: 'UCL', name: 'Champions League', country: 'Europe' },
];

const MOCK_TEAMS: Record<string, Array<{ id: string; name: string; short: string; elo: number }>> = {
  PL: [
    { id: 'ARS', name: 'Arsenal', short: 'ARS', elo: 1920 },
    { id: 'MCI', name: 'Manchester City', short: 'MCI', elo: 1945 },
    { id: 'LIV', name: 'Liverpool', short: 'LIV', elo: 1910 },
    { id: 'CHE', name: 'Chelsea', short: 'CHE', elo: 1830 },
    { id: 'MUN', name: 'Manchester United', short: 'MUN', elo: 1810 },
    { id: 'TOT', name: 'Tottenham', short: 'TOT', elo: 1800 },
    { id: 'AVL', name: 'Aston Villa', short: 'AVL', elo: 1790 },
    { id: 'NEW', name: 'Newcastle', short: 'NEW', elo: 1810 },
    { id: 'WHU', name: 'West Ham', short: 'WHU', elo: 1750 },
    { id: 'BHA', name: 'Brighton', short: 'BHA', elo: 1770 },
  ],
  LL: [
    { id: 'RMA', name: 'Real Madrid', short: 'RMA', elo: 1960 },
    { id: 'BAR', name: 'Barcelona', short: 'BAR', elo: 1940 },
    { id: 'ATM', name: 'Atlético Madrid', short: 'ATM', elo: 1860 },
    { id: 'RSO', name: 'Real Sociedad', short: 'RSO', elo: 1800 },
    { id: 'SEV', name: 'Sevilla', short: 'SEV', elo: 1790 },
    { id: 'VIL', name: 'Villarreal', short: 'VIL', elo: 1780 },
  ],
  SA: [
    { id: 'INT', name: 'Inter Milan', short: 'INT', elo: 1890 },
    { id: 'NAP', name: 'Napoli', short: 'NAP', elo: 1870 },
    { id: 'MIL', name: 'AC Milan', short: 'MIL', elo: 1850 },
    { id: 'JUV', name: 'Juventus', short: 'JUV', elo: 1840 },
    { id: 'ROM', name: 'Roma', short: 'ROM', elo: 1790 },
    { id: 'ATA', name: 'Atalanta', short: 'ATA', elo: 1810 },
  ],
  BL: [
    { id: 'BAY', name: 'Bayern Munich', short: 'BAY', elo: 1950 },
    { id: 'BVB', name: 'Borussia Dortmund', short: 'BVB', elo: 1860 },
    { id: 'RBL', name: 'RB Leipzig', short: 'RBL', elo: 1830 },
    { id: 'LEV', name: 'Bayer Leverkusen', short: 'LEV', elo: 1870 },
    { id: 'WOB', name: 'Wolfsburg', short: 'WOB', elo: 1750 },
    { id: 'SGE', name: 'Eintracht Frankfurt', short: 'SGE', elo: 1770 },
  ],
  L1: [
    { id: 'PSG', name: 'Paris Saint-Germain', short: 'PSG', elo: 1890 },
    { id: 'OLM', name: 'Olympique Marseille', short: 'OM', elo: 1810 },
    { id: 'MON', name: 'Monaco', short: 'MON', elo: 1800 },
    { id: 'LIL', name: 'Lille', short: 'LIL', elo: 1790 },
    { id: 'OLL', name: 'Olympique Lyon', short: 'OL', elo: 1780 },
    { id: 'REN', name: 'Rennes', short: 'REN', elo: 1760 },
  ],
  UCL: [
    { id: 'RMA', name: 'Real Madrid', short: 'RMA', elo: 1960 },
    { id: 'MCI', name: 'Manchester City', short: 'MCI', elo: 1945 },
    { id: 'BAY', name: 'Bayern Munich', short: 'BAY', elo: 1950 },
    { id: 'BAR', name: 'Barcelona', short: 'BAR', elo: 1940 },
    { id: 'PSG', name: 'Paris Saint-Germain', short: 'PSG', elo: 1890 },
    { id: 'INT', name: 'Inter Milan', short: 'INT', elo: 1890 },
  ],
};

const PLAYER_NAMES = [
  'Saka', 'Salah', 'Haaland', 'Palmer', 'Mbappé', 'Vinicius Jr.',
  'Bellingham', 'Pedri', 'Lautaro', 'Musiala', 'Wirtz', 'Szoboszlai',
  'Olmo', 'Kane', 'Son', 'Watkins', 'Isak', 'Gordon', 'Díaz', 'Havertz',
  'Foden', 'Rice', 'Rodri', 'De Bruyne', 'Bruno Fernandes', 'Rashford',
  'Gündogan', 'Yamal', 'Raphinha', 'Lewandowski', 'Grimaldo', 'Thuram',
];

// ─── State for live simulation ──────────────────────────────

interface SimMatch {
  id: string;
  compId: string;
  homeTeam: { id: string; name: string; short: string };
  awayTeam: { id: string; name: string; short: string };
  homeScore: number;
  awayScore: number;
  homeHtScore: number | null;
  awayHtScore: number | null;
  minute: number;
  addedTime: number;
  status: string;
  kickoffAt: string;
  events: RawMatchEvent[];
  possession: number; // Home possession 0-100
  homeXg: number;
  awayXg: number;
  homeShots: number;
  awayShots: number;
  homeShotsOT: number;
  awayShotsOT: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
}

const activeMatches: Map<string, SimMatch> = new Map();
let initialized = false;

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function initializeSimulation(): void {
  if (initialized) return;
  initialized = true;

  // Create 4-6 concurrent live matches across different leagues
  const numMatches = rand(4, 6);
  const usedPairings = new Set<string>();

  for (let i = 0; i < numMatches; i++) {
    const comp = pick(MOCK_COMPETITIONS);
    const teams = MOCK_TEAMS[comp.id]!;
    let homeTeam = pick(teams);
    let awayTeam = pick(teams);

    // Ensure unique pairing
    let attempts = 0;
    while (
      (homeTeam.id === awayTeam.id || usedPairings.has(`${homeTeam.id}-${awayTeam.id}`)) &&
      attempts < 20
    ) {
      homeTeam = pick(teams);
      awayTeam = pick(teams);
      attempts++;
    }
    usedPairings.add(`${homeTeam.id}-${awayTeam.id}`);

    const matchId = `sim_${comp.id}_${homeTeam.id}_${awayTeam.id}`;
    const minute = rand(1, 85);
    const status = minute <= 45 ? '1H' : minute === 46 ? 'HT' : '2H';

    const match: SimMatch = {
      id: matchId,
      compId: comp.id,
      homeTeam: { id: homeTeam.id, name: homeTeam.name, short: homeTeam.short },
      awayTeam: { id: awayTeam.id, name: awayTeam.name, short: awayTeam.short },
      homeScore: rand(0, 2),
      awayScore: rand(0, 2),
      homeHtScore: status !== '1H' ? rand(0, 1) : null,
      awayHtScore: status !== '1H' ? rand(0, 1) : null,
      minute,
      addedTime: 0,
      status,
      kickoffAt: new Date(Date.now() - minute * 60 * 1000).toISOString(),
      events: [],
      possession: rand(35, 65),
      homeXg: parseFloat((Math.random() * 2.5).toFixed(2)),
      awayXg: parseFloat((Math.random() * 2.0).toFixed(2)),
      homeShots: rand(3, 14),
      awayShots: rand(2, 12),
      homeShotsOT: rand(1, 6),
      awayShotsOT: rand(1, 5),
      homeCorners: rand(1, 8),
      awayCorners: rand(1, 7),
      homeFouls: rand(3, 14),
      awayFouls: rand(3, 14),
    };

    activeMatches.set(matchId, match);
  }

  console.log(`[MockProvider] Initialized ${activeMatches.size} simulated live matches`);
}

/**
 * Advance the simulation by one tick (called every ~5 seconds).
 * Each tick progresses the match minute and may generate events.
 */
function tickSimulation(): void {
  for (const match of activeMatches.values()) {
    // Advance minute
    if (match.status === '1H' || match.status === '2H') {
      match.minute = Math.min(match.minute + 1, match.status === '1H' ? 45 : 90);

      // Random event generation (~10% chance per tick)
      if (Math.random() < 0.10) {
        generateRandomEvent(match);
      }

      // Update stats
      match.possession = Math.min(75, Math.max(25, match.possession + rand(-3, 3)));
      if (Math.random() < 0.3) match.homeShots++;
      if (Math.random() < 0.25) match.awayShots++;
      if (Math.random() < 0.15) match.homeShotsOT++;
      if (Math.random() < 0.12) match.awayShotsOT++;
      if (Math.random() < 0.1) match.homeCorners++;
      if (Math.random() < 0.08) match.awayCorners++;
      match.homeXg = parseFloat((match.homeXg + Math.random() * 0.05).toFixed(2));
      match.awayXg = parseFloat((match.awayXg + Math.random() * 0.04).toFixed(2));

      // Half-time transition
      if (match.status === '1H' && match.minute >= 45) {
        match.status = 'HT';
        match.homeHtScore = match.homeScore;
        match.awayHtScore = match.awayScore;
      }

      // Full-time transition
      if (match.status === '2H' && match.minute >= 90) {
        match.status = 'FT';
      }
    }

    // HT → 2H after ~3 ticks (~15 seconds)
    if (match.status === 'HT' && Math.random() < 0.33) {
      match.status = '2H';
      match.minute = 46;
    }
  }

  // Remove finished matches and spawn new ones occasionally
  for (const [id, match] of activeMatches) {
    if (match.status === 'FT') {
      activeMatches.delete(id);
    }
  }

  // Spawn a new match if we're running low
  if (activeMatches.size < 3 && Math.random() < 0.5) {
    const comp = pick(MOCK_COMPETITIONS);
    const teams = MOCK_TEAMS[comp.id]!;
    const home = pick(teams);
    let away = pick(teams);
    let attempts = 0;
    while (home.id === away.id && attempts < 10) {
      away = pick(teams);
      attempts++;
    }
    if (home.id !== away.id) {
      const newId = `sim_${comp.id}_${home.id}_${away.id}_${Date.now()}`;
      activeMatches.set(newId, {
        id: newId,
        compId: comp.id,
        homeTeam: { id: home.id, name: home.name, short: home.short },
        awayTeam: { id: away.id, name: away.name, short: away.short },
        homeScore: 0,
        awayScore: 0,
        homeHtScore: null,
        awayHtScore: null,
        minute: 1,
        addedTime: 0,
        status: '1H',
        kickoffAt: new Date().toISOString(),
        events: [],
        possession: 50,
        homeXg: 0,
        awayXg: 0,
        homeShots: 0,
        awayShots: 0,
        homeShotsOT: 0,
        awayShotsOT: 0,
        homeCorners: 0,
        awayCorners: 0,
        homeFouls: 0,
        awayFouls: 0,
      });
    }
  }
}

function generateRandomEvent(match: SimMatch): void {
  const isHome = Math.random() < match.possession / 100;
  const teamSide: 'home' | 'away' = isHome ? 'home' : 'away';
  const playerName = pick(PLAYER_NAMES);

  const eventRoll = Math.random();
  let eventType: string;

  if (eventRoll < 0.25) {
    eventType = 'GOAL';
    if (isHome) match.homeScore++;
    else match.awayScore++;
    match[isHome ? 'homeXg' : 'awayXg'] += parseFloat((0.2 + Math.random() * 0.6).toFixed(2));
  } else if (eventRoll < 0.50) {
    eventType = 'YELLOW_CARD';
    match[isHome ? 'homeFouls' : 'awayFouls']++;
  } else if (eventRoll < 0.65) {
    eventType = 'SUBSTITUTION';
  } else if (eventRoll < 0.70) {
    eventType = 'RED_CARD';
  } else if (eventRoll < 0.80) {
    eventType = 'PENALTY_GOAL';
    if (isHome) match.homeScore++;
    else match.awayScore++;
    match[isHome ? 'homeXg' : 'awayXg'] += 0.76; // Penalty xG
  } else {
    eventType = 'VAR_DECISION';
  }

  const event: RawMatchEvent = {
    eventType,
    minute: match.minute,
    addedTime: match.addedTime,
    playerName,
    relatedPlayerName: eventType === 'SUBSTITUTION' ? pick(PLAYER_NAMES) : null,
    teamSide,
    detail: eventType === 'GOAL' ? {
      bodyPart: pick(['right_foot', 'left_foot', 'head']),
      situation: pick(['open_play', 'set_piece', 'counter_attack', 'free_kick']),
      xg: parseFloat((Math.random() * 0.8).toFixed(2)),
    } : undefined,
  };

  match.events.push(event);
}

// ─── Provider Implementation ────────────────────────────────

export class MockDataProvider implements DataProvider {
  readonly name = 'mock';
  readonly priority = 999; // Lowest priority — used only when no real providers

  constructor() {
    initializeSimulation();
  }

  async fetchLiveMatches(): Promise<RawMatchData[]> {
    tickSimulation();

    const results: RawMatchData[] = [];
    for (const match of activeMatches.values()) {
      const comp = MOCK_COMPETITIONS.find((c) => c.id === match.compId)!;

      const stats: RawTeamStats = {
        home: {
          possession: match.possession,
          xg: match.homeXg,
          totalShots: match.homeShots,
          shotsOnTarget: match.homeShotsOT,
          corners: match.homeCorners,
          fouls: match.homeFouls,
          yellowCards: match.events.filter(
            (e) => e.teamSide === 'home' && e.eventType === 'YELLOW_CARD',
          ).length,
          redCards: match.events.filter(
            (e) => e.teamSide === 'home' && e.eventType === 'RED_CARD',
          ).length,
        },
        away: {
          possession: 100 - match.possession,
          xg: match.awayXg,
          totalShots: match.awayShots,
          shotsOnTarget: match.awayShotsOT,
          corners: match.awayCorners,
          fouls: match.awayFouls,
          yellowCards: match.events.filter(
            (e) => e.teamSide === 'away' && e.eventType === 'YELLOW_CARD',
          ).length,
          redCards: match.events.filter(
            (e) => e.teamSide === 'away' && e.eventType === 'RED_CARD',
          ).length,
        },
      };

      results.push({
        providerId: match.id,
        providerName: this.name,
        status: match.status,
        minute: match.minute,
        addedTime: match.addedTime,
        homeTeamProvId: match.homeTeam.id,
        homeTeamName: match.homeTeam.name,
        awayTeamProvId: match.awayTeam.id,
        awayTeamName: match.awayTeam.name,
        competitionProvId: match.compId,
        competitionName: comp.name,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        homeHtScore: match.homeHtScore,
        awayHtScore: match.awayHtScore,
        kickoffAt: match.kickoffAt,
        stats,
        events: match.events,
      });
    }

    return results;
  }

  async fetchFixtures(from: string, to: string): Promise<RawFixture[]> {
    const fixtures: RawFixture[] = [];
    const startDate = new Date(from);
    const endDate = new Date(to);

    for (const comp of MOCK_COMPETITIONS) {
      const teams = MOCK_TEAMS[comp.id]!;
      for (let i = 0; i < teams.length - 1; i += 2) {
        const home = teams[i]!;
        const away = teams[i + 1]!;
        const kickoff = new Date(
          startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime()),
        );

        fixtures.push({
          providerId: `fix_${comp.id}_${home.id}_${away.id}`,
          homeTeamProvId: home.id,
          homeTeamName: home.name,
          awayTeamProvId: away.id,
          awayTeamName: away.name,
          competitionProvId: comp.id,
          competitionName: comp.name,
          kickoffAt: kickoff.toISOString(),
          matchday: rand(1, 38),
          roundName: null,
          venueName: `${home.name} Stadium`,
        });
      }
    }

    return fixtures;
  }

  async fetchStandings(competitionProvId: string): Promise<RawStandingRow[]> {
    const teams = MOCK_TEAMS[competitionProvId];
    if (!teams) return [];

    return teams.map((team, i) => {
      const played = rand(10, 20);
      const won = rand(3, played);
      const drawn = rand(0, played - won);
      const lost = played - won - drawn;
      return {
        teamProvId: team.id,
        teamName: team.name,
        position: i + 1,
        played,
        won,
        drawn,
        lost,
        goalsFor: rand(10, 50),
        goalsAgainst: rand(8, 40),
        points: won * 3 + drawn,
        form: Array.from({ length: 5 }, () => pick(['W', 'D', 'L'])).join('-'),
      };
    }).sort((a, b) => b.points - a.points)
      .map((row, i) => ({ ...row, position: i + 1 }));
  }

  async healthCheck(): Promise<{ isHealthy: boolean; rateLimitRemaining: number | null }> {
    return { isHealthy: true, rateLimitRemaining: null };
  }
}
