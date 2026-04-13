# Implementation Plan: Full Page Listing Details

**Branch**: `006-full-page-listings` | **Date**: 2026-04-13 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/006-full-page-listings/spec.md`

## Summary

After discovering listings from search results pages, the scanner fetches each listing's detail page URL to extract the full aircraft specification and all images. This runs as a new phase in the existing orchestrator (between historian/dedup and the matcher), using a local Ollama model (qwen2.5 or similar) via the OpenAI-compatible endpoint for LLM extraction. Enriched attributes flow directly into scoring and AI explanation generation within the same scan run. Max concurrency is 5 parallel fetches. `fetchHtml` retries on HTTP 429 with exponential backoff (up to 3 attempts). No new database tables.

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js LTS v20+  
**Primary Dependencies**: `@anthropic-ai/sdk` (existing), `better-sqlite3` (existing), `express` (existing), `openai` (add if not already present from verifier-ollama work)  
**Storage**: SQLite (`./data/listings.db`) — no migration needed; enriches existing `raw_attributes`, `thumbnail_url`, `all_image_urls` columns  
**Testing**: Vitest (existing)  
**Target Platform**: Linux server (Docker) / WSL2 local  
**Project Type**: Background service / web server  
**Performance Goals**: Detail fetching for 50 listings adds ≤ 60 seconds to scan time (5 concurrent HTTP + LLM calls)  
**Constraints**: Max 5 concurrent detail-page fetches; HTML trimmed to 40k chars; LLM output capped at 1024 tokens per listing  
**Scale/Scope**: 20–100 listings per site; single user

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity First | ✓ PASS | No new dependencies; bounded concurrency via simple batch loop; single new agent file |
| II. Resilience | ✓ PASS | `runDetailFetcher` never throws; orchestrator uses `Promise.allSettled`; failures log and continue |
| III. Observability | ✓ PASS | Detail fetch phase logs count, per-listing success/failure, token usage |
| IV. Config-Driven | ✓ PASS | No new config keys needed in v1; concurrency is a code constant (5) documented in spec |
| V. Test-First | ✓ PASS | Merge logic (deterministic) must be TDD; HTTP/LLM calls use injectable `fetchHtml` dep |
| VI. Agent Architecture | ✓ PASS | New `DetailFetcher` agent follows the single-responsibility, restricted-tools pattern; role documented |
| VII. Agent Controls | ✓ PASS | Haiku model; max_tokens: 1024; no tool loop (single call); no persistent state in agent |
| VIII. Living Documentation | ✓ PASS | `quickstart.md` produced in this plan; README update task included |

## Project Structure

### Documentation (this feature)

```text
specs/006-full-page-listings/
├── plan.md                         # This file
├── research.md                     # Phase 0 output
├── data-model.md                   # Phase 1 output
├── quickstart.md                   # Phase 1 output
├── contracts/
│   └── detail-fetcher-agent.md    # Phase 1 output
└── tasks.md                        # Phase 2 output (speckit.tasks)
```

### Source Code

```text
src/
├── agents/
│   ├── detail-fetcher.ts           # NEW — detail page fetch + LLM extraction
│   └── orchestrator.ts             # MODIFIED — add detail fetch phase
tests/
├── unit/
│   └── detail-fetcher.test.ts      # NEW — merge logic + output validation (TDD)
└── integration/
    └── orchestrator.test.ts        # MODIFIED — assert detail fetch phase runs
```

**No new files needed** in `src/db/`, `src/services/`, `src/web/`, or `src/types.ts` (other than a type export for `DetailFetchResult` which can live in `types.ts`).

## Agent Role: Detail Fetcher

| Property | Value |
|----------|-------|
| Responsibility | Fetch one listing detail page; extract attributes + images via LLM |
| Permitted tools | HTTP GET (via Node.js `fetch`) only |
| Model | Ollama model from `config.ollama.verification_model` (e.g. `qwen2.5:7b`) via OpenAI-compat client |
| Max turns | 1 (single `chat.completions.create` — no agentic loop) |
| State | Stateless — receives URL, returns structured result |
| Error handling | Never throws; always returns a result (with `error` field set on failure) |

## Orchestrator Phase Order (updated)

```
1. Scraper agents (parallel, all sites)
2. Historian/dedup — stores listings, populates allListingIds
3. [NEW] Detail fetcher — fetches detail pages for all listings in allListingIds
                          (5 concurrent; updates raw_attributes, images, marks AI stale on success)
