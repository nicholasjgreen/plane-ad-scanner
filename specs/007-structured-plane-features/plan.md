# Implementation Plan: Structured Plane Features

**Branch**: `007-structured-plane-features` | **Date**: 2026-04-16 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/007-structured-plane-features/spec.md`

## Summary

Derives 20 structured indicators (avionics type, IFR approval/capability, engine state, etc.) from each listing's `raw_attributes` using a single Anthropic API call per listing. Indicators are stored in a new `listing_indicators` table (JSON blob + status). They feed the scoring engine via a new `indicator` criterion type on `ProfileCriterion`, and are displayed in five collapsible groups on the listings page. A new `IndicatorDeriver` agent runs as the final phase of each scan run, after the Presenter. Stale marking is triggered by `dedup.ts` whenever raw_attributes change.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js LTS v20+  
**Primary Dependencies**: `@anthropic-ai/sdk` (existing) — no new production dependencies  
**Storage**: SQLite — migration 005 adds `listing_indicators` table  
**Testing**: Vitest (existing)  
**Target Platform**: Linux server (Docker) / WSL2 local  
**Project Type**: Background service / web server  
**Performance Goals**: Derive indicators for 20 listings in ≤ 60 seconds (concurrent API calls, same pattern as Presenter)  
**Constraints**: `claude-sonnet-4-6` for indicator derivation (judgment task); single LLM call per listing; indicators stored as JSON blob  
**Scale/Scope**: 20–200 listings; single user

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✓ PASS | One new agent file, one new DB module, one new migration, one new criterion type — all follow established patterns; no speculative abstractions |
| II. Resilience | ✓ PASS | `runIndicatorDeriver` never throws; on failure existing indicators are preserved and listing re-queued; orchestrator uses `Promise.allSettled` |
| III. Observability | ✓ PASS | Phase logs count, per-listing success/failure; token usage logged per call |
| IV. Config-Driven | ✓ PASS | `indicator` criterion type is YAML-configurable; no hardcoded criteria |
| V. Test-First | ✓ PASS | Criterion matching logic (deterministic), DB module functions, and output schema validation MUST be TDD |
| VI. Agent Architecture | ✓ PASS | New `IndicatorDeriver` agent: single responsibility, no tool calls, stateless, restricted to pure generation |
| VII. Agent Controls | ✓ PASS | `claude-sonnet-4-6`; single call (max_turns=1); no tool loop; no persistent state in agent |
| VIII. Living Documentation | ✓ PASS | `quickstart.md` produced in this plan; README update task included in tasks |

## Project Structure

### Documentation (this feature)

```text
specs/007-structured-plane-features/
├── plan.md                               # This file
├── research.md                           # Phase 0 output ✓
├── data-model.md                         # Phase 1 output ✓
├── quickstart.md                         # Phase 1 output ✓
├── contracts/
│   └── indicator-deriver-agent.md       # Phase 1 output ✓
└── tasks.md                              # Phase 2 output (speckit.tasks)
```

### Source Code

```text
src/
├── db/
│   ├── migrations/
│   │   └── 005-structured-indicators.sql   # NEW — listing_indicators table
│   └── listing-indicators.ts               # NEW — DB access module (TDD)
├── agents/
│   ├── indicator-deriver.ts                # NEW — Anthropic API call, returns StructuredIndicators
│   └── orchestrator.ts                     # MODIFIED — add indicator deriver phase (Phase 6)
├── services/
│   └── profile-scorer.ts                   # MODIFIED — add 'indicator' case to evalCriterion (TDD)
│   └── dedup.ts                            # MODIFIED — call markIndicatorsStale alongside markListingAiStale
├── web/
│   ├── render.ts                           # MODIFIED — add IndicatorGroup, extend ListingRow
│   └── server.ts                           # MODIFIED — query indicators, pass to renderer
└── types.ts                                # MODIFIED — StructuredIndicators type, extend ProfileCriterion
src/config.ts                               # MODIFIED — extend Zod schema for 'indicator' criterion

