# Contract: Profile YAML Schema

**Feature**: 002-interest-profiles | **Date**: 2026-04-05

---

## Overview

Each interest profile is a `*.yml` file in the `profiles/` directory at the repository root.
All files are loaded and validated at startup. Any file that fails validation prevents the tool
from starting, with an error identifying the offending file.

---

## Zod Schema (TypeScript)

The schema below is the authoritative validation contract. The implementation in
`src/services/profile-loader.ts` must match this exactly.

```typescript
import { z } from 'zod';

const MissionTypeCriterionSchema = z.object({
  type: z.literal('mission_type'),
  intent: z.string().min(1),
  weight: z.number().positive(),
  sub_criteria: z.array(z.string().min(1)).min(1),
});

const MakeModelCriterionSchema = z.object({
  type: z.literal('make_model'),
  make: z.string().min(1).nullable().default(null),
  model: z.string().min(1).nullable().default(null),
  weight: z.number().positive(),
}).refine(d => d.make !== null || d.model !== null, {
  message: 'make_model criterion requires at least one of make or model',
});

const PriceRangeCriterionSchema = z.object({
  type: z.literal('price_range'),
  min: z.number().nonnegative().default(0),
  max: z.number().positive(),
  weight: z.number().positive(),
}).refine(d => d.min <= d.max, { message: 'price_range min must be <= max' });

const YearRangeCriterionSchema = z.object({
  type: z.literal('year_range'),
  yearMin: z.number().int().min(1900),
  yearMax: z.number().int(),
  weight: z.number().positive(),
}).refine(d => d.yearMin <= d.yearMax, { message: 'year_range yearMin must be <= yearMax' });

const ListingTypeCriterionSchema = z.object({
  type: z.literal('listing_type'),
  listingType: z.enum(['full_ownership', 'share', 'any']),
  weight: z.number().positive(),
});

const ProximityCriterionSchema = z.object({
  type: z.literal('proximity'),
  maxDistanceKm: z.number().positive(),
  weight: z.number().positive(),
});

const ProfileCriterionSchema = z.discriminatedUnion('type', [
  MissionTypeCriterionSchema,
  MakeModelCriterionSchema,
  PriceRangeCriterionSchema,
  YearRangeCriterionSchema,
  ListingTypeCriterionSchema,
  ProximityCriterionSchema,
]);

export const InterestProfileSchema = z.object({
  name: z.string().min(1),
  weight: z.number().nonnegative(),  // 0 = inactive; positive = active
  description: z.string().optional(),
  min_score: z.number().min(0).max(100).default(0),
  intent: z.string().optional(),     // Original high-level intent (FR-012)
  criteria: z.array(ProfileCriterionSchema).min(1),
});

export type InterestProfileConfig = z.infer<typeof InterestProfileSchema>;
```

---

## YAML File Example

```yaml
name: "IFR Touring"
weight: 1.0
description: "IFR-capable aircraft for UK and European touring"
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

---

## Validation Rules

| Rule | Behaviour on violation |
|------|----------------------|
| File is not valid YAML | Startup error with filename and YAML parse error |
| File fails Zod validation | Startup error with filename and all Zod issues |
| `criteria` is empty | Startup error: "profiles/X.yml: criteria must have at least 1 item" |
| `make_model` with no make and no model | Startup error: "make_model criterion requires at least one of make or model" |
| `price_range.min > max` | Startup error: "price_range min must be <= max" |
| `year_range.yearMin > yearMax` | Startup error: "year_range yearMin must be <= yearMax" |
| `weight: 0` | Valid — profile is inactive; excluded from scoring |

---

## File naming

- File name has no semantic meaning beyond uniqueness.
- Convention: `profiles/<slug>.yml` where `<slug>` is kebab-case from the profile name (e.g., `ifr-touring.yml`).
- Any `*.yml` file in `profiles/` is loaded. Files starting with `_` are ignored (reserved for templates/examples).

---

## Timestamped backups

When a weight suggestion is accepted (FR-022), the relevant profile file is rewritten atomically:
1. Write new content to `profiles/<slug>.yml.tmp`
2. Rename original to `profiles/<slug>.yml.<ISO8601>.bak` (e.g., `ifr-touring.yml.2026-04-05T120000Z.bak`)
3. Rename `.tmp` to `profiles/<slug>.yml`

Backup files are NOT loaded at startup (only `*.yml` files without `.bak` extension are loaded).