4. Matcher — scores all listings (now with enriched attributes)
5. Presenter — generates headlines/explanations for pending listing_ai rows
```

## Merge Logic (detail page → DB)

```typescript
// Pseudo-code for the UPDATE after a successful detail fetch

const mergedAttributes = { ...existingAttributes, ...detailAttributes };
// detail keys overwrite existing only when non-empty string

const newThumbnail = detailImageUrls[0] ?? existingThumbnailUrl;
const newAllImages = detailImageUrls.length > 0
  ? JSON.stringify(detailImageUrls)
  : existingAllImageUrls;

db.prepare(`
  UPDATE listings SET
    raw_attributes = ?,
    thumbnail_url  = ?,
    all_image_urls = ?,
    make           = COALESCE(?, make),
    model          = COALESCE(?, model),
    year           = COALESCE(?, year),
    price          = COALESCE(?, price),
    location       = COALESCE(?, location),
    registration   = COALESCE(?, registration)
  WHERE id = ?
`).run(...);

markListingAiStale(db, listingId);  // Reset to pending → Presenter will regenerate
```

## Implementation Notes

### `src/agents/detail-fetcher.ts`

- Export `runDetailFetcher(input, ollamaClient, ollamaModel, deps?)` matching the contract in `contracts/detail-fetcher-agent.md`
- Uses `openai` npm package pointed at `config.ollama.url + '/v1'`; `apiKey: 'ollama'`
- `deps.fetchHtml` injectable (same pattern as `runScraper` — `ScraperDeps.fetchHtml`)
- **429 retry in `fetchHtml`**: if response status is 429, wait `delay * 2^attempt` ms (base 1000ms) then retry; up to 3 attempts total; on exhaustion return HTTP 429 error result
- HTML trim: `html.slice(0, 40_000)` (same as scraper)
- LLM call: `ollamaClient.chat.completions.create({ model: ollamaModel, messages: [...], ... })` — OpenAI message format
- LLM prompt targets a JSON object `{ attributes: {...}, imageUrls: [...] }` — single listing
- Relative URL normalisation: prepend `new URL(listingUrl).origin`
- Log: `logger.debug({ listingId, attributeCount, imageCount }, 'Detail fetcher: done')`
- On failure: `logger.warn({ listingId, err }, 'Detail fetcher: failed')` then return error result

### `src/agents/orchestrator.ts`

- Add `OrchestratorDeps.detailFetcher?` for test injection
- Add `DETAIL_CONCURRENCY = 5` constant
- New phase reads `allListingIds`, queries `listing_url` for each from DB, runs batched detail fetch
- Passes `ollamaClient` + `config.ollama.verification_model` through to each `runDetailFetcher` call
- On success result: run merge UPDATE + `markListingAiStale`
- On error result: log and skip (no DB change)
- Log summary: `logger.info({ total, succeeded, failed }, 'Detail fetch phase complete')`

### `src/types.ts`

- Add `DetailFetchResult` interface (export alongside existing types)

### Tests

- `tests/unit/detail-fetcher.test.ts` (TDD — write and confirm FAILING before implementing):
  - Attributes from detail page overwrite existing empty attributes
  - Attributes from detail page do NOT overwrite existing non-empty attributes with blank values
  - Image URLs are normalised to absolute
  - Relative image URLs are resolved against the listing's origin
  - When `fetchHtml` throws, returns result with `error` set and empty attributes/images
  - When LLM returns no JSON, returns result with `error` set
  - When LLM returns partial JSON (attributes only, no imageUrls), handles gracefully
  - When `fetchHtml` returns HTTP 429 once then succeeds, retries and succeeds
  - When `fetchHtml` returns HTTP 429 three times, returns error result after exhausting retries
- `tests/integration/orchestrator.test.ts` (extend existing):
  - When `detailFetcher` dep is provided, it is called for each listing in `allListingIds`
  - A detail fetcher failure for one listing does not abort the scan or prevent other listings from being processed

## Complexity Tracking

No violations. This feature adds one agent file and one orchestrator phase, which is the established pattern in this codebase.
