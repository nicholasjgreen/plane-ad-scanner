# Implementation Plan: Listing Presentation

**Branch**: `004-listing-presentation` | **Date**: 2026-03-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-listing-presentation/spec.md`

## Summary

For each stored aircraft listing, the system generates an AI-written headline (from the listing's intrinsic data) and a plain-English explanation of why it matches the user's interest profiles. Both are produced at scan time by a new **Presenter agent** and stored in a dedicated `listing_ai` table. The web page (extended from feature 001) renders listings as expandable cards using native `<details>`/`<summary>` HTML — no JavaScript framework required. Expanding a card reveals the explanation and a full image gallery. Thumbnails are selected at scrape time using a priority heuristic (`og:image` first) and stored as URLs served directly as `<img src>` tags.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js LTS
**Primary Dependencies**: Anthropic Agent SDK (`@anthropic-ai/sdk`); existing web server and DB from feature 001
**Storage**: SQLite (feature 001's existing store) — two new columns on `listings`, one new `listing_ai` table
**Testing**: Vitest
**Target Platform**: Local Node.js server (localhost)
**Project Type**: Web application — server-rendered HTML backend + minimal-HTML frontend
**Performance Goals**: Expanded view renders within 3 seconds (SC-005); listing page loads within 2 seconds for 500 listings (SC-006 from feature 001)
**Constraints**: Presenter agent uses `claude-sonnet-4-6` (judgment task per constitution); image URLs stored and served directly — no proxying needed for localhost `<img src>` tags
**Scale/Scope**: Up to 500 stored listings; one `listing_ai` row per listing

## Constitution Check

### Pre-Design Gate

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✓ PASS | Presenter agent is a justified new capability. `<details>`/`<summary>` avoids JS framework. Separate `listing_ai` table is the simplest schema that supports independent regeneration. |
| II. Resilience | ✓ PASS | Presenter failures do not abort scan; `failed` status retains previous content; placeholder shown on first-ever failure. |
| III. Observability | ✓ PASS | Presenter agent token usage logged per run. Generation failures logged. `status` column queryable for operational visibility. |
| IV. Configuration-Driven | ✓ PASS | Presenter model overrideable in config. No new mandatory config keys. |
| V. Test-First | ✓ PASS | Presenter output validation, headline truncation, and placeholder logic are deterministic — must be TDD. Image extraction: integration test acceptable. |
| VI. Agent Architecture | ✓ PASS | New Presenter agent follows single-responsibility pattern. Runs in parallel per listing. No tools (pure generation). |
| VII. Agent Controls | ✓ PASS | Model: sonnet. Max turns: 3. Tools: none. Output schema-validated before DB insert. Runs within existing per-run token budget. |

**GATE: PASSED** — no violations.

### Post-Design Gate

Re-checked against completed design — no new violations introduced. Presenter agent follows the established role/tool restriction pattern exactly.

## Project Structure

### Documentation (this feature)

```text
specs/004-listing-presentation/
├── plan.md                        ← this file
├── research.md                    ← Phase 0 complete
├── data-model.md                  ← Phase 1 complete
├── quickstart.md                  ← Phase 1 complete
├── contracts/
│   ├── listing-card.md            ← data contracts for card + expanded view
│   └── presenter-agent.md        ← Presenter agent I/O contract
└── tasks.md                       ← Phase 2 output (/speckit.tasks — not yet generated)
```

### Source Code Layout

```text
plane-ad-scanner/
├── src/
│   ├── agents/
│   │   ├── orchestrator.ts        # extend: invoke Presenter after Matcher
│   │   ├── presenter.ts           # NEW: Presenter agent
│   │   └── scraper.ts             # extend: extract og:image + all_image_urls
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 004-listing-ai.sql # NEW: thumbnail_url, all_image_urls, listing_ai table
│   │   └── listing-ai.ts          # NEW: read/write listing_ai table
│   ├── services/
│   │   └── presentation.ts        # NEW: regenerate-ai CLI + profile-change detection
│   └── web/
│       ├── server.ts              # extend: pass ListingExpandedData to template
│       └── templates/
│           └── listings.html      # extend: <details> card pattern, explanation, gallery
└── tests/
    ├── unit/
    │   ├── presenter.test.ts      # NEW: output validation, truncation, placeholder logic
    │   └── listing-ai.test.ts    # NEW: status transitions, upsert logic
    └── integration/
        └── presentation.test.ts  # NEW: scan → AI generation → page render
```

**Structure Decision**: Extends the single-project layout from feature 001. All new code is additive — no restructuring of existing directories.

## Complexity Tracking

> No constitution violations — table intentionally empty.

## Phase 0: Research

**Status: Complete** → see [research.md](research.md)

| Unknown | Decision |
|---------|----------|
| Thumbnail selection | `og:image` meta first → first non-decorative `<img>` fallback |
| Image serving | Store URL, serve as `<img src>` directly — no CORS issue for localhost |
| Headline/explanation prompt | Few-shot, structured JSON output, single LLM call per listing |
| Card expand/collapse UI | Native `<details>`/`<summary>` — zero JavaScript required |
| AI content schema | Separate `listing_ai` table with FK; `status` + `model_ver` for regeneration lifecycle |

## Phase 1: Design

**Status: Complete**

### Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Data model | [data-model.md](data-model.md) | ✓ Done |
| Listing card contract | [contracts/listing-card.md](contracts/listing-card.md) | ✓ Done |
| Presenter agent contract | [contracts/presenter-agent.md](contracts/presenter-agent.md) | ✓ Done |
| Quickstart | [quickstart.md](quickstart.md) | ✓ Done |

### Presenter Agent Design Summary

| Parameter | Value |
|-----------|-------|
| Responsibility | Generate headline + explanation for one listing against active profiles |
| Model | `claude-sonnet-4-6` |
| Max turns | 3 |
| Tools | None |
| Parallelism | One instance per listing, all run concurrently |
| Output | `{ listingId, headline, explanation, status }` — schema-validated before insert |
| Failure behaviour | Set `listing_ai.status = 'failed'`; do not abort scan; retain previous content |

### Regeneration Logic

Explanations are regenerated at the **next scheduled scan** after profiles change. Detection: compare `listing_ai.model_ver` (encodes active profile version hash) against the current profile version. Any mismatch → set `status = 'pending'` before the Presenter pass.
