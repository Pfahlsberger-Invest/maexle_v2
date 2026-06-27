-- ============================================================
-- Mäxle Score-Board · Database Schema (Postgres / Neon)
-- ============================================================
-- Apply once on a fresh Neon database. Script is idempotent
-- (safe to re-run; uses IF NOT EXISTS / ON CONFLICT clauses).
-- ============================================================

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- Optional clean reset (uncomment to wipe everything)
-- ------------------------------------------------------------
-- DROP VIEW  IF EXISTS player_stats;
-- DROP TABLE IF EXISTS round_participants, rounds,
--                      schande_adjustments, players, app_state CASCADE;

-- ============================================================
-- TABLE: players
-- The four (or more) people on the score board.
-- Soft-deleted via archived_at — historical rounds stay valid.
-- ============================================================
CREATE TABLE IF NOT EXISTS players (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  color          text        NOT NULL,
  in_game        boolean     NOT NULL DEFAULT true,
  schande_score  integer     NOT NULL DEFAULT 0
                              CHECK (schande_score BETWEEN -100 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz
);

-- Only one *active* player per name (case-insensitive); reuse OK after archive
CREATE UNIQUE INDEX IF NOT EXISTS uniq_players_active_name
  ON players (lower(name))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_players_active
  ON players (created_at)
  WHERE archived_at IS NULL;

-- ============================================================
-- TABLE: rounds
-- One row per click event. The "loser" is the person whose
-- counter went up. The IP is who recorded it.
-- ============================================================
CREATE TABLE IF NOT EXISTS rounds (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  loser_id    uuid        NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  played_at   timestamptz NOT NULL DEFAULT now(),
  ip_address  inet
);

CREATE INDEX IF NOT EXISTS idx_rounds_played_at ON rounds (played_at DESC);
CREATE INDEX IF NOT EXISTS idx_rounds_loser     ON rounds (loser_id);

-- ============================================================
-- TABLE: round_participants
-- Who was "Im Spiel" when this round was recorded.
-- The loser is always also a participant.
-- ============================================================
CREATE TABLE IF NOT EXISTS round_participants (
  round_id   uuid NOT NULL REFERENCES rounds(id)  ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  PRIMARY KEY (round_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_player ON round_participants (player_id);

-- ============================================================
-- TABLE: schande_adjustments
-- Audit log of MANUAL changes (slider in the modal).
-- Automatic 5-min decay is NOT logged — it's just applied to
-- players.schande_score directly.
-- ============================================================
CREATE TABLE IF NOT EXISTS schande_adjustments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   uuid        NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  delta       integer     NOT NULL CHECK (delta BETWEEN -200 AND 200),
  applied_at  timestamptz NOT NULL DEFAULT now(),
  ip_address  inet
);

CREATE INDEX IF NOT EXISTS idx_schande_player     ON schande_adjustments (player_id);
CREATE INDEX IF NOT EXISTS idx_schande_applied_at ON schande_adjustments (applied_at DESC);

-- ============================================================
-- TABLE: app_state
-- Global key/value: last_decay_at, feature flags, etc.
-- ============================================================
CREATE TABLE IF NOT EXISTS app_state (
  key         text        PRIMARY KEY,
  value       jsonb       NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_state (key, value)
VALUES ('last_decay_at', to_jsonb(now()))
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- VIEW: player_stats
-- Convenience view with punkte, runden, quote per player.
-- ============================================================
CREATE OR REPLACE VIEW player_stats AS
SELECT
  p.id,
  p.name,
  p.color,
  p.in_game,
  p.schande_score,
  COALESCE(losses.cnt, 0)::int  AS punkte,
  COALESCE(parts.cnt,  0)::int  AS runden,
  CASE
    WHEN COALESCE(parts.cnt, 0) > 0
    THEN ROUND((COALESCE(losses.cnt, 0)::numeric / parts.cnt) * 1000) / 10
    ELSE NULL
  END AS quote_pct
FROM players p
LEFT JOIN (
  SELECT loser_id, COUNT(*) AS cnt
  FROM rounds GROUP BY loser_id
) losses ON losses.loser_id = p.id
LEFT JOIN (
  SELECT player_id, COUNT(*) AS cnt
  FROM round_participants GROUP BY player_id
) parts ON parts.player_id = p.id
WHERE p.archived_at IS NULL
ORDER BY quote_pct NULLS LAST, p.created_at;

-- ============================================================
-- SEED: the original four players
-- ============================================================
INSERT INTO players (name, color, in_game)
SELECT s.name, s.color, true
FROM (VALUES
  ('Luki',   '#FF6B6B'),
  ('Thoma',  '#4ECDC4'),
  ('Simi',   '#FFD93D'),
  ('Mauchi', '#A78BFA')
) AS s(name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM players p
  WHERE lower(p.name) = lower(s.name) AND p.archived_at IS NULL
);

-- ============================================================
-- Quick sanity check
-- ============================================================
SELECT * FROM player_stats;
