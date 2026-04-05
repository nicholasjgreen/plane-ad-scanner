# Data Model: Profile-Based Interest Scoring

**Feature**: 002-interest-profiles | **Date**: 2026-04-05

---

## Migration 003: `003-interest-profiles.sql`

### New Tables

#### `listing_scores`

Persists per-listing, per-profile scoring results. One row per listing per profile per scan run.

```sql
CREATE TABLE listing_scores (
  id           TEXT PRIMARY KEY,               -- UUID v4
  listing_id   TEXT NOT NULL REFERENCES listings(id),
  profile_name TEXT NOT NULL,                  -- Matches the `name` field in the profile YAML
  score        REAL NOT NULL,                  -- 0.0–100.0 (profile-level score)
  evidence     TEXT NOT NULL,                  -- JSON: EvidenceItem[]
  scored_at    TEXT NOT NULL                   -- ISO 8601 datetime
);

CREATE INDEX idx_listing_scores_listing ON listing_scores(listing_id);
CREATE INDEX idx_listing_scores_profile ON listing_scores(profile_name, score DESC);
```

**Evidence JSON shape** (`EvidenceItem[]`):
```json
[
  {
    "criterionName": "IFR certified avionics",
    "matched": true,
    "contribution": 42.9,
    "note": "GPS navigator and Mode S transponder mentioned in listing",
    "confidence": "high"
  },
  {
    "criterionName": "Price range £30k–£80k",
    "matched": false,
    "contribution": 0,
    "note": "Price not specified in listing",
    "confidence": null
  }
]
```

---

#### `listing_feedback`

Stores user feedback on ranked listings.

```sql
CREATE TABLE listing_feedback (
  id               TEXT PRIMARY KEY,           -- UUID v4
  listing_id       TEXT NOT NULL REFERENCES listings(id),
  rating           TEXT NOT NULL               -- 'more_interesting' | 'as_expected' | 'less_interesting'
                   CHECK (rating IN ('more_interesting', 'as_expected', 'less_interesting')),
  weights_snapshot TEXT NOT NULL,              -- JSON: { profileName: weight }[] at time of feedback
  created_at       TEXT NOT NULL               -- ISO 8601 datetime
);

CREATE INDEX idx_feedback_listing ON listing_feedback(listing_id);
CREATE INDEX idx_feedback_created ON listing_feedback(created_at DESC);
```

---

#### `weight_suggestions`

Records generated suggestions and user responses.

```sql
CREATE TABLE weight_suggestions (
  id              TEXT PRIMARY KEY,            -- UUID v4
  profile_name    TEXT NOT NULL,
  current_weight  REAL NOT NULL,
  proposed_weight REAL NOT NULL,
  rationale       TEXT NOT NULL,               -- Plain-language explanation
  feedback_count  INTEGER NOT NULL,            -- Number of feedback records supporting this
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at      TEXT NOT NULL,               -- ISO 8601 datetime
  resolved_at     TEXT                         -- NULL until accepted or rejected
);

CREATE INDEX idx_suggestions_profile ON weight_suggestions(profile_name, created_at DESC);
CREATE INDEX idx_suggestions_status ON weight_suggestions(status);
```

---

#### `airfield_locations`

Cache of ICAO codes resolved from the bundled `airports.csv`.

```sql
CREATE TABLE airfield_locations (
  icao_code TEXT PRIMARY KEY,                  -- 4-letter ICAO code (uppercase)
  name      TEXT NOT NULL,                     -- Airfield name
  lat       REAL NOT NULL,
  lon       REAL NOT NULL
);
```

---

### Existing table changes

None. `listings.match_score` continues to hold the overall interest level; the Matcher now writes
the weighted-average profile score to it (replacing 001's flat criterion scorer output). No column
rename is needed — the column semantics are unchanged.

---

## TypeScript Types (additions to `src/types.ts`)

```typescript
// --- Profile types (runtime representation after loading YAML) ---

export interface ProfileCriterion {
  type: 'mission_type' | 'make_model' | 'price_range' | 'year_range' | 'listing_type' | 'proximity';
  weight: number;
  // type-specific fields below:
  intent?: string;            // mission_type: original intent description
  sub_criteria?: string[];    // mission_type: researched concrete sub-criteria
  make?: string | null;       // make_model
  model?: string | null;      // make_model (wildcard * supported)
  min?: number;               // price_range
  max?: number;               // price_range
  yearMin?: number;           // year_range
  yearMax?: number;           // year_range
  listingType?: 'full_ownership' | 'share' | 'any';  // listing_type
  maxDistanceKm?: number;     // proximity
}

export interface InterestProfile {
  name: string;
  weight: number;             // Profile-level weight; 0 = inactive
  description?: string;
  min_score: number;          // 0–100, default 0
  intent?: string;            // Original high-level intent (stored for FR-012)
  criteria: ProfileCriterion[];
}

// --- Scoring output ---

export interface EvidenceItem {
  criterionName: string;
  matched: boolean;
  contribution: number;       // 0–100 (this criterion's contribution to profile score)
  note: string;
  confidence: 'high' | 'medium' | 'low' | null;  // null for deterministic criteria
}

export interface ProfileScore {
  profileName: string;
  score: number;              // 0–100
  evidence: EvidenceItem[];
}

export interface ProfileMatcherOutput {
  scores: Array<{
    listingId: string;
    overallScore: number;     // weighted average; written to listings.match_score
    profileScores: ProfileScore[];
  }>;
}

// --- Feedback ---

export type FeedbackRating = 'more_interesting' | 'as_expected' | 'less_interesting';

export interface FeedbackRecord {
  id: string;
  listingId: string;
  rating: FeedbackRating;
  weightsSnapshot: Record<string, number>;  // profileName → weight
  createdAt: string;
}

// --- Weight suggestions ---

export interface WeightSuggestion {
  id: string;
  profileName: string;
  currentWeight: number;
  proposedWeight: number;
  rationale: string;
  feedbackCount: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}
```

---

## Config additions (`src/config.ts`)

```typescript
// In ConfigSchema:
home_location: z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
}).nullable().default(null),
feedback_min_count: z.number().int().positive().default(5),
```

---

## Static Data

**`data/airports.csv`**: Bundled from ourairports.com. Committed to git. Key columns used:
- `ident` → ICAO code (4-letter, e.g. `EGBJ`)
- `name` → Airfield name
- `latitude_deg` → latitude (float)
- `longitude_deg` → longitude (float)
- `type` → airfield type (not filtered — all types included)

Loaded once at service module initialisation into `Map<string, { name: string; lat: number; lon: number }>`.

---

## Profile YAML File Format

Stored in `profiles/<slug>.yml`. All `*.yml` files in the directory are loaded at startup.

See `contracts/profile-schema.md` for the full Zod schema and validation rules.

**Example** (`profiles/example-ifr-touring.yml`):
```yaml
name: "IFR Touring"
weight: 1.0
description: "IFR-capable aircraft for touring in UK and Europe"
min_score: 20
intent: "IFR touring in the UK and Europe"
criteria:
  - type: mission_type
    intent: "IFR certified avionics suite"
    weight: 3.0
    sub_criteria:
      - "GPS navigator capable of IFR approaches"
      - "Mode S transponder"
      - "Working attitude indicator"
  - type: price_range
    min: 30000
    max: 100000
    weight: 2.0
  - type: year_range
    yearMin: 1990
    yearMax: 2025
    weight: 0.5
  - type: listing_type
    listingType: "full_ownership"
    weight: 1.0
```
