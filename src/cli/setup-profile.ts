#!/usr/bin/env tsx
// Interactive CLI for creating a new interest profile via the ProfileResearcher LLM agent.
// Usage: npm run setup-profile

import { createInterface } from 'node:readline';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import yaml from 'js-yaml';
import { loadConfig, logger } from '../config.js';
import { runProfileResearcher } from '../agents/profile-researcher.js';
import { loadProfiles } from '../services/profile-loader.js';
import type { ProfileCriterion } from '../types.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const config = loadConfig();
  const anthropic = new Anthropic();
  const profilesDir = join(process.cwd(), 'profiles');

  console.log('\n🛩  Plane Ad Scanner — Profile Setup\n');

  const name = (await ask('Profile name (e.g. "IFR Tourer"): ')).trim();
  if (!name) { console.error('Name is required.'); process.exit(1); }

  const intent = (await ask('Describe what you\'re looking for in plain English:\n> ')).trim();
  if (!intent) { console.error('Intent is required.'); process.exit(1); }

  const weightStr = (await ask('Profile weight [1.0]: ')).trim();
  const weight = weightStr ? parseFloat(weightStr) : 1.0;
  if (isNaN(weight) || weight < 0) { console.error('Invalid weight.'); process.exit(1); }

  const minScoreStr = (await ask('Minimum score to show in results (0–100) [0]: ')).trim();
  const minScore = minScoreStr ? parseInt(minScoreStr, 10) : 0;

  console.log('\nResearching criteria for your intent...');
  const { proposed } = await runProfileResearcher(intent, anthropic, config);

  if (proposed.length === 0) {
    console.log('No criteria proposed. Please try again with a more specific intent.');
    rl.close();
    process.exit(1);
  }

  const acceptedCriteria: ProfileCriterion[] = [];

  console.log(`\n${proposed.length} criteria proposed. Review each:\n`);
  for (const crit of proposed) {
    console.log(`─────────────────────────────`);
    console.log(`Type:        ${crit.type}`);
    console.log(`Description: ${crit.description}`);
    console.log(`Rationale:   ${crit.rationale}`);
    console.log(`Defaults:    ${JSON.stringify(crit.defaults)}`);
    const action = (await ask('\n[A]ccept / [R]eject / [M]odify defaults? [A]: ')).trim().toUpperCase() || 'A';

    if (action === 'R') {
      console.log('→ Rejected.\n');
      continue;
    }

    let defaults = { ...crit.defaults };
    if (action === 'M') {
      const edited = (await ask(`Edit defaults (JSON): `)).trim();
      if (edited) {
        try {
          defaults = JSON.parse(edited) as Record<string, unknown>;
        } catch {
          console.log('Invalid JSON — using original defaults.');
        }
      }
    }

    // Build criterion from accepted/modified defaults
    const criterion = buildCriterion(crit.type, defaults);
    if (criterion) {
      acceptedCriteria.push(criterion);
      console.log('→ Accepted.\n');
    } else {
      console.log('→ Could not build criterion from defaults — skipped.\n');
    }
  }

  if (acceptedCriteria.length === 0) {
    console.log('No criteria accepted. Profile not created.');
    rl.close();
    process.exit(0);
  }

  const profileData = {
    name,
    weight,
    description: intent,
    min_score: minScore,
    intent,
    criteria: acceptedCriteria,
  };

  const slug = slugify(name);
  const filePath = join(profilesDir, `${slug}.yml`);

  if (existsSync(filePath)) {
    const overwrite = (await ask(`\n${filePath} already exists. Overwrite? [y/N]: `)).trim().toLowerCase();
    if (overwrite !== 'y') {
      console.log('Aborted.');
      rl.close();
      process.exit(0);
    }
  }

  writeFileSync(filePath, yaml.dump(profileData, { quotingType: '"', forceQuotes: false }), 'utf8');

  // Validate the written file
  try {
    loadProfiles(profilesDir);
    console.log(`\n✓ Profile saved to ${filePath}`);
    console.log(`  ${acceptedCriteria.length} criteria accepted.`);
  } catch (err) {
    console.error(`\n✗ Profile validation failed: ${(err as Error).message}`);
    process.exit(1);
  }

  rl.close();
}

function buildCriterion(type: string, defaults: Record<string, unknown>): ProfileCriterion | null {
  const weight = typeof defaults.weight === 'number' ? defaults.weight : 1.0;
  switch (type) {
    case 'make_model':
      return { type: 'make_model', make: (defaults.make as string | null) ?? null, model: (defaults.model as string | null) ?? null, weight };
    case 'price_range':
      return { type: 'price_range', min: Number(defaults.min ?? 0), max: Number(defaults.max ?? 100000), weight };
    case 'year_range':
      return { type: 'year_range', yearMin: Number(defaults.yearMin ?? 1990), yearMax: Number(defaults.yearMax ?? new Date().getFullYear()), weight };
    case 'listing_type':
      return { type: 'listing_type', listingType: (defaults.listingType as 'full_ownership' | 'share' | 'any') ?? 'any', weight };
    case 'mission_type':
      return { type: 'mission_type', intent: String(defaults.intent ?? type), sub_criteria: (defaults.sub_criteria as string[]) ?? [], weight };
    default:
      logger.warn({ type }, 'Unknown criterion type from researcher');
      return null;
  }
}

main().catch((err) => {
  logger.error({ err }, 'setup-profile failed');
  rl.close();
  process.exit(1);
});
