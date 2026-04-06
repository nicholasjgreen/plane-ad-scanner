import { z } from 'zod';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { InterestProfile, ProfileCriterion } from '../types.js';

// ---------------------------------------------------------------------------
// Zod schema (authoritative — matches contracts/profile-schema.md)
// ---------------------------------------------------------------------------

const MissionTypeCriterionSchema = z.object({
  type: z.literal('mission_type'),
  intent: z.string().min(1),
  weight: z.number().positive(),
  sub_criteria: z.array(z.string().min(1)).min(1),
});

const MakeModelCriterionSchema = z
  .object({
    type: z.literal('make_model'),
    make: z.string().min(1).nullable().default(null),
    model: z.string().min(1).nullable().default(null),
    weight: z.number().positive(),
  })
  .refine((d) => d.make !== null || d.model !== null, {
    message: 'make_model criterion requires at least one of make or model',
  });

const PriceRangeCriterionSchema = z
  .object({
    type: z.literal('price_range'),
    min: z.number().nonnegative().default(0),
    max: z.number().positive(),
    weight: z.number().positive(),
  })
  .refine((d) => d.min <= d.max, { message: 'price_range min must be <= max' });

const YearRangeCriterionSchema = z
  .object({
    type: z.literal('year_range'),
    yearMin: z.number().int().min(1900),
    yearMax: z.number().int(),
    weight: z.number().positive(),
  })
  .refine((d) => d.yearMin <= d.yearMax, { message: 'year_range yearMin must be <= yearMax' });

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

const ProfileCriterionSchema = z.union([
  MissionTypeCriterionSchema,
  MakeModelCriterionSchema,
  PriceRangeCriterionSchema,
  YearRangeCriterionSchema,
  ListingTypeCriterionSchema,
  ProximityCriterionSchema,
]);

const InterestProfileSchema = z.object({
  name: z.string().min(1),
  weight: z.number().nonnegative(),
  description: z.string().optional(),
  min_score: z.number().min(0).max(100).default(0),
  intent: z.string().optional(),
  criteria: z.array(ProfileCriterionSchema).min(1),
});

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Read all *.yml files (excluding *.bak) from `dir`, validate each against the
 * InterestProfileSchema, and return them as InterestProfile[].
 * Any validation failure throws with the offending filename in the message.
 */
export function loadProfiles(dir: string): InterestProfile[] {
  let files: string[];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.yml') && !f.endsWith('.bak'))
      .sort();
  } catch {
    // profiles/ directory doesn't exist — return empty list gracefully
    return [];
  }

  return files.map((file) => {
    const filePath = join(dir, file);
    let raw: unknown;
    try {
      raw = yaml.load(readFileSync(filePath, 'utf8'));
    } catch (err) {
      throw new Error(`${filePath}: YAML parse error — ${(err as Error).message}`);
    }

    const result = InterestProfileSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new Error(`${filePath}: validation failed — ${issues}`);
    }

    const data = result.data;
    return {
      name: data.name,
      weight: data.weight,
      description: data.description,
      min_score: data.min_score,
      intent: data.intent,
      criteria: data.criteria as ProfileCriterion[],
    } satisfies InterestProfile;
  });
}
