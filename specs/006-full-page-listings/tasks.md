# Tasks: Full Page Listing Details (006)

**Input**: Design documents from `/specs/006-full-page-listings/`
**Branch**: `006-full-page-listings`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/detail-fetcher-agent.md ✓

**Tests**: TDD required for merge logic and 429 retry — write unit tests FIRST, confirm they FAIL before implementing.

**Organization**: Tasks grouped by user story. US2 and US3 are automatically satisfied by US1 (existing matcher and renderer already consume `raw_attributes` and `thumbnail_url`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared state)
- **[Story]**: User story label (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Install the `openai` npm package (required for Ollama OpenAI-compat client)

- [ ] T001 Check if `openai` package is already in `package.json`; if absent, run `npm install openai` and verify the package is added

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type and Ollama client wiring that all implementation tasks depend on

**⚠️ CRITICAL**: Both tasks must complete before US1 implementation begins

- [ ] T002 [P] Add `DetailFetchResult` and `DetailFetcherInput` interfaces to `src/types.ts` (export alongside existing types per plan)
- [ ] T003 Instantiate `OpenAI` client from `config.ollama` (`new OpenAI({ baseURL: config.ollama.url + '/v1', apiKey: 'ollama' })`) in the scan entry point(s) and pass through to the orchestrator — identify the correct call site(s) by tracing where `runOrchestrator` (or equivalent) is called from `src/`

**Checkpoint**: `DetailFetchResult` type exported; `ollamaClient` is available at the orchestrator call site

---

## Phase 3: User Story 1 — Richer Listing Data After Scan (Priority: P1) 🎯 MVP

**Goal**: Fetch each listing's detail page during a scan; extract full attributes + images; merge into DB; reset AI to pending; fail gracefully per listing without aborting the scan.

**Independent Test**: Run `npm run scan` (or `docker compose run --rm scan`). After completion, `SELECT json_extract(raw_attributes, '$.total_time') FROM listings LIMIT 5;` should return non-null values for listings whose detail pages have that field. At least one listing should have a non-null `thumbnail_url`.

### Tests for User Story 1 (TDD — write FAILING tests first)

> **Write tests FIRST, confirm they FAIL (e.g. "cannot find module"), THEN implement**

- [ ] T004 Write FAILING unit tests in `tests/unit/detail-fetcher.test.ts` covering the 9 cases from plan.md:
  1. Detail attributes overwrite existing *empty* attributes in merged result
  2. Detail attributes do NOT overwrite existing *non-empty* attributes with blank values
  3. Absolute image URLs are returned as-is
  4. Relative image URLs are resolved against the listing origin (prepend `new URL(listingUrl).origin`)
  5. When `fetchHtml` throws, returns `{ ..., error: <message>, attributes: {}, imageUrls: [] }`
  6. When LLM returns no parseable JSON, returns `{ ..., error: 'parse error' }`
  7. When LLM returns partial JSON (`attributes` only, no `imageUrls`), returns gracefully with empty imageUrls
  8. When `fetchHtml` returns HTTP 429 once then succeeds on retry, final result has attributes and no error
  9. When `fetchHtml` returns HTTP 429 three times consecutively, returns `{ ..., error: 'HTTP 429' }`

- [ ] T005 Write FAILING integration test additions in `tests/integration/orchestrator.test.ts`:
  1. When `OrchestratorDeps.detailFetcher` is provided, it is called once per listing ID in `allListingIds`
  2. When `detailFetcher` returns an error result for one listing, the scan does not throw and all other listings are still processed

### Implementation for User Story 1

- [ ] T006 [US1] Implement `fetchHtml` helper inside `src/agents/detail-fetcher.ts`: Node.js `fetch` with `User-Agent` header matching the scraper, 30s timeout, and 429 exponential backoff retry — base 1000ms, `delay * 2^attempt`, up to 3 total attempts; on 3rd failure return HTTP status so caller can build an error result
- [ ] T007 [US1] Implement `runDetailFetcher` core in `src/agents/detail-fetcher.ts`: call `fetchHtml`, trim HTML to 40,000 chars, call `ollamaClient.chat.completions.create({ model: ollamaModel, messages: [system, user] })` (OpenAI message format), parse JSON from response for `{ attributes: Record<string,string>, imageUrls: string[] }`, normalise relative image URLs by prepending origin
- [ ] T008 [US1] Add error handling shell to `runDetailFetcher` in `src/agents/detail-fetcher.ts`: wrap entire function body in try/catch; on any thrown exception OR non-200 HTTP (non-429) return `{ listingId, attributes: {}, imageUrls: [], error: message }` — function must NEVER throw
- [ ] T009 [P] [US1] Add `DETAIL_CONCURRENCY = 5` constant and optional `detailFetcher?` to `OrchestratorDeps` in `src/agents/orchestrator.ts`
- [ ] T010 [US1] Implement the detail fetch phase in `src/agents/orchestrator.ts` between the historian pass and the matcher pass:
  - Read `allListingIds`; query `listing_url` for each from DB
  - Batch-loop in waves of `DETAIL_CONCURRENCY` using `Promise.allSettled`
  - On success result: run merge UPDATE (shallow-merge `raw_attributes`, COALESCE scalars, replace `all_image_urls` if images found, set `thumbnail_url` to first image if found) then call `markListingAiStale(db, listingId)`
  - On error result: `logger.warn` and skip — no DB change
  - Log phase summary: `logger.info({ total, succeeded, failed }, 'Detail fetch phase complete')`
  - Use injectable `deps.detailFetcher` when provided (for tests), otherwise call `runDetailFetcher` directly

**Checkpoint**: All 9 unit tests and 2 integration tests pass. A real scan produces listings with richer attributes and images.

---

## Phase 4: User Story 2 — Better Match Scores From Full Attributes (Priority: P2)

**Goal**: Confirm enriched attributes flow into scoring and AI explanation within the same scan run.

**Why no new code**: The matcher already reads `raw_attributes` from DB; the presenter already reads stored attributes for AI explanation. US1 inserts the detail fetch phase *before* the matcher, so enriched data is automatically available.

**Independent Test**: Add a profile criterion for a detail-page-only attribute (e.g. `total_time`). Run a scan. Check `listing_ai.explanation` contains a reference to that attribute.

- [ ] T011 [US2] Verify orchestrator phase order in `src/agents/orchestrator.ts` is: Scraper → Historian → Detail Fetch → Matcher → Presenter; add an inline comment `// Phase order: see plan.md §Orchestrator Phase Order` above the detail fetch block if not already present

**Checkpoint**: Match scores and AI explanations reflect detail-page attributes after a scan. No new code paths required.

---

## Phase 5: User Story 3 — Images Visible in Listing Cards (Priority: P3)

**Goal**: Listing cards show aircraft photos instead of "No photo" placeholder, automatically, because US1 now populates `thumbnail_url`.

**Why no new code**: Feature 004 already renders `thumbnail_url` in listing cards. US3 is satisfied automatically once US1 runs successfully on a site whose detail pages contain photos.

**Independent Test**: View the listings page after a scan. Listing cards for sites with photos should show a thumbnail image rather than the "No photo" placeholder.

- [ ] T012 [US3] Smoke-test the web UI after a scan: open the listings page in a browser and confirm at least one listing card shows an image — document result in a comment on this task

**Checkpoint**: No photo placeholder replaced by real images for listings with photos on their detail pages.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T013 [P] Rebuild Docker image to bake in new test file: `docker compose build app`
- [ ] T014 Run full test suite inside Docker: `docker compose run --rm -e NODE_ENV=test app npm test` — confirm all tests pass (including the 9 new unit tests and 2 new integration tests)
- [ ] T015 [P] Run lint: `npm run lint` — confirm zero errors
- [ ] T016 [P] Update `CLAUDE.md` if any new technology or pattern was introduced that isn't already documented

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all US phases
- **Phase 3 (US1)**: Depends on Phase 2 — TDD tests (T004–T005) written first, then implementation (T006–T010)
- **Phase 4 (US2)**: Depends on Phase 3 complete
- **Phase 5 (US3)**: Depends on Phase 3 complete (can run in parallel with Phase 4)
- **Phase 6 (Polish)**: Depends on all story phases complete

### Within Phase 3 (US1)

```
T004 (unit tests — write FAILING) ──┐
T005 (integration tests — FAILING) ─┼── then T006 (fetchHtml + 429 retry)
T009 (orchestrator constants) ───────┘         │
                                               T007 (LLM call + parse)
                                               T008 (error handling shell)
                                               T010 (orchestrator phase)
```

T004, T005, and T009 can start in parallel immediately after Phase 2. T006–T008 are sequential (same file). T010 depends on T006–T009.

### Parallel Opportunities

```bash
# Phase 2: run together
T002  # Add types to src/types.ts
T003  # Wire ollamaClient in scan entry point

# Phase 3 start: run together
T004  # unit tests (new file)
T005  # integration test additions (different file from T004)
T009  # orchestrator constants (different file from T004/T005)

# Phase 6: run together
T013  # Docker build
T015  # Lint
T016  # CLAUDE.md update
```

---

## Implementation Strategy

### MVP (Phase 1 → 2 → 3 only)

1. Complete Phase 1: install `openai`
2. Complete Phase 2: add `DetailFetchResult` type, wire `ollamaClient`
3. Write failing tests (T004, T005)
4. Implement detail-fetcher.ts (T006–T008) until all unit tests pass
5. Extend orchestrator (T009–T010) until integration tests pass
6. **STOP and VALIDATE**: run a real scan, inspect DB for richer attributes + images
7. Proceed to US2/US3 validation and polish

### Key Implementation Notes (from plan.md)

- **Ollama client**: `new OpenAI({ baseURL: config.ollama.url + '/v1', apiKey: 'ollama' })` — same pattern as verifier-ollama plan
- **429 backoff**: `await sleep(1000 * Math.pow(2, attempt))` before retry — 1s, 2s, 4s
- **Merge rule**: `const merged = { ...existingAttrs }; for (const [k, v] of Object.entries(detailAttrs)) { if (v !== '') merged[k] = v; }`
- **Image rule**: replace `all_image_urls` only when `detailImageUrls.length > 0`; set `thumbnail_url` to `detailImageUrls[0]` only when non-empty
- **Never throws**: entire `runDetailFetcher` body wrapped in `try/catch`; every exit path returns `DetailFetchResult`

---

## Notes

- [P] tasks = different files, no dependencies between them
- [Story] label maps task to spec user story for traceability
- TDD: T004 and T005 MUST fail before T006–T010 are written
- Docker image must be rebuilt (T013) before test suite can discover the new test file
- Ollama must be running locally on `config.ollama.url` for real scans; unit/integration tests mock both `fetchHtml` and the LLM client
