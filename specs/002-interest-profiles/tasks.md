# Tasks: Profile-Based Interest Scoring

**Input**: Design documents from `/specs/002-interest-profiles/`  
**Prerequisites**: plan.md ✓ spec.md ✓ research.md ✓ data-model.md ✓ contracts/ ✓ quickstart.md ✓

**TDD Note**: `profile-scorer.ts` and `icao.ts` are deterministic core logic — Constitution Principle V mandates test-first (Red → confirm failure → Green). Tasks T017–T018 and T033–T034 follow this pattern explicitly.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to
- TDD tasks are marked with ⚠️ TDD — write test first, confirm it FAILS before implementing

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Static data and profile directory that all stories depend on.

- [ ] T001 Download `airports.csv` from ourairports.com and save to `data/airports.csv` (run: `curl -L "https://davidmegginson.github.io/ourairports-data/airports.csv" -o data/airports.csv`)
- [ ] T002 Create `profiles/` directory and add `profiles/example-ifr-touring.yml` from the example in `specs/002-interest-profiles/data-model.md`
- [ ] T003 Add `profiles/` to `.gitignore` exclusions except the example file (keep `!profiles/example-*.yml`); add `data/airports.csv` to git tracking

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: New DB tables, updated types, config additions, and profile loader that ALL user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Create `src/db/migrations/003-interest-profiles.sql` with four new tables: `listing_scores`, `listing_feedback`, `weight_suggestions`, `airfield_locations` — exact schema from `specs/002-interest-profiles/data-model.md`
- [ ] T005 Extend `src/types.ts` with new types: `InterestProfile`, `ProfileCriterion`, `EvidenceItem`, `ProfileScore`, `ProfileMatcherOutput`, `FeedbackRecord`, `FeedbackRating`, `WeightSuggestion` — exact shapes from `specs/002-interest-profiles/data-model.md`
- [ ] T006 Extend `src/config.ts` `ConfigSchema` with `home_location` (`{ lat, lon } | null`, default null) and `feedback_min_count` (int, default 5); export updated `Config` type
- [ ] T007 Create `src/services/profile-loader.ts`: reads all `*.yml` (excluding `*.bak`) from a given directory, parses with `js-yaml`, validates each against the Zod `InterestProfileSchema` from `specs/002-interest-profiles/contracts/profile-schema.md`, throws a descriptive startup error naming the file on any failure; exports `loadProfiles(dir: string): InterestProfile[]`

**Checkpoint**: Migration, types, config, and profile loader ready. User story implementation can begin.

---

## Phase 3: User Story 1 — Browse a Ranked List of Interesting Listings (Priority: P1) 🎯 MVP

**Goal**: Listings scored against all active profiles; overall weighted-average score written to `listings.match_score`; web page shows ranked list as before.

**Independent Test**: Load two active profiles; run a scan with mock scraper returning 5 listings; confirm `listings.match_score` values reflect weighted profile average; confirm listing excluded if it falls below every active profile's `min_score`.

### Tests for User Story 1 ⚠️ TDD — write FIRST, confirm FAIL before implementing

