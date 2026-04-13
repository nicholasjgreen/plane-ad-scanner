# Quickstart: Full Page Listing Details (006)

## What This Feature Does

After every scan, the scanner now follows each listing's detail page URL and extracts the
full aircraft specification (total time, engine time, avionics, damage history, seller notes,
all images). This enriched data is used for scoring and AI explanation generation within the
same scan run.

## Prerequisites

- Feature 004 (listing-presentation) complete and merged
- `config.yml` with at least one enabled site
- `ANTHROPIC_API_KEY` set in environment

## Running a Scan

```bash
# Docker (recommended)
docker compose run --rm scan

# Direct (if Node.js installed locally)
npm run scan
```

The scan now has an additional phase between dedup and scoring:

```
[SCRAPER] Fetching search results pages...
[DETAIL FETCHER] Fetching 23 listing detail pages (5 concurrent)...
[MATCHER] Scoring 23 listings...
[PRESENTER] Generating headlines for 12 pending listings...
```

## Verifying the Feature

After a scan, check that detail-page data was captured:

```bash
# Open the SQLite DB
sqlite3 data/listings.db

-- Check a listing has rich attributes
SELECT id, make, model, json_extract(raw_attributes, '$.total_time') AS total_time,
       thumbnail_url IS NOT NULL AS has_image
FROM listings LIMIT 5;

-- Count listings with images
SELECT COUNT(*) FROM listings WHERE thumbnail_url IS NOT NULL;

-- Check listing_ai status after scan (should be 'ready' for most)
SELECT status, COUNT(*) FROM listing_ai GROUP BY status;
```

Expected after a successful scan:
- `raw_attributes` contains keys beyond make/model/year (e.g. `total_time`, `engine_time`)
- `thumbnail_url` is non-null for listings whose detail pages had photos
- `listing_ai.status` shows `ready` for listings the Presenter processed

## Failure Handling

If a detail-page fetch fails (404, timeout, anti-bot block), the listing is stored with
search-results data only and the scan continues. Check the logs:

```bash
# Docker logs
docker compose logs app | grep "Detail fetcher"

# Direct run — stderr
npm run scan 2>&1 | grep "detail"
```

Failed fetches do NOT reset the listing's AI explanation (existing explanation preserved).

## Testing

```bash
# Run all tests (includes unit tests for detail fetch merge logic)
docker compose run --rm -e NODE_ENV=test app npm test
```

The unit tests for `src/agents/detail-fetcher.ts` use an injectable `fetchHtml` mock so no
real HTTP calls are made. Integration tests verify the orchestrator phase ordering.

## Configuration

No new config keys. The detail fetcher uses the existing `agent.token_budget_per_run` as
its overall budget reference. Concurrency is fixed at 5 (not configurable in v1).
