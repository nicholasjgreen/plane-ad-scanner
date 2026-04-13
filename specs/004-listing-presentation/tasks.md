# Tasks: Listing Presentation

**Input**: Design documents from `/specs/004-listing-presentation/`
**Prerequisites**: plan.md ✓, spec.md ✓, data-model.md ✓, contracts/ ✓, research.md ✓, quickstart.md ✓

**Tests**: TDD is mandatory (constitution Principle V) for Presenter output validation and listing-ai DB module — deterministic logic. Integration test for Re-score endpoint. Test tasks MUST be written and confirmed FAILING before their implementation tasks.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

**Codebase notes**:
- Rendering is in `src/web/render.ts` (TypeScript, not a separate HTML template file)
- Evidence rendering (`renderEvidence()`) already exists in `render.ts` from feature 002
- `listing_scores.evidence` is a JSON column (not a separate `evidence_items` table)
- Migration 003 already created `listing_scores`, `listing_feedback`, `weight_suggestions`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- TDD tasks: write test → confirm it FAILS → then implement

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: DB migration and type additions — must be complete before anything else.

- [x] T001 Create `src/db/migrations/004-listing-presentation.sql` — `ALTER TABLE listings ADD COLUMN thumbnail_url TEXT`; `ALTER TABLE listings ADD COLUMN all_image_urls TEXT` (JSON array); `CREATE TABLE listing_ai` with columns: `listing_id TEXT PRIMARY KEY REFERENCES listings(id)`, `headline TEXT`, `explanation TEXT`, `status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed'))`, `model_ver TEXT`, `generated_at TEXT`; add indexes on `listing_ai(status)` and `listing_ai(model_ver)`
- [x] T002 Update `src/types.ts` — add `imageUrls?: string[]` to `RawListing` interface; add `PresenterInput` (listing data + active profiles) and `PresenterOutput` (`{ listingId: string, headline: string, explanation: string, status: 'ok' | 'partial' }`) interfaces matching the contract in `contracts/presenter-agent.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: listing-ai DB module and Presenter agent — must be complete before any user story work. TDD: write tests first, confirm FAIL, then implement.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T003 [P] Write FAILING unit tests for Presenter output validation in `tests/unit/presenter.test.ts` — cover: headline > 60 chars is truncated with `…` suffix; blank headline is replaced with site+price fallback (e.g. `"Listing on Trade-A-Plane — £45,000"`); blank explanation replaced with `"No summary available."`; status must be `'ok'` or `'partial'` (any other value rejected); when profiles array is empty, status is `'partial'` (not `'ok'`)
- [x] T004 [P] Write FAILING unit tests for listing-ai DB module in `tests/unit/listing-ai.test.ts` — cover: `upsertListingAi` creates a new row with `status='pending'` on first call; subsequent call updates the existing row (no duplicate rows); `setStatusReady` sets status to `'ready'` and stores headline, explanation, model_ver, generated_at; `setStatusFailed` sets status to `'failed'` without overwriting existing headline/explanation; `getPendingListingIds` returns only rows with `status='pending'`
- [x] T005 Implement `src/db/listing-ai.ts` — functions: `upsertListingAi(db, listingId)` (creates 'pending' row or no-ops if exists), `setStatusReady(db, listingId, data: { headline, explanation, modelVer })`, `setStatusFailed(db, listingId)`, `getPendingListingIds(db): string[]`, `getListingAi(db, listingId)`, `resetAllToPending(db)` (for future CLI); all T004 tests must pass before submitting
- [x] T006 Implement `src/agents/presenter.ts` — export `runPresenter(input: PresenterInput, anthropic: Anthropic, model: string): Promise<PresenterOutput>`; use model `claude-sonnet-4-6` (or passed model); max turns: 3; no tools; build structured JSON prompt from `PresenterInput` using few-shot examples from `research.md`; parse and validate the returned JSON; apply all validation rules (truncate headline at 60 chars, blank fallbacks, status validation); throw on unrecoverable failure; all T003 tests must pass before submitting

**Checkpoint**: Run `npm test` — all unit tests must pass before proceeding to user story phases.

---

## Phase 3: User Story 1 — Scan Listings as Informative Cards (Priority: P1) 🎯 MVP

**Goal**: Each listing on the page renders as a `<details>`/`<summary>` accordion card showing an AI-generated headline, make/model/year/price, and one thumbnail image (or placeholder). Cards are sorted by match score descending.

**Independent Test**: Seed DB with a mix of listings (some with images, some without; some with `listing_ai` rows in `ready` status, some with no `listing_ai` row). Start the web server. Confirm: every listing shows a non-generic, non-blank headline (or the site+price fallback); make, model, year, price are displayed; exactly one thumbnail or a placeholder is shown; cards are sorted by `match_score` descending; listings with `is_new = 1` have a visible "New" badge.

- [x] T007 [P] [US1] Update `src/agents/scraper.ts` to extract image URLs from each listing page: (1) `thumbnail_url` — `og:image` meta tag first; fall back to first `<img>` whose URL does not match `/logo|/icon|/sprite|/pixel/i` and whose `width` attribute (if present) is ≥ 100; (2) `all_image_urls` — JSON array of all `<img src>` values from the listing body; store both on `RawListing.imageUrls` (thumbnail as first element when using the fallback heuristic); update `src/services/dedup.ts` `upsertListing` to persist `thumbnail_url` (first imageUrl) and `all_image_urls` (full JSON array) to the listings table and to call `upsertListingAi(db, id)` so a `listing_ai` row is created immediately for every new listing
- [x] T008 [P] [US1] Update `src/agents/orchestrator.ts` to invoke the Presenter after the Matcher pass: (1) call `getPendingListingIds(db)` to get the batch for this scan; (2) run `runPresenter` for each listing in parallel (using `Promise.allSettled`); (3) on success: call `setStatusReady`; on failure: call `setStatusFailed` and log the error; (4) presenter failures MUST NOT abort the scan run; (5) log token usage from each Presenter call; add `presenterModel?: string` to `OrchestratorDeps`
- [x] T009 [P] [US1] Update `src/web/render.ts` — extend `ListingRow` with `headline: string | null`, `thumbnailUrl: string | null`, `allImageUrls: string[]`; rewrite `renderListing()` to use `<details class="listing">` / `<summary>` accordion pattern: summary shows headline (fallback: `"Listing on {sourceSite} — {price}"` if null), make · model · year · price as key facts, one `<img src="{thumbnailUrl}">` or a `<div class="thumbnail-placeholder">` when null, and the "New" badge; leave expanded body as a `<div class="expanded-body">` placeholder for Phase 4 (explanation) and Phase 5 (gallery); preserve existing `renderEvidence()` and `renderFilterBar()` functions unchanged
- [x] T010 [US1] Update `src/web/server.ts` `GET /` handler to JOIN `listings` with `listing_ai` (LEFT JOIN, so listings with no AI row still render); build `ListingRow[]` including `headline`, `thumbnailUrl`, `allImageUrls`, and the existing `evidence` from `listing_scores`; pass to `renderListingsPage()`; sort by `match_score DESC, date_first_found DESC`

**Checkpoint**: Run `npm run scan` then start the server. The listings page must show accordion cards with headlines, facts, and thumbnails in score order.

---

## Phase 4: User Story 2 — Plain-English Interest Explanation + Re-score (Priority: P1)

**Goal**: Expanding an accordion card reveals a plain-English explanation of why the listing matches the user's interests, a visually subordinate structured evidence breakdown, a "View original listing" link, and a "Re-score" button that triggers on-demand explanation regeneration.

**Independent Test**: With a listing that has a `listing_ai` row in `ready` status and a row in `listing_scores`, expand the card. Confirm: explanation text is shown (no bare numbers without context); the evidence section is present but collapsed by default; a "View original listing →" link is present; a "Re-score" form button is present. Click "Re-score" — confirm redirect back to `/` and that `listing_ai.generated_at` is updated in the DB.

- [ ] T011 [P] [US2] Update `src/web/render.ts` expanded body inside `renderListing()` — add: (1) explanation section: render explanation text if `status='ready'` and non-null; render `"Summary is being generated…"` if `status='pending'`; render stale explanation or `"Summary not yet available for this listing."` if `status='failed'`; (2) evidence section: call existing `renderEvidence(evidence)` inside a nested `<details class="evidence">` collapsed by default (evidence is already visually subordinate per existing CSS); (3) a `<a href="{listingUrl}" target="_blank" rel="noopener">View original listing →</a>` link; (4) a `<form method="post" action="/rescore"><input type="hidden" name="listing_id" value="{id}"><button type="submit">Re-score</button></form>` button; add CSS for the Re-score button matching the existing button style
- [ ] T012 [P] [US2] Add `POST /rescore` endpoint in `src/web/server.ts` — read `listing_id` from body; load the listing from DB; load current profiles from `config.yml` or profile store; call `runPresenter(input, anthropic, model)`; on success: call `setStatusReady`; on failure: call `setStatusFailed` and log; redirect to `/` in all cases (PRG pattern); if `listing_id` is missing or the listing does not exist, redirect to `/` without error
- [ ] T013 [US2] Write integration test `tests/integration/rescore.test.ts` — seed a listing and a `listing_ai` row with `status='pending'`; mock `runPresenter` to return a fixed `PresenterOutput`; POST to `/rescore` with the listing ID; assert response is a redirect (302); assert `listing_ai` row now has `status='ready'`, non-empty `headline` and `explanation`, and updated `generated_at`

**Checkpoint**: Expand a card. All three expanded sections (explanation, evidence, source link + Re-score button) must be present and correct. Evidence must be collapsed by default.

---

## Phase 5: User Story 3 — Browse Images in the Expanded View (Priority: P2)

**Goal**: All scraped images for a listing are browsable in the expanded view. A placeholder is shown when no images are available.

**Independent Test**: With a listing that has 3 entries in `all_image_urls`, expand the card. Confirm all 3 images are rendered as `<img src="…">` tags. With a listing that has no images, confirm the placeholder renders rather than broken images or empty space.

- [ ] T014 [US3] Update `src/web/render.ts` expanded body — add image gallery section below the explanation: iterate `allImageUrls` and render each as `<img src="…" class="gallery-img" loading="lazy">`; if `allImageUrls` is empty, render `<div class="thumbnail-placeholder gallery-placeholder">No images available</div>`; add CSS for `.gallery-img` (max-width: 100%, margin-bottom: .5rem) and the gallery wrapper

**Checkpoint**: Expand listings with multiple images, one image, and no images — all three cases render correctly.

---

## Phase 6: User Story 4 — Explanation Reflects Current Interest Profiles (Priority: P3)

**Goal**: When interest profiles change, stale explanations are automatically reset to `pending` at the start of the next scan and regenerated by the Presenter pass in that same run. The previous explanation remains visible until regeneration completes.

**Independent Test**: Update a profile weight. Run a scan. Confirm that listing rows whose `model_ver` did not match the new profile hash were reset to `pending` before the Presenter pass, and after the scan their `model_ver` equals the new hash.

- [ ] T015 [P] [US4] Implement `src/services/presentation.ts` — export `computeProfileHash(profiles: InterestProfile[]): string` (SHA-256 of deterministic JSON.stringify with sorted keys using Node.js built-in `crypto`); export `resetStaleExplanations(db: Database, currentHash: string): number` (UPDATE listing_ai SET status='pending' WHERE model_ver != currentHash OR model_ver IS NULL; return row count updated); no external dependencies
- [ ] T016 [US4] Update `src/agents/orchestrator.ts` — after `resetIsNew(db)` and before the Presenter pass, call `resetStaleExplanations(db, currentHash)` where `currentHash = computeProfileHash(profiles)`; log the count of stale explanations reset; update `setStatusReady` call to pass `modelVer: currentHash` so each freshly generated explanation is stamped with the current profile hash

**Checkpoint**: After a profile change, run a scan — stale explanations are regenerated and `model_ver` is updated.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Config key support, documentation accuracy, and final lint/test pass.

- [ ] T017 [P] Add `agent.presenter_model` optional config key in `src/config.ts` — read from `config.yml` agent block; default to the value of `agent.matcher_model` if absent (so a single `matcher_model` key controls both unless explicitly overridden); pass the resolved model name through `OrchestratorDeps.presenterModel` into `runPresenter`
- [ ] T018 [P] Update `specs/004-listing-presentation/quickstart.md` — replace references to `src/web/templates/listings.html` with `src/web/render.ts`; add Re-score button documentation; note that `model_ver` tracks which profile version generated each explanation; verify all npm script commands still match `package.json`
- [ ] T019 Run `npm test && npm run lint` — all unit tests (T003–T004 scope) and integration test (T013) must pass; no lint errors; resolve any TypeScript strict-mode errors introduced in this feature

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phase 3 (US1)**: Depends on Phase 2 — can start once Foundational complete
- **Phase 4 (US2)**: Depends on Phase 3 — explanation rendered inside the accordion from US1
- **Phase 5 (US3)**: Depends on Phase 3 — image gallery rendered inside the same accordion
- **Phase 6 (US4)**: Depends on Phase 3 (Presenter must exist); can overlap with Phase 4/5
- **Phase 7 (Polish)**: Depends on all story phases complete

### Within Phase 2

- T003 and T004 can run in parallel (different test files)
- T005 depends on T004 being written and FAILING first (TDD)
- T006 depends on T003 being written and FAILING first (TDD)
- T005 and T006 can run in parallel once T003/T004 exist

### Within Phase 3

- T007, T008, T009 can run in parallel (different files)
- T010 depends on T009 (ListingRow shape must be defined before server queries it)

### Within Phase 4

- T011 and T012 can run in parallel (different files)
- T013 depends on T012 (endpoint must exist for integration test)

### Parallel Opportunities

```bash
# Phase 2 — TDD setup (run in parallel):
Task T003: "Write failing presenter.test.ts"
Task T004: "Write failing listing-ai.test.ts"
# Then (can overlap once their tests exist):
Task T005: "Implement src/db/listing-ai.ts"
Task T006: "Implement src/agents/presenter.ts"