- [ ] T008 [US1] Write `tests/unit/profile-scorer.test.ts` covering: make_model wildcard match, price_range in/out of bounds, year_range in/out of bounds, listing_type full_ownership vs share, profile with weight=0 excluded, overall weighted average, min_score exclusion (listing excluded only when below ALL profiles' floors), empty profiles returns 0 — **run `docker compose run --rm app npm test` and confirm these tests FAIL before proceeding**

### Implementation for User Story 1

- [ ] T009 [US1] Create `src/services/profile-scorer.ts`: pure function `scoreListingAgainstProfiles(listing: ListingForScoring, profiles: InterestProfile[]): { overallScore: number; profileScores: ProfileScore[] }` — deterministic criterion types only (make_model, price_range, year_range, listing_type; proximity returns 0 until Phase 6); `mission_type` returns 0 with note "requires AI evaluation — see Phase 5 US3" — **implement until T008 tests pass (GREEN)**
- [ ] T010 [US1] Update `src/agents/matcher.ts`: replace `scoreListing` call with `scoreListingAgainstProfiles`; accept `profiles: InterestProfile[]` as a new parameter alongside `criteria`; if profiles non-empty use profile scorer; else fall back to existing `scoreListing` from `scoring.ts`; persist `listing_scores` rows for each listing × profile using a new `persistProfileScores(db, listingId, profileScores, scoredAt)` helper
- [ ] T011 [US1] Update `src/agents/orchestrator.ts`: load profiles via `loadProfiles(profilesDir)` at start of `runScan` (profilesDir passed via config or deps); pass profiles to matcher; add `profilesDir` to `OrchestratorDeps`
- [ ] T012 [US1] Update `src/web/server.ts`: call `loadProfiles(profilesDir)` on startup; pass profiles to orchestrator and to app deps; `profilesDir` defaults to `path.join(process.cwd(), 'profiles')`
- [ ] T013 [US1] Update `src/cli/scan.ts`: pass `profilesDir` to orchestrator deps

**Checkpoint**: Run `docker compose run --rm scan`; check `listings.match_score` written; check `listing_scores` rows in DB. US1 independently functional.

---

## Phase 4: User Story 2 — Set Up a Profile by Stating High-Level Intent (Priority: P2)

**Goal**: Interactive CLI that calls the ProfileResearcher LLM agent, presents proposed criteria, lets user accept/modify/reject each, and writes a validated `profiles/<slug>.yml`.

**Independent Test**: Run `npm run setup-profile`; enter "Hour building in UK"; confirm the agent proposes concrete criteria; accept all; confirm a valid YAML file appears in `profiles/`.

### Implementation for User Story 2

- [ ] T014 [P] [US2] Create `src/agents/profile-researcher.ts`: async function `runProfileResearcher(intent: string, anthropic: Anthropic, config: Config): Promise<{ proposed: Array<{ type: string; description: string; rationale: string; defaults: Record<string, unknown> }> }>` — prompt the LLM with the intent, request a JSON array of proposed criteria with descriptions and rationale; no tools (pure LLM generation); bounded by `config.agent.max_turns_per_agent`
- [ ] T015 [US2] Create `src/cli/setup-profile.ts`: interactive CLI flow — prompt for profile name and intent; call `runProfileResearcher`; display each proposed criterion with accept (y) / modify (m) / reject (r) prompt; assemble confirmed criteria into `InterestProfileSchema`-valid object; write to `profiles/<slug>.yml`; validate final file via `loadProfiles` before confirming success
- [ ] T016 [US2] Add `"setup-profile": "tsx src/cli/setup-profile.ts"` to `package.json` scripts

**Checkpoint**: `npm run setup-profile` (or `docker compose run --rm app npm run setup-profile`) produces a valid profile YAML. US2 independently functional.

---

## Phase 5: User Story 3 — Understand Why a Listing Scored as It Did (Priority: P3)

**Goal**: Each listing on the web page shows which criteria matched/didn't, contributions, and inference confidence; evidence already persisted in `listing_scores.evidence`.

**Independent Test**: With a known profile and known listing attributes, confirm `listing_scores.evidence` JSON contains all criteria entries (matched + unmatched), each with `criterionName`, `matched`, `contribution`, and `note`.

### Implementation for User Story 3

- [ ] T017 [P] [US3] Update `src/services/profile-scorer.ts` to produce complete `EvidenceItem[]` for every criterion (matched AND unmatched): include `criterionName`, `matched`, `contribution` (0 for unmatched), `note` (human-readable), `confidence: null` for deterministic criteria — update T008 tests to cover evidence shape
- [ ] T018 [P] [US3] Update `src/web/render.ts`: add "Show evidence" toggle on each listing row that expands to show `listing_scores` evidence; query `listing_scores` from DB grouped by `listing_id`; render as a table of criteria with matched/unmatched indicators and contributions

**Checkpoint**: Load web page; expand a listing; see per-criterion evidence table. US3 independently functional.

---

## Phase 6: User Story 4 — Match Share Listings by Proximity to Home Airfield (Priority: P4)

**Goal**: Proximity criterion works for share listings; ICAO codes resolved from bundled `airports.csv`; resolved entries cached in `airfield_locations`; full-ownership listings contribute 0 with a note.

**Independent Test**: Configure home at EGBJ coords; two share listings: EGBJ (0 km) and EGPD (450 km) with `maxDistanceKm: 150`; confirm EGBJ scores high on proximity, EGPD scores 0; confirm `airfield_locations` cache populated.

### Tests for User Story 4 ⚠️ TDD — write FIRST, confirm FAIL before implementing

- [ ] T019 [US4] Write `tests/unit/icao.test.ts` covering: `haversineKm` (known distances EGBJ→EGLL ~160 km within 10 km tolerance), ICAO resolution from CSV (EGBJ present), unknown code returns null, proximity score 0 when code unknown, proximity score decreasing with distance, score = 0 beyond maxDistanceKm, full-ownership listing → 0 regardless of distance — **confirm these tests FAIL before implementing**

### Implementation for User Story 4

- [ ] T020 [US4] Create `src/services/icao.ts`: load `data/airports.csv` into `Map<string, { name: string; lat: number; lon: number }>` at module load; export `resolveIcao(code: string): { name: string; lat: number; lon: number } | null`; export `haversineKm(lat1, lon1, lat2, lon2): number`; export `proximityScore(icaoCode: string | null, listingType: string, homeLat: number, homeLon: number, maxDistanceKm: number): { score: number; note: string }` — **implement until T019 tests pass (GREEN)**
- [ ] T021 [US4] Update `src/services/profile-scorer.ts`: handle `proximity` criterion type using `proximityScore` from `icao.ts`; full-ownership listing → `{ score: 0, note: "proximity only applies to share listings" }`; `home_location: null` → `{ score: 0, note: "home_location not configured" }`
- [ ] T022 [US4] Wire ICAO cache to DB: after resolving a new code, upsert into `airfield_locations` table; add helper `cacheAirfield(db, icaoCode, name, lat, lon)` in `src/services/icao.ts`; pass `db` into `proximityScore` call from profile-scorer

**Checkpoint**: Run scan with share listings containing ICAO codes; check proximity scores and `airfield_locations` cache. US4 independently functional.

---

## Phase 7: User Story 5 — Refine Profile Weights Through Feedback (Priority: P5)

**Goal**: Inline feedback forms on listing rows; `POST /feedback` stores feedback; `GET /suggest-weights` generates and displays weight suggestions; accept/reject controls update profile YAMLs with timestamped backups.

**Independent Test**: Submit 5 feedback records; hit `GET /suggest-weights`; confirm suggestion page renders with proposed changes; accept one; confirm profile YAML updated and `.bak` file created.

### Implementation for User Story 5

- [ ] T023 [P] [US5] Update `src/web/render.ts`: add inline thumbs-up / neutral / thumbs-down form on each listing row (`POST /feedback` with `listing_id` and `rating`); add `renderSuggestWeightsPage(suggestions, feedbackCount, minCount)` function
- [ ] T024 [US5] Add `POST /feedback` route to `src/web/server.ts`: validate `listing_id` (must exist in DB) and `rating` (must be valid enum); capture current profile weights snapshot as JSON; insert into `listing_feedback`; redirect to `GET /`
- [ ] T025 [US5] Create `src/agents/weight-suggester.ts`: async function `runWeightSuggester(feedback: FeedbackRecord[], profiles: InterestProfile[], anthropic: Anthropic, config: Config): Promise<Omit<WeightSuggestion, 'id' | 'status' | 'createdAt' | 'resolvedAt'>[]>` — prompt LLM with feedback data and current weights; request proposed weight adjustments with rationale; no tools; return structured array
- [ ] T026 [US5] Add `GET /suggest-weights` route to `src/web/server.ts`: count non-neutral feedback; if below `feedback_min_count` render "need N more" page; load pending suggestions from DB (if any); if none, call `runWeightSuggester` and persist results; render suggest-weights page
- [ ] T027 [US5] Add `POST /suggest-weights/:action` route to `src/web/server.ts`: for `accept` — load suggestion, find profile file by `profile_name`, write new weight atomically (tmp → bak rename → rename), update `weight_suggestions.status`; for `reject` — update status only; redirect to `GET /suggest-weights`
- [ ] T028 [US5] Add integration test coverage to `tests/integration/web.test.ts`: `POST /feedback` with valid and invalid inputs; `GET /suggest-weights` below threshold; mock `runWeightSuggester` and verify suggestion page renders

**Checkpoint**: Full feedback loop operational: submit feedback → request suggestions → accept → verify profile YAML updated with backup. US5 independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, lint, final validation.

- [ ] T029 Update `README.md` with feature 002 prerequisites (download `airports.csv`), `profiles/` directory setup, and `npm run setup-profile` command (Constitution Principle VIII)
- [ ] T030 [P] Run `docker compose run --rm app npm test && docker compose run --rm app npm run lint` — fix any failures
- [ ] T031 Run through `specs/002-interest-profiles/quickstart.md` validation scenarios manually; confirm all pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — MVP deliverable
- **Phase 4 (US2)**: Depends on Phase 2 — can start after Phase 2 independently of US1
- **Phase 5 (US3)**: Depends on Phase 3 (US1) — extends the evidence already persisted by US1 matcher
- **Phase 6 (US4)**: Depends on Phase 3 (US1) — extends profile-scorer with proximity criterion
- **Phase 7 (US5)**: Depends on Phase 2 — can start after Phase 2 independently of US1–US4
- **Phase 8 (Polish)**: Depends on all desired stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundational complete → implement; MVP scope
- **US2 (P2)**: Foundational complete → implement (independent of US1)
- **US3 (P3)**: US1 complete → implement (extends profile-scorer and render)
- **US4 (P4)**: US1 complete → implement (extends profile-scorer with proximity)
- **US5 (P5)**: Foundational complete → implement (independent of US1–US4, but benefits from having listings in DB)

### Within Each TDD Story (US1, US4)

1. Write tests → confirm FAIL (RED)
2. Implement service → run tests → confirm PASS (GREEN)
3. Wire into agents/routes
4. Run full test suite

### Parallel Opportunities

- T001, T002, T003 (Phase 1): independent, run in parallel
- T004, T005, T006, T007 (Phase 2): independent, run in parallel
- T014 (US2 researcher) can be developed in parallel with T009–T013 (US1) once Phase 2 is done
- T017, T018 (US3): independent files, run in parallel
- T023 (US5 render), T025 (US5 agent): independent files, run in parallel

---

## Parallel Example: User Story 1 (TDD flow)

```bash
# Step 1: Write tests — no parallelism, one file
Task: "Write tests/unit/profile-scorer.test.ts (T008)"
Run: docker compose run --rm app npm test  # must see FAILURES

# Step 2: Implement — then verify GREEN
Task: "Create src/services/profile-scorer.ts (T009)"
Run: docker compose run --rm app npm test  # must see T008 tests PASS

# Step 3: Wire in parallel (different files)
Task: "Update src/agents/matcher.ts (T010)"
Task: "Update src/agents/orchestrator.ts (T011)"  ← parallel with T010
Task: "Update src/web/server.ts (T012)"           ← parallel with T010, T011
Task: "Update src/cli/scan.ts (T013)"             ← parallel with T010–T012
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US1 (TDD for profile-scorer)
4. **STOP and VALIDATE**: confirm listings ranked by profile score, min_score exclusion working
5. Check in / demo

### Incremental Delivery

1. Phase 1 + 2 → Foundation ready
2. Phase 3 (US1) → Profile scoring live, ranked list works ✓
3. Phase 4 (US2) → Profile setup CLI works ✓
4. Phase 5 (US3) → Evidence visible in web UI ✓
5. Phase 6 (US4) → Proximity scoring live ✓
6. Phase 7 (US5) → Feedback loop complete ✓
7. Phase 8 → Polish ✓

---

## Summary

| Phase | User Story | Tasks | TDD? |
|-------|-----------|-------|------|
| 1 | Setup | T001–T003 | No |
| 2 | Foundational | T004–T007 | No |
| 3 | US1 Ranked List (P1) | T008–T013 | Yes (T008–T009) |
| 4 | US2 Profile Setup (P2) | T014–T016 | No |
| 5 | US3 Evidence (P3) | T017–T018 | No |
| 6 | US4 Proximity (P4) | T019–T022 | Yes (T019–T020) |
| 7 | US5 Feedback (P5) | T023–T028 | No |
| 8 | Polish | T029–T031 | No |

**Total tasks**: 31  
**TDD tasks**: 4 (T008, T009, T019, T020)  
**Parallelizable tasks**: T001–T003, T004–T007, T010–T013, T017–T018, T023+T025  
**MVP scope**: Phases 1–3 (T001–T013, 13 tasks)
