# Contract: Configuration Schema

**Feature**: 001-plane-listing-scanner
**Date**: 2026-03-30

---

## Overview

All user-facing behaviour is controlled via `config.yml` at the repository root. The file is validated at startup using `zod`; missing required fields or invalid values produce a clear error message and abort startup.

Secrets (`ANTHROPIC_API_KEY`) are supplied via environment variables only — never in `config.yml`.

---

## Schema

```yaml
# config.yml

# Cron expression for automatic scanning (node-cron format)
# Default: every 6 hours. Set to null to disable automatic scheduling.
schedule: "0 */6 * * *"

web:
  port: 3000          # Port for the web server (default: 3000)

agent:
  token_budget_per_run: 50000   # Max tokens across all agents in one scan run
  max_turns_per_agent: 10       # Max tool-call turns per agent invocation
  scraper_model: "claude-haiku-4-5-20251001"   # Model for Scraper agents
  matcher_model: "claude-sonnet-4-6"           # Model for Matcher agent
  require_approval: false       # When true, Orchestrator pauses after Matcher for user confirmation

# Interest criteria for the built-in scoring engine.
# Each criterion has a type, a weight (relative importance), and type-specific fields.
# Superseded by feature 002's InterestProfile system when integrated.
criteria:
  - type: type_match
    pattern: "cessna 172"   # Case-insensitive substring match against aircraft type/make/model
    weight: 3

  - type: price_range
    min: 20000
    max: 80000              # GBP
    weight: 2

  - type: year_min
    yearMin: 1990
    weight: 1

  - type: location_contains
    locationPattern: "yorkshire"
    weight: 1

# Sites to scan. Before feature 003 is installed, sites are defined here
# and seeded into the DB at first startup. Feature 003 takes over site management.
sites:
  - name: "Trade-A-Plane"
    url: "https://www.trade-a-plane.com/search?..."
    enabled: true

  - name: "Controller"
    url: "https://www.controller.com/listings/..."
    enabled: true
```

---

## TypeScript Schema (zod)

```typescript
import { z } from 'zod';

const CriterionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('type_match'),       pattern: z.string().min(1),              weight: z.number().positive() }),
  z.object({ type: z.literal('price_max'),         max: z.number().positive(),              weight: z.number().positive() }),
  z.object({ type: z.literal('price_range'),       min: z.number().nonnegative(), max: z.number().positive(), weight: z.number().positive() }),
  z.object({ type: z.literal('year_min'),          yearMin: z.number().int().min(1900),     weight: z.number().positive() }),
  z.object({ type: z.literal('year_range'),        yearMin: z.number().int().min(1900), yearMax: z.number().int(), weight: z.number().positive() }),
  z.object({ type: z.literal('location_contains'), locationPattern: z.string().min(1),     weight: z.number().positive() }),
]);

const SiteSchema = z.object({
  name:    z.string().min(1),
  url:     z.string().url(),
  enabled: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  schedule: z.string().nullable().default('0 */6 * * *'),
  web: z.object({
    port: z.number().int().min(1).max(65535).default(3000),
  }).default({}),
  agent: z.object({
    token_budget_per_run: z.number().int().positive().default(50000),
    max_turns_per_agent:  z.number().int().positive().default(10),
    scraper_model:        z.string().default('claude-haiku-4-5-20251001'),
    matcher_model:        z.string().default('claude-sonnet-4-6'),
    require_approval:     z.boolean().default(false),
  }).default({}),
  criteria: z.array(CriterionSchema).default([]),
  sites:    z.array(SiteSchema).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;
```

---

## Validation Errors

Startup aborts with a human-readable error if:
- `web.port` is not a valid TCP port number
- Any criterion has `min > max` (for range types)
- Any site URL is not a valid http/https URL
- `agent.token_budget_per_run` is 0 or negative

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | YES | Anthropic API key for all agent invocations |
| `LOG_LEVEL` | NO | Log verbosity: `trace`, `debug`, `info` (default), `warn`, `error` |
| `CONFIG_PATH` | NO | Override path to config.yml (default: `./config.yml`) |
