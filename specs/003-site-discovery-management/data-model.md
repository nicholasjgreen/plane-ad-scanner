# Data Model: Site Discovery and Management

**Feature**: 003-site-discovery-management
**Date**: 2026-04-04

---

## Entity Overview

```
sites (1) ──────────── (N) verification_results
sites (1) ──────────── (N) listings        [read; managed by feature 001]
discovery_candidates   [standalone; linked to sites by url on approval]
```

- `sites` is extended by this feature with status, priority, and scan metadata.
- `verification_results` is owned by this feature.
- `discovery_candidates` is owned by this feature.
- `listings` is read-only from this feature's perspective.

---

## Migration 002: `src/db/migrations/002-site-management.sql`

### Changes to `sites` table

```sql
-- Extend the sites table for full lifecycle management.
ALTER TABLE sites ADD COLUMN status TEXT NOT NULL DEFAULT 'enabled'
  CHECK (status IN ('pending', 'enabled', 'disabled', 'verification_failed'));

ALTER TABLE sites ADD COLUMN last_scan_outcome TEXT;
-- JSON: { date: ISO8601, listingsFound: number, error?: string } | null

ALTER TABLE sites ADD COLUMN total_listings INTEGER NOT NULL DEFAULT 0;
-- Denormalised count updated after each scan for fast display; source of truth is COUNT on listings table.
```

### New table: `verification_results`

```sql
CREATE TABLE verification_results (
  id            TEXT PRIMARY KEY,          -- UUID v4
  site_id       TEXT NOT NULL REFERENCES sites(id),
  attempted_at  TEXT NOT NULL,             -- ISO 8601 datetime
  completed_at  TEXT,                      -- NULL while in progress
  listings_sample TEXT,                    -- JSON: RawListing[] (up to 5 items shown to admin)
  passed        INTEGER,                   -- 1 = passed, 0 = failed, NULL = in progress
  failure_reason TEXT                      -- Human-readable explanation on failure
);

CREATE INDEX idx_verification_site ON verification_results(site_id, attempted_at DESC);
```

### New table: `discovery_candidates`

```sql
CREATE TABLE discovery_candidates (
  id            TEXT PRIMARY KEY,          -- UUID v4
  url           TEXT NOT NULL UNIQUE,      -- Normalised (trailing slash stripped, lowercase scheme/host)
  name          TEXT NOT NULL,             -- LLM-suggested display name
  description   TEXT,                      -- Brief description from discoverer agent
  discovered_at TEXT NOT NULL,             -- ISO 8601 datetime
  status        TEXT NOT NULL DEFAULT 'pending_review'
                CHECK (status IN ('pending_review', 'approved', 'dismissed'))
);

CREATE INDEX idx_candidates_status ON discovery_candidates(status);
```

---

## Entity Schemas

### Site (extended)

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | TEXT | NO | UUID v4 |
| `name` | TEXT | NO | UNIQUE human-readable display name |
| `url` | TEXT | NO | Base listing page URL |
| `enabled` | INTEGER | NO | Legacy column — now always mirrors `status = 'enabled'`; kept for feature 001 backward compatibility until 003 is fully integrated |
| `status` | TEXT | NO | `pending` / `enabled` / `disabled` / `verification_failed` |
| `priority` | INTEGER | NO | Lower = scanned first; admin-editable |
| `created_at` | TEXT | NO | ISO 8601 datetime |
| `last_verified` | TEXT | YES | ISO 8601 datetime of last completed verification (any outcome) |
| `last_scan_outcome` | TEXT | YES | JSON `{ date, listingsFound, error? }` |
| `total_listings` | INTEGER | NO | Denormalised; updated after each scan |

**Note on `enabled` column**: Feature 001's Orchestrator reads `WHERE enabled = 1`. Until feature 001's scanner is updated to use `WHERE status = 'enabled'`, a trigger or update keeps `enabled` in sync with `status`. Migration 002 adds this trigger.

```sql
-- Keep legacy 'enabled' column in sync with new status column
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
```

### VerificationResult

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | TEXT | NO | UUID v4 |
| `site_id` | TEXT | NO | FK → sites.id |
| `attempted_at` | TEXT | NO | ISO 8601 |
| `completed_at` | TEXT | YES | NULL while running |
| `listings_sample` | TEXT | YES | JSON array, up to 5 `RawListing` items |
| `passed` | INTEGER | YES | 1 = passed, 0 = failed, NULL = in progress |
| `failure_reason` | TEXT | YES | Human-readable failure description |

### DiscoveryCandidate

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `id` | TEXT | NO | UUID v4 |
| `url` | TEXT | NO | UNIQUE — prevents re-proposal of same URL |
| `name` | TEXT | NO | LLM-suggested display name |
| `description` | TEXT | YES | Brief description of the site |
| `discovered_at` | TEXT | NO | ISO 8601 |
| `status` | TEXT | NO | `pending_review` / `approved` / `dismissed` |

---

## Site Status State Machine

```
                    [admin triggers re-verify]
                    ←────────────────────────
   [add site]    ┌──────────┐    [approve sample]    ┌─────────┐
   ──────────►   │ pending  │ ─────────────────────► │ enabled │
                 └──────────┘                         └─────────┘
                      │ [reject sample]                    │ [disable]
                      ▼                                    ▼
             ┌──────────────────┐              ┌──────────────────┐
             │ verification_    │              │    disabled      │
             │    failed        │              └──────────────────┘
             └──────────────────┘                    │ [enable]
                      │ [re-verify]                   │
                      └───────────► pending ◄─────────┘
                                  (loops back)
```

Any status → `disabled` is always permitted via the disable action.
`disabled` → `enabled` (re-enable without re-verify) is also permitted.

---

## Listing Count Maintenance

`sites.total_listings` is updated at the end of each successful scan by the Orchestrator:

```sql
UPDATE sites SET total_listings = (
  SELECT COUNT(*) FROM listings WHERE source_site = sites.name
)
WHERE name IN (/* sites scanned in this run */);
```

Alternatively, derived at query time with a subquery (`COUNT` on `listings` table). The denormalised column is preferred for the admin page display performance (one JOIN vs N subqueries).

---

## Integration Points

```
sites.status         ──→ Orchestrator reads WHERE status = 'enabled'  [replaces WHERE enabled = 1]
sites.enabled        ──→ kept in sync via trigger for 001 backward compat
verification_results ──→ admin page shows latest result per site
discovery_candidates ──→ admin page shows pending_review candidates
listings             ──→ feature 001 still owns; 003 reads count only
```
