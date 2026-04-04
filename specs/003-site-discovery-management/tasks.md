# Tasks: Site Discovery and Management

**Input**: Design documents from `/specs/003-site-discovery-management/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: TDD is **mandatory** per Constitution Principle V for `siteStatus.ts` (state machine). Integration tests for admin HTTP routes. Test tasks appear *before* their implementation tasks.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete sibling tasks)
- **[Story]**: Which user story this task belongs to (US1–US5)
- TDD tasks: marked `[TDD]` — write the test first, confirm it **fails**, then implement

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create new directories and shared types needed before any user story work begins.

- [x] T001 Add `VerifierOutput`, `DiscovererOutput`, and `DiscoveryCandidate` types to `src/types.ts` (extend existing file — do not create new one)
- [x] T002 [P] Create directory structure: `src/admin/` for routes and render; `src/agents/verifier.ts` and `src/agents/discoverer.ts` placeholders (empty exports); `tests/integration/admin.test.ts` placeholder

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: DB schema migration and site status service — all user stories depend on these. No user story work can begin until this phase is complete.

- [x] T003 Write `src/db/migrations/002-site-management.sql` — ALTER `sites` to add `status TEXT NOT NULL DEFAULT 'enabled' CHECK(...)`, `last_scan_outcome TEXT`, `total_listings INTEGER NOT NULL DEFAULT 0`; CREATE `verification_results` table; CREATE `discovery_candidates` table; CREATE `sync_enabled_on_insert` and `sync_enabled_on_update` triggers; all indexes — per `data-model.md`
- [x] T004 [TDD] Write failing unit tests for the site status state machine in `tests/unit/siteStatus.test.ts` covering: all 14 valid transitions from `contracts/site-status-service.md`; all invalid transitions throw `InvalidTransitionError`; `canTransition` returns correct boolean for all combinations; `disable` valid from every non-disabled status
- [x] T005 Implement `src/services/siteStatus.ts` — `SiteStatus` type, `SiteAction` type, `InvalidTransitionError` class, `applyTransition(current, action)` pure function, `canTransition(current, action)` pure function — make all T004 tests pass
- [x] T006 Update `src/db/index.ts` — remove `seedSitesFromConfig` function (superseded by admin UI in this feature); migration runner will now apply `002-site-management.sql` automatically on startup

**Checkpoint**: Migration applied, state machine tested and green, DB singleton clean — user story implementation can now begin.

---

## Phase 3: User Story 1 + 2 — Manually Add a Site & Disable a Site (Priority: P1)

These two stories share the same admin page and route handler; implementing them together is the natural MVP.

**Goal**: Admin can add a site (triggers verification automatically) and disable/enable any site. The site list page shows all sites with their status.

**Independent Test**: Add a site via `POST /admin/sites`. Confirm 302 redirect and site appears in `GET /admin` with `status = pending`. Disable it via `POST /admin/sites/:id/disable`. Confirm status changes to `disabled` in `GET /admin` and in DB. Re-enable via `POST /admin/sites/:id/enable`. Confirm status = `enabled`.

### TDD — Admin Route Integration Tests

- [x] T007 [TDD] Write failing integration tests for admin routes in `tests/integration/admin.test.ts` covering: `GET /admin` renders site list with status badges; `POST /admin/sites` adds site with `status='pending'` and redirects; `POST /admin/sites` rejects duplicate URL; `POST /admin/sites` rejects invalid URL; `POST /admin/sites/:id/disable` sets status to `disabled`; `POST /admin/sites/:id/enable` sets status to `enabled`

### Implementation

- [x] T008 [US1] [US2] Create `src/admin/render.ts` — `renderAdminPage(data: AdminPageData): string` using template literals (same pattern as `src/web/render.ts`); implement: site list table with name/URL/status badge/priority/total-listings/last-scan-outcome/last-verified columns; status badge CSS classes (`badge--pending`, `badge--enabled`, `badge--disabled`, `badge--failed`); action buttons per status per `contracts/admin-routes.md` action matrix; "Add site" inline form; "Run Discovery" button; discovery candidates section (hidden when empty); flash message banner; CSS in `<style>` block; `interface AdminPageData` exported from the same file
- [x] T009 [US1] [US2] Create `src/admin/routes.ts` — Express Router; `GET /admin` handler: query all sites ordered by status then priority, query pending candidates, render `renderAdminPage`; `POST /admin/sites` handler: validate name (non-empty) and URL (`^https?://`), check duplicate, INSERT site with `status='pending'`, trigger verification async (fire-and-forget), redirect with flash; `POST /admin/sites/:id/disable` and `POST /admin/sites/:id/enable` handlers using `applyTransition` from `siteStatus.ts`; flash message via query string `?msg=...&type=success|error`
- [x] T010 [US1] [US2] Mount admin router in `src/web/server.ts` — add `import { createAdminRouter } from '../admin/routes.js'` and `app.use('/admin', createAdminRouter(db))` after existing routes; make T007 integration tests pass

