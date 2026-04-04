# Contract: Discoverer Agent

**Feature**: 003-site-discovery-management
**Date**: 2026-04-04

---

## Agent Role

The **Discoverer agent** searches the web for aircraft-for-sale websites not already known to the system and returns a list of candidate sites. It uses the Anthropic-native `web_search_20250305` first-party tool — no external search API key required.

---

## Agent Configuration

| Parameter | Value |
|-----------|-------|
| Model | `claude-sonnet-4-6` (judgment quality — evaluates whether a result is a genuine marketplace) |
| Max turns | 10 |
| Tools | `web_search_20250305` only (Anthropic first-party tool) |
| Invocation | One-shot; triggered manually by admin from `/admin` page |

---

## Input Schema

```typescript
interface DiscovererInput {
  existingUrls: string[];     // URLs already in sites table (any status) + discovery_candidates (any status)
                              // Used in the system prompt to avoid re-proposing known URLs
  maxCandidates?: number;     // Max proposals to return (default: 10)
}
```

---

## Output Schema

```typescript
interface DiscovererOutput {
  candidates: DiscoveryCandidate[];
}

interface DiscoveryCandidate {
  url: string;         // Normalised: lowercase scheme+host, no trailing slash
  name: string;        // Suggested display name (e.g. "Controller.com")
  description: string; // 1–2 sentence description of the site and its typical listings
}
```

---

## Behaviour

1. The agent generates 2–3 web search queries targeting aircraft-for-sale marketplaces (e.g., "aircraft for sale UK marketplace", "buy used airplane listings site").
2. It evaluates each search result and filters to genuine aircraft-for-sale listing sites (not news articles, blogs, or broker landing pages without searchable inventory).
3. It normalises each URL (strip path and query string, keep `scheme://host`).
4. It excludes any normalised URL already in `existingUrls`.
5. It deduplicates candidates (same host under different paths).
6. Returns up to `maxCandidates` candidates.

---

## URL Normalisation (applied by caller before DB insert)

```typescript
function normaliseUrl(raw: string): string {
  const u = new URL(raw);
  return `${u.protocol}//${u.hostname}`;
}
```

The normalised URL is stored in `discovery_candidates.url`. The UNIQUE constraint prevents exact duplicates.

---

## Validation Rules (applied by caller)

- `url` MUST match `^https?://`
- `url` (after normalisation) MUST NOT already exist in `sites.url` or `discovery_candidates.url`
- `name` MUST be non-empty (1–100 chars)
- `description` truncated to 500 chars if longer

---

## Invocation Sequence

```
AdminRoute (POST /admin/discovery/run)
  └─► [async] DiscovererAgent({ existingUrls })
        ├─► web_search("aircraft for sale marketplace")
        ├─► web_search("buy used aircraft listings")
        ├─► evaluate results, filter non-marketplaces
        ├─► normalise + deduplicate URLs
        └─► return DiscovererOutput

AdminService
  └─► for each candidate:
        ├─► normalise URL
        ├─► skip if URL in existingUrls (safety net — already filtered by agent)
        └─► INSERT INTO discovery_candidates ... ON CONFLICT (url) DO NOTHING
```

---

## Suppression of Previously Dismissed URLs

Before invoking the agent, the caller queries:

```sql
SELECT url FROM sites
UNION
SELECT url FROM discovery_candidates
```

This combined list is passed as `existingUrls`. The agent is instructed to exclude these. The `ON CONFLICT DO NOTHING` insert clause is the DB-level safety net for any URL the agent misses.
