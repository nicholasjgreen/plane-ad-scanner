/**
 * End-to-end pipeline test: AFORS SR20 G-CHPG listing
 *
 * Uses real LLM calls — no mocking of model responses.
 * - detail-fetcher: real Ollama (qwen3:8b) receives the full listing HTML
 * - indicator-deriver: real Anthropic (claude-sonnet) receives the extracted attributes
 *
 * fetchHtml is stubbed to return the saved HTML fixture so no network
 * call to AFORS is needed, but every LLM step is real.
 *
 * Expected results for G-CHPG (Cirrus SR20 G2 with Avidyne Entegra):
 *   avionics_type:        Glass Cockpit
 *   ifr_capability_level: Advanced
 *   registration_country: United Kingdom
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { runDetailFetcher } from '../../src/agents/detail-fetcher.js';
import { runIndicatorDeriver } from '../../src/agents/indicator-deriver.js';
import type { IndicatorDeriverInput } from '../../src/types.js';

const FIXTURE_PATH = resolve('tests/fixtures/afors-sr20-66905.html');
const LISTING_URL  = 'https://afors.uk/light-aircraft/for-sale/standardView-66905/';
const OLLAMA_URL   = process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.1:8b';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

describe('SR20 end-to-end pipeline (real LLMs)', () => {
  it('detail-fetcher extracts avionics attributes from the full listing HTML', { timeout: 120_000 }, async () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const ollamaClient = new OpenAI({ baseURL: `${OLLAMA_URL}/v1`, apiKey: 'ollama' });

    const result = await runDetailFetcher(
      { listingId: 'sr20-e2e', listingUrl: LISTING_URL, sourceSite: 'Afors' },
      ollamaClient,
      OLLAMA_MODEL,
      { fetchHtml: async () => html, retryBaseMs: 0 },
    );

    console.log('\n--- Detail fetcher attributes ---');
    for (const [k, v] of Object.entries(result.attributes)) {
      console.log(`  ${k}: ${String(v).slice(0, 120)}`);
    }
    console.log(`  imageUrls: ${result.imageUrls.length} found`);
    if (result.error) console.log(`  error: ${result.error}`);

    expect(result.error).toBeUndefined();

    // Must have extracted something about avionics — any key containing Avidyne/avionics text
    const allValues = Object.values(result.attributes).join(' ').toLowerCase();
    expect(allValues).toMatch(/avidyne|entegra|glass|avionics/i);
  });

  it('indicator-deriver produces Glass Cockpit / Advanced IFR from real Ollama-extracted attributes', { timeout: 240_000 }, async () => {
    const html = readFileSync(FIXTURE_PATH, 'utf-8');
    const ollamaClient = new OpenAI({ baseURL: `${OLLAMA_URL}/v1`, apiKey: 'ollama' });
    const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Step 1: real detail-fetcher with real Ollama
    const fetchResult = await runDetailFetcher(
      { listingId: 'sr20-e2e', listingUrl: LISTING_URL, sourceSite: 'Afors' },
      ollamaClient,
      OLLAMA_MODEL,
      { fetchHtml: async () => html, retryBaseMs: 0 },
    );

    console.log('\n--- Attributes extracted by Ollama ---');
    for (const [k, v] of Object.entries(fetchResult.attributes)) {
      console.log(`  ${k}: ${String(v).slice(0, 120)}`);
    }

    // Step 2: real indicator-deriver with real Anthropic
    const input: IndicatorDeriverInput = {
      listingId: 'sr20-e2e',
      rawAttributes: fetchResult.attributes,
      aircraftType: fetchResult.attributes['aircraft_type'] ?? fetchResult.attributes['type'] ?? 'Cirrus SR20 G2',
      make: fetchResult.attributes['make'] ?? 'Cirrus',
      model: fetchResult.attributes['model'] ?? 'SR20',
      registration: fetchResult.attributes['registration'] ?? 'G-CHPG',
    };

    const indicators = await runIndicatorDeriver(input, anthropicClient, ANTHROPIC_MODEL);

    console.log('\n--- Indicators from Anthropic ---');
    if (indicators.error) {
      console.log(`  error: ${indicators.error}`);
    } else {
      const ind = indicators.indicators!;
      console.log(`  avionics_type:         ${ind.avionics_type.value} [${ind.avionics_type.confidence}]`);
      console.log(`  autopilot_capability:  ${ind.autopilot_capability.value} [${ind.autopilot_capability.confidence}]`);
      console.log(`  ifr_approval:          ${ind.ifr_approval.value} [${ind.ifr_approval.confidence}]`);
      console.log(`  ifr_capability_level:  ${ind.ifr_capability_level.value} [${ind.ifr_capability_level.confidence}]`);
      console.log(`  engine_state:          ${ind.engine_state.value} [${ind.engine_state.confidence}]`);
      console.log(`  registration_country:  ${ind.registration_country.value} [${ind.registration_country.confidence}]`);
    }

    expect(indicators.error).toBeUndefined();
    const ind = indicators.indicators!;

    // The Cirrus SR20 G2 ships with the Avidyne Entegra glass cockpit suite.
    // The listing explicitly names PFD + MFD + IFD440 NAV/GPS units.
    expect(ind.avionics_type.value).toBe('Glass Cockpit');
    expect(ind.ifr_capability_level.value).toBe('Advanced');
    expect(ind.registration_country.value).toBe('United Kingdom');
  });
});
