# Contract: Matcher Agent

**Feature**: 001-plane-listing-scanner
**Date**: 2026-03-30

---

## Agent Role

The **Matcher agent** receives all deduplicated listings for the current scan run and the active criteria ruleset from config. It scores each listing and returns a ranked list. It is a pure logic agent with no tools and no side effects.

**Note**: This is the feature 001 built-in Matcher. It is superseded by feature 002's Matcher agent when feature 002 is integrated. The output shape (`MatcherOutput`) is unchanged; only the scoring mechanism changes.

---

## Agent Configuration

| Parameter | Value |
|-----------|-------|
| Model | `claude-sonnet-4-6` |
| Max turns | 3 |
| Tools | None (pure scoring logic) |
| Parallelism | Single instance per scan run; runs after Historian deduplication |
| Failure handling | On exception, retain existing `match_score` values in DB; log error; do not abort scan |

---

## Input Schema

```typescript
interface MatcherInput {
  listings: ListingForScoring[];
  criteria: ScoringCriteria[];
}

interface ListingForScoring {
  id: string;
  registration: string | null;
  aircraftType: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  priceCurrency: string;
  location: string | null;
}

interface ScoringCriteria {
  type: 'type_match' | 'price_max' | 'price_range' | 'year_min' | 'year_range' | 'location_contains';
  weight: number;         // Positive number; relative weight in score calculation
  // type_match:
  pattern?: string;       // Case-insensitive substring to match against aircraftType/make/model
  // price_max:
  max?: number;
  // price_range:
  min?: number;
  // year_min / year_range:
  yearMin?: number;
  yearMax?: number;
  // location_contains:
  locationPattern?: string;
}
```

---

## Output Schema

```typescript
interface MatcherOutput {
  scores: ListingScore[];
}

interface ListingScore {
  listingId: string;
  score: number;   // 0.0–100.0, one decimal place
}
```

---

## Scoring Algorithm

```
score(listing, criteria[]) =
  (sum of weight for each criterion that listing satisfies)
  ────────────────────────────────────────────────────────  × 100
  (sum of all criterion weights)

Rounded to 1 decimal place.
If no criteria are configured: score = 0 for all listings.
If a required field (e.g. price) is null and the criterion needs it: criterion is treated as NOT satisfied.
```

### Criterion satisfaction rules

| Type | Satisfied when |
|------|---------------|
| `type_match` | `pattern` appears (case-insensitive) in `aircraftType`, `make`, or `model` |
| `price_max` | `price` is not null AND `price <= max` |
| `price_range` | `price` is not null AND `min <= price <= max` |
| `year_min` | `year` is not null AND `year >= yearMin` |
| `year_range` | `year` is not null AND `yearMin <= year <= yearMax` |
| `location_contains` | `locationPattern` appears (case-insensitive) in `location` |

---

## Invocation Sequence

```
Orchestrator
  └─► MatcherAgent({ listings: deduplicatedListings, criteria: configCriteria })
        └─► score each listing against all criteria
        └─► return MatcherOutput
  └─► validate MatcherOutput schema
  └─► UPDATE listings SET match_score = score WHERE id = listingId
        (for each ListingScore in output)
```
