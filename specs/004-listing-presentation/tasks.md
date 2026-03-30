# Tasks: Listing Presentation

**Input**: Design documents from `/specs/004-listing-presentation/`
**Prerequisites**: plan.md ✓, spec.md ✓, data-model.md ✓, contracts/ ✓, research.md ✓, quickstart.md ✓

**Tests**: Included for deterministic logic per constitution Principle V (TDD mandatory for Presenter output validation, headline truncation, and placeholder logic). Integration test included for scan → generation → render flow.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration and project file structure — must be complete before anything else.

- [ ] T001 Create DB migration file at `src/db/migrations/004-listing-ai.sql` — add `thumbnail_url TEXT` and `all_image_urls TEXT` columns to `listings`; create `listing_ai` table with all columns; add indexes on `listing_ai(status)` and `listing_ai(model_ver)`
- [ ] T002 Wire the 004 migration into the DB initialisation sequence so it is applied automatically at startup (extend existing migration runner in `src/db/index.ts` or equivalent)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core DB module and Presenter agent — must be complete before ANY user story implementation. **TDD order: write failing tests first, then implement.**

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Write failing unit tests for the listing-ai DB module in `tests/unit/listing-ai.test.ts` — cover: upsert creates row with `status=pending`; upsert updates existing row; status transition rules (pending → ready, pending → failed, failed retains previous headline/explanation); querying all pending rows
- [ ] T004 [P] Write failing unit tests for Presenter agent output validation in `tests/unit/presenter.test.ts` — cover: headline truncated to 60 chars with `…` suffix; blank headline replaced with site+price fallback; blank explanation replaced with `"No summary available."`; status must be `'ok'` or `'partial'`; placeholder rendered when no profiles exist
- [ ] T005 Implement listing-ai DB module at `src/db/listing-ai.ts` — functions: `upsertListingAi(listingId, data)`, `getPendingListingIds()`, `getListingAiById(listingId)`, `setStatusFailed(listingId)`, `markAllPending()` (for regenerate-ai CLI); all tests in T003 must pass
- [ ] T006 Implement Presenter agent at `src/agents/presenter.ts` — model: `claude-sonnet-4-6`, max turns: 3, no tools; build prompt from `PresenterInput` schema; parse and schema-validate `PresenterOutput`; apply all validation rules (truncation, fallbacks); return validated output; on exception throw (caller sets `failed`); all tests in T004 must pass

**Checkpoint**: Run `npm test` — all unit tests must pass before proceeding to user story phases.

---

## Phase 3: User Story 1 — Scan Listings as Informative Cards (Priority: P1) 🎯 MVP

**Goal**: Each listing on the page renders as a card with a generated headline, make/model/year/price, and one thumbnail image (or placeholder). Cards are sorted by match score.

**Independent Test**: Seed the DB with listings (some with images, some without; some with listing_ai rows, some without). Start the web server. Confirm every listing has a card with: a non-empty headline (or the site+price fallback, never blank), the four key fields, and exactly one thumbnail or the placeholder image. Verify cards are ordered by matchScore descending.

- [ ] T007 [P] [US1] Extend scraper agent at `src/agents/scraper.ts` to extract `thumbnail_url` using the `og:image` meta tag → first non-decorative `<img>` fallback heuristic, and collect all `<img>` `src` values as a JSON array into `all_image_urls`; store both on the listings row
- [ ] T008 [P] [US1] Extend Orchestrator at `src/agents/orchestrator.ts` to invoke `PresenterAgent` in parallel for each listing after the Matcher pass (only for listings where `listing_ai.status = 'pending'`); handle Presenter exceptions per listing without aborting the scan run; log Anthropic token usage from each Presenter call
- [ ] T009 [US1] Extend the listings page template at `src/web/templates/listings.html` with the `<details>`/`<summary>` card pattern — `<summary>` renders: headline (fallback: `"Listing on {sourceSite} — {price}"` when null), make · model · year · price, and one `<img src="{thumbnailUrl}">` or a placeholder image; mark cards with a visual "new" indicator when `isNew = true`
- [ ] T010 [US1] Extend web server at `src/web/server.ts` to query `listing_ai` and join with `listings` data, building `ListingCardData[]` sorted by `matchScore` desc (ties broken by `dateFirstFound` desc), and pass the array to the listings template

