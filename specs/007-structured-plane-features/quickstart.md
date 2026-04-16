# Quickstart: Structured Plane Features (007)

## What this feature does

Derives 20 structured indicators for each listing (avionics type, IFR approval, engine state, etc.) from the raw scraped attributes using AI inference. Indicators feed the scoring engine and are displayed in collapsible groups on the listings page.

## Prerequisites

- Feature 001 running (SQLite DB, web server, scan scheduler)
- Feature 004 running (listing_ai table, Presenter agent)
- `ANTHROPIC_API_KEY` set in environment
- Docker Compose or Node.js v20+ with `npm ci`

## Running the tests

```bash
docker compose run --rm test
# or locally:
npm test
```

All new tests are in:
- `tests/unit/indicator-deriver.test.ts` — schema validation, Unknown defaults (TDD)
- `tests/unit/indicator-criterion.test.ts` — criterion matching + confidence weighting (TDD)
- `tests/unit/listing-indicators.test.ts` — DB module functions (TDD)
- `tests/integration/orchestrator.test.ts` — indicator deriver phase wiring

## Triggering indicator derivation manually

Indicators are derived automatically at the end of each scan run. To trigger for all listings immediately:

```bash
# Mark all listings as pending and run a scan
npm run rescore   # (existing command — re-runs scoring + presenter + indicator deriver)
```

Or trigger a one-off scan:

```bash
docker compose run --rm scan
```

## Validation scenarios

### SC-001: Indicators derived within one enrichment cycle

1. Add a new listing via the scraper (or seed directly via SQL)
2. Run a scan: `docker compose run --rm scan`
3. Check the `listing_indicators` table: `SELECT status, derived_at FROM listing_indicators WHERE listing_id = '<id>'`
4. Expected: `status = 'ready'`, `derived_at` is set

### SC-002: At least 12/20 indicators populated for detailed listings

1. Find a listing with rich `raw_attributes` (make, model, equipment list)
2. Run a scan to trigger derivation
3. Check: `SELECT indicators FROM listing_indicators WHERE listing_id = '<id>'`
4. Parse JSON and count non-null values: expect ≥ 12

### SC-003: Indicator criteria affect match scores

1. Add an `indicator` criterion to `config.yml`:
   ```yaml
   profiles:
     - name: IFR Pilot
       criteria:
         - type: indicator
           weight: 10
           indicatorField: ifr_capability_level
           indicatorValue: Enhanced
   ```
2. Run a scan
3. Compare scores of IFR-capable vs VFR-only listings — IFR-capable should score significantly higher

### SC-004: Page load time unchanged

1. Open the listings page in browser
2. Indicators are shown in collapsible groups — already stored, not computed on load
3. Chrome DevTools Network tab: no new slow requests during page load

### SC-005: Batch of 20 listings derives within 60 seconds

1. Seed 20 listings with `status = 'pending'` in `listing_indicators`
2. Trigger a scan and watch logs for "Indicator deriver phase complete"
3. Wall clock from first call to last: ≤ 60 seconds

### SC-006: Indicators refresh after re-scrape

1. Note current indicator values for a listing
2. Update `raw_attributes` directly in the DB (simulating a re-scrape with new data)
3. Run a scan
4. Check `listing_indicators.status` = 'ready' with updated `derived_at`

## Configuring indicator criteria

Add `type: indicator` criteria to any profile in `config.yml`:

```yaml
profiles:
  - name: My Profile
    weight: 1
    min_score: 50
    criteria:
      - type: indicator
        weight: 8
        indicatorField: engine_state
        indicatorValue: Green
      - type: indicator
        weight: 6
        indicatorField: ifr_approval
        indicatorValue: IFR Approved
      - type: indicator
        weight: 5
        indicatorField: aircraft_type_category
        indicatorValue: Single Piston
      - type: indicator
        weight: 4
        indicatorField: passenger_capacity
        indicatorValue: "3–4 seats"
```

Valid `indicatorField` values and their accepted `indicatorValue` options are documented in `specs/007-structured-plane-features/data-model.md`.
