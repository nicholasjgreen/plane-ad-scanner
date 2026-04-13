# Research: Full Page Listing Details (006)

## Bounded Concurrency Without New Dependencies

**Decision**: Implement bounded concurrency as a simple batched `Promise.allSettled` loop — process listings in waves of N (where N = 5 per clarification), awaiting each wave before starting the next.

**Rationale**: The project constitution (Principle I) forbids speculative dependencies. A true semaphore (e.g. `p-limit`) is unnecessary here: aircraft listing sites have 20–100 listings, waves of 5 are short-lived, and the slight inefficiency vs. a real semaphore (idle slots when a batch member finishes early) is immaterial at this scale.

```typescript
// Pattern — no new import required
for (let i = 0; i < items.length; i += CONCURRENCY) {
  await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(fn));
}
```

**Alternatives considered**: `p-limit` npm package (rejected — adds dependency for negligible gain at this scale); sequential processing (rejected — too slow for 50 listings).

---

## LLM Prompt Design for Detail Page Extraction

**Decision**: Reuse the same LLM extraction pattern as the scraper (`claude-haiku-4-5-20251001`, single `messages.create` call, parse JSON array from response), but adapted for a single listing detail page.

**Rationale**: The scraper already proves that Haiku can reliably extract structured aircraft data from HTML. A detail page contains the same kind of data but more of it. One call per listing, capped at 4096 output tokens, HTML trimmed to 40,000 characters — same bounds as the existing scraper.

**Prompt design**:
- System: "You extract structured data from a single aircraft-for-sale listing page. Return ONLY a JSON object with `attributes` (flat key-value pairs of all labelled fields: make, model, year, price, registration, total_time, engine_time, avionics, damage_history, seller_notes, and any other labelled fields) and `imageUrls` (array of all `<img src>` and `og:image` URLs on the page, relative URLs prepended with origin)."
- User: extracted HTML trimmed to 40k chars
- Parse: extract `{ attributes: Record<string, string>, imageUrls: string[] }` from response

**Alternatives considered**: Cheerio-only (no LLM) for images + LLM for attributes (two-pass; rejected — adds complexity without meaningful saving since Haiku is cheap and one call is simpler); per-site parsers (rejected — violates Principle I, high maintenance cost).

---

## Attribute Merge Strategy

**Decision**: Use SQL `COALESCE(new_value, existing_value)` for top-level columns (`make`, `model`, `year`, `price`, `location`, `registration`, `thumbnail_url`). For `raw_attributes` JSON: parse both, shallow-merge (new keys win over existing blank values; existing non-blank keys survive if detail page omits them). For `all_image_urls`: replace entirely if detail page returns any images; keep existing if detail returns none.

**Rationale**: Prevents regression where a detail page that omits a field (e.g. registration not shown on detail page) would blank out a value correctly captured from search results. Matches the existing `COALESCE` pattern already used in `upsertListing`.

**Alternatives considered**: Full replace (rejected — loses data if detail page is partial); always-prefer-existing (rejected — never picks up price updates or new images).

---

## Insertion Point in Orchestrator

**Decision**: Detail fetching runs as a new phase between the historian pass and the matcher pass, in the same scan run:

```
Scraper(s) → Historian/dedup → [NEW] Detail fetcher → Matcher → Presenter
```

**Rationale**: 
- Runs after historian so we have the listing IDs and URLs already in the DB
- Runs before matcher so enriched `raw_attributes` are available for scoring
- Presenter runs last and picks up the `pending` status set by `markListingAiStale`

**Alternatives considered**: Post-matcher (rejected — scorer sees stale data); separate background job (rejected — over-engineering for a single-user tool, Principle I).

---

## AI Explanation Reset on Success

**Decision**: Call `markListingAiStale(db, listingId)` after each successful detail fetch. This is already implemented in `src/db/listing-ai.ts` and used by `dedup.ts` on listing updates.

**Rationale**: FR-009 requires this. `markListingAiStale` sets `status = 'pending'` without clearing existing headline/explanation, so the card shows the old explanation until the Presenter runs in the same scan and regenerates it.

On failure: no call to `markListingAiStale` — existing explanation preserved (per clarification Q3).

---

## No New Database Migration

**Decision**: No migration needed. All required columns (`raw_attributes`, `thumbnail_url`, `all_image_urls`) exist. `listing_ai` table exists. The detail fetcher only updates existing rows.

**Rationale**: The 004 migration already added image columns. `raw_attributes` is an existing JSON column. Nothing about this feature requires new schema.
