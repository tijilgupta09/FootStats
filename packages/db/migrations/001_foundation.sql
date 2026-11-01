-- ═══════════════════════════════════════════════════════════════
-- FootStats — Migration 001: Foundation Schema
-- PostgreSQL 16 + TimescaleDB
-- ═══════════════════════════════════════════════════════════════

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- TimescaleDB (will be available in Docker)
-- CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ═══════════════════════════════════════════════════════════════
-- CUSTOM ENUMS
-- ═══════════════════════════════════════════════════════════════

CREATE TYPE match_status AS ENUM (
    'SCHEDULED', 'TOSS', 'WARMUP',
    '1H', 'HT', '2H', 'ET_1H', 'ET_HT', 'ET_2H',
    'BT', 'PEN', 'FT', 'AET', 'AP',
    'SUSP', 'PST', 'ABD', 'CANC', 'AWARDED', 'WO', 'TBD'
);

CREATE TYPE event_type AS ENUM (
    'GOAL', 'OWN_GOAL', 'PENALTY_GOAL', 'PENALTY_MISS',
    'YELLOW_CARD', 'SECOND_YELLOW', 'RED_CARD',
    'SUBSTITUTION', 'VAR_DECISION', 'VAR_GOAL_CONFIRMED',
    'VAR_GOAL_DISALLOWED', 'VAR_PENALTY_AWARDED', 'VAR_PENALTY_CANCELLED',
    'VAR_RED_CARD', 'PENALTY_AWARDED',
    'KICKOFF', 'HALFTIME', 'SECOND_HALF_START', 'FULLTIME',
    'EXTRA_TIME_START', 'PENALTY_SHOOTOUT_START'
);

CREATE TYPE competition_tier AS ENUM (
    'TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'FRIENDLY'
);

CREATE TYPE news_category AS ENUM (
    'BREAKING', 'TRANSFERS', 'INJURIES', 'MATCH_REPORTS',
    'TACTICS', 'VAR_WATCH', 'FEATURES', 'INTERVIEWS'
);

CREATE TYPE player_position AS ENUM (
    'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB',
    'CDM', 'CM', 'CAM', 'LM', 'RM',
    'LW', 'RW', 'CF', 'ST'
);

-- ═══════════════════════════════════════════════════════════════
-- AUTO-UPDATE TRIGGER
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- CORE ENTITY TABLES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE countries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code_iso2 CHAR(2) UNIQUE,
    code_iso3 CHAR(3) UNIQUE,
    flag_url TEXT,
    continent VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER set_countries_updated_at
    BEFORE UPDATE ON countries
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE competitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    short_name VARCHAR(50),
    code VARCHAR(20),
    country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
    tier competition_tier NOT NULL DEFAULT 'TIER_3',
    type VARCHAR(30) NOT NULL CHECK (type IN ('LEAGUE', 'CUP', 'SUPER_CUP', 'INTERNATIONAL')),
    logo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INT NOT NULL DEFAULT 999,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_competitions_tier ON competitions(tier, display_order);
CREATE INDEX idx_competitions_country ON competitions(country_id);
CREATE INDEX idx_competitions_name_trgm ON competitions USING gin(name gin_trgm_ops);
CREATE TRIGGER set_competitions_updated_at
    BEFORE UPDATE ON competitions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    name VARCHAR(30) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(competition_id, name)
);
CREATE INDEX idx_seasons_current ON seasons(competition_id) WHERE is_current = TRUE;
CREATE TRIGGER set_seasons_updated_at
    BEFORE UPDATE ON seasons
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    city VARCHAR(100),
    country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
    capacity INT,
    surface VARCHAR(50),
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_venues_name_trgm ON venues USING gin(name gin_trgm_ops);
CREATE TRIGGER set_venues_updated_at
    BEFORE UPDATE ON venues
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    short_name VARCHAR(50),
    code VARCHAR(10),
    country_id UUID REFERENCES countries(id) ON DELETE SET NULL,
    venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    logo_url TEXT,
    founded_year INT,
    manager_name VARCHAR(200),
    manager_photo_url TEXT,
    current_elo DECIMAL(8, 2) NOT NULL DEFAULT 1500.00,
    market_value_eur BIGINT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_teams_name_trgm ON teams USING gin(name gin_trgm_ops);
CREATE INDEX idx_teams_country ON teams(country_id);
CREATE INDEX idx_teams_elo ON teams(current_elo DESC);
CREATE TRIGGER set_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    short_name VARCHAR(100),
    display_name VARCHAR(100),
    date_of_birth DATE,
    nationality_id UUID REFERENCES countries(id) ON DELETE SET NULL,
    current_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    position player_position,
    shirt_number INT,
    height_cm INT,
    weight_kg INT,
    preferred_foot VARCHAR(10) CHECK (preferred_foot IN ('LEFT', 'RIGHT', 'BOTH')),
    photo_url TEXT,
    market_value_eur BIGINT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_players_name_trgm ON players USING gin(name gin_trgm_ops);
