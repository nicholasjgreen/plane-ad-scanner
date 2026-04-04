-- Migration 002: site management
-- Extends sites table with status/scan metadata; adds verification_results and discovery_candidates tables.

-- ---------------------------------------------------------------------------
-- Extend the sites table for full lifecycle management.
-- ---------------------------------------------------------------------------

ALTER TABLE sites ADD COLUMN status TEXT NOT NULL DEFAULT 'enabled'
  CHECK (status IN ('pending', 'enabled', 'disabled', 'verification_failed'));

ALTER TABLE sites ADD COLUMN last_scan_outcome TEXT;
-- JSON: { date: ISO8601, listingsFound: number, error?: string } | null

ALTER TABLE sites ADD COLUMN total_listings INTEGER NOT NULL DEFAULT 0;
-- Denormalised count updated after each scan for fast display.

-- ---------------------------------------------------------------------------
-- Keep legacy 'enabled' column in sync with new status column.
-- Feature 001 orchestrator reads WHERE enabled = 1; trigger preserves compat.
-- ---------------------------------------------------------------------------

CREATE TRIGGER sync_enabled_on_insert
AFTER INSERT ON sites
BEGIN
  UPDATE sites SET enabled = CASE WHEN NEW.status = 'enabled' THEN 1 ELSE 0 END
  WHERE id = NEW.id;
END;

CREATE TRIGGER sync_enabled_on_update
AFTER UPDATE OF status ON sites
BEGIN
  UPDATE sites SET enabled = CASE WHEN NEW.status = 'enabled' THEN 1 ELSE 0 END
  WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- verification_results: records every verification attempt per site.
-- ---------------------------------------------------------------------------

CREATE TABLE verification_results (
  id             TEXT PRIMARY KEY,          -- UUID v4
  site_id        TEXT NOT NULL REFERENCES sites(id),
  attempted_at   TEXT NOT NULL,             -- ISO 8601 datetime
  completed_at   TEXT,                      -- NULL while in progress
  listings_sample TEXT,                     -- JSON: RawListing[] (up to 5 items shown to admin)
  passed         INTEGER,                   -- 1 = passed, 0 = failed, NULL = in progress
  failure_reason TEXT                       -- Human-readable explanation on failure
);

CREATE INDEX idx_verification_site ON verification_results(site_id, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- discovery_candidates: sites proposed by the Discoverer agent.
-- ---------------------------------------------------------------------------

CREATE TABLE discovery_candidates (
  id            TEXT PRIMARY KEY,           -- UUID v4
  url           TEXT NOT NULL UNIQUE,       -- Normalised (trailing slash stripped, lowercase scheme/host)
  name          TEXT NOT NULL,              -- LLM-suggested display name
  description   TEXT,                       -- Brief description from discoverer agent
  discovered_at TEXT NOT NULL,              -- ISO 8601 datetime
  status        TEXT NOT NULL DEFAULT 'pending_review'
                CHECK (status IN ('pending_review', 'approved', 'dismissed'))
);

CREATE INDEX idx_candidates_status ON discovery_candidates(status);
