# Implementation Plan: Plane Listing Scanner

**Branch**: `001-plane-listing-scanner` | **Date**: 2026-03-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-plane-listing-scanner/spec.md`

---

## Summary

Periodically scans aircraft-for-sale websites using parallel Scraper agents, deduplicates by registration number via the Historian agent, scores listings against user-defined config criteria via a built-in Matcher, persists all results to SQLite, and serves a read-only ranked listing page on localhost. The web page shows a "New" badge for listings from the most recent scan, a scan-error banner, and the last scan timestamp. Feature 002 supersedes the built-in Matcher; feature 003 supersedes the placeholder site management; feature 004 adds AI headlines and expanded views.

---

## Technical Context

**Language/Version**: TypeScript (strict mode) on Node.js LTS (v20+)
**Primary Dependencies**: `@anthropic-ai/sdk`, `express`, `cheerio`, `better-sqlite3`, `node-cron`, `zod`, `pino`
**Storage**: SQLite (`better-sqlite3`); file at `./data/listings.db`
**Testing**: Vitest
**Linting/Formatting**: ESLint + Prettier
**Target Platform**: Linux/macOS personal machine; localhost web page
**Project Type**: CLI + web server (single process)
**Performance Goals**: Web page loads in < 2 seconds for up to 500 listings (SC-006)
**Constraints**: Single-user; no distributed components; no external services beyond scanned sites and Anthropic API
**Scale/Scope**: Personal tool; O(100s) of listings; O(10) sites

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✓ PASS | `fetch` + `cheerio` for scraping; `better-sqlite3` (sync); Express for web; no ORMs, no build steps |
| II. Resilience over Completeness | ✓ PASS | FR-009: Orchestrator continues if a Scraper fails; error recorded in `scan_runs.error_summary`; surfaced as page banner |
| III. Observability | ✓ PASS | `pino` structured logging; token usage logged per agent call; `ScanRun` row written; errors surfaced on page |
| IV. Configuration-Driven | ✓ PASS | Sites, criteria, schedule, models, token budget all in `config.yml`; `ANTHROPIC_API_KEY` via env var; `zod` validation at startup |
| V. Test-First | ✓ PASS | Scoring engine (TDD required); deduplication logic (TDD required); Orchestrator flow (mocked agents, TDD required); scrapers: integration tests acceptable |
| VI. Agent Architecture | ✓ PASS | Orchestrator, Scraper (per site, parallel), Matcher (pure logic), Historian (state r/w); Presenter not in 001 scope |
| VII. Agent Controls | ✓ PASS | Configurable token budget + max turns; Haiku for scraping, Sonnet for matching; `requireApproval` mode; URL validation before persistence; schema validation before downstream handoff |

No constitution violations. Complexity Tracking table not required.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-plane-listing-scanner/
├── plan.md              ← This file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── scraper-agent.md
│   ├── matcher-agent.md
│   ├── web-routes.md
│   └── config-schema.md
└── tasks.md             ← Phase 2 output (/speckit.tasks — not yet generated)
```

### Source Layout

```text
plane-ad-scanner/
  src/
    agents/
      orchestrator.ts     # Coordinates full scan run; spawns Scrapers in parallel; invokes Matcher → Historian
      scraper.ts          # Per-site Scraper agent (HTTP GET + cheerio); one instance per site
      matcher.ts          # Built-in Matcher agent (pure scoring logic; no tools)
      historian.ts        # Historian agent: deduplication + SQLite persistence
    db/
      index.ts            # DB connection, migration runner (applies migrations/*.sql at startup)
      migrations/
        001-initial.sql   # listings, scan_runs, sites tables and all indexes
    services/
      scoring.ts          # Built-in scoring logic — TDD (scoring.test.ts)
      dedup.ts            # Registration-based deduplication logic — TDD (dedup.test.ts)
    web/
      server.ts           # Express server; GET / → listings page; GET /health
      templates/
        listings.html     # Server-rendered template: ranked listing rows, new badge, error banner, empty state
    cli/
      scan.ts             # One-off scan entry point (npm run scan)
    config.ts             # Config loading (js-yaml + zod validation) + env var checks
  tests/
    unit/
      scoring.test.ts         # TDD: all scoring rule types, edge cases, null fields
      dedup.test.ts           # TDD: registration match, no-registration fallback, update semantics
      orchestration.test.ts   # TDD: Orchestrator flow with mocked Scraper/Matcher/Historian responses
    integration/
      scraper.test.ts     # Smoke test: fetch + parse a known static HTML fixture
      web.test.ts         # GET /: HTML contains listings in score order; empty state; error banner
  config.yml.example
  .env.example
  data/                   # Created at runtime; gitignored
    listings.db
```

---

## Phase 0: Research Findings

All technical decisions resolved. See [research.md](research.md) for full rationale.

| Decision | Choice |
|----------|--------|
| HTML scraping | `node-fetch` + `cheerio` (HTTP GET only; Playwright deferred) |
| SQLite client | `better-sqlite3` (synchronous; no async complexity) |
| Scheduling | `node-cron` (in-process; shared process with web server) |
| Web server | `Express.js` with server-rendered HTML template literals |
| Built-in scoring | Rule-based weighted average from `config.yml`; score = 0–100 |
| Registration extraction | Structured field first → regex patterns (UK/US/EU) → null |
| Logging | `pino` (structured JSON to stdout; `LOG_LEVEL` env var) |
| Config validation | `zod` (TypeScript-native; clear field-level error messages) |

---

## Phase 1: Design Artifacts

### Data Model — [data-model.md](data-model.md)

Three tables:
- `listings` — deduplication key: `registration` (unique index where NOT NULL); `is_new` flag reset at scan start, set for listings found in current run
- `scan_runs` — one row per scan execution; `error_summary` JSON for failed sites
- `sites` — placeholder schema (seeded from `config.yml`); owned by feature 003 when integrated

### Contracts — [contracts/](contracts/)

| Contract | Purpose |
|----------|---------|
| [scraper-agent.md](contracts/scraper-agent.md) | `ScraperInput` / `ScraperOutput` / `RawListing`; registration extraction strategy |
| [matcher-agent.md](contracts/matcher-agent.md) | `MatcherInput` / `MatcherOutput`; scoring algorithm; criterion types |
| [web-routes.md](contracts/web-routes.md) | `GET /` template data shape; rendering rules; ordering |
| [config-schema.md](contracts/config-schema.md) | Full `config.yml` schema with zod types; env vars |

### Quickstart — [quickstart.md](quickstart.md)

Install → configure → `npm run scan` → `npm run serve`. Full validation scenario table included.

---

## Post-Design Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✓ PASS | No new abstractions beyond what the design requires |
| II. Resilience | ✓ PASS | `scan_runs.error_summary` + page banner covers all site failure paths |
| III. Observability | ✓ PASS | `pino` + `ScanRun` row; token logging per agent; errors on page |
| IV. Configuration-Driven | ✓ PASS | Full config schema with zod validation documented |
| V. Test-First | ✓ PASS | TDD scope explicit: `scoring.ts`, `dedup.ts`, Orchestrator flow |
| VI. Agent Architecture | ✓ PASS | 4 agents with correct roles, tool restrictions, and concurrency |
| VII. Agent Controls | ✓ PASS | All controls (budget, turns, models, approval, URL validation, schema validation) documented |
