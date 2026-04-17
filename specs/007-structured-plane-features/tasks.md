# Tasks: Structured Plane Features

**Input**: Design documents from `specs/007-structured-plane-features/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**TDD Note**: The spec (Principle V) requires that tests for criterion matching, DB module functions, and output schema validation are written as **failing tests BEFORE** their implementation tasks begin.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Create the database migration that all subsequent work depends on.

- [X] T001 Create migration `src/db/migrations/005-structured-indicators.sql` — `listing_indicators` table with `listing_id` (PK, FK→listings), `indicators` (TEXT JSON), `status` (pending/ready/failed/stale CHECK constraint), `derived_at` (TEXT ISO 8601); plus `CREATE INDEX idx_listing_indicators_status ON listing_indicators(status)`. Match the exact SQL from data-model.md.

**Checkpoint**: Migration file exists and is syntactically valid.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core types and DB module that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Extend `src/types.ts` — add `type Confidence = 'High' | 'Medium' | 'Low'`; add `StructuredIndicators` interface (all 20 fields: categorical `{value:string|null, confidence:Confidence}`, display-only numeric `{value:number|null, confidence:Confidence}`, banded numeric `{value:number|null, band:string|null, confidence:Confidence}`); add `indicatorField?: string` and `indicatorValue?: string` to `ProfileCriterion`; add `'indicator'` to the `type` union. Follow the exact interface from data-model.md.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Score Listings Against Mission Profile Using Indicators (Priority: P1) 🎯 MVP

**Goal**: Structured indicators can be stored, retrieved, and evaluated as `indicator` criteria in interest profiles — producing weighted match scores with confidence-adjusted contributions.

**Independent Test**: Configure an interest profile with `engine_state = Green`, `ifr_approval = IFR Approved`, `typical_fuel_burn = Green` criteria. Seed two listings in `listing_indicators` — one with all three as `ready` with matching values, one with none matching. Run `scoreListingAgainstProfiles`. Verify the matching listing scores substantially higher.

### TDD — Write Failing Tests First ⚠️

> **Write these tests BEFORE T006 and T008. Confirm they FAIL before proceeding.**

- [X] T003 [P] [US1] Write failing tests in `tests/unit/listing-indicators.test.ts` covering: (1) `upsertListingIndicators` inserts a `pending` row; second call is a no-op; (2) `setIndicatorsReady` stores JSON blob and sets `derived_at`; (3) `setIndicatorsFailed` preserves existing indicators blob; (4) `markIndicatorsStale` sets `status = 'stale'`; (5) `getPendingOrStaleListingIds` returns ids with `status IN ('pending','stale')` and excludes `ready`/`failed`. Use an in-memory SQLite DB (`:memory:`) with migration 005 applied.

- [X] T004 [P] [US1] Write failing tests in `tests/unit/indicator-criterion.test.ts` covering: (1) `indicator` criterion matched when `engine_state.value === 'Green'`; (2) not matched when value differs; (3) not matched when indicator value is `null` (Unknown); (4) not matched when `indicatorField` absent from indicators; (5) `High` confidence → `partialScore = weight × 1.0`; (6) `Medium` → `weight × 0.75`; (7) `Low` → `weight × 0.5`; (8) banded field `typical_range` matched against `band`, not raw `value`; (9) `smoh_hours` as `indicatorField` returns `matched: false, note: 'Indicator criterion misconfigured'`. These test the `evalCriterion` function in `src/services/profile-scorer.ts`.

### Implementation for User Story 1

- [X] T005 [US1] Implement `src/db/listing-indicators.ts` exporting all 6 DB functions: `upsertListingIndicators`, `setIndicatorsReady`, `setIndicatorsFailed`, `markIndicatorsStale`, `getPendingOrStaleListingIds`, `getListingIndicators`. Mirror the pattern from `src/db/listing-ai.ts`. Use `INSERT OR IGNORE` for upsert. `getListingIndicators` returns parsed `StructuredIndicators | null`. **Confirm T003 tests now pass.**

- [X] T006 [US1] Extend `src/config.ts` Zod schema — add `indicatorField: z.string().optional()` and `indicatorValue: z.string().optional()` to `ProfileCriterionSchema`; add `'indicator'` to the `type` discriminated union (or the existing union, following the existing pattern for the other criterion types).

- [X] T007 [US1] Add `'indicator'` case to `evalCriterion` in `src/services/profile-scorer.ts` — implement the confidence-multiplier logic (High=1.0, Medium=0.75, Low=0.5); banded fields (`typical_range`, `typical_cruise_speed`, `typical_fuel_burn`, `passenger_capacity`) match against `band`; all others match against `value`; `smoh_hours` returns misconfigured note; missing/null returns `matched: false` with conservative note. Extend `EvalContext` to include `indicators?: StructuredIndicators | null`. **Confirm T004 tests now pass.**

- [X] T008 [US1] Update `src/agents/matcher.ts` — import `getListingIndicators` from `db/listing-indicators.js`; when `db` is available, fetch indicators for each listing before calling `scoreListingAgainstProfiles`; pass `indicators` in the `EvalContext` object passed to the scorer.

**Checkpoint**: User Story 1 independently functional — indicator criteria affect scores and T003/T004 tests pass.

---

## Phase 4: User Story 2 — See Structured Indicators on the Listings Page (Priority: P2)

**Goal**: Each listing card shows five collapsible indicator groups; values and confidence badges visible on expansion; page load time unchanged (indicators are pre-stored).

**Independent Test**: Seed the DB with a listing that has a `ready` row in `listing_indicators` (engine state Green/High, avionics Glass Cockpit/High, etc.). Open the listings web page. Verify five collapsible `<details>` elements appear on the listing card; expanding "Engine & Airworthiness" shows engine_state = "Green" with a green confidence badge.

- [X] T009 [US2] Extend `ListingRow` interface in `src/web/render.ts` — add `indicators: StructuredIndicators | null`; add `renderIndicatorGroups(indicators: StructuredIndicators | null): string` function that renders five `<details>` elements (groups: Avionics & IFR, Engine & Airworthiness, Aircraft Profile, Costs, Provenance) per the field groupings in data-model.md. Each indicator row shows: label, value (or "Unknown"), confidence badge (green/amber/red CSS class matching the RAG scheme). Banded numeric fields show raw value in parentheses alongside band. Null indicators render "Unknown" with no badge.

- [X] T010 [US2] Update `src/web/server.ts` — add a LEFT JOIN on `listing_indicators` (or batch-query after the listings fetch); parse the `indicators` JSON column for each listing; pass the parsed `StructuredIndicators | null` to the `ListingRow` renderer. Handle parse errors gracefully (null on failure).

**Checkpoint**: User Stories 1 and 2 both independently functional; indicators visible on page.

---

## Phase 5: User Story 3 — Indicators Refresh When Listing Data Changes (Priority: P3)

**Goal**: New listings get `pending` indicator rows; changed listings are marked `stale`; the orchestrator derives indicators in Phase 6 after each scan; failures preserve existing values.

**Independent Test**: Seed a listing with `status = 'stale'` in `listing_indicators`. Stub `runIndicatorDeriver` to return a fully-populated `StructuredIndicators`. Run the orchestrator. Verify `listing_indicators.status` is `ready` and `derived_at` is set. Seed a listing whose `runIndicatorDeriver` returns `{ error }`. Verify existing indicators are preserved and `status = 'failed'`.

### TDD — Write Failing Tests First ⚠️

> **Write these tests BEFORE T013 and T015. Confirm they FAIL before proceeding.**

- [X] T011 [P] [US3] Write failing tests in `tests/unit/indicator-deriver.test.ts` covering: (1) returns `{ listingId, error }` (not throw) when LLM returns invalid JSON; (2) returns error when LLM returns JSON missing required fields; (3) returns all-null indicators (not error) for empty `rawAttributes`; (4) registration prefix `G-` maps `registration_country.value = 'United Kingdom'`; (5) output `listingId` matches input `listingId`. Stub the Anthropic client to return controlled responses.

- [X] T012 [US3] Extend `tests/integration/orchestrator.test.ts` — add assertion that when `listing_indicators` has a `pending` row, running the orchestrator triggers the indicator deriver phase and the row is updated to `ready` or `failed`. Inject a stub `indicatorDeriver` via `OrchestratorDeps`. Confirm the test fails before T015 is implemented.

### Implementation for User Story 3

- [X] T013 [US3] Implement `src/agents/indicator-deriver.ts` — export `runIndicatorDeriver(input: IndicatorDeriverInput, anthropic: Anthropic, model: string): Promise<IndicatorDeriverOutput>` matching the contract in `contracts/indicator-deriver-agent.md`. System prompt embeds full indicator definitions (FR-002–FR-024), IFR inference rules (FR-004), IFR capability level equipment markers (FR-004a), and banding thresholds from the contract. User message contains make/model/type/registration + `raw_attributes` JSON. Parse and validate output (all 20 fields present, correct shapes, `null` for Unknown not string "Unknown"); return `{ listingId, error }` on any failure. Log `{ listingId, populated }` at debug. **Confirm T011 tests now pass.**

- [X] T014 [US3] Update `src/services/dedup.ts` — import `markIndicatorsStale` from `db/listing-indicators.js`; call `markIndicatorsStale(db, listingId)` alongside every existing call to `markListingAiStale(db, listingId)` — this covers both new listing inserts (where `upsertListingIndicators` creates the `pending` row) and updates to existing listings. Also call `upsertListingIndicators(db, listingId)` for newly inserted listings so the `pending` row is created immediately.

- [X] T015 [US3] Add Phase 6 to `src/agents/orchestrator.ts` — import `runIndicatorDeriver`, `getPendingOrStaleListingIds`, `setIndicatorsReady`, `setIndicatorsFailed` from their modules; add `indicatorDeriver?` to `OrchestratorDeps` for test injection; after the Presenter phase: fetch pending/stale ids, run concurrently using the same `DETAIL_CONCURRENCY = 5` batch pattern as the detail fetcher, call `setIndicatorsReady` on success or `setIndicatorsFailed` on error; log `{ total, succeeded, failed }` at info level with message `'Indicator deriver phase complete'`. **Confirm T012 integration test now passes.**

**Checkpoint**: All three user stories functional. Indicators are derived automatically at end of scan, stale when raw attributes change, and failures are handled gracefully.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Validate against quickstart.md scenarios: SC-001 (indicators derived within one cycle), SC-002 (≥12/20 indicators for detailed listing), SC-003 (indicator criteria produce score separation), SC-004 (page load time unchanged), SC-005 (20 listings derive in ≤60s), SC-006 (indicators refresh after re-scrape).

- [X] T017 Run `npm test && npm run lint` — confirm all existing tests still pass alongside the new unit and integration tests; confirm lint clean.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1 — T001)**: No dependencies — start immediately
- **Foundational (Phase 2 — T002)**: Depends on T001 — BLOCKS all user stories
- **US1 (Phase 3 — T003–T008)**: Depends on T002; TDD tests T003/T004 can be written first, implementation T005–T008 follows
- **US2 (Phase 4 — T009–T010)**: Depends on T005 (needs `getListingIndicators` and `StructuredIndicators` type) — can be worked independently of US1 scorer changes
- **US3 (Phase 5 — T011–T015)**: Depends on T005 (DB functions used by dedup and orchestrator) — TDD tests T011/T012 can be written first
- **Polish (Phase 6)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: Depends only on Foundational (T002) — no dependency on US2 or US3
- **US2 (P2)**: Depends on T005 (`listing-indicators.ts`) — display reads the DB module; independent of scoring changes
- **US3 (P3)**: Depends on T005 (`listing-indicators.ts`) — dedup and orchestrator call DB functions; independent of scorer/matcher changes

### Within Each Phase

- TDD tests MUST be written and confirmed **failing** before their implementation tasks
- T003 and T004 can be written in parallel (different test files)
- T005 (DB module) must pass T003 before proceeding to T007/T008
- T008 (matcher) depends on T005 (DB) and T007 (scorer)
- T009 (render) and T010 (server) can run in parallel

---

## Parallel Example: User Story 1

```
# After T002 (types.ts) is complete:

