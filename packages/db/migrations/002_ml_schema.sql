-- ═══════════════════════════════════════════════════════════════
-- FootStats — Migration 002: ML Engine Schema Enhancements
-- Phase 3: Adds columns required by the Node.js ML inference engine
-- ═══════════════════════════════════════════════════════════════

-- ─── Extend match_momentum_ticks ─────────────────────────────
-- The original schema had partial columns; add the full set used
-- by the momentum calculator. Use IF NOT EXISTS guards so this
-- migration is idempotent.

ALTER TABLE match_momentum_ticks
  ADD COLUMN IF NOT EXISTS momentum_home    INT,
  ADD COLUMN IF NOT EXISTS momentum_away    INT,
  ADD COLUMN IF NOT EXISTS pressure_home    INT,
  ADD COLUMN IF NOT EXISTS pressure_away    INT,
  ADD COLUMN IF NOT EXISTS dominant_team    VARCHAR(10)
    CHECK (dominant_team IN ('home', 'away', 'neutral'));

-- Back-fill renamed columns (if rows exist from earlier schema)
UPDATE match_momentum_ticks
SET
  momentum_home = ROUND(home_momentum)::INT
WHERE momentum_home IS NULL AND home_momentum IS NOT NULL;

-- ─── Extend match_probability_ticks ──────────────────────────
-- Add a unique constraint on (match_id, time) so ON CONFLICT
-- DO NOTHING works correctly in the inference consumer.
-- Wrapped in DO block to avoid error if already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'match_probability_ticks_match_id_time_key'
  ) THEN
    ALTER TABLE match_probability_ticks
      ADD CONSTRAINT match_probability_ticks_match_id_time_key
      UNIQUE (match_id, time);
  END IF;
END;
$$;

-- Same for momentum ticks
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'match_momentum_ticks_match_id_time_key'
  ) THEN
    ALTER TABLE match_momentum_ticks
      ADD CONSTRAINT match_momentum_ticks_match_id_time_key
      UNIQUE (match_id, time);
  END IF;
END;
$$;

-- ─── Team attack/defence ratings ─────────────────────────────
-- New table for storing computed season-level team ratings used
-- by the Poisson model. Populated by the ELO/xG rolling tables.

CREATE TABLE IF NOT EXISTS team_season_ratings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season_id       UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    competition_id  UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,

    attack_rating   DECIMAL(5, 3) NOT NULL DEFAULT 1.5,
    defence_rating  DECIMAL(5, 3) NOT NULL DEFAULT 1.3,
    home_attack     DECIMAL(5, 3),    -- attack rating at home
    away_attack     DECIMAL(5, 3),    -- attack rating away
    home_defence    DECIMAL(5, 3),    -- goals conceded at home
    away_defence    DECIMAL(5, 3),    -- goals conceded away

    matches_played  INT NOT NULL DEFAULT 0,
    goals_for       INT NOT NULL DEFAULT 0,
    goals_against   INT NOT NULL DEFAULT 0,

    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(team_id, season_id, competition_id)
);

CREATE INDEX IF NOT EXISTS idx_team_season_ratings_team
  ON team_season_ratings(team_id, season_id);

CREATE TRIGGER set_team_season_ratings_updated_at
  BEFORE UPDATE ON team_season_ratings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── DONE ─────────────────────────────────────────────────────
