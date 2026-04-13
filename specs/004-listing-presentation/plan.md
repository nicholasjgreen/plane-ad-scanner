# Implementation Plan: Listing Presentation

**Branch**: `004-listing-presentation` | **Date**: 2026-04-13 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-listing-presentation/spec.md`

## Summary

Generate and display AI-powered headlines and plain-English interest explanations for aircraft
listings. Each listing card gets a system-generated headline (created once at scan time, stable),
a single thumbnail image, and key facts (make/model/year/price). Clicking a card expands it
in-place (accordion) to reveal a plain-English explanation of why the listing matches the user's
interest profiles, structured evidence, all available images, a direct source link, and a
"Re-score" button for on-demand regeneration.

Technical approach: new `Presenter` agent (LLM-driven, no direct DB access), a DB migration
adding `headline` and `image_urls` to `listings` and a new `listing_ai` table for explanations,
and updates to `render.ts` and `server.ts` to surface the accordion UX.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js LTS v20+
**Primary Dependencies**: `@anthropic-ai/sdk` (existing), `better-sqlite3` (existing), `express` (existing) — no new production dependencies
**Storage**: SQLite — migration 004 adds `headline TEXT` + `image_urls TEXT` to `listings`; new `listing_ai` table for explanations
**Testing**: Vitest (existing) — unit tests for Presenter output-parsing + prompt construction; integration test for Re-score endpoint
**Target Platform**: Linux server (Docker)
**Project Type**: Web service + background agents
**Performance Goals**: Expanded view loads and displays stored explanation within 3 seconds (SC-005)
**Constraints**: No new production dependencies; image URLs stored as strings only (no byte download/serving); Presenter agent MUST NOT read or write DB directly (constitution Principle VII)
**Scale/Scope**: Personal single-user tool, tens to low hundreds of listings

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | PASS | Accordion via `<details>`/`<summary>` — no JS framework. Image URLs only. No new deps. |
| II. Resilience over Completeness | PASS | Presenter failure shows placeholder text; scan still completes. Re-score failure handled gracefully. |
| III. Observability | PASS | Presenter invocations + token usage logged per constitution pattern. |
| IV. Configuration-Driven | PASS | Presenter model uses existing `agent.matcher_model` config key (or its own key if needed — both via config.yml). |
| V. Test-First for Core Logic | PASS | Prompt-building and output-parsing in Presenter are deterministic → TDD. LLM call → integration/mock. |
| VI. Agent Architecture | PASS | `Presenter` agent added to the mandatory role table (see research.md). Single responsibility: generate headline + explanation from inputs. No tools needed. |
| VII. Agent Controls | PASS | Presenter receives listing + profiles as input, returns text — no DB read/write. Max-turns cap applies. Orchestrator writes results. |
| VIII. Living Documentation | PASS | quickstart.md produced in Phase 1; README updated before feature complete. |

**No violations — no Complexity Tracking entries required.**

## Project Structure

### Documentation (this feature)

```text
specs/004-listing-presentation/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── web-routes.md    # Phase 1 output (update existing)
└── tasks.md             # Phase 2 output (speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── agents/
│   ├── presenter.ts          ← NEW: Presenter agent (headline + explanation)
│   ├── orchestrator.ts       ← UPDATE: call Presenter after Matcher
│   └── (scraper, historian, matcher — unchanged)
├── db/
│   └── migrations/
│       └── 004-listing-presentation.sql  ← NEW
├── services/
│   └── rescore.ts            ← NEW: on-demand Re-score service (calls Presenter, writes DB)
├── types.ts                  ← UPDATE: add imageUrls to RawListing; PresenterInput/Output types
└── web/
    ├── render.ts             ← UPDATE: accordion, thumbnail, explanation, images, Re-score button
    └── server.ts             ← UPDATE: POST /rescore endpoint; query explanation from listing_ai

tests/
├── unit/
│   └── presenter.test.ts     ← NEW: TDD — prompt formatting, output parsing
└── integration/
    └── rescore.test.ts       ← NEW: Re-score endpoint (seed DB, POST /rescore, assert DB updated)
```

## Complexity Tracking

*No violations requiring justification.*