# Write both TDD test files simultaneously:
T003: tests/unit/listing-indicators.test.ts   (T004 can start at same time)
T004: tests/unit/indicator-criterion.test.ts

# After tests are failing, implement simultaneously:
T005: src/db/listing-indicators.ts            (unblocks T006, T007, T008)
T006: src/config.ts (indicator Zod schema)    (can start parallel to T005)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only — Scoring)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002)
3. Write failing tests T003, T004
4. Implement T005, T006, T007, T008
5. **STOP and VALIDATE**: Run `npm test` — US1 unit tests pass; verify score separation manually
6. Indicators are now usable as profile criteria — core feature delivered

### Incremental Delivery

1. Foundation (T001–T002) → types and migration ready
2. US1 (T003–T008) → indicators affect scores → **MVP**
3. US2 (T009–T010) → indicators visible on page
4. US3 (T011–T015) → indicators auto-derive and refresh
5. Polish (T016–T017) → validation and lint clean

---

## Notes

- [P] tasks operate on different files with no shared dependencies — safe to parallelise
- TDD tasks (T003, T004, T011, T012) MUST produce failing tests before their corresponding implementation
- Each phase checkpoint is independently verifiable without completing subsequent phases
- The `indicatorDeriver?` injection point in `OrchestratorDeps` is specifically to enable T012 integration test without live API calls
- `smoh_hours` is intentionally excluded from scoring (`indicatorField` misconfigured note) — `engine_state` is the scoring proxy
- Warm-up behaviour: new listings score without indicators on first cycle; ready from second cycle onward — this is expected and acceptable
