# Data Model: Structured Plane Features

## New Table: `listing_indicators`

```sql
CREATE TABLE listing_indicators (
  listing_id   TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  indicators   TEXT,           -- JSON blob: StructuredIndicators object
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'ready', 'failed', 'stale')),
  derived_at   TEXT            -- ISO 8601 datetime of last successful derivation; NULL until first success
);

CREATE INDEX idx_listing_indicators_status ON listing_indicators(status);
```

### Status lifecycle

```
[new listing] → pending
     ↓ derivation succeeds
   ready
     ↓ raw_attributes updated (any change)
   stale
     ↓ re-derivation succeeds
   ready
     ↓ derivation fails
  failed  ←── retained values preserved; re-queued next cycle
```

---

## JSON Schema: `indicators` column

Each field is an `IndicatorValue` object. Three shapes:

```typescript
// Categorical indicator
{ value: string | null, confidence: 'High' | 'Medium' | 'Low' }
// null value = "Unknown"

// Numeric indicator (display only — no scoring)
{ value: number | null, confidence: 'High' | 'Medium' | 'Low' }

// Banded numeric indicator (display + scoring)
{ value: number | null, band: string | null, confidence: 'High' | 'Medium' | 'Low' }
// band is the scoring-ready category (e.g. "Green", "3–4 seats")
```

Full object structure:

```typescript
interface StructuredIndicators {
  // Avionics & IFR
  aircraft_type_category:  { value: string | null; confidence: Confidence };
  avionics_type:           { value: string | null; confidence: Confidence };
  autopilot_capability:    { value: string | null; confidence: Confidence };
  ifr_approval:            { value: string | null; confidence: Confidence };
  ifr_capability_level:    { value: string | null; confidence: Confidence };

  // Engine & Airworthiness
  engine_state:            { value: string | null; confidence: Confidence };
  smoh_hours:              { value: number | null; confidence: Confidence };  // display only
  condition_band:          { value: string | null; confidence: Confidence };
  airworthiness_basis:     { value: string | null; confidence: Confidence };

  // Aircraft Profile (performance = banded)
  aircraft_type_category:  { value: string | null; confidence: Confidence };
  passenger_capacity:      { value: number | null; band: string | null; confidence: Confidence };
  typical_range:           { value: number | null; band: string | null; confidence: Confidence };
  typical_cruise_speed:    { value: number | null; band: string | null; confidence: Confidence };
  typical_fuel_burn:       { value: number | null; band: string | null; confidence: Confidence };

  // Costs
  maintenance_cost_band:   { value: string | null; confidence: Confidence };
  fuel_cost_band:          { value: string | null; confidence: Confidence };
  maintenance_program:     { value: string | null; confidence: Confidence };

  // Provenance
  registration_country:    { value: string | null; confidence: Confidence };
  ownership_structure:     { value: string | null; confidence: Confidence };
  hangar_situation:        { value: string | null; confidence: Confidence };
  redundancy_level:        { value: string | null; confidence: Confidence };
}

type Confidence = 'High' | 'Medium' | 'Low';
```

---

## Extended: `ProfileCriterion` (src/types.ts)

Add `'indicator'` to the type union and two new optional fields:

```typescript
export interface ProfileCriterion {
  type: 'mission_type' | 'make_model' | 'price_range' | 'year_range'
      | 'listing_type' | 'proximity' | 'indicator';   // ← new
  weight: number;
  // ... existing fields unchanged ...
  indicatorField?: string;   // e.g. 'engine_state'       ← new
  indicatorValue?: string;   // e.g. 'Green'              ← new
}
```

### `indicator` criterion matching rules

- Match target: `indicators[indicatorField]`
- For categorical fields: matched if `indicator.value === indicatorValue`
- For banded numeric fields (`typical_range`, `typical_cruise_speed`, `typical_fuel_burn`, `passenger_capacity`): matched if `indicator.band === indicatorValue`
- `smoh_hours` is **excluded** — not a valid `indicatorField` (display only)
- If `indicator` is missing, or `value`/`band` is null: **not satisfied** (conservative)
- Confidence weighting: contribution × (High=1.0, Medium=0.75, Low=0.5)

### Config YAML example

```yaml
criteria:
  - type: indicator
    weight: 8
    indicatorField: engine_state
    indicatorValue: Green
  - type: indicator
    weight: 6
    indicatorField: ifr_capability_level
    indicatorValue: Enhanced
  - type: indicator
    weight: 4
    indicatorField: passenger_capacity
    indicatorValue: "3–4 seats"
```

---

## DB Module: `src/db/listing-indicators.ts`

Exports (mirroring `listing-ai.ts` pattern):

| Function | Purpose |
|----------|---------|
| `upsertListingIndicators(db, listingId)` | INSERT OR IGNORE with status='pending' |
| `setIndicatorsReady(db, listingId, indicators)` | Store JSON blob, set status='ready', set derived_at |
| `setIndicatorsFailed(db, listingId)` | Set status='failed'; preserve existing indicators blob |
| `markIndicatorsStale(db, listingId)` | Set status='stale' if row exists |
| `getPendingOrStaleListingIds(db)` | Return ids WHERE status IN ('pending','stale') |
| `getListingIndicators(db, listingId)` | Return parsed StructuredIndicators or null |
