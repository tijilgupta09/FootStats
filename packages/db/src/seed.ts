// ═══════════════════════════════════════════════════════════════
// FootStats — Database Seed Script
// ═══════════════════════════════════════════════════════════════
//
// Seeds the database with initial data matching the mock provider:
// - Countries, Competitions, Seasons, Venues, Teams
// - Creates entity_aliases for provider → internal ID mapping
// - Seeds some historical matches for H2H and standings
//
// Usage: pnpm --filter @footstats/db seed
//

import 'dotenv/config';
import { getPool, query, transaction, closePool } from './connection';

// ─── Seed Data ──────────────────────────────────────────────

const COUNTRIES = [
  { name: 'England', code2: 'GB', code3: 'GBR', continent: 'Europe' },
  { name: 'Spain', code2: 'ES', code3: 'ESP', continent: 'Europe' },
  { name: 'Italy', code2: 'IT', code3: 'ITA', continent: 'Europe' },
  { name: 'Germany', code2: 'DE', code3: 'DEU', continent: 'Europe' },
  { name: 'France', code2: 'FR', code3: 'FRA', continent: 'Europe' },
  { name: 'Europe', code2: null, code3: null, continent: 'Europe' },
] as const;

const COMPETITIONS = [
  { name: 'Premier League', short: 'PL', code: 'PL', country: 'England', tier: 'TIER_1', type: 'LEAGUE', order: 1 },
  { name: 'La Liga', short: 'LL', code: 'LL', country: 'Spain', tier: 'TIER_1', type: 'LEAGUE', order: 2 },
  { name: 'Serie A', short: 'SA', code: 'SA', country: 'Italy', tier: 'TIER_1', type: 'LEAGUE', order: 3 },
  { name: 'Bundesliga', short: 'BL', code: 'BL', country: 'Germany', tier: 'TIER_1', type: 'LEAGUE', order: 4 },
  { name: 'Ligue 1', short: 'L1', code: 'L1', country: 'France', tier: 'TIER_1', type: 'LEAGUE', order: 5 },
  { name: 'Champions League', short: 'UCL', code: 'UCL', country: 'Europe', tier: 'TIER_1', type: 'CUP', order: 0 },
] as const;

