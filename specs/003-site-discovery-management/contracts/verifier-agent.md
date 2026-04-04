# Contract: Verifier Agent

**Feature**: 003-site-discovery-management
**Date**: 2026-04-04

---

## Agent Role

The **Verifier agent** checks whether a given site URL can yield structured aircraft listing data. It attempts to extract a small representative sample of listings (up to 5), following pagination or click-through links as needed. The sample is returned to the admin for review. The Verifier does NOT write to the database — its output is handled by the calling service.

---

## Agent Configuration

| Parameter | Value |
|-----------|-------|
| Model | `claude-haiku-4-5-20251001` |
| Max turns | 15 (higher than Scraper to allow pagination following) |
| Tools | HTTP GET only (same fetch tool as Scraper) |
| Invocation | One-shot per site; called from admin route handler asynchronously |

---

## Input Schema

```typescript
interface VerifierInput {
  site: {
    name: string;   // Display name for logging
    url: string;    // Base listing page URL to verify
  };
  maxSamples?: number;  // Max listings to return (default: 5)
}
```

---

## Output Schema

```typescript
interface VerifierOutput {
  siteName: string;
  sampleListings: RawListing[];  // Up to 5 items; empty on failure
  canFetchListings: boolean;     // true if at least 1 listing extracted
  failureReason?: string;        // Human-readable reason if canFetchListings = false
  turnsUsed: number;             // For cost visibility logging
}
```

**`RawListing`**: Same type as defined in `src/types.ts` (shared with Scraper agent).

---

## Behaviour

1. The agent is given the site URL as a starting point.
2. It fetches the page and assesses whether listing data is visible.
3. If listings are not directly visible (e.g., behind pagination or a "search results" page), the agent follows up to 2 additional links before giving up.
4. It extracts up to `maxSamples` listings in `RawListing` format.
5. Returns `canFetchListings = true` if `sampleListings.length >= 1`.
6. On network error, LLM error, or zero listings after max turns: returns `canFetchListings = false` with a `failureReason`.

---

## Validation Rules (applied by caller before storing)

- `sampleListings[*].listingUrl` MUST match `^https?://` (same as Scraper)
- `sampleListings[*].price` MUST be positive if present
- `sampleListings[*].year` MUST be 1900–(current year + 1) if present

---

## Invocation Sequence

```
AdminRoute (POST /admin/sites/:id/verify)
  └─► VerifierAgent({ site })
        ├─► fetch site URL (HTTP GET)
        ├─► assess listing availability
        ├─► [if needed] follow pagination link (HTTP GET, up to 2 hops)
        ├─► extract RawListing[] (up to 5)
        └─► return VerifierOutput

AdminService
  └─► UPDATE verification_results SET listings_sample, passed, completed_at
  └─► if passed = NULL (agent threw): UPDATE site.status = 'verification_failed'
  └─► else: site.status remains 'pending' until admin approves/rejects
```

---

## Relationship to Scraper Agent

The Verifier shares the same HTTP GET tool implementation and `RawListing` output type as the Scraper agent (`src/agents/scraper.ts`). The differences are:

| | Scraper | Verifier |
|-|---------|----------|
| Purpose | Full scan (all listings) | Sample extraction (≤5) |
| Max turns | 10 | 15 |
| Called by | Orchestrator (per scan run) | Admin route (one-off) |
| Output | `ScraperOutput` (full listing set) | `VerifierOutput` (sample + pass/fail) |
| DB write | Via Historian | None (caller writes `verification_results`) |