**Checkpoint**: US1+US2 complete — `GET /admin` shows site list; `POST /admin/sites` adds site; disable/enable actions work.

---

## Phase 4: User Story 3 — Verify a Site Can Yield Listings (Priority: P2)

**Goal**: When a site is added or re-verification is triggered, the Verifier agent extracts a sample of up to 5 listings. The sample is shown to the admin for review. Approve → enabled; Reject → verification_failed.

**Independent Test**: Seed a site with `status='pending'`. POST a mock verification result into `verification_results` (bypassing the agent). Visit `GET /admin` and confirm the sample listings are shown with Approve/Reject buttons. `POST /admin/sites/:id/verify/approve` → site status becomes `enabled`. `POST /admin/sites/:id/verify/reject` → site status becomes `verification_failed`.

- [x] T011 [US3] Implement `src/agents/verifier.ts` — `runVerifier(site, anthropic, config, deps?)` following the same pattern as `src/agents/scraper.ts`; haiku model; max 15 turns; HTTP GET tool; system prompt instructs to extract ≤5 sample listings and follow pagination if needed; returns `VerifierOutput`; on any exception returns `{ siteName, sampleListings: [], canFetchListings: false, failureReason: message, turnsUsed: 0 }`; `VerifierOutput` type defined in `src/types.ts` (T001)
- [x] T012 [US3] Add `POST /admin/sites/:id/verify`, `POST /admin/sites/:id/verify/approve`, and `POST /admin/sites/:id/verify/reject` route handlers to `src/admin/routes.ts` — trigger: sets status to `pending`, inserts `verification_results` row with `passed=NULL`, runs `runVerifier` async (writes result to `verification_results` on completion, updates `site.last_verified`), redirects; approve: calls `applyTransition('approve_verification')`, updates `site.status='enabled'` and `site.last_verified`; reject: calls `applyTransition('reject_verification')`, updates `site.status='verification_failed'`
- [x] T013 [US3] Update `src/admin/render.ts` — show latest `verification_results` row inline for each `pending` site: sample listing count, "Approve" and "Reject" buttons, timestamp; show "Verification in progress…" when `passed IS NULL`; show failure reason when `passed = 0`
- [x] T014 [US3] Add integration tests for verification review flow to `tests/integration/admin.test.ts` — seed site + verification_results row; `GET /admin` shows sample; `POST /admin/sites/:id/verify/approve` sets site status = `enabled`; `POST /admin/sites/:id/verify/reject` sets site status = `verification_failed`

**Checkpoint**: US3 complete — verification flow end-to-end; admin can approve or reject samples.

---

## Phase 5: User Story 5 — Review the Site List (Priority: P2)

**Goal**: Site list shows all sites in all states with listing count, last scan/verification outcome; pending discovery proposals in a separate section.

**Independent Test**: Seed sites in all four statuses plus pending discovery candidates. `GET /admin` should show each site with correct status badge, correct listing count (from `total_listings`), and last scan date. Pending candidates appear in a distinct section.

