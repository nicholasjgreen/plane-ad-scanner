import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import pino from 'pino';

// ---------------------------------------------------------------------------
// Zod schema — matches contracts/config-schema.md exactly
// ---------------------------------------------------------------------------

const CriterionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('type_match'),
    pattern: z.string().min(1),
    weight: z.number().positive(),
  }),
  z.object({
    type: z.literal('price_max'),
    max: z.number().positive(),
    weight: z.number().positive(),
  }),
  z.object({
    type: z.literal('price_range'),
    min: z.number().nonnegative(),
    max: z.number().positive(),
    weight: z.number().positive(),
  }),
  z.object({
    type: z.literal('year_min'),
    yearMin: z.number().int().min(1900),
    weight: z.number().positive(),
  }),
  z.object({
    type: z.literal('year_range'),
    yearMin: z.number().int().min(1900),
    yearMax: z.number().int(),
    weight: z.number().positive(),
  }),
  z.object({
    type: z.literal('location_contains'),
    locationPattern: z.string().min(1),
    weight: z.number().positive(),
  }),
]);

const SiteSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().default(true),
});

const ConfigSchema = z
  .object({
    schedule: z.string().nullable().default('0 */6 * * *'),
    web: z
      .object({
        port: z.number().int().min(1).max(65535).default(3000),
      })
      .default({}),
    agent: z
      .object({
        token_budget_per_run: z.number().int().positive().default(50000),
        max_turns_per_agent: z.number().int().positive().default(10),
        scraper_model: z.string().default('claude-haiku-4-5-20251001'),
        matcher_model: z.string().default('claude-sonnet-4-6'),
        require_approval: z.boolean().default(false),
      })
      .default({}),
    criteria: z.array(CriterionSchema).default([]),
    sites: z.array(SiteSchema).default([]),
    ollama: z
      .object({
        url: z.string().url().default('http://localhost:11434'),
        verification_model: z.string().min(1).optional(),
        scraper_model: z.string().min(1).optional(),
        scoring_model: z.string().min(1).optional(),
        indicator_model: z.string().min(1).optional(),
      })
      .nullable()
      .default(null),
    home_location: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })
      .nullable()
      .default(null),
    feedback_min_count: z.number().int().positive().default(5),
  })
  .superRefine((data, ctx) => {
    data.criteria.forEach((criterion, i) => {
      if (criterion.type === 'price_range' && criterion.min > criterion.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `criteria[${i}]: price_range min (${criterion.min}) must be <= max (${criterion.max})`,
          path: ['criteria', i],
        });
      }
      if (
        criterion.type === 'year_range' &&
        criterion.yearMin > criterion.yearMax
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `criteria[${i}]: year_range yearMin (${criterion.yearMin}) must be <= yearMax (${criterion.yearMax})`,
          path: ['criteria', i],
        });
      }
    });
  });

export type Config = z.infer<typeof ConfigSchema>;
export type Criterion = z.infer<typeof CriterionSchema>;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export function loadConfig(overridePath?: string): Config {
  const filePath = resolve(overridePath ?? process.env.CONFIG_PATH ?? './config.yml');

  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read config at ${filePath}: ${(err as Error).message}`);
  }

  const result = ConfigSchema.safeParse(raw ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Logger (pino — structured JSON to stdout; level controlled by LOG_LEVEL)
// ---------------------------------------------------------------------------

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});
