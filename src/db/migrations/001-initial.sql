-- Migration 001: initial schema
-- Creates listings, scan_runs, and sites tables with all indexes.

CREATE TABLE listings (
  id               TEXT PRIMARY KEY,           -- UUID v4
  registration     TEXT,                        -- Aircraft registration (e.g. G-ABCD, N12345); NULL if not found
  make             TEXT,                        -- Manufacturer (e.g. "Cessna")
  model            TEXT,                        -- Model (e.g. "172S")
  aircraft_type    TEXT,                        -- Free-text type as scraped (e.g. "Cessna 172 Skyhawk")
  year             INTEGER,                     -- Year of manufacture; NULL if unknown
  price            REAL,                        -- Asking price as a number; NULL if not listed
  price_currency   TEXT NOT NULL DEFAULT 'GBP',
  location         TEXT,                        -- Free-text location as scraped
  listing_url      TEXT NOT NULL,               -- Direct URL to the listing on the source site
  source_site      TEXT NOT NULL,               -- Site name (references sites.name)
  match_score      REAL NOT NULL DEFAULT 0,     -- 0.0–100.0; written by Matcher; superseded by feature 002
  is_new           INTEGER NOT NULL DEFAULT 1,  -- 1 = found in most recent scan run; 0 = older
  date_first_found TEXT NOT NULL,               -- ISO 8601 datetime
  date_last_seen   TEXT NOT NULL,               -- ISO 8601 datetime; updated on every scan where listing reappears
  raw_attributes   TEXT                         -- JSON blob: all scraped key/value pairs from the listing
);

-- Deduplication: only one row per registration (when known)
CREATE UNIQUE INDEX idx_listings_registration
  ON listings(registration)
  WHERE registration IS NOT NULL;

-- Fast ordering for the web page
CREATE INDEX idx_listings_score ON listings(match_score DESC, date_first_found DESC);

-- Filtering by site
CREATE INDEX idx_listings_site ON listings(source_site);

-- "New" badge query: listings from the most recent scan
CREATE INDEX idx_listings_is_new ON listings(is_new);

-- -----------------------------------------------------------------------

CREATE TABLE scan_runs (
  id                TEXT PRIMARY KEY,        -- UUID v4
  started_at        TEXT NOT NULL,           -- ISO 8601 datetime
  completed_at      TEXT,                    -- NULL if scan is still running or crashed
  sites_attempted   INTEGER NOT NULL DEFAULT 0,
  sites_succeeded   INTEGER NOT NULL DEFAULT 0,
  sites_failed      INTEGER NOT NULL DEFAULT 0,
  listings_found    INTEGER NOT NULL DEFAULT 0,  -- Total raw listings scraped (before dedup)
  listings_new      INTEGER NOT NULL DEFAULT 0,  -- Net new listings added to DB this run
  error_summary     TEXT                         -- JSON array: [{site: string, error: string}]
);

CREATE INDEX idx_scan_runs_started ON scan_runs(started_at DESC);

-- -----------------------------------------------------------------------

CREATE TABLE sites (
  id            TEXT PRIMARY KEY,        -- UUID v4
  name          TEXT NOT NULL UNIQUE,    -- Human-readable name (e.g. "Trade-A-Plane")
  url           TEXT NOT NULL,           -- Base URL for the listing page
  enabled       INTEGER NOT NULL DEFAULT 1,  -- 1 = active; 0 = disabled
  priority      INTEGER NOT NULL DEFAULT 0,  -- Lower = higher priority (scan order)
  created_at    TEXT NOT NULL,
  last_verified TEXT                     -- NULL until feature 003 runs verification
);

CREATE INDEX idx_sites_enabled ON sites(enabled);
