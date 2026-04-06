-- Migration 003: interest-profiles
-- Adds listing_scores, listing_feedback, weight_suggestions, and airfield_locations tables.

CREATE TABLE listing_scores (
  id           TEXT PRIMARY KEY,
  listing_id   TEXT NOT NULL REFERENCES listings(id),
  profile_name TEXT NOT NULL,
  score        REAL NOT NULL,
  evidence     TEXT NOT NULL,  -- JSON: EvidenceItem[]
  scored_at    TEXT NOT NULL
);

CREATE INDEX idx_listing_scores_listing ON listing_scores(listing_id);
CREATE INDEX idx_listing_scores_profile ON listing_scores(profile_name, score DESC);

-- -----------------------------------------------------------------------

CREATE TABLE listing_feedback (
  id               TEXT PRIMARY KEY,
  listing_id       TEXT NOT NULL REFERENCES listings(id),
  rating           TEXT NOT NULL
                   CHECK (rating IN ('more_interesting', 'as_expected', 'less_interesting')),
  weights_snapshot TEXT NOT NULL,  -- JSON: { profileName: weight }[]
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_feedback_listing ON listing_feedback(listing_id);
CREATE INDEX idx_feedback_created ON listing_feedback(created_at DESC);

-- -----------------------------------------------------------------------

CREATE TABLE weight_suggestions (
  id              TEXT PRIMARY KEY,
  profile_name    TEXT NOT NULL,
  current_weight  REAL NOT NULL,
  proposed_weight REAL NOT NULL,
  rationale       TEXT NOT NULL,
  feedback_count  INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at      TEXT NOT NULL,
  resolved_at     TEXT
);

CREATE INDEX idx_suggestions_profile ON weight_suggestions(profile_name, created_at DESC);
CREATE INDEX idx_suggestions_status ON weight_suggestions(status);

-- -----------------------------------------------------------------------

CREATE TABLE airfield_locations (
  icao_code TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  lat       REAL NOT NULL,
  lon       REAL NOT NULL
);
