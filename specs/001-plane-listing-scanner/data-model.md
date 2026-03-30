# Data Model: Plane Listing Scanner

**Feature**: 001-plane-listing-scanner
**Date**: 2026-03-30

---

## Entity Overview

```
sites (1) ──────────── (N) listings
listings (N) ──────────── (1) scan_runs  [via date_last_seen match]
scan_runs (1) ─────────── (0..N) scan_run_errors
```

- `sites` is owned by feature 003; this feature reads it (enabled sites only) and writes a placeholder schema for standalone operation before 003 is implemented.
- `listings` is owned by this feature.
- `scan_runs` is owned by this feature.

---

## Table: `listings`

The canonical record of every aircraft-for-sale listing ever discovered.

```sql
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
```

### Field notes

| Field | Nullable | Notes |
|-------|----------|-------|
| `registration` | YES | Dedup key when present; extracted by regex or structured field |
| `make` / `model` | YES | Parsed from `aircraft_type` when possible; may remain null |
| `year` | YES | Integer year (e.g. 1998); null if not stated |
| `price` | YES | Numeric value only; currency stored separately |
| `is_new` | NO | Reset to 0 for ALL rows at scan start; set to 1 for any listing seen in current run |
| `raw_attributes` | YES | Full JSON bag from scraper for future extraction; not displayed |

### Lifecycle

```
[Scraper finds listing]
  ├── registration present?
  │     YES → lookup existing row by registration
  │             ├── found: UPDATE date_last_seen, price, location, is_new=1
  │             └── not found: INSERT new row
  └── NO → INSERT new row (UUID as id)

[Scan run starts]
  └── UPDATE listings SET is_new = 0 (all rows)

[Scan run ends]
  └── is_new = 1 for any listing whose date_last_seen = current scan started_at
```

---

## Table: `scan_runs`

One row per scan execution.

```sql
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
```

### Field notes

| Field | Notes |
|-------|-------|
| `completed_at` | NULL during a run; set on normal or partial completion (even if some sites failed) |
| `error_summary` | Populated by Orchestrator from Scraper agent failures; rendered as page banner |

---

## Table: `sites`

Placeholder schema for standalone operation. Superseded by feature 003's full lifecycle management.

```sql
CREATE TABLE sites (
  id            TEXT PRIMARY KEY,        -- UUID v4
  name          TEXT NOT NULL UNIQUE,    -- Human-readable name (e.g. "Trade-A-Plane")
  url           TEXT NOT NULL,           -- Base URL for the listing page
  enabled       INTEGER NOT NULL DEFAULT 1,  -- 1 = active; 0 = disabled
  priority      INTEGER NOT NULL DEFAULT 0,  -- Lower = higher priority (scan order); not used in 001
  created_at    TEXT NOT NULL,
  last_verified TEXT                     -- NULL until feature 003 runs verification
);

CREATE INDEX idx_sites_enabled ON sites(enabled);
```

**Note**: In v1 (feature 001 standalone), sites are seeded from `config.yml` at startup if the `sites` table is empty. Feature 003 takes over ownership of this table when integrated.

---

## SQLite Migration Strategy

Migrations are plain `.sql` files applied sequentially by filename. Applied at startup by `src/db/index.ts`.

```
src/db/migrations/
  001-initial.sql     -- Creates listings, scan_runs, sites tables and all indexes
```

Future features add their own numbered migration files (e.g. `002-...sql`, `003-...sql`).

---

## Entity Relationships (feature integration points)

```
listings.source_site ──→ sites.name         [this feature; site management owned by 003]
listings.match_score ──→ written by Matcher  [built-in in 001; superseded by 002]
listings ──────────────→ listing_ai          [added by feature 004; read-only here]
listings ──────────────→ listing_scores      [added by feature 002; read-only here]
```