tests/
├── unit/
│   ├── indicator-deriver.test.ts           # NEW — schema validation, Unknown defaults (TDD)
│   ├── indicator-criterion.test.ts         # NEW — evalCriterion 'indicator' + confidence weighting (TDD)
│   └── listing-indicators.test.ts          # NEW — DB module functions (TDD)
└── integration/
    └── orchestrator.test.ts                # MODIFIED — assert indicator deriver phase runs
```

## Agent Role: Indicator Deriver

| Property | Value |
|----------|-------|
| Responsibility | Classify raw listing attributes into 20 structured indicators |
| Permitted tools | None (pure generation — single `messages.create` call) |
| Model | `claude-sonnet-4-6` |
| Max turns | 1 |
| State | Stateless — receives raw_attributes, returns StructuredIndicators JSON |
| Error handling | Never throws; returns `{ error }` result; caller preserves existing indicators |

## Orchestrator Phase Order (updated)

```
1. Scraper agents (parallel, all sites)
2. Historian/dedup — stores listings, populates allListingIds
                    → also calls markIndicatorsStale for updated listings
3. Detail fetcher  — fetches detail pages; updates raw_attributes + images
                    → also calls markIndicatorsStale on success
4. Matcher         — scores all listings (uses stored indicators from prior cycles)
5. Presenter       — generates headlines/explanations for pending listing_ai rows
6. [NEW] Indicator Deriver — derives indicators for all pending/stale listing_indicators rows
                             (derived indicators available for scoring in next cycle)