- [x] T015 [US5] [P] Update `src/agents/orchestrator.ts` — change `WHERE enabled = 1` to `WHERE status = 'enabled'` in the sites query; after each site scan, UPDATE `sites.last_scan_outcome = ?` (JSON `{date, listingsFound, error?}`) and UPDATE `sites.total_listings = (SELECT COUNT(*) FROM listings WHERE source_site = sites.name)` for each site attempted
- [x] T016 [US5] [P] Update `src/admin/render.ts` — ensure site list table shows `total_listings`, `last_scan_outcome` (parsed as `{date, listingsFound, error?}`), `last_verified` for every site; show `—` for null fields; last scan outcome error shown in red; all four status badges visually distinct (CSS already added in T008 — verify coverage)
- [x] T017 [US5] [P] Add integration test to `tests/integration/admin.test.ts` — seed sites in all 4 statuses; `GET /admin` HTML contains correct status badge text for each; listing counts visible; pending candidates section present only when candidates exist

**Checkpoint**: US5 complete — admin has full observability of all sites and their health.

---

## Phase 6: User Story 4 — Automatically Discover New Sites (Priority: P3)

**Goal**: Admin clicks "Run Discovery" → Discoverer agent searches the web → new candidates appear in the admin page → admin approves (site added + verification triggered) or dismisses (URL permanently suppressed).

**Independent Test**: Seed `discovery_candidates` with one `pending_review` and one `dismissed` candidate plus one existing site. Mock the Discoverer agent to return a new candidate and the dismissed candidate's URL. `POST /admin/discovery/run` → only the new candidate is inserted. Approve a candidate → site created with `status='pending'`. Dismiss a candidate → status set to `dismissed`. Re-run discovery → dismissed URL not inserted again.

- [x] T018 [US4] Implement `src/agents/discoverer.ts` — `runDiscoverer(input: DiscovererInput, anthropic, config, deps?)` using `claude-sonnet-4-6`; max 10 turns; `web_search_20250305` first-party tool; system prompt instructs agent to search for aircraft-for-sale marketplaces, exclude `existingUrls`, normalise URLs (`scheme://host` only), return JSON array of `{url, name, description}`; parse response; validate each candidate URL (`^https?://`); deduplicate; return `DiscovererOutput`; on error return `{ candidates: [] }`
- [x] T019 [US4] Add `POST /admin/discovery/run`, `POST /admin/discovery/candidates/:id/approve`, `POST /admin/discovery/candidates/:id/dismiss` route handlers to `src/admin/routes.ts` — run: query all known URLs (UNION of sites + discovery_candidates), run `runDiscoverer` async, INSERT candidates with `ON CONFLICT(url) DO NOTHING`, redirect; approve: set candidate `status='approved'`, INSERT site with `status='pending'`, trigger verification async, redirect; dismiss: set candidate `status='dismissed'`, redirect
- [x] T020 [US4] Add integration tests for discovery flow to `tests/integration/admin.test.ts` (mock Discoverer agent via deps injection) — run discovery inserts new candidates; existing site URL not re-inserted; dismissed candidate URL not re-inserted; approve candidate creates site with status `pending`; dismiss candidate sets status `dismissed`

**Checkpoint**: US4 complete — full discovery workflow functional.

---

## Phase 7: User Story 1 Additional — Priority Ordering (Priority: P1, FR-016)

**Goal**: Admin can set an integer priority for enabled sites; scanner processes sites in that order.

**Independent Test**: Set site A priority=1 and site B priority=2 via `POST /admin/sites/:id/priority`. Confirm `sites` table has correct values. Confirm `GET /admin/` shows sites ordered by priority. Confirm `orchestrator.ts` query returns sites in priority ASC order.

- [x] T021 [US1] Add `POST /admin/sites/:id/priority` route handler to `src/admin/routes.ts` — validate `priority` is a non-negative integer; UPDATE `sites.priority`; redirect with flash
- [x] T022 [US1] Update `src/admin/render.ts` — add priority number input field + "Set" button for `enabled` sites in site list; current priority value pre-populated in input

**Checkpoint**: All user stories complete and independently testable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, type-check, test run, and cleanup.

