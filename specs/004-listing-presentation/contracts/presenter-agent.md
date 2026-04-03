# Contract: Presenter Agent

**Feature**: 004-listing-presentation
**Date**: 2026-03-30

---

## Agent Role

The **Presenter agent** takes a single listing and the user's active interest profiles and returns an AI-generated headline and plain-English explanation. It is invoked by the Orchestrator once per listing during a scan run, in parallel with other per-listing Presenter invocations.

---

## Input Schema

```typescript
interface PresenterInput {
  listing: {
    id: string;
    make: string | null;
    model: string | null;
    year: number | null;
    price: number | null;
    priceCurrency: string;
    location: string | null;
    sourceSite: string;
    ownershipType: string | null;    // e.g. "share", "full", "group"
    attributes: Record<string, string>; // all other scraped key/value pairs
  };
  profiles: ActiveProfile[];          // empty array if no profiles defined
}

interface ActiveProfile {
  name: string;
  criteria: Criterion[];
}

interface Criterion {
  name: string;         // e.g. "IFR capability", "autopilot"
  weight: number;       // 0.0–1.0
  description: string;  // plain-English description of what the user wants
}
```

---

## Output Schema

```typescript
interface PresenterOutput {
  listingId: string;
  headline: string;          // max 60 characters; never null — fallback to site+price if needed
  explanation: string;       // 2–4 sentences; never null — fallback to general summary if no profiles
  status: 'ok' | 'partial'; // 'partial' = generated but with incomplete data (e.g. no profiles)
}
```

**Validation rules applied before insert**:
- `headline.length` MUST be ≤ 60 characters; truncate with "…" if the model exceeds this
- `headline` MUST NOT be empty; if blank, replace with site + price fallback
- `explanation` MUST NOT be empty; if blank, use "No summary available."
- `status` MUST be `'ok'` or `'partial'`

---

## Agent Configuration

| Parameter | Value |
|-----------|-------|
| Model | `claude-sonnet-4-6` |
| Max turns | 3 |
| Tools | None |
| Token budget | Drawn from the per-run configurable budget (shared with Matcher agent) |
| Parallelism | One agent instance per listing; all instances run concurrently |
| Failure handling | On exception or schema validation failure, set `listing_ai.status = 'failed'`; do not abort the scan run |

---

## Invocation Sequence

```
Orchestrator
  └─► for each listing (parallel):
        └─► PresenterAgent(listing, activeProfiles)
              └─► returns PresenterOutput
        └─► validate PresenterOutput schema
        └─► upsert into listing_ai table
              ├─► on success: status = 'ready'
              └─► on failure: status = 'failed', retain previous headline/explanation
```
