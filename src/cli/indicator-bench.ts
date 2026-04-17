/**
 * Indicator deriver benchmark — runs all fixture samples through the indicator
 * deriver and scores the output against expected values.
 *
 * Usage:
 *   docker compose run --rm scan npm run indicator-bench
 *   docker compose run --rm scan npm run indicator-bench -- --ollama qwen3:8b --url http://host.docker.internal:11434
 *   docker compose run --rm scan npm run indicator-bench -- --fixture sr20  (single fixture)
 *
 * Exit code 0 = all required fields passed; 1 = any failure.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { loadConfig, logger } from '../config.js';
import { runIndicatorDeriver } from '../agents/indicator-deriver.js';
import type { IndicatorDeriverInput, StructuredIndicators } from '../types.js';

function isAllNull(indicators: StructuredIndicators | undefined): boolean {
  if (!indicators) return true;
  return Object.values(indicators).every(
    (ind) => typeof ind === 'object' && ind !== null && (ind as Record<string, unknown>).value === null
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(__dirname, '../../tests/fixtures/samples');
const EXPECTED_DIR = join(SAMPLES_DIR, 'expected');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
let ollamaModel: string | undefined;
let ollamaUrl: string | undefined;
let fixtureFilter: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ollama' && args[i + 1])   { ollamaModel  = args[++i]; }
  else if (args[i] === '--url' && args[i + 1]) { ollamaUrl    = args[++i]; }
  else if (args[i] === '--fixture' && args[i + 1]) { fixtureFilter = args[++i]; }
  else if (!args[i].startsWith('--'))          { fixtureFilter = args[i]; }
}

// ---------------------------------------------------------------------------
// Expected value types
// ---------------------------------------------------------------------------
interface ExpectedValues {
  _fixture: string;
  _notes?: string;
  /** Fields that must match exactly. */
  required: Record<string, string | null>;
  /** Fields where any listed value is acceptable. */
  flexible: Record<string, Array<string | null>>;
  /** Fields whose value must be non-null (no specific value required). */
  non_null: string[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
type CheckResult = { field: string; status: 'pass' | 'fail' | 'warn'; expected: string; actual: string };

function scoreIndicators(
  indicators: StructuredIndicators,
  expected: ExpectedValues,
  fixtureFile: string
): { checks: CheckResult[]; required: number; passed: number } {
  const checks: CheckResult[] = [];

  for (const [field, expectedValue] of Object.entries(expected.required)) {
    const ind = indicators[field as keyof StructuredIndicators] as Record<string, unknown>;
    const actual = ind?.value ?? null;
    const pass = actual === expectedValue;
    checks.push({
      field,
      status: pass ? 'pass' : 'fail',
      expected: String(expectedValue),
      actual: String(actual),
    });
  }

  for (const [field, acceptableValues] of Object.entries(expected.flexible)) {
    const ind = indicators[field as keyof StructuredIndicators] as Record<string, unknown>;
    const actual = ind?.value ?? null;
    const pass = acceptableValues.includes(actual as string | null);
    checks.push({
      field,
      status: pass ? 'pass' : 'warn',
      expected: acceptableValues.join(' | '),
      actual: String(actual),
    });
  }

  for (const field of expected.non_null) {
    const ind = indicators[field as keyof StructuredIndicators] as Record<string, unknown>;
    const actual = ind?.value ?? null;
    const pass = actual !== null;
    checks.push({
      field,
      status: pass ? 'pass' : 'warn',
      expected: '(non-null)',
      actual: String(actual),
    });
  }

  const requiredChecks = checks.filter(c => c.status === 'pass' || (c.status === 'fail'));
  const passed = requiredChecks.filter(c => c.status === 'pass').length;

  void fixtureFile;
  return { checks, required: requiredChecks.length, passed };
}

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------
function loadFixture(txtPath: string): IndicatorDeriverInput {
  const text = readFileSync(txtPath, 'utf-8');
  const rawAttributes: Record<string, string> = { description: text };
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9 /()]+?):\s*(.+)$/);
    if (m) rawAttributes[m[1].trim()] = m[2].trim();
  }
  const registration = rawAttributes['Reg Number'] ?? rawAttributes['Registration'] ?? null;
  const make         = rawAttributes['Make'] ?? null;
  const model        = rawAttributes['Model'] ?? null;
  const aircraftType = rawAttributes['Aircraft Type'] ?? null;
  return { listingId: basename(txtPath, '.txt'), rawAttributes, aircraftType, make, model, registration };
}