# Phase 3 — all can proceed in parallel once Phase 2 done:
Task T007: "Extend scraper: thumbnail_url + all_image_urls"
Task T008: "Extend orchestrator: Presenter invocation"
Task T009: "Update render.ts: accordion card"

# Phase 4 — can run in parallel:
Task T011: "Update render.ts: expanded body"
Task T012: "Add POST /rescore endpoint"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: Foundational — TDD mandatory (T003–T006)
3. Complete Phase 3: User Story 1 (T007–T010)
4. **STOP and VALIDATE**: `npm run scan` then start server — cards render with headlines, facts, thumbnails in score order
5. This is the usable MVP; phases 4–7 add value without breaking it

### Incremental Delivery

1. Setup + Foundational → unit tests passing, DB migrated
2. User Story 1 → informative listing cards (MVP)
3. User Story 2 → expanded view with explanation + Re-score button
4. User Story 3 → image gallery in expanded view
5. User Story 4 → explanations stay current as profiles evolve
6. Polish → config key, docs updated, lint clean

---

## Notes

- [P] tasks operate on different files with no dependency on other incomplete tasks in the same phase
- TDD is **mandatory** for T003/T004 (constitution Principle V) — tests MUST fail before T005/T006 are implemented
- `renderEvidence()` already exists in `src/web/render.ts` — do NOT rewrite it; just call it inside the accordion expanded body in T011
- `listing_scores.evidence` is a JSON column containing `EvidenceItem[]` — read it via `JSON.parse()` in the server query, not from a separate table
- The Re-score button uses the same PRG (Post/Redirect/Get) pattern as the feedback buttons already in `render.ts`
- `crypto.createHash('sha256')` is a Node.js built-in — no new dependency needed for T015
- Commit after each phase checkpoint; each produces an independently runnable increment