**Checkpoint**: Run `npm run scan` then `npm run serve`. The listing page must display all cards with headlines, facts, and thumbnails.

---

## Phase 4: User Story 2 — Read a Plain-English Interest Explanation (Priority: P1)

**Goal**: Expanding a listing card reveals a plain-English explanation of why the listing matches the user's interests, followed by a visually subordinate structured evidence breakdown (per-profile scores and per-criterion match data from feature 002). A direct link to the source listing is also shown.

**Independent Test**: With at least one listing that has a `listing_ai` row in `ready` status and a profile score row in feature 002's tables, expand the card. Confirm: explanation text is shown (no bare spec numbers without context); the structured evidence section is present but visually subordinate (e.g. wrapped in a nested `<details>` collapsed by default); a "View original listing" link opens the source URL.

- [ ] T011 [US2] Extend `src/db/listing-ai.ts` to include a `getProfileScoresForListing(listingId)` function that reads per-profile scores and per-criterion evidence items from feature 002's `listing_scores` and `evidence_items` tables (read-only; no writes) and returns them as `ProfileScore[]`
- [ ] T012 [US2] Extend web server at `src/web/server.ts` to build the full `ListingExpandedData` shape — add `explanation`, `explanationStatus`, `profileScores`, `allImageUrls`, `location`, `listingDate`, and `rawAttributes` to the data passed to the template (calling `getProfileScoresForListing` for each listing)
- [ ] T013 [US2] Extend listings template at `src/web/templates/listings.html` with the expanded view body — (1) explanation section: render explanation text if `status=ready` and non-null; render `"Summary is being generated…"` if `status=pending`; render stale explanation or `"Summary not yet available"` if `status=failed`; (2) structured evidence section wrapped in a nested `<details>` element (collapsed by default) showing each `ProfileScore` with its criteria, match status, score contribution, and inference confidence note; (3) a direct "View original listing →" link to `sourceUrl`
- [ ] T014 [US2] Write integration test at `tests/integration/presentation.test.ts` — seed a listing, run the Orchestrator (Presenter pass), confirm `listing_ai` row has `status=ready` with non-empty headline and explanation, then render the web route and confirm the explanation text appears in the HTML

**Checkpoint**: Expand a card. All three expanded sections (explanation, evidence, source link) must be present and correct. Evidence section must be collapsed by default.

---

## Phase 5: User Story 3 — Browse Images in the Expanded View (Priority: P2)

**Goal**: All images scraped for a listing are browsable in the expanded view; a placeholder is shown when no images are available.

**Independent Test**: With a listing that has multiple entries in `all_image_urls`, expand the card. Confirm all images are rendered as `<img src="…">` tags, and that the first image is scrolled into view by default. With a listing that has no images, confirm the placeholder is shown rather than broken images or empty space.

- [ ] T015 [US3] Extend listings template at `src/web/templates/listings.html` with an image gallery section in the expanded view — iterate over `allImageUrls` and render each as `<img src="…">`; if `allImageUrls` is empty, render the single placeholder image; ensure first image is the default scroll position

**Checkpoint**: Expand listings with multiple images, one image, and no images. All three cases must render correctly.

---

## Phase 6: User Story 4 — Explanation Reflects Current Interest Profiles (Priority: P3)

**Goal**: When interest profiles change, all listing explanations are regenerated at the next scheduled scan. The previous explanation remains visible until regeneration completes. A manual regeneration CLI is also available.

**Independent Test**: Update a profile, run a scan, confirm that listings whose `listing_ai.model_ver` does not match the current profile version hash were set to `status=pending` before the Presenter pass, and that after the Presenter pass their `model_ver` is updated to the new hash. Confirm that a listing with no previously generated explanation shows the placeholder (not an error) during the pending period.

