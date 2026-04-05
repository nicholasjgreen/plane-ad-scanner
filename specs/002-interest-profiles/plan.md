# Implementation Plan: Profile-Based Interest Scoring

**Branch**: `002-interest-profiles` | **Date**: 2026-04-05 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/002-interest-profiles/spec.md`

## Summary

Replace feature 001's flat criterion scorer with a multi-profile interest engine. Each profile is a
YAML file in `profiles/`; the updated Matcher agent scores listings against all active profiles
(using deterministic pure functions for most criteria, LLM inference for `mission_type`), computes
a weighted-average overall score written to `listings.match_score`, and persists per-profile
evidence. Two new web routes (`POST /feedback`, `GET /suggest-weights`) support a feedback loop
that feeds a WeightSuggester agent to propose profile weight refinements.

## Technical Context

**Language/Version**: TypeScript strict, Node.js LTS v20+  
**Primary Dependencies**: `@anthropic-ai/sdk`, `better-sqlite3`, `express`, `js-yaml`, `pino`, `zod` (all from feature 001); no new production dependencies  
**Storage**: SQLite (`./data/listings.db`) — migration 003 adds four tables; `profiles/*.yml` files for profile definitions  
**Testing**: Vitest (existing)  
**Target Platform**: Linux server (Docker on WSL2)  
**Project Type**: web-service + CLI  
**Performance Goals**: Scoring + evidence persisted per scan run; profile load < 1s at startup  
**Constraints**: No new production dependencies; bundled `airports.csv` (~7 MB) committed to repo  
**Scale/Scope**: Single user; tens of profiles max; hundreds of listings

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Profile YAML files (no profile DB); AI only for `mission_type`; no speculative abstractions |
| II. Resilience | PASS | Bad profile file → startup error (FR-007); ICAO lookup miss → 0 contribution, not error; matcher failure → existing scores retained |
| III. Observability | PASS | Profile load, per-listing scoring, and evidence all logged; feedback timestamps stored |
| IV. Config-driven | PASS | `home_location` and `feedback_min_count` in `config.yml`; `min_score` + criteria weights in profile YAML; no code changes needed for user customisation |
| V. TDD | PASS | `profile-scorer.ts` (deterministic criteria), ICAO distance in `icao.ts`, and `min_score` exclusion logic MUST be written test-first |
| VI. Agent Architecture | PASS | Matcher role updated; ProfileResearcher + WeightSuggester added — all documented below |
| VII. Agent Controls | PASS | All three agents have no tools (pure generation/logic); bounded by existing `max_turns_per_agent` |
| VIII. Living Docs | PASS | `quickstart.md` produced by this plan; README update required before feature is complete |

### Agent roles (updated table)

| Agent | Responsibility | Tools |
|-------|---------------|-------|
| Orchestrator | Coordinates scan; delegates; aggregates | State read, spawn sub-agents |
| Scraper (per site) | Fetch + parse raw listings | HTTP GET only |
| Matcher (updated) | Score listings against all active profiles; persist evidence | None |
| Historian | Deduplicates incoming listings; reads/writes seen-listings store | State read/write only |
| Presenter (feature 004) | Generates AI headlines and explanations | None |
| **ProfileResearcher** (new) | Given a high-level mission intent, returns proposed concrete criteria with explanations | None (LLM knowledge only) |
| **WeightSuggester** (new) | Given feedback data, proposes per-profile weight changes with plain-language reasoning | None (pure generation) |

## Project Structure

### Documentation (this feature)

```text
specs/002-interest-profiles/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── profile-schema.md
│   └── api-routes.md
└── tasks.md             ← /speckit.tasks output (not created here)
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── matcher.ts          (updated — profile-aware; calls profile-scorer + LLM for mission_type)
│   ├── orchestrator.ts     (minor update — pass profiles to matcher)
│   ├── profile-researcher.ts  (new — research agent)
│   └── weight-suggester.ts    (new — weight suggestion agent)
├── cli/
│   ├── scan.ts             (existing)
│   └── setup-profile.ts   (new — interactive profile setup CLI)
├── db/
│   └── migrations/
│       ├── 001-initial.sql         (existing)
│       ├── 002-site-management.sql (existing)
│       └── 003-interest-profiles.sql  (new)
├── services/
│   ├── dedup.ts            (existing, unchanged)
│   ├── icao.ts             (new — ICAO resolver + Haversine distance)
│   ├── profile-loader.ts   (new — loads + validates profiles/*.yml)
│   ├── profile-scorer.ts   (new — pure function scorer for deterministic criteria)
│   ├── scoring.ts          (existing — 001 scorer; still used as fallback if no profiles)
│   └── siteStatus.ts       (existing, unchanged)
├── web/
│   ├── render.ts           (updated — feedback forms on listing rows + suggest-weights page)
│   └── server.ts           (updated — POST /feedback, GET /suggest-weights, POST /suggest-weights/:action)
├── config.ts               (updated — home_location + feedback_min_count fields)
└── types.ts                (updated — ProfileScoreResult, EvidenceItem, FeedbackRecord, etc.)

data/
└── airports.csv            (new — bundled static ourairports.com data, committed to git)

profiles/
└── example-ifr-touring.yml (new — example profile, committed to git)

tests/
├── fixtures/
│   └── listing-page.html   (existing)
├── helpers/
│   └── db.ts               (existing — auto-picks up migration 003)
├── integration/
│   ├── scraper.test.ts     (existing, unchanged)
│   ├── web.test.ts         (updated — POST /feedback, GET /suggest-weights)
│   └── admin.test.ts       (existing, unchanged)
└── unit/
    ├── dedup.test.ts        (existing, unchanged)
    ├── icao.test.ts         (new — TDD: distance calc, code resolution, cache)
    ├── orchestration.test.ts (existing, unchanged)
    ├── profile-scorer.test.ts (new — TDD: all deterministic criterion types + min_score exclusion)
    ├── scoring.test.ts      (existing, unchanged)
    └── siteStatus.test.ts   (existing, unchanged)
```

**Structure Decision**: Single-project layout (Option 1), extending feature 001's `src/` tree. Profile YAML files live at repo root in `profiles/`; the bundled `airports.csv` lives in `data/`.

## Complexity Tracking

> No constitution violations — no entries required.

All additions are demanded by the spec. The `airports.csv` commit (~7 MB) is the simplest
implementation of "bundled static data" for a personal tool; downloading at runtime would add
network dependency on startup.
