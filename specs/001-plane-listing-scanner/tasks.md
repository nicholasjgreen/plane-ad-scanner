# Tasks: Plane Listing Scanner

**Input**: Design documents from `/specs/001-plane-listing-scanner/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: TDD is **mandatory** per constitution Principle V for `scoring.ts`, `dedup.ts`, and Orchestrator flow (mocked agents). Integration tests for scraper and web page. Test tasks for these appear *before* their implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete sibling tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)
- TDD tasks: marked `[TDD]` — write the test first, confirm it **fails**, then implement

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and toolchain — required before any code is written.

- [ ] T001 Initialise Node.js project: create `package.json` with all dependencies (`@anthropic-ai/sdk`, `express`, `cheerio`, `better-sqlite3`, `node-cron`, `zod`, `pino`, `js-yaml`) and devDependencies (`typescript`, `tsx`, `vitest`, `eslint`, `prettier`, `@types/*`)
- [ ] T002 Create `tsconfig.json` with `strict: true`, `module: NodeNext`, `target: ES2022`, rootDir `src`, outDir `dist`
- [ ] T003 [P] Create `vitest.config.ts` pointing at `tests/**/*.test.ts`; add `npm test` script to `package.json`
- [ ] T004 [P] Create `.eslintrc.json` and `.prettierrc` for TypeScript; add `npm run lint` and `npm run lint:fix` scripts to `package.json`
- [ ] T005 [P] Create `config.yml.example` with all sections populated (schedule, web.port, agent config, example criteria, example sites) based on `contracts/config-schema.md`
- [ ] T006 [P] Create `.env.example` with `ANTHROPIC_API_KEY=` and `LOG_LEVEL=info` placeholders; create `data/.gitkeep` to ensure `data/` directory is tracked

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure — DB schema, config loading, and logger — that all user stories depend on. **No user story work can begin until this phase is complete.**

- [ ] T007 Write SQL migration `src/db/migrations/001-initial.sql` — create `listings`, `scan_runs`, and `sites` tables with all indexes as specified in `data-model.md`
- [ ] T008 Implement `src/db/index.ts` — open SQLite connection (`better-sqlite3`), run all pending `src/db/migrations/*.sql` files in filename order at startup, export `db` singleton; seed `sites` table from `config.yml` if table is empty
- [ ] T009 [P] Implement `src/config.ts` — load `config.yml` (path overridable via `CONFIG_PATH` env var), validate with `zod` `ConfigSchema` (all types from `contracts/config-schema.md`), abort with human-readable error on invalid config, export typed `Config`; also initialise `pino` logger (respects `LOG_LEVEL` env var) and export it

**Checkpoint**: DB schema applied, config loads and validates, logger available — user story implementation can now begin.

---

## Phase 3: User Story 1 — View Prioritised Listings on a Web Page (Priority: P1) 🎯 MVP

**Goal**: A user can run a scan, have listings scraped and persisted to SQLite, then open the web page and see all listings ordered by match score with a "New" badge and error banner.

**Independent Test**: Seed the `listings` table with 3 rows at different `match_score` values (e.g., 80, 50, 20). Start the web server (`npm run serve`). Open `http://localhost:3000` and verify: rows appear in score-descending order; the correct fields (type, price, location, year, site, link) are shown; the "No listings yet" empty state is NOT shown.

### TDD — Dedup Service (write tests FIRST, confirm they FAIL, then implement)

- [ ] T010 [US1] [TDD] Write failing unit tests for dedup logic in `tests/unit/dedup.test.ts` covering: (a) registration match → UPDATE existing row; (b) registration absent → INSERT new row; (c) two listings same registration different sites → deduplicated to one row; (d) null registration on both → two separate rows
- [ ] T011 [US1] Implement `src/services/dedup.ts` — pure function: given a `RawListing` and the `db`, apply registration-based dedup logic (INSERT or UPDATE); return the listing `id` and whether it was `isNew`; make all T010 tests pass

### TDD — Orchestration Flow (write tests FIRST, confirm they FAIL, then implement)

- [ ] T012 [US1] [TDD] Write failing unit tests for orchestrator flow in `tests/unit/orchestration.test.ts` using mocked Scraper/Historian/Matcher responses; cover: (a) happy path — all sites succeed, scores written; (b) one site fails — error recorded in `scan_runs.error_summary`, remaining sites processed; (c) Matcher throws — existing scores retained, scan still completes

### Implementation — Scraper, Historian, Orchestrator

- [ ] T013 [P] [US1] Implement `src/agents/scraper.ts` — Anthropic SDK agent (Haiku model, max 10 turns); tool: HTTP GET via `node-fetch`; parse HTML with `cheerio`; apply registration extraction strategy (structured field → UK/US/EU regex → undefined); return `ScraperOutput`; on exception return `{ siteName, listings: [], error: message }`
- [ ] T014 [US1] Implement `src/agents/historian.ts` — receives validated `RawListing[]` for one site; uses `src/services/dedup.ts` to INSERT or UPDATE each listing; resets `is_new = 0` for all rows at scan start; sets `is_new = 1` for each listing touched in this run; returns count of new vs updated listings
- [ ] T015 [US1] Implement `src/agents/orchestrator.ts` — reads enabled sites from DB; resets `is_new` flags; spawns all Scraper agents in parallel (`Promise.allSettled`); validates `RawListing[]` (URL check, price/year coercion per scraper-agent.md); passes each site's listings to Historian; stubs Matcher call (score = 0 for all listings for now); writes `scan_runs` row; make T012 orchestration tests pass
- [ ] T016 [P] [US1] Write smoke test for scraper with static HTML fixture in `tests/integration/scraper.test.ts` — load a saved HTML file representing a listing page; run scraper parsing logic; assert expected `RawListing` fields are extracted

### Implementation — Web Server and Template

- [ ] T017 [P] [US1] Implement `src/web/server.ts` — Express app; `GET /`: query `listings` ordered by `match_score DESC, date_first_found DESC`; query most recent `scan_runs` row for `lastScan` and `scanErrors`; render `listings.html` template with `ListingsPageData`; `GET /health`: return `{ status: "ok", uptime: process.uptime() }`; export `startServer(config)` function
- [ ] T018 [US1] Create `src/web/templates/listings.html` — server-rendered HTML template (template literals in TypeScript); implement all rendering rules from `contracts/web-routes.md`: ranked listing rows with all required fields, "New" badge (`is_new = 1`), last scan timestamp, scan error banner, empty-state messages (pre-first-scan vs no-results), `listing.price === null` → "Price not listed"
- [ ] T019 [US1] Write integration test for web page in `tests/integration/web.test.ts` — seed DB with 3 listings at different scores; start server; `GET /`; assert: HTML contains listings in score-descending order; "New" badge present for `is_new = 1` rows; empty-state message absent when listings exist; error banner absent when `scan_runs.error_summary` is empty

**Checkpoint**: US1 complete — `npm run serve` shows a seeded database's listings in ranked order with correct badges and error handling.

---

## Phase 4: User Story 2 — Define Search Criteria (Priority: P2)

**Goal**: User configures criteria in `config.yml` (type, price range, year, location); the scoring engine assigns each listing a `match_score` of 0–100; listings with more matching criteria appear higher on the page.

**Independent Test**: Configure criteria `type_match: "cessna"` (weight 3) and `price_range: 20000–80000` (weight 2) in `config.yml`. Seed DB with three listings: one matching both criteria (expected score 100), one matching only type (expected score 60), one matching neither (expected score 0). Run `npm run scan`. Open page; verify ordering matches expected scores.

### TDD — Scoring Engine (write tests FIRST, confirm they FAIL, then implement)

- [ ] T020 [US2] [TDD] Write failing unit tests for scoring engine in `tests/unit/scoring.test.ts` covering: (a) all 6 criterion types satisfied → 100; (b) partial matches → correct weighted fraction; (c) null price/year → criterion not satisfied, no crash; (d) empty criteria → score 0 for all; (e) `price_range` with `min > max` edge case; (f) `type_match` is case-insensitive across `aircraftType`, `make`, and `model`

### Implementation — Scoring Service and Matcher

- [ ] T021 [US2] Implement `src/services/scoring.ts` — pure function `scoreListing(listing: ListingForScoring, criteria: ScoringCriteria[]): number`; implement all criterion satisfaction rules from `contracts/matcher-agent.md`; return 0–100 rounded to 1 decimal; make all T020 tests pass
- [ ] T022 [US2] Implement `src/agents/matcher.ts` — Anthropic SDK agent (Sonnet model, max 3 turns, no tools); calls `src/services/scoring.ts` for each listing; returns `MatcherOutput`; on exception, log error and return empty scores (Orchestrator retains existing DB scores)
- [ ] T023 [US2] Wire Matcher into `src/agents/orchestrator.ts` — replace the stub Matcher call (T015) with the real `MatcherAgent`; after Historian step, call `MatcherAgent({ listings: deduplicatedListings, criteria: config.criteria })`; validate `MatcherOutput` schema; UPDATE `listings.match_score` for each returned score; update T012 orchestration tests to cover Matcher call

**Checkpoint**: US1 + US2 working — listings are now ranked by config-driven criteria scores.

---

## Phase 5: User Story 3 — Scheduled Automatic Scanning (Priority: P3)

**Goal**: The scanner runs automatically on a cron schedule without manual invocation; site failures are resilient and surfaced on the page.

**Independent Test**: Set `schedule: "* * * * *"` (every minute) in `config.yml`. Start `npm start`. Wait ~65 seconds. Refresh the page; verify `scan_runs` table has a new row and listings have been refreshed. Then set one site URL to an unreachable address; trigger a scan; verify the error banner appears on the page.

- [ ] T024 [P] [US3] Implement `src/cli/scan.ts` — one-off scan entry point; load config, open DB, run Orchestrator once, log token usage and any errors, exit 0 on success (or partial success with errors) / exit 1 only on total failure; wire as `npm run scan` script in `package.json`
- [ ] T025 [US3] Add cron scheduler to `src/web/server.ts` — when `config.schedule` is not null, register a `node-cron` job calling the Orchestrator; log each scheduled run start/end; wire `npm start` script (server + scheduler) and `npm run serve` script (server only, no scheduler) in `package.json`
- [ ] T026 [P] [US3] Verify resilience path end-to-end: in `tests/unit/orchestration.test.ts`, add test confirming that when one Scraper returns `error` and others succeed, `scan_runs.error_summary` contains the failed site and `sites_failed` count is correct (update T012 mocked orchestration tests if needed)

**Checkpoint**: US1–US3 complete — `npm start` runs perpetually, scans on schedule, page stays current.

---

## Phase 6: User Story 4 — Filter and Browse the Listing Page (Priority: P4)

**Goal**: User can filter the listing page by aircraft type substring and/or price band to focus on a subset of the market.

**Independent Test**: Seed DB with a Cessna 172 at £45,000 and a Piper PA-28 at £60,000. Open `/?type=cessna`; verify only the Cessna appears. Open `/?max_price=50000`; verify only the Cessna appears. Open `/` with no filters; verify both listings appear.

- [ ] T027 [US4] Add query-param filtering to `GET /` in `src/web/server.ts` — accept optional `type` (substring, case-insensitive match against `aircraft_type`, `make`, `model`), `max_price` (numeric), and `new_only` (flag) query params; apply as additional SQL WHERE clauses before rendering
- [ ] T028 [US4] Update `src/web/templates/listings.html` — add a filter bar with type text input, max-price input, and "New only" checkbox; form submits via GET; active filters are pre-populated from current query params; a "Clear filters" link resets to `/`

**Checkpoint**: All 4 user stories complete and independently testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, and config hardening.

- [ ] T029 [P] Run all quickstart.md validation scenarios manually: (a) listings ranked by score, (b) "New" badge appears/clears across two scans, (c) unreachable site shows error banner, (d) empty state before first scan, (e) deduplication by registration — fix any gaps found
- [ ] T030 [P] Run `npm test && npm run lint` — fix any remaining test failures or lint errors; ensure all TDD test files (scoring, dedup, orchestration) are green
- [ ] T031 Finalise `config.yml.example` with realistic values (a Cessna 172 price range, a UK location pattern, two placeholder site URLs) and update `README` or quickstart.md if any setup steps have changed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories**
- **Phase 3 (US1)**: Depends on Phase 2 — first user story, builds the end-to-end pipeline
- **Phase 4 (US2)**: Depends on Phase 3 (scorer wires into existing Orchestrator) — can begin once orchestrator stub is in place (T015)
- **Phase 5 (US3)**: Depends on Phase 3 (CLI needs Orchestrator); Phase 4 recommended first (scored scans are more useful)
- **Phase 6 (US4)**: Depends on Phase 3 (web server must exist); independent of US2/US3
- **Phase 7 (Polish)**: Depends on all desired stories being complete

### Within-Story TDD Order

For US1 (dedup + orchestration) and US2 (scoring):
1. Write test file — confirm it **fails**
2. Implement service/agent — make tests pass
3. Do not proceed to next task until tests are green

### Parallel Opportunities Per Phase

**Phase 1**: T003, T004, T005, T006 can all run in parallel after T001+T002
**Phase 2**: T008 depends on T007 (migration file must exist first); T009 is independent
**Phase 3**: T010 (dedup tests) and T012 (orchestration tests) can be written in parallel; T013 (Scraper) and T016 (scraper integration test) can run in parallel once Phase 2 is done; T017 (web server) is independent of scraper/historian tasks

---

## Parallel Example: Phase 3 (US1)

```
# These can start in parallel once Phase 2 is done:
Task T010: Write failing dedup tests in tests/unit/dedup.test.ts
Task T012: Write failing orchestration tests in tests/unit/orchestration.test.ts
Task T013: Implement Scraper agent in src/agents/scraper.ts

# After T010 passes:
Task T011: Implement src/services/dedup.ts

# After T013 is done:
Task T016: Write scraper integration test with static HTML fixture

# After T011 and T014 are done:
Task T015: Implement orchestrator (make T012 tests pass)

# Independently, in parallel with T013–T015:
Task T017: Implement web server src/web/server.ts
Task T018: Create listings template src/web/templates/listings.html
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1 (TDD: dedup + orchestration; scraper; web page)
4. **STOP and VALIDATE**: `npm run scan` fetches listings; `npm run serve` shows them ranked; all Phase 3 tests green
5. This is a fully working tool — scoring shows 0 until US2 is added

### Incremental Delivery

1. Phase 1 + 2 → Foundation ready
2. Phase 3 (US1) → End-to-end pipeline, listings visible on page (MVP)
3. Phase 4 (US2) → Criteria-driven scoring, listings ranked by relevance
4. Phase 5 (US3) → Automatic scanning, unattended operation
5. Phase 6 (US4) → Filtering for power users
6. Phase 7 → Polish and validation

---

## Notes

- `[P]` tasks touch different files with no cross-dependency — safe to run in parallel
- TDD tasks (`[TDD]`) must be written and **confirmed failing** before the corresponding implementation task begins
- Constitution Principle V mandates TDD for `scoring.ts` (T020→T021), `dedup.ts` (T010→T011), and Orchestrator flow (T012→T015); do not skip
- Each story phase ends with a **Checkpoint** — validate independently before starting the next story
- `data/listings.db` is created at runtime; `data/` is gitignored (only `data/.gitkeep` is tracked)
- Scorer stub in T015 (score = 0) lets US1 be tested independently without US2 being complete
