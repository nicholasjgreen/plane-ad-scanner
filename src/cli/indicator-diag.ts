/**
 * Indicator deriver diagnostic — runs the indicator deriver against a local
 * listing text file and prints the result to stdout.
 *
 * Parses key: value lines into rawAttributes and treats the full text as
 * "description", matching what the scraper produces for a full-page listing.
 *
 * Usage:
 *   docker compose run --rm scan npm run indicator-diag -- tests/fixtures/samples/afors/sr20.txt
 */
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, logger } from '../config.js';
import { runIndicatorDeriver } from '../agents/indicator-deriver.js';
import type { IndicatorDeriverInput } from '../types.js';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npm run indicator-diag -- <path-to-listing.txt>');
  process.exit(1);
}

const text = readFileSync(filePath, 'utf-8');

// Parse "Key: Value" lines into rawAttributes
const rawAttributes: Record<string, string> = { description: text };
for (const line of text.split('\n')) {
  const m = line.match(/^([A-Za-z][A-Za-z0-9 /()]+?):\s*(.+)$/);
  if (m) rawAttributes[m[1].trim()] = m[2].trim();
}

// Extract top-level fields the deriver uses for context
const registration = rawAttributes['Reg Number'] ?? rawAttributes['Registration'] ?? null;
const make         = rawAttributes['Make'] ?? null;
const model        = rawAttributes['Model'] ?? null;
const aircraftType = rawAttributes['Aircraft Type'] ?? null;

const input: IndicatorDeriverInput = {
  listingId: 'diag-001',
  rawAttributes,
  aircraftType,
  make,
  model,
  registration,
};

console.log('--- Input context ---');
console.log(`  Aircraft type : ${aircraftType ?? '(none)'}`);
console.log(`  Make          : ${make ?? '(none)'}`);
console.log(`  Model         : ${model ?? '(none)'}`);
console.log(`  Registration  : ${registration ?? '(none)'}`);
console.log(`  Attributes    : ${Object.keys(rawAttributes).filter(k => k !== 'description').join(', ')}`);
console.log('');

const config = loadConfig();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const model_id = config.agent.matcher_model;

logger.info({ model: model_id }, 'Running indicator deriver...');

const result = await runIndicatorDeriver(input, anthropic, model_id);

if (result.error) {
  console.error(`\n❌ Deriver failed: ${result.error}`);
  process.exit(1);
}

const ind = result.indicators!;
console.log('\n--- Indicators ---');

const groups: Array<{ title: string; fields: Array<[string, keyof typeof ind]> }> = [
  { title: 'Avionics & IFR', fields: [
    ['Avionics type',      'avionics_type'],
    ['Autopilot',          'autopilot_capability'],
    ['IFR Approval',       'ifr_approval'],
    ['IFR Capability',     'ifr_capability_level'],
  ]},
  { title: 'Engine & Airworthiness', fields: [
    ['Engine state',       'engine_state'],
    ['SMOH hours',         'smoh_hours'],
    ['Condition',          'condition_band'],
    ['Airworthiness',      'airworthiness_basis'],
  ]},
  { title: 'Aircraft Profile', fields: [
    ['Type category',      'aircraft_type_category'],
    ['Passengers',         'passenger_capacity'],
    ['Typical range',      'typical_range'],
    ['Cruise speed',       'typical_cruise_speed'],
    ['Fuel burn',          'typical_fuel_burn'],
  ]},
  { title: 'Costs', fields: [
    ['Maintenance cost',   'maintenance_cost_band'],
    ['Fuel cost',          'fuel_cost_band'],
    ['Maintenance prog.',  'maintenance_program'],
  ]},
  { title: 'Provenance', fields: [
    ['Reg. country',       'registration_country'],
    ['Ownership',          'ownership_structure'],
    ['Hangar',             'hangar_situation'],
    ['Redundancy',         'redundancy_level'],
  ]},
];

for (const group of groups) {
  console.log(`\n  ${group.title}`);
  for (const [label, key] of group.fields) {
    const indicator = ind[key] as Record<string, unknown>;
    const value = indicator.value ?? '—';
    const band  = 'band' in indicator ? ` (band: ${indicator.band ?? '—'})` : '';
    const conf  = indicator.confidence;
    console.log(`    ${label.padEnd(20)} ${String(value).padEnd(25)}${band}  [${conf}]`);
  }
}
