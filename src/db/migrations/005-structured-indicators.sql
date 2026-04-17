-- Migration 005: structured-indicators
-- Adds listing_indicators table for AI-derived structured indicator data.

CREATE TABLE listing_indicators (
  listing_id   TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  indicators   TEXT,         -- JSON: StructuredIndicators object; NULL until first derivation
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'ready', 'failed', 'stale')),
  derived_at   TEXT          -- ISO 8601; NULL until first success
);

CREATE INDEX idx_listing_indicators_status ON listing_indicators(status);

-- Backfill pending rows for all listings that existed before this migration
INSERT OR IGNORE INTO listing_indicators (listing_id, status)
SELECT id, 'pending' FROM listings;
