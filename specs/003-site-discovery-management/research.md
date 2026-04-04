# Research: Site Discovery and Management

**Feature**: 003-site-discovery-management
**Date**: 2026-04-04

---

## Decision 1: Automated Discovery — Web Search Mechanism

**Decision**: Use the Anthropic API's native `web_search_20250305` first-party tool via a Discoverer agent.

**Rationale**: `@anthropic-ai/sdk` v0.39.0 supports first-party tool types. The `web_search_20250305` tool is invoked by passing `{"type": "web_search_20250305"}` in the `tools` array — Anthropic executes the search server-side. This introduces zero new dependencies or API keys beyond what feature 001 already requires. The Discoverer agent uses `claude-sonnet-4-6` (judgment-quality model) to generate good search queries and evaluate which results are genuine aircraft-for-sale marketplaces.

**Alternatives considered**:
- DuckDuckGo HTML (`https://html.duckduckgo.com/html/?q=...`): No API key needed, but scraping a search engine HTML page is fragile and violates their ToS. Ruled out.
- Brave Search API / Google Custom Search: Require separate API keys. Constitution Principle I (no speculative dependencies). Ruled out.
- Hardcoded seed list: Zero discovery; defeats the purpose of US4. Ruled out.

---

## Decision 2: Verification Agent — Extending the Scraper Pattern

**Decision**: The Verifier agent is a distinct module (`src/agents/verifier.ts`) that follows the exact same pattern as the Scraper agent (HTTP GET tool, LLM extraction) but with a higher turn budget (up to 15 turns) and explicit guidance to follow pagination links and click-through listing pages.

**Rationale**: The clarification confirmed "no headless browser — extend existing LLM scraper agent with multi-turn tool use". A higher turn limit (15 vs 10) gives the verifier room to follow 2–3 pages of pagination. The output is a `VerificationSample` (up to 5 `RawListing` items) shown to the admin for review before the site is enabled.

**Alternatives considered**:
- Playwright/Puppeteer: Headless browser solves the interactive-page problem definitively, but the clarification explicitly ruled it out. Adds ~100MB dependency to Docker image.
- Reusing the Scraper agent directly: The Scraper runs per-scan and returns all listings; the Verifier is a one-shot check that returns a small sample. Different purpose, separate implementation keeps the Scraper clean.

---

## Decision 3: Site Status State Machine

**Decision**: Add a `status` TEXT column to the existing `sites` table via migration 002, with a SQLite CHECK constraint enforcing four values: `'pending'`, `'enabled'`, `'disabled'`, `'verification_failed'`. State transitions are implemented as a pure function service in `src/services/siteStatus.ts` (TDD-mandatory per Constitution Principle V).

**Valid transitions**:
```
pending           → enabled          (admin approves verification sample)
pending           → verification_failed (admin rejects sample)
enabled           → disabled         (admin disables)
enabled           → verification_failed (re-verify → admin rejects)
disabled          → enabled          (admin re-enables)
verification_failed → pending        (admin triggers re-verify)
```

**Rationale**: Keeping transitions in a pure function makes them trivially testable and prevents invalid transitions from being applied by mistake. SQLite CHECK constraint prevents invalid status values reaching the database.

---

## Decision 4: Admin UI Architecture

**Decision**: New Express router mounted at `/admin` with server-rendered HTML forms (GET/POST, full-page reload). HTML template functions in `src/admin/render.ts` (same pattern as `src/web/render.ts`). The admin router is imported and mounted in `src/web/server.ts`.

**Rationale**: The clarification confirmed "server-rendered HTML forms (GET/POST), consistent with feature 001; no client-side JS." The existing Express server is already running; a sub-router is the simplest extension. Template literals with HTML escaping are already established in `src/web/render.ts`.

**No authentication**: The spec confirms "Admin refers to the single personal user of the tool; no separate authentication or role-based access control." The `/admin` endpoint is available to anyone who can reach the server (localhost only by default).

---

## Decision 5: Discovery Candidate Suppression

**Decision**: A `discovery_candidates` table stores all proposals with a `status` column: `'pending_review'` | `'approved'` | `'dismissed'`. The Discoverer agent filters out any URL already present in `sites` OR in `discovery_candidates` (any status) before proposing it. The unique constraint on `url` enforces this at the DB level.

**Rationale**: Permanent suppression (FR-013, FR-009) requires that dismissed URLs are never re-proposed. Storing them in a table with `dismissed` status is the simplest durable approach. The Discoverer reads existing URLs before proposing, and the DB unique constraint is a safety net.

---

## Decision 6: Priority Ordering UI

**Decision**: A form on the admin site list allows the admin to set an integer priority for each enabled site. Lower integer = higher priority (processed first by the Orchestrator). No drag-and-drop.

**Rationale**: The spec notes "drag-and-drop reordering UI is out of scope for v1." A simple number input per site, submitting via `POST /admin/sites/:id/priority`, is sufficient.

---

## Decision 7: Migration Strategy

**Decision**: `src/db/migrations/002-site-management.sql` ALTER-adds columns to the existing `sites` table and creates `verification_results` and `discovery_candidates` tables. Applied automatically by the existing migration runner on startup.

**SQLite compatibility**: `ALTER TABLE … ADD COLUMN … CHECK …` is supported since SQLite 3.37.0. Node 20 bundles SQLite 3.43+. No risk.

**Config.yml `sites` array**: Feature 003 supersedes feature 001's site seeding from config.yml. After 003 is integrated, sites are managed solely through the admin UI. The `seedSitesFromConfig` function in `src/db/index.ts` will be removed or made a one-time import helper for migration purposes.
