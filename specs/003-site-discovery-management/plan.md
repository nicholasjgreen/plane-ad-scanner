# Implementation Plan: Site Discovery and Management

**Branch**: `003-site-discovery-management` | **Date**: 2026-04-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/003-site-discovery-management/spec.md`

---

## Summary

Feature 003 adds a dedicated admin page at `/admin` that supersedes the config.yml site list from feature 001. Admins can add known sites (triggering automatic LLM-based verification), disable sites, re-verify sites, and trigger a manual discovery run that uses the Anthropic `web_search_20250305` first-party tool to surface new aircraft-for-sale marketplaces. All admin actions are performed via server-rendered HTML forms (GET/POST, full-page reload), consistent with feature 001's web architecture. A SQLite migration extends the `sites` table with a `status` column and creates two new tables (`verification_results`, `discovery_candidates`).

---

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js LTS v20
**Primary Dependencies**: `@anthropic-ai/sdk` v0.39+, `express`, `better-sqlite3`, `zod`, `pino`, `uuid` — all from feature 001; no new production dependencies
**Storage**: SQLite (`./data/listings.db`) — migration 002 extends existing schema
**Testing**: Vitest + in-memory SQLite helper (existing `tests/helpers/db.ts`)
**Target Platform**: Linux/macOS, Docker (same as feature 001)
**Project Type**: Web service (HTTP server + admin UI)
**Performance Goals**: Admin page loads < 500ms for ≤ 50 sites; verification completes within the Anthropic API timeout (~60s)
**Constraints**: No headless browser; no new API keys; server-rendered HTML only; no client-side JS
**Scale/Scope**: Single user, ≤ 50 sites, ≤ 200 discovery candidates

---

## Constitution Check

### Pre-Design Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✅ PASS | No new production deps; extends existing Express server with a sub-router; web_search via existing Anthropic API |
| II. Resilience | ✅ PASS | Verification and discovery run async; failures are logged and status-updated without crashing the server |
| III. Observability | ✅ PASS | All status transitions, agent invocations, and errors logged via pino |
| IV. Config-Driven | ✅ PASS | Sites migrate from config.yml to DB (admin-managed); scanner reads `WHERE status = 'enabled'` |
| V. Test-First | ✅ PASS | TDD mandatory for `siteStatus.ts` (state machine) |
| VI. Agent Architecture | ✅ PASS | Verifier agent (HTTP GET, haiku), Discoverer agent (web_search, sonnet); both follow established agent pattern |
| VII. Agent Controls | ✅ PASS | Verifier: HTTP GET only, max 15 turns; Discoverer: web_search only, max 10 turns; token budget applies |

**No complexity violations.** Complexity Tracking table not required.

### Post-Design Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✅ PASS | Pure function state machine (`siteStatus.ts`), simple Express sub-router, migration 002 extends existing tables |
| II. Resilience | ✅ PASS | Async verification/discovery; route handlers never block on LLM calls |
| III. Observability | ✅ PASS | `verification_results` table records every attempt; pino logs transitions |
| IV. Config-Driven | ✅ PASS | `sites` array in config.yml superseded; DB is the config store post-003 |
| V. Test-First | ✅ PASS | TDD: `siteStatus.test.ts` covers all 14 valid transitions and all invalid transition errors |
| VI. Agent Architecture | ✅ PASS | Verifier input/output schemas defined in contracts; Discoverer uses first-party tool |
| VII. Agent Controls | ✅ PASS | Discoverer filters known URLs before proposing; `ON CONFLICT DO NOTHING` as DB safety net |

---

## Project Structure

### Documentation (this feature)

```text
specs/003-site-discovery-management/
├── plan.md              ← This file
├── research.md          ← Phase 0 output ✓
├── data-model.md        ← Phase 1 output ✓
├── quickstart.md        ← Phase 1 output ✓
├── contracts/
│   ├── admin-routes.md           ← Phase 1 output ✓
│   ├── verifier-agent.md         ← Phase 1 output ✓
│   ├── discoverer-agent.md       ← Phase 1 output ✓
│   └── site-status-service.md    ← Phase 1 output ✓
└── tasks.md             ← Phase 2 output (/speckit.tasks — not yet generated)
```

### Source Code Changes

```text
src/
├── admin/
│   ├── routes.ts              NEW — Express router for /admin/*
│   └── render.ts              NEW — HTML template for admin page
├── agents/
│   ├── verifier.ts            NEW — Verification agent (HTTP GET, haiku, 15 turns)
│   ├── discoverer.ts          NEW — Discovery agent (web_search, sonnet, 10 turns)
│   ├── scraper.ts             UNCHANGED — feature 001
│   ├── historian.ts           UNCHANGED — feature 001
│   ├── matcher.ts             UNCHANGED — feature 001
│   └── orchestrator.ts        MODIFIED — reads WHERE status='enabled' instead of enabled=1
├── services/
│   ├── siteStatus.ts          NEW — pure state machine (TDD)
│   ├── dedup.ts               UNCHANGED — feature 001
│   └── scoring.ts             UNCHANGED — feature 001
├── db/
│   ├── index.ts               MODIFIED — remove seedSitesFromConfig (superseded by admin UI)
│   └── migrations/
│       ├── 001-initial.sql    UNCHANGED — feature 001
│       └── 002-site-management.sql  NEW — ALTER sites, CREATE verification_results, CREATE discovery_candidates
├── web/
│   ├── server.ts              MODIFIED — mount admin router at /admin
│   └── render.ts              UNCHANGED — feature 001
├── config.ts                  MODIFIED — remove sites from ConfigSchema (optional deprecation path)
└── types.ts                   MODIFIED — add VerifierOutput, DiscovererOutput, DiscoveryCandidate types

tests/
├── unit/
│   ├── siteStatus.test.ts     NEW — TDD for state machine
│   ├── dedup.test.ts          UNCHANGED
│   ├── orchestration.test.ts  UNCHANGED
│   └── scoring.test.ts        UNCHANGED
└── integration/
    ├── admin.test.ts          NEW — HTTP integration tests for /admin routes
    ├── scraper.test.ts        UNCHANGED
    └── web.test.ts            UNCHANGED
```

---

## Complexity Tracking

> No violations — table not required.

---

## Agent Roles

| Agent | File | Model | Max Turns | Tools |
|-------|------|-------|-----------|-------|
| Verifier | `src/agents/verifier.ts` | haiku | 15 | HTTP GET |
| Discoverer | `src/agents/discoverer.ts` | sonnet | 10 | `web_search_20250305` |

Existing agents from feature 001 are unchanged.

---

## Key Design Decisions (from research.md)

1. **Discovery search**: Anthropic `web_search_20250305` first-party tool — no new API key
2. **Verification**: Extends Scraper pattern with higher turn budget (15) and small-sample focus (≤5 listings)
3. **Status model**: TEXT CHECK constraint in SQLite; pure-function state machine in `siteStatus.ts` (TDD)
4. **Admin UI**: Express sub-router + template literals (matches feature 001 render.ts pattern)
5. **Legacy `enabled` column**: Kept in sync via SQLite trigger for feature 001 backward compatibility
6. **Discovery suppression**: Dismissed URLs stored in `discovery_candidates`; union query passes all known URLs to agent

---

## Integration Points

- `src/web/server.ts` mounts admin router: `app.use('/admin', adminRouter)`
- `src/agents/orchestrator.ts` updated to query `WHERE status = 'enabled'` (was `WHERE enabled = 1`)
- `src/db/index.ts` `seedSitesFromConfig` is removed; config.yml `sites` array is deprecated
- Feature 001 scan results update `sites.last_scan_outcome` and `sites.total_listings` (Orchestrator writes these)
