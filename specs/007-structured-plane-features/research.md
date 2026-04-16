# Research: Structured Plane Features

## Decision 1: Storage format for 20 structured indicators

**Decision**: Store all 20 indicators as a single JSON blob in a `listing_indicators` table column (`indicators TEXT`), not as 40 flat columns.

**Rationale**: Scoring and rendering always read all indicators together — there is no SQL query that filters by a single indicator value. JSON storage keeps the schema stable if indicator fields evolve, avoids a 40-column migration, and is consistent with the pattern already used for `raw_attributes`. The TypeScript scorer reads the blob and does equality matching in code.

**Alternatives considered**:
- 40 flat columns (20 value + 20 confidence): queryable via SQL but verbose, inflexible, and provides no benefit since all filtering is in TS
- EAV table (indicator_name, value, confidence rows): maximally flexible but complex to read, write, and validate atomically

---

## Decision 2: Orchestrator phase position

**Decision**: Indicator Deriver runs after Presenter (last phase), same position as the Presenter but in a subsequent step.

**Rationale**: User confirmed "same pattern as existing Presenter agent" (triggered at end of scan run). Indicators derived in cycle N are available for scoring in cycle N+1. This is a "warm-up" behaviour: new listings score without indicators on their first appearance, then with full indicators on all subsequent cycles. This is acceptable because the listings page doesn't disappear between cycles — the user sees updated scores on the next scan.

**Alternatives considered**:
- Before Matcher: would allow same-cycle scoring but requires indicator derivation to complete before scoring, adding latency to the critical path
- Independent timer: decoupled from scans but requires scheduler state; rejected as unnecessary complexity (Principle I)

---

## Decision 3: Indicator criterion evaluation — confidence weighting

**Decision**: For `indicator` criterion type, the confidence level of the stored indicator modulates the contribution: High = full weight, Medium = 75% of weight, Low = 50% of weight. Unknown/null = not satisfied (conservative, per spec).

**Rationale**: The spec explicitly states "Low confidence value contributes less to the score than High confidence" (US1 acceptance scenario 3). Using simple multipliers (1.0 / 0.75 / 0.5) is transparent and testable.

**Alternatives considered**:
- Binary (matched or not, ignoring confidence): simpler but violates the spec requirement
- Continuous confidence scoring: more nuanced but arbitrary; the three fixed multipliers are sufficient

---

## Decision 4: LLM prompt strategy for indicator derivation

**Decision**: Single Anthropic API call per listing using a detailed structured JSON prompt with all 20 indicator definitions, the FR-004/FR-004a equipment signal lists, and the raw_attributes as input. No agentic tool loop — pure generation.

**Rationale**: The indicator derivation is a classification/extraction task with no need for tool calls or multi-turn reasoning. A well-crafted single-shot prompt with the normative equipment signal lists from the spec will produce consistent output. Token budget: ~2,500 output tokens per listing (JSON with 20 indicators × 2 fields).

**Model**: `claude-sonnet-4-6` — judgment task requiring domain knowledge; Haiku does not have sufficient aviation domain knowledge for reliable IFR inference.

**Alternatives considered**:
- Agentic loop with tool calls: unnecessary complexity for a pure classification task
- Separate calls per indicator group: reduces output size but increases latency and cost

---

## Decision 5: Historian / dedup integration for stale marking

**Decision**: `src/services/dedup.ts` already calls `markListingAiStale` when a listing's raw_attributes change. Add a parallel call to `markIndicatorsStale` in the same location (both `upsert` for new listings and `update` for changed listings).

**Rationale**: The stale trigger must fire "whenever a listing's raw attributes are updated, regardless of the nature or extent of the change" (FR-011). `dedup.ts` is the single place where raw_attributes are written to the DB, making it the correct and complete insertion point.

---

## Decision 6: Indicator field names (canonical)

The 20 indicator fields stored in the JSON blob:

| Field key | Type | Scoreable via | Display notes |
|-----------|------|---------------|---------------|
| `aircraft_type_category` | categorical | value | — |
| `avionics_type` | categorical | value | — |
| `autopilot_capability` | categorical | value | — |
| `ifr_approval` | categorical | value | — |
| `ifr_capability_level` | categorical | value | — |
| `redundancy_level` | categorical | value | — |
| `engine_state` | categorical | value | — |
| `smoh_hours` | numeric | *display only* | Raw hours or null |
| `maintenance_cost_band` | categorical | value | — |
| `fuel_cost_band` | categorical | value | — |
| `condition_band` | categorical | value | — |
| `maintenance_program` | categorical | value | Named programme or "None" |
| `hangar_situation` | categorical | value | — |
| `ownership_structure` | categorical | value | — |
| `airworthiness_basis` | categorical | value | — |
| `registration_country` | categorical | value | — |
| `typical_range` | numeric + band | band | Raw nm value + Green/Amber/Red |
| `typical_cruise_speed` | numeric + band | band | Raw kts value + Green/Amber/Red |
| `typical_fuel_burn` | numeric + band | band | Raw GPH value + Green/Amber/Red |
| `passenger_capacity` | numeric + band | band | Raw seats + "2 seats"/"3–4 seats"/"5–6 seats"/"7+ seats" |

For `indicator` criteria, the `indicatorValue` is matched against `value` for categoricals and against `band` for banded numerics. `smoh_hours` is excluded from criterion matching.

---

## Decision 7: Display groupings

Five collapsible groups on the listing card:

| Group | Fields |
|-------|--------|
| Avionics & IFR | avionics_type, autopilot_capability, ifr_approval, ifr_capability_level |
| Engine & Airworthiness | engine_state, smoh_hours, condition_band, airworthiness_basis |
| Aircraft Profile | aircraft_type_category, passenger_capacity, typical_range, typical_cruise_speed, typical_fuel_burn |
| Costs | maintenance_cost_band, fuel_cost_band, maintenance_program |
| Provenance | registration_country, ownership_structure, hangar_situation, redundancy_level |