CREATE INDEX idx_players_team ON players(current_team_id) WHERE is_active = TRUE;
CREATE INDEX idx_players_position ON players(position);
CREATE TRIGGER set_players_updated_at
    BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- ENTITY ALIAS MAPPING (Multi-Provider ID Resolution)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE entity_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type VARCHAR(30) NOT NULL CHECK (entity_type IN (
        'COMPETITION', 'TEAM', 'PLAYER', 'VENUE', 'COUNTRY'
    )),
    internal_id UUID NOT NULL,
    provider VARCHAR(50) NOT NULL,
    external_id VARCHAR(100) NOT NULL,
    external_name VARCHAR(300),
    confidence DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_type, provider, external_id)
);
CREATE INDEX idx_entity_aliases_lookup ON entity_aliases(entity_type, internal_id);
CREATE INDEX idx_entity_aliases_provider ON entity_aliases(provider, entity_type, external_id);
CREATE INDEX idx_entity_aliases_name_trgm ON entity_aliases USING gin(external_name gin_trgm_ops);

-- ═══════════════════════════════════════════════════════════════
-- MATCHES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    matchday INT,
    round_name VARCHAR(100),

    home_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    away_team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
    referee_name VARCHAR(200),

    -- Scheduling
    kickoff_at TIMESTAMPTZ NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',

    -- Live State
    status match_status NOT NULL DEFAULT 'SCHEDULED',
    minute INT,
    added_time INT NOT NULL DEFAULT 0,
    period VARCHAR(20),

    -- Scores
    home_score INT NOT NULL DEFAULT 0,
    away_score INT NOT NULL DEFAULT 0,
    home_ht_score INT,
    away_ht_score INT,
    home_ft_score INT,
    away_ft_score INT,
    home_et_score INT,
    away_et_score INT,
    home_pen_score INT,
    away_pen_score INT,
    home_agg_score INT,
    away_agg_score INT,

    -- Metadata
    attendance INT,
    pitch_condition VARCHAR(50),
    weather JSONB,

    -- Lineups (JSONB)
    lineups JSONB,

    -- Stats (JSONB)
    stats JSONB NOT NULL DEFAULT '{}',

    -- xG Timeline (JSONB array)
    xg_timeline JSONB NOT NULL DEFAULT '[]',

    -- AI Predictions (latest snapshot)
    predictions JSONB NOT NULL DEFAULT '{}',

    -- Provider IDs
    provider_ids JSONB NOT NULL DEFAULT '{}',

    -- State hashing for delta detection
    state_hash VARCHAR(32),
    state_version INT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_matches_kickoff ON matches(kickoff_at);
CREATE INDEX idx_matches_live ON matches(status) WHERE status IN ('1H', 'HT', '2H', 'ET_1H', 'ET_HT', 'ET_2H', 'BT', 'PEN');
CREATE INDEX idx_matches_competition_season ON matches(competition_id, season_id, matchday);
CREATE INDEX idx_matches_home_team ON matches(home_team_id, kickoff_at DESC);
CREATE INDEX idx_matches_away_team ON matches(away_team_id, kickoff_at DESC);
CREATE INDEX idx_matches_date ON matches((kickoff_at::date));
CREATE INDEX idx_matches_provider_ids ON matches USING gin(provider_ids);

CREATE TRIGGER set_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- MATCH EVENTS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE match_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    event_type event_type NOT NULL,
    minute INT NOT NULL,
    added_time INT NOT NULL DEFAULT 0,
    period VARCHAR(20),

    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    player_name VARCHAR(200),
    related_player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    related_player_name VARCHAR(200),

    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    is_home BOOLEAN,

    detail JSONB NOT NULL DEFAULT '{}',

    home_score_at_event INT,
    away_score_at_event INT,

    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_match_events_match ON match_events(match_id, minute, sort_order);
CREATE INDEX idx_match_events_type ON match_events(event_type);
CREATE INDEX idx_match_events_player ON match_events(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX idx_match_events_team ON match_events(team_id) WHERE team_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- STANDINGS
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE standings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    group_name VARCHAR(50),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

    position INT NOT NULL,
    played INT NOT NULL DEFAULT 0,
    won INT NOT NULL DEFAULT 0,
    drawn INT NOT NULL DEFAULT 0,
    lost INT NOT NULL DEFAULT 0,
    goals_for INT NOT NULL DEFAULT 0,
    goals_against INT NOT NULL DEFAULT 0,
    goal_difference INT GENERATED ALWAYS AS (goals_for - goals_against) STORED,
    points INT NOT NULL DEFAULT 0,

    form VARCHAR(20),
    qualification_status VARCHAR(50),

    live_position_delta INT NOT NULL DEFAULT 0,
    is_live BOOLEAN NOT NULL DEFAULT FALSE,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(competition_id, season_id, COALESCE(group_name, ''), team_id)
);
CREATE INDEX idx_standings_lookup ON standings(competition_id, season_id, position);
CREATE INDEX idx_standings_team ON standings(team_id);