```

**Warm-up note**: New listings score without indicators on their first cycle; indicators are derived and ready from the second cycle onward. This is acceptable — listings persist across scans and scores update on the next run.

## New Criterion Type: `indicator`

### Config schema extension (`src/config.ts`)

The existing Zod `ProfileCriterionSchema` gains a new branch in the discriminated union (or a new optional fields approach matching the existing pattern):

```typescript
// Added to ProfileCriterion interface in types.ts:
indicatorField?: string;   // key from StructuredIndicators (e.g. 'engine_state')
indicatorValue?: string;   // expected value or band (e.g. 'Green', '3–4 seats')
```

### Evaluation logic (`src/services/profile-scorer.ts`)

```typescript
case 'indicator': {
  if (!ctx.indicators || !crit.indicatorField || !crit.indicatorValue) {
    return { matched: false, note: 'Indicator criterion misconfigured', confidence: null };
  }
  const ind = ctx.indicators[crit.indicatorField];
  if (!ind) {
    return { matched: false, note: `Indicator '${crit.indicatorField}' not derived`, confidence: 'low' };
  }
  // For banded numerics, match against band; for all others, match against value
  const BANDED = ['typical_range', 'typical_cruise_speed', 'typical_fuel_burn', 'passenger_capacity'];
  const actual = BANDED.includes(crit.indicatorField) ? ind.band : ind.value;
  if (actual === null) {
    return { matched: false, note: `${crit.indicatorField} is Unknown`, confidence: 'low' };
  }
  const matched = String(actual) === crit.indicatorValue;
  // Confidence multiplier: High=1.0, Medium=0.75, Low=0.5
  const confidenceMultiplier = ind.confidence === 'High' ? 1.0 : ind.confidence === 'Medium' ? 0.75 : 0.5;
  return {
    matched,
    note: matched
      ? `${crit.indicatorField} is ${actual} (confidence: ${ind.confidence})`
      : `${crit.indicatorField} is ${actual}, expected ${crit.indicatorValue}`,
    confidence: ind.confidence.toLowerCase() as 'high' | 'medium' | 'low',
    partialScore: matched ? confidenceMultiplier * 100 : 0,
  };
}
```

### Passing indicators to scorer (`src/agents/matcher.ts`)

The matcher fetches `StructuredIndicators` from DB for each listing (when DB is available) and passes them to `scoreListingAgainstProfiles` via `EvalContext`. The `EvalContext` interface gains:

```typescript
indicators?: StructuredIndicators | null;
```

## Web Display

### `ListingRow` extension (`src/web/render.ts`)

```typescript
indicators: StructuredIndicators | null;   // null until indicators derived
```

### Indicator group rendering

Five collapsible `<details>` elements per listing card:

| Group | Fields |
|-------|--------|
| Avionics & IFR | avionics_type, autopilot_capability, ifr_approval, ifr_capability_level |
| Engine & Airworthiness | engine_state, smoh_hours, condition_band, airworthiness_basis |
| Aircraft Profile | aircraft_type_category, passenger_capacity, typical_range, typical_cruise_speed, typical_fuel_burn |
| Costs | maintenance_cost_band, fuel_cost_band, maintenance_program |
| Provenance | registration_country, ownership_structure, hangar_situation, redundancy_level |

Each indicator row shows: field label, value (or "Unknown"), confidence badge (colour-coded: green/amber/red), and for banded numerics the raw value in parentheses.

Green/Amber/Red values use the existing RAG colour scheme from the listing card CSS.

## Migration 005

```sql
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
```

## TDD Requirements (Principle V)

The following MUST be written as failing tests BEFORE implementation:

**`tests/unit/indicator-criterion.test.ts`** (most critical):
- `indicator` criterion matched when `engine_state` value equals expected
- `indicator` criterion not matched when value differs
- `indicator` criterion not matched when indicator is Unknown (null value)
- `indicator` criterion not matched when indicatorField is missing from indicators
- Confidence `High` → contribution = weight × 1.0
- Confidence `Medium` → contribution = weight × 0.75
- Confidence `Low` → contribution = weight × 0.5
- Banded field (`typical_range`) matched against `band`, not raw `value`
- `smoh_hours` field excluded / returns misconfigured note (no band field)

**`tests/unit/listing-indicators.test.ts`**:
- `upsertListingIndicators` inserts pending row; second call is no-op
- `setIndicatorsReady` stores JSON blob and sets derived_at
- `setIndicatorsFailed` preserves existing indicators blob
- `markIndicatorsStale` sets status to 'stale'
- `getPendingOrStaleListingIds` returns ids with status pending or stale, not ready/failed

**`tests/unit/indicator-deriver.test.ts`**:
- Returns error result (not throw) when LLM returns invalid JSON
- Returns error result when LLM returns JSON missing required fields
- All-null indicators returned for empty raw_attributes (not error)
- Registration prefix G- maps to registration_country = "United Kingdom"
- Returns `listingId` in output matching input `listingId`

## Implementation Notes

### `src/agents/indicator-deriver.ts`

- Export `runIndicatorDeriver(input, anthropic, model)` matching contract
- System prompt embeds full indicator definitions from spec (FR-002–FR-024)
- System prompt includes IFR inference rules verbatim from FR-004
- System prompt includes IFR capability level equipment markers from FR-004a
- System prompt includes banding thresholds from `contracts/indicator-deriver-agent.md`
- Unknown → null in JSON (not the string "Unknown")
- Parse and validate output; on any parse/validation failure return `{ listingId, error }`
- Log: `logger.debug({ listingId, populated }, 'Indicator deriver: done')` where `populated` = count of non-null values

### `src/agents/orchestrator.ts`

- Import `runIndicatorDeriver`, `getPendingOrStaleListingIds`, `setIndicatorsReady`, `setIndicatorsFailed`
- Add `indicatorDeriver?` to `OrchestratorDeps` for test injection
- New phase 6 after Presenter: fetch pending/stale ids, run concurrently (same `DETAIL_CONCURRENCY = 5` constant), store results
- Log summary: `logger.info({ total, succeeded, failed }, 'Indicator deriver phase complete')`

### `src/services/dedup.ts`

- Import `markIndicatorsStale` from `db/listing-indicators.js`
- Call `markIndicatorsStale(db, listingId)` alongside every `markListingAiStale(db, listingId)` call (both on insert of new listing and on update of existing)

### `src/agents/matcher.ts`

- Import `getListingIndicators` from `db/listing-indicators.js`
- When `db` is available: fetch indicators for each listing before calling `scoreListingAgainstProfiles`
- Pass `indicators` in `EvalContext`

### `src/web/server.ts`

- Query `listing_indicators` for each listing in the listings fetch (LEFT JOIN or batch query)
- Pass `indicators` (parsed JSON or null) to `ListingRow`

## Complexity Tracking

No violations. This feature adds one agent, one DB module, one criterion type, and one migration — all following the established pattern in this codebase.