const TEAMS: Record<string, Array<{ name: string; short: string; code: string; elo: number; venue: string; city: string; capacity: number }>> = {
  PL: [
    { name: 'Arsenal', short: 'Arsenal', code: 'ARS', elo: 1920, venue: 'Emirates Stadium', city: 'London', capacity: 60704 },
    { name: 'Manchester City', short: 'Man City', code: 'MCI', elo: 1945, venue: 'Etihad Stadium', city: 'Manchester', capacity: 53400 },
    { name: 'Liverpool', short: 'Liverpool', code: 'LIV', elo: 1910, venue: 'Anfield', city: 'Liverpool', capacity: 61276 },
    { name: 'Chelsea', short: 'Chelsea', code: 'CHE', elo: 1830, venue: 'Stamford Bridge', city: 'London', capacity: 40341 },
    { name: 'Manchester United', short: 'Man Utd', code: 'MUN', elo: 1810, venue: 'Old Trafford', city: 'Manchester', capacity: 74310 },
    { name: 'Tottenham Hotspur', short: 'Spurs', code: 'TOT', elo: 1800, venue: 'Tottenham Hotspur Stadium', city: 'London', capacity: 62850 },
    { name: 'Aston Villa', short: 'Aston Villa', code: 'AVL', elo: 1790, venue: 'Villa Park', city: 'Birmingham', capacity: 42640 },
    { name: 'Newcastle United', short: 'Newcastle', code: 'NEW', elo: 1810, venue: 'St. James\' Park', city: 'Newcastle', capacity: 52305 },
    { name: 'West Ham United', short: 'West Ham', code: 'WHU', elo: 1750, venue: 'London Stadium', city: 'London', capacity: 62500 },
    { name: 'Brighton & Hove Albion', short: 'Brighton', code: 'BHA', elo: 1770, venue: 'Amex Stadium', city: 'Brighton', capacity: 31800 },
  ],
  LL: [
    { name: 'Real Madrid', short: 'Real Madrid', code: 'RMA', elo: 1960, venue: 'Santiago Bernabéu', city: 'Madrid', capacity: 81044 },
    { name: 'FC Barcelona', short: 'Barcelona', code: 'BAR', elo: 1930, venue: 'Spotify Camp Nou', city: 'Barcelona', capacity: 99354 },
    { name: 'Atlético Madrid', short: 'Atlético', code: 'ATM', elo: 1870, venue: 'Cívitas Metropolitano', city: 'Madrid', capacity: 68456 },
    { name: 'Real Sociedad', short: 'Sociedad', code: 'RSO', elo: 1800, venue: 'Reale Arena', city: 'San Sebastián', capacity: 39803 },
    { name: 'Real Betis', short: 'Betis', code: 'BET', elo: 1770, venue: 'Benito Villamarín', city: 'Seville', capacity: 60720 },
    { name: 'Athletic Club', short: 'Athletic', code: 'ATH', elo: 1780, venue: 'San Mamés', city: 'Bilbao', capacity: 53289 },
    { name: 'Villarreal CF', short: 'Villarreal', code: 'VIL', elo: 1790, venue: 'Estadio de la Cerámica', city: 'Villarreal', capacity: 23000 },
    { name: 'Sevilla FC', short: 'Sevilla', code: 'SEV', elo: 1760, venue: 'Ramón Sánchez-Pizjuán', city: 'Seville', capacity: 43883 },
  ],
  SA: [
    { name: 'SSC Napoli', short: 'Napoli', code: 'NAP', elo: 1880, venue: 'Stadio Diego Armando Maradona', city: 'Naples', capacity: 54726 },
    { name: 'Inter Milan', short: 'Inter', code: 'INT', elo: 1900, venue: 'San Siro', city: 'Milan', capacity: 75923 },
    { name: 'AC Milan', short: 'Milan', code: 'MIL', elo: 1850, venue: 'San Siro', city: 'Milan', capacity: 75923 },
    { name: 'Juventus', short: 'Juventus', code: 'JUV', elo: 1870, venue: 'Allianz Stadium', city: 'Turin', capacity: 41507 },
    { name: 'AS Roma', short: 'Roma', code: 'ROM', elo: 1810, venue: 'Stadio Olimpico', city: 'Rome', capacity: 72698 },
    { name: 'SS Lazio', short: 'Lazio', code: 'LAZ', elo: 1790, venue: 'Stadio Olimpico', city: 'Rome', capacity: 72698 },
    { name: 'Atalanta BC', short: 'Atalanta', code: 'ATA', elo: 1840, venue: 'Gewiss Stadium', city: 'Bergamo', capacity: 21300 },
    { name: 'ACF Fiorentina', short: 'Fiorentina', code: 'FIO', elo: 1780, venue: 'Stadio Artemio Franchi', city: 'Florence', capacity: 43147 },
  ],
  BL: [
    { name: 'Bayern Munich', short: 'Bayern', code: 'BAY', elo: 1940, venue: 'Allianz Arena', city: 'Munich', capacity: 75024 },
    { name: 'Borussia Dortmund', short: 'Dortmund', code: 'BVB', elo: 1880, venue: 'Signal Iduna Park', city: 'Dortmund', capacity: 81365 },
    { name: 'RB Leipzig', short: 'Leipzig', code: 'RBL', elo: 1850, venue: 'Red Bull Arena', city: 'Leipzig', capacity: 47069 },
    { name: 'Bayer Leverkusen', short: 'Leverkusen', code: 'LEV', elo: 1870, venue: 'BayArena', city: 'Leverkusen', capacity: 30210 },
    { name: 'VfB Stuttgart', short: 'Stuttgart', code: 'STU', elo: 1780, venue: 'MHPArena', city: 'Stuttgart', capacity: 60449 },
    { name: 'Eintracht Frankfurt', short: 'Frankfurt', code: 'SGE', elo: 1800, venue: 'Deutsche Bank Park', city: 'Frankfurt', capacity: 51500 },
  ],
  L1: [
    { name: 'Paris Saint-Germain', short: 'PSG', code: 'PSG', elo: 1910, venue: 'Parc des Princes', city: 'Paris', capacity: 47929 },
    { name: 'Olympique Marseille', short: 'Marseille', code: 'OM', elo: 1800, venue: 'Stade Vélodrome', city: 'Marseille', capacity: 67394 },
    { name: 'AS Monaco', short: 'Monaco', code: 'ASM', elo: 1810, venue: 'Stade Louis II', city: 'Monaco', capacity: 18523 },
    { name: 'OGC Nice', short: 'Nice', code: 'NIC', elo: 1770, venue: 'Allianz Riviera', city: 'Nice', capacity: 35624 },
    { name: 'LOSC Lille', short: 'Lille', code: 'LIL', elo: 1790, venue: 'Stade Pierre-Mauroy', city: 'Lille', capacity: 50157 },
    { name: 'Olympique Lyonnais', short: 'Lyon', code: 'LYO', elo: 1780, venue: 'Groupama Stadium', city: 'Lyon', capacity: 59186 },
  ],
};

