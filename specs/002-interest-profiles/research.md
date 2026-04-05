# Research: Profile-Based Interest Scoring

**Feature**: 002-interest-profiles | **Date**: 2026-04-05

## 1. ICAO Coordinate Resolution

**Decision**: Bundle `airports.csv` from ourairports.com; load into in-memory Map at startup; cache resolved entries in `airfield_locations` SQLite table.

**Rationale**: ourairports.com publishes a free, public-domain `airports.csv` (~7 MB, ~74k rows). It includes: `ident` (ICAO code), `name`, `latitude_deg`, `longitude_deg`, `type`. No API key or runtime network call required. The relevant columns are `ident`, `latitude_deg`, `longitude_deg` — all numeric, parseable with `parseFloat`.

**Alternatives considered**:
- OpenAIP API — requires API key, runtime network, rate limits. Rejected.
- Google Maps geocoding — requires billing. Rejected.
- OurAirports REST API — network dependency at startup. Rejected in favour of bundled CSV.

**Key fields in airports.csv**:
```
ident,type,name,latitude_deg,longitude_deg,...
EGBJ,small_airport,Gloucestershire Airport,51.8942,-2.16722,...
EGLL,large_airport,London Heathrow Airport,51.4775,-0.461389,...
```

**In-memory index**: `Map<string, { name: string; lat: number; lon: number }>` keyed on uppercase ICAO code. Built once at module load time. Memory: ~74k entries × ~80 bytes ≈ 6 MB — acceptable.

**DB cache** (`airfield_locations` table): only stores codes actually seen in listing data, not the full 74k. Survives restarts; avoids re-parsing CSV on every lookup (though parsing is fast enough that the cache is primarily for auditability).

---

## 2. Distance Calculation (Haversine)

**Decision**: Implement Haversine formula inline in `src/services/icao.ts`; no npm dependency needed.

**Formula** (TypeScript):
```typescript
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
```

**Proximity scoring** (0–100, max_distance in km):
- If distance ≤ max_distance: `score = 100 × (1 − distance / max_distance)`
- If distance > max_distance: `score = 0`
- Linear decay from 100 at home to 0 at max_distance.

**Alternatives considered**: `geolib` npm package. Rejected — Haversine is 10 lines; no dependency warranted.

---

## 3. Profile YAML Schema Design

**Decision**: Discriminated union on `criterion.type` mirroring the existing `Criterion` schema in `config.ts`, extended with `mission_type`, `make_model`, `listing_type`, and `proximity` criterion types.

**Profile file format** (see `contracts/profile-schema.md` for full Zod schema):
```yaml
name: "IFR Touring"
weight: 1.0          # Profile-level relative weight (positive number); 0 = inactive
description: "IFR capability in UK and Europe"
min_score: 20        # 0–100, default 0
intent: "IFR touring in the UK and Europe"  # Original high-level intent (stored for FR-012)
criteria:
  - type: mission_type
    intent: "IFR certified avionics suite"
    weight: 3.0
    sub_criteria:
      - "GPS navigator capable of IFR approaches"
      - "Mode S transponder"
      - "Working attitude indicator"
  - type: make_model
    make: "Cessna"        # optional; null = any
    model: "172*"         # optional; wildcard * supported
    weight: 1.0
  - type: price_range
    min: 30000
    max: 80000
    weight: 2.0
  - type: year_range
    yearMin: 2000
    yearMax: 2025
    weight: 1.0
  - type: listing_type
    listingType: "full_ownership"   # "full_ownership" | "share" | "any"
    weight: 0.5
  - type: proximity
    maxDistanceKm: 150
    weight: 1.0
```

**Validation**: Zod schema in `src/services/profile-loader.ts`. Errors at startup include filename.

**Rationale**: Per-criterion weights enable nuanced scoring. `mission_type` stores both the user's intent and the researched `sub_criteria` (for transparency / re-running setup). Profiles are self-contained YAML files requiring no DB record.

---

## 4. Scoring Algorithm

**Decision**: Profile score = weighted sum of matched criteria / total weight × 100. Overall score = weighted average of per-profile scores. Min_score exclusion: listing shown if ≥ 1 active profile's score ≥ that profile's `min_score`.

**Per-profile score** (0–100):
```
profile_score = Σ(criterion_score × criterion_weight) / Σ(criterion_weight) × 100
```

Where `criterion_score` is:
- Deterministic types (make_model, price_range, year_range, listing_type, proximity): 0 or 1 (or continuous 0–1 for proximity)
- `mission_type`: float 0–1, confidence-weighted by LLM inference result

**Overall interest level**:
```
overall = Σ(profile_score × profile_weight) / Σ(active_profile_weights)
```

Only profiles with `weight > 0` contribute.

**Min_score exclusion**: After computing overall, apply: exclude listing if `profile_score < profile.min_score` for EVERY active profile.

---

## 5. Weight Suggestion Algorithm

**Decision**: Pure LLM generation — no statistical regression. WeightSuggester agent receives all feedback records as structured JSON context and produces human-readable suggestions.

**Rationale**: Sample sizes will be small (5–50 feedback records). Statistical regression is unreliable at this scale. LLM reasoning over concrete examples produces more interpretable rationale. The user must confirm before weights are applied (FR-022), so incorrect suggestions have limited blast radius.

**Minimum threshold**: `feedback_min_count` (default 5) is a count of non-"as expected" records — neutral feedback carries no signal and should not count toward the minimum.

**Alternatives considered**: Gradient descent on weights — complex, opaque, unreliable at low n. Rejected.

---

## 6. Profile Setup Flow (ProfileResearcher Agent)

**Decision**: Interactive CLI flow (`npm run setup-profile`) that invokes the ProfileResearcher agent with the user's intent string. No web GUI for setup.

**Why CLI**: Profile setup is a one-time or infrequent operation. A CLI is simpler than a web form with multi-turn LLM interaction. The user can run it any time and the resulting YAML is immediately live.

**Flow**:
1. Prompt user for profile name + intent description
2. ProfileResearcher agent returns proposed criteria JSON
3. CLI displays each criterion; user accepts (y), modifies (m), or rejects (r)
4. CLI writes `profiles/<slug>.yml` with confirmed criteria

**ProfileResearcher prompt**: Receives `{ intent: string }`, returns `{ proposed_criteria: ProposedCriterion[] }` where each criterion has `type`, `description`, `rationale`, and default values.

---

## 7. New Config Fields

**Decision**: Add to `config.yml` top-level schema:

```yaml
home_location:
  lat: 51.8942
  lon: -2.16722

feedback_min_count: 5   # minimum non-neutral feedback records before suggestions enabled
```

Zod schema additions to `ConfigSchema`:
```typescript
home_location: z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).nullable().default(null),
feedback_min_count: z.number().int().positive().default(5),
```

`home_location: null` (default) means proximity criterion always contributes 0 with a note.