CREATE TRIGGER set_standings_updated_at
    BEFORE UPDATE ON standings
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- TIME-SERIES TABLES (TimescaleDB compatible, works as regular tables without extension)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE match_probability_ticks (
    time TIMESTAMPTZ NOT NULL,
    match_id UUID NOT NULL,
    minute INT,
    home_win_prob DECIMAL(5, 4),
    draw_prob DECIMAL(5, 4),
    away_win_prob DECIMAL(5, 4),
    home_xg_live DECIMAL(5, 3),
    away_xg_live DECIMAL(5, 3),
    trigger_event VARCHAR(50),
    model_version VARCHAR(20),
    features JSONB
);
CREATE INDEX idx_prob_ticks_match_time ON match_probability_ticks(match_id, time DESC);
CREATE INDEX idx_prob_ticks_time ON match_probability_ticks(time DESC);

-- Convert to hypertable if TimescaleDB is available
-- SELECT create_hypertable('match_probability_ticks', 'time', if_not_exists => TRUE);

CREATE TABLE match_momentum_ticks (
    time TIMESTAMPTZ NOT NULL,
    match_id UUID NOT NULL,
    minute INT,
    home_momentum DECIMAL(5, 2),
    home_pressure_index DECIMAL(5, 2),
    away_pressure_index DECIMAL(5, 2),
    possession_home DECIMAL(5, 2),
    xg_pace_home DECIMAL(5, 3),
    xg_pace_away DECIMAL(5, 3)
);
CREATE INDEX idx_momentum_match_time ON match_momentum_ticks(match_id, time DESC);

-- SELECT create_hypertable('match_momentum_ticks', 'time', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════
-- ELO & TEAM STRENGTH HISTORY
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE team_elo_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    elo DECIMAL(8, 2) NOT NULL,
    elo_delta DECIMAL(6, 2),
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    source VARCHAR(50) NOT NULL DEFAULT 'calculated',
    UNIQUE(team_id, date)
);
CREATE INDEX idx_elo_team_date ON team_elo_history(team_id, date DESC);

CREATE TABLE team_xg_rolling (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    match_id UUID REFERENCES matches(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    xg_for DECIMAL(5, 3),
    xg_against DECIMAL(5, 3),
    ewma_5_xg_for DECIMAL(5, 3),
    ewma_5_xg_against DECIMAL(5, 3),
    ewma_10_xg_for DECIMAL(5, 3),
    ewma_10_xg_against DECIMAL(5, 3),
    venue_type VARCHAR(10) CHECK (venue_type IN ('HOME', 'AWAY', 'NEUTRAL')),
    UNIQUE(team_id, match_id)
);
CREATE INDEX idx_xg_rolling_team ON team_xg_rolling(team_id, date DESC);

-- ═══════════════════════════════════════════════════════════════
-- NEWS ARTICLES
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE news_articles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name VARCHAR(100) NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    source_tier INT NOT NULL DEFAULT 2 CHECK (source_tier BETWEEN 1 AND 4),

    title TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    thumbnail_url TEXT,
    author VARCHAR(200),
    published_at TIMESTAMPTZ NOT NULL,

    category news_category,
    canonical_story_id UUID,

    tagged_competition_ids UUID[] DEFAULT '{}',
    tagged_team_ids UUID[] DEFAULT '{}',
    tagged_player_ids UUID[] DEFAULT '{}',

    nlp_entities JSONB NOT NULL DEFAULT '{}',
    -- embedding_vector VECTOR(384),  -- Requires pgvector extension
    minhash_signature BYTEA,

    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_news_published ON news_articles(published_at DESC);
CREATE INDEX idx_news_category ON news_articles(category, published_at DESC);
CREATE INDEX idx_news_teams ON news_articles USING GIN(tagged_team_ids);
CREATE INDEX idx_news_players ON news_articles USING GIN(tagged_player_ids);
CREATE INDEX idx_news_canonical ON news_articles(canonical_story_id) WHERE canonical_story_id IS NOT NULL;
CREATE INDEX idx_news_source ON news_articles(source_name, published_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- COMPETITION-TEAM MAPPING (Many-to-Many)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE competition_teams (
    competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    PRIMARY KEY (competition_id, season_id, team_id)
);
CREATE INDEX idx_competition_teams_team ON competition_teams(team_id);

-- ═══════════════════════════════════════════════════════════════
-- DONE
-- ═══════════════════════════════════════════════════════════════