- [ ] T016 [US4] Implement profile-change detection in `src/services/presentation.ts` — compute a hash of the current active profiles (profile names + criteria + weights); query all `listing_ai` rows where `model_ver` does not match the current hash; set those rows to `status=pending`; return the count of rows reset
- [ ] T017 [US4] Extend Orchestrator at `src/agents/orchestrator.ts` to call the profile-change detection function (T016) at the start of each scan run, before the Presenter pass, so stale explanations are reset to `pending` and then regenerated in the same run
- [ ] T018 [US4] Implement regenerate-ai CLI at `src/cli/regenerate-ai.ts` — call `markAllPending()` (from `listing-ai.ts`), then run a Presenter-only scan pass (skip Scraper and Matcher) to regenerate all explanations immediately; expose as `npm run regenerate-ai`

**Checkpoint**: Run `npm run regenerate-ai` from the terminal. All `listing_ai` rows should transition from any status to `ready` (or `failed`). Confirm `model_ver` is updated.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Config support, final validation.

- [ ] T019 [P] Add `presenter_model` config key support in the config loading layer — read `agent.presenter_model` from `config.yml`; default to `claude-sonnet-4-6` if absent; pass the resolved model name into the Presenter agent constructor
- [ ] T020 Run `npm test && npm run lint` — all unit tests (T003–T004 scope) and integration test (T014) must pass; no lint errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user story phases
- **Phase 3 (US1)**: Depends on Phase 2 — can start once Foundational is complete
- **Phase 4 (US2)**: Depends on Phase 3 — explanation rendering requires cards to exist
- **Phase 5 (US3)**: Depends on Phase 3 — image gallery is part of the expanded view; `all_image_urls` must be stored first
- **Phase 6 (US4)**: Depends on Phase 4 — regeneration logic requires the full explanation pipeline to be in place
- **Phase 7 (Polish)**: Depends on all story phases being complete

### Within Phase 2

- T003 and T004 can run in parallel (different test files)
- T005 depends on T003 (tests must exist and fail first — TDD)
- T006 depends on T004 (tests must exist and fail first — TDD)
- T005 and T006 can run in parallel with each other (different source files, no mutual dependency)

### Within Phase 3

- T007 and T008 can run in parallel (different source files)
- T009 and T010 can start in parallel with T007/T008 (template and server files are independent)
- T010 depends on T005 (listing-ai.ts must exist) — already complete by Phase 3 start

### Parallel Opportunities

```bash
# Phase 2 — TDD setup:
Task T003: "Write failing unit tests for listing-ai.ts"
Task T004: "Write failing unit tests for presenter.ts"
# (then)
Task T005: "Implement listing-ai.ts"
Task T006: "Implement presenter.ts"

# Phase 3 — all four tasks can proceed in parallel once Phase 2 is done:
Task T007: "Extend scraper: og:image + all_image_urls"
Task T008: "Extend Orchestrator: parallel Presenter invocation"
Task T009: "Extend listings.html: <details> card pattern"
Task T010: "Extend web server: ListingCardData[]"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (TDD — tests before implementation)
3. Complete Phase 3: User Story 1 (listing cards)
4. **STOP and VALIDATE**: `npm run scan` then `npm run serve` — cards render with headlines, facts, and thumbnails
5. This is the usable MVP — all further phases add value without breaking it

### Incremental Delivery

1. Setup + Foundational → unit tests passing, DB migrated
2. User Story 1 → listing page shows informative cards (MVP)
3. User Story 2 → expand any card to read explanation and evidence
4. User Story 3 → browse all images in expanded view
5. User Story 4 → explanations stay current as profiles evolve
6. Polish → config support, full lint/test pass

---

## Notes

- [P] tasks operate on different files and have no dependency on other incomplete tasks in the same phase
- TDD is **mandatory** for T003/T004 (constitution Principle V) — tests MUST be written and confirmed failing before T005/T006 are implemented
- Feature 002's `listing_scores` and `evidence_items` tables are read-only dependencies — this feature never writes to them
- `listing_ai.model_ver` encodes the active profile version hash; a mismatch triggers regeneration
- `npm run regenerate-ai` (T018) sets all rows to pending and runs a Presenter-only pass — useful after prompt template changes
- Commit after each phase checkpoint; each checkpoint produces an independently runnable increment