- [x] T023 [P] Run `npm test && npm run lint` inside Docker — fix any failures; ensure all existing feature 001 tests (52 tests) still pass alongside new tests; run `npm run build` (tsc --noEmit) to confirm no type errors
- [ ] T024 [P] Smoke-test all quickstart.md validation scenarios manually using Docker  ← manual: add site → verify → approve; disable site → scan → confirm no listings; dismiss candidate → run discovery → confirm not re-proposed; site list shows all four statuses correctly
- [x] T025 Update `config.yml.example` — add comment noting `sites:` array is deprecated when feature 003 is active; remove site entries or mark as legacy; update any relevant notes in `specs/003-site-discovery-management/quickstart.md` if setup steps changed during implementation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks all user stories** (migration + state machine must be in place)
- **Phase 3 (US1+US2)**: Depends on Phase 2 — builds the admin page foundation
- **Phase 4 (US3)**: Depends on Phase 3 (admin routes must exist to add verify/approve/reject handlers)
- **Phase 5 (US5)**: Depends on Phase 2; T015 (orchestrator update) is independent of Phase 3; T016/T017 depend on Phase 3 (admin render)
- **Phase 6 (US4)**: Depends on Phase 3 (admin router must exist for new routes)
- **Phase 7 (US1 priority)**: Depends on Phase 3 (admin router must exist)
- **Phase 8 (Polish)**: Depends on all desired stories complete

### User Story Dependencies

- **US1+US2 (Phase 3)**: First to implement — provides admin page skeleton all others extend
- **US3 (Phase 4)**: Depends on US1+US2 admin routes being present
- **US5 (Phase 5)**: T015 (orchestrator) is independent; T016/T017 (render) depend on Phase 3
- **US4 (Phase 6)**: Depends on Phase 3 admin router; independent of US3
- **Priority ordering (Phase 7)**: Depends on Phase 3

### Within Each Phase

- TDD tasks (`[TDD]`): write first, confirm failing, then implement
- `siteStatus.ts` (T005) must pass before any admin route handler that calls `applyTransition`
- Migration T003 must exist before any integration test that creates a test DB

---

## Parallel Opportunities

**Phase 2**: T003 (migration SQL), T004 (siteStatus tests), and T006 (db/index.ts cleanup) can all be written in parallel; T005 (siteStatus impl) follows T004

**Phase 3**: T008 (render.ts) and the test writing in T007 can be done in parallel; T009 (routes.ts) follows both; T010 (mount router) follows T009

**Phase 5**: T015 (orchestrator), T016 (render update), T017 (test) are all parallel once Phase 3 is done

---

## Parallel Example: Phase 3 (US1+US2)

```
# Start in parallel once Phase 2 is done:
Task T007: Write failing admin integration tests in tests/integration/admin.test.ts
Task T008: Create admin page template in src/admin/render.ts

# After T007 and T008:
Task T009: Create admin routes in src/admin/routes.ts (make T007 tests pass)

# After T009:
Task T010: Mount admin router in src/web/server.ts
```

---

## Implementation Strategy

### MVP (US1+US2 only — Phase 1 through Phase 3)

1. Phase 1: Add new types to `src/types.ts`
2. Phase 2: Migration + TDD state machine
3. Phase 3: Admin page (add site, disable, enable, list)
4. **STOP and VALIDATE**: Site can be added and disabled; admin page renders correctly; all tests green
5. This is a useful tool immediately — sites managed from the UI without editing config.yml

### Incremental Delivery

1. Phases 1–3 → Admin page with add/disable/enable (US1+US2) — MVP
2. Phase 4 (US3) → Verification flow with sample review
3. Phase 5 (US5) → Full site health dashboard
4. Phase 6 (US4) → Automated discovery
5. Phase 7 → Priority ordering
6. Phase 8 → Polish and validation

---

## Notes

- `[P]` tasks touch different files — safe to run in parallel
- TDD tasks (`[TDD]`) must be confirmed **failing** before implementation begins
- Constitution Principle V mandates TDD for `siteStatus.ts` (T004→T005); do not skip
- Verification and discovery are async (fire-and-forget from route handler) — no HTTP timeout risk
- The `enabled` column is kept in sync with `status` via SQLite trigger (T003) — feature 001's `WHERE enabled = 1` query still works until T015 updates the orchestrator
- All admin POST routes redirect (302) — never render HTML directly from a POST (PRG pattern)