// ─── Main Seed Function ─────────────────────────────────────

async function seed(): Promise<void> {
  console.log('');
  console.log('  🌱 FootStats Database Seeder');
  console.log('  ────────────────────────────────────────');

  const countryIds = new Map<string, string>();
  const competitionIds = new Map<string, string>();
  const seasonIds = new Map<string, string>();
  const teamIds = new Map<string, string>();

  await transaction(async (client) => {
    // ─── 1. Countries ─────────────────────────────────────
    console.log('  ├─ Seeding countries...');
    for (const country of COUNTRIES) {
      const result = await client.query(
        `INSERT INTO countries (name, code_iso2, code_iso3, continent)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (name) DO UPDATE SET
           code_iso2 = COALESCE(EXCLUDED.code_iso2, countries.code_iso2),
           continent = COALESCE(EXCLUDED.continent, countries.continent)
         RETURNING id`,
        [country.name, country.code2, country.code3, country.continent],
      );
      countryIds.set(country.name, result.rows[0].id);
    }
    console.log(`  │  ✓ ${COUNTRIES.length} countries`);

    // ─── 2. Competitions ──────────────────────────────────
    console.log('  ├─ Seeding competitions...');
    for (const comp of COMPETITIONS) {
      const countryId = countryIds.get(comp.country);
      const result = await client.query(
        `INSERT INTO competitions (name, short_name, code, country_id, tier, type, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [comp.name, comp.short, comp.code, countryId, comp.tier, comp.type, comp.order],
      );
      if (result.rows[0]) {
        competitionIds.set(comp.code, result.rows[0].id);
      } else {
        // Already exists — fetch its ID
        const existing = await client.query(
          'SELECT id FROM competitions WHERE code = $1',
          [comp.code],
        );
        if (existing.rows[0]) {
          competitionIds.set(comp.code, existing.rows[0].id);
        }
      }
    }
    console.log(`  │  ✓ ${COMPETITIONS.length} competitions`);

    // ─── 3. Seasons ───────────────────────────────────────
    console.log('  ├─ Seeding seasons...');
    for (const [code, compId] of competitionIds) {
      const result = await client.query(
        `INSERT INTO seasons (competition_id, name, start_date, end_date, is_current)
         VALUES ($1, '2024-25', '2024-08-01', '2025-06-30', true)
         ON CONFLICT (competition_id, name) DO UPDATE SET is_current = true
         RETURNING id`,
        [compId],
      );
      seasonIds.set(code, result.rows[0].id);
    }
    console.log(`  │  ✓ ${seasonIds.size} seasons`);

    // ─── 4. Venues + Teams ────────────────────────────────
    console.log('  ├─ Seeding teams & venues...');
    let totalTeams = 0;

    for (const [compCode, teams] of Object.entries(TEAMS)) {
      const countryName = COMPETITIONS.find((c) => c.code === compCode)?.country;
      const countryId = countryName ? countryIds.get(countryName) : null;
      const compId = competitionIds.get(compCode);
      const seasonId = seasonIds.get(compCode);

      for (const team of teams) {
        // Insert venue
        const venueResult = await client.query(
          `INSERT INTO venues (name, city, country_id, capacity)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [team.venue, team.city, countryId, team.capacity],
        );
        let venueId = venueResult.rows[0]?.id;
        if (!venueId) {
          const existing = await client.query(
            'SELECT id FROM venues WHERE name = $1',
            [team.venue],
          );
          venueId = existing.rows[0]?.id;
        }

        // Insert team
        const teamResult = await client.query(
          `INSERT INTO teams (name, short_name, code, country_id, venue_id, current_elo)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING
           RETURNING id`,
          [team.name, team.short, team.code, countryId, venueId, team.elo],
        );
        let teamId = teamResult.rows[0]?.id;
        if (!teamId) {
          const existing = await client.query(
            'SELECT id FROM teams WHERE code = $1',
            [team.code],
          );
          teamId = existing.rows[0]?.id;
        }

        if (teamId) {
          teamIds.set(team.code, teamId);

          // Create entity alias for mock provider mapping
          await client.query(
            `INSERT INTO entity_aliases (entity_type, internal_id, provider, external_id, external_name, verified)
             VALUES ('TEAM', $1, 'mock', $2, $3, true)
             ON CONFLICT (entity_type, provider, external_id) DO NOTHING`,
            [teamId, team.code, team.name],
          );

          // Link team to competition/season
          if (compId && seasonId) {
            await client.query(
              `INSERT INTO competition_teams (competition_id, season_id, team_id)
               VALUES ($1, $2, $3)
               ON CONFLICT DO NOTHING`,
              [compId, seasonId, teamId],
            );
          }
        }

        totalTeams++;
      }
    }
    console.log(`  │  ✓ ${totalTeams} teams`);

    // ─── 5. Initial Standings ─────────────────────────────
    console.log('  ├─ Seeding initial standings...');
    for (const [compCode, teams] of Object.entries(TEAMS)) {
      const compId = competitionIds.get(compCode);
      const seasonId = seasonIds.get(compCode);
      if (!compId || !seasonId) continue;

      for (let i = 0; i < teams.length; i++) {
        const team = teams[i]!;
        const teamId = teamIds.get(team.code);
        if (!teamId) continue;

        await client.query(
          `INSERT INTO standings (competition_id, season_id, team_id, position, points)
           VALUES ($1, $2, $3, $4, 0)
           ON CONFLICT (competition_id, season_id, group_name, team_id) DO NOTHING`,
          [compId, seasonId, teamId, i + 1],
        );
      }
    }
    console.log(`  │  ✓ Initial standings seeded`);

    // ─── 6. Create Competition Entity Aliases ────────────
    console.log('  ├─ Seeding entity aliases...');
    for (const [code, compId] of competitionIds) {
      await client.query(
        `INSERT INTO entity_aliases (entity_type, internal_id, provider, external_id, external_name, verified)
         VALUES ('COMPETITION', $1, 'mock', $2, $3, true)
         ON CONFLICT (entity_type, provider, external_id) DO NOTHING`,
        [compId, code, COMPETITIONS.find((c) => c.code === code)?.name],
      );
    }
    console.log(`  │  ✓ Entity aliases created`);
  });

  console.log('  └─ ✅ Seed complete!');
  console.log('');

  // Print summary
  console.log('  📊 Summary:');
  console.log(`     Countries:     ${countryIds.size}`);
  console.log(`     Competitions:  ${competitionIds.size}`);
  console.log(`     Seasons:       ${seasonIds.size}`);
  console.log(`     Teams:         ${teamIds.size}`);
  console.log('');
}

// ─── Execute ────────────────────────────────────────────────

seed()
  .then(() => {
    console.log('  Done. Closing connections...');
    return closePool();
  })
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('  ✗ Seed failed:', err);
    process.exit(1);
  });