function findFixtures(): Array<{ txt: string; json: string; name: string }> {
  const jsonFiles = readdirSync(EXPECTED_DIR).filter(f => f.endsWith('.json')).sort();
  return jsonFiles
    .map(f => ({
      name: basename(f, '.json'),
      txt: join(SAMPLES_DIR, basename(f, '.json') + '.txt'),
      json: join(EXPECTED_DIR, f),
    }))
    .filter(({ name }) => !fixtureFilter || name.includes(fixtureFilter));
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------
const COL = { name: 28, req: 6, pass: 6, warn: 6, score: 8 };
const sep = '-'.repeat(COL.name + COL.req + COL.pass + COL.warn + COL.score + 8);

function row(...cols: string[]) {
  return [
    cols[0].padEnd(COL.name),
    cols[1].padStart(COL.req),
    cols[2].padStart(COL.pass),
    cols[3].padStart(COL.warn),
    cols[4].padStart(COL.score),
  ].join('  ');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const config = loadConfig();
const useOllama = !!ollamaModel;
const baseURL = ollamaUrl ?? config.ollama?.url ?? 'http://localhost:11434';
const client = useOllama
  ? new OpenAI({ baseURL: `${baseURL}/v1`, apiKey: 'ollama' })
  : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const modelId = ollamaModel ?? config.agent.matcher_model;

const fixtures = findFixtures();
if (fixtures.length === 0) {
  console.error(`No fixtures found${fixtureFilter ? ` matching "${fixtureFilter}"` : ''}`);
  process.exit(1);
}

console.log(`\n=== Indicator Deriver Benchmark ===`);
console.log(`Backend : ${useOllama ? `Ollama  (${baseURL})` : 'Anthropic'}`);
console.log(`Model   : ${modelId}`);
console.log(`Fixtures: ${fixtures.length}\n`);
console.log(sep);
console.log(row('Fixture', 'Req', 'Pass', 'Warn', 'Score'));
console.log(sep);

// Per-field aggregate counters (required checks only)
const fieldStats: Record<string, { pass: number; total: number }> = {};

let totalRequired = 0;
let totalPassed = 0;
let anyFail = false;

// Collect per-fixture detail to print after the summary table
const details: Array<{ name: string; checks: CheckResult[] }> = [];

for (const { name, txt, json } of fixtures) {
  const expected: ExpectedValues = JSON.parse(readFileSync(json, 'utf-8'));
  const input = loadFixture(txt);

  logger.debug({ fixture: name, model: modelId }, 'Running deriver...');
  // Pause between fixtures; local models (Ollama) can exhaust KV cache under sequential load
  if (details.length > 0) await new Promise(r => setTimeout(r, 3000));

  // Retry up to 3 times with backoff when all fields return null (local model flakiness)
  let result = await runIndicatorDeriver(input, client, modelId);
  for (let attempt = 1; attempt <= 2 && (result.error || isAllNull(result.indicators)); attempt++) {
    logger.debug({ fixture: name, attempt }, 'Retrying (all-null or error)...');
    await new Promise(r => setTimeout(r, attempt * 4000));
    result = await runIndicatorDeriver(input, client, modelId);
  }

  if (result.error || !result.indicators) {
    console.log(row(name, '—', '—', '—', `ERROR: ${result.error ?? 'no indicators'}`));
    anyFail = true;
    continue;
  }

  const { checks, required, passed } = scoreIndicators(result.indicators, expected, name);
  const warns = checks.filter(c => c.status === 'warn').length;
  const fails = checks.filter(c => c.status === 'fail').length;
  const score = required > 0 ? `${Math.round((passed / required) * 100)}%` : 'n/a';

  console.log(row(name, String(required), String(passed), String(warns), score));

  if (fails > 0) anyFail = true;
  totalRequired += required;
  totalPassed += passed;

  for (const c of checks) {
    if (c.status === 'fail' || c.status === 'pass') {
      if (!fieldStats[c.field]) fieldStats[c.field] = { pass: 0, total: 0 };
      fieldStats[c.field].total++;
      if (c.status === 'pass') fieldStats[c.field].pass++;
    }
  }

  details.push({ name, checks });
}

console.log(sep);
const totalScore = totalRequired > 0 ? `${Math.round((totalPassed / totalRequired) * 100)}%` : 'n/a';
console.log(row('TOTAL', String(totalRequired), String(totalPassed), '', totalScore));
console.log(sep);

// Per-field summary
console.log('\n--- Required field accuracy ---');
const fieldSep = '-'.repeat(36);
console.log(fieldSep);
for (const [field, { pass, total }] of Object.entries(fieldStats).sort()) {
  const pct = `${Math.round((pass / total) * 100)}%`;
  const bar = '#'.repeat(Math.round((pass / total) * 20)).padEnd(20);
  console.log(`  ${field.padEnd(30)} ${bar} ${pass}/${total} (${pct})`);
}
console.log(fieldSep);

// Failures and warnings detail
let hasDetail = false;
for (const { name, checks } of details) {
  const bad = checks.filter(c => c.status !== 'pass');
  if (bad.length === 0) continue;
  if (!hasDetail) { console.log('\n--- Issues ---'); hasDetail = true; }
  console.log(`\n  ${name}`);
  for (const c of bad) {
    const tag = c.status === 'fail' ? '✗' : '~';
    console.log(`    ${tag} ${c.field.padEnd(30)} expected: ${c.expected.padEnd(25)} got: ${c.actual}`);
  }
}

console.log(`\nResult: ${anyFail ? 'FAIL' : 'PASS'}`);
process.exit(anyFail ? 1 : 0);
