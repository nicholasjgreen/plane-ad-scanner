/**
 * T011 — TDD tests for src/agents/indicator-deriver.ts
 * Three-call architecture: listing facts | avionics list | avionics classification
 */
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runIndicatorDeriver } from '../../src/agents/indicator-deriver.js';
import type { IndicatorDeriverInput } from '../../src/types.js';

const LISTING_ID = 'test-listing-001';

const BASE_INPUT: IndicatorDeriverInput = {
  listingId: LISTING_ID,
  rawAttributes: { 'Engine hours': '450 SMOH', 'Avionics': 'Garmin G1000' },
  aircraftType: 'Cessna 172',
  make: 'Cessna',
  model: '172',
  registration: 'G-ABCD',
};

// Canonical mock responses for the three LLM calls
const FACTS_RESPONSE = JSON.stringify({
  engine_state: 'Green',
  smoh_hours: 450,
  condition_band: 'Green',
  airworthiness_basis: 'Type Certificated',
  ownership_structure: 'Full Ownership',
  hangar_situation: 'Hangared',
  maintenance_program: null,
});

const AVIONICS_LIST_RESPONSE = JSON.stringify([
  'Garmin G1000 PFD',
  'Garmin G1000 MFD',
  'GFC700 autopilot',
]);

const AVIONICS_CLASS_RESPONSE = JSON.stringify({
  avionics_type:         { value: 'Glass Cockpit',      confidence: 'High' },
  autopilot_capability:  { value: 'Modern Integrated',  confidence: 'High' },
  ifr_avionics_equipped: { value: 'Equipped',           confidence: 'High' },
  ifr_capability_level:  { value: 'Advanced',           confidence: 'High' },
});

/** Create a mock Anthropic client that returns each response in sequence. */
function makeAnthropicMock(...responses: string[]): Anthropic {
  const mock = vi.fn();
  for (const response of responses) {
    mock.mockResolvedValueOnce({ content: [{ type: 'text', text: response }] });
  }
  // Fallback for any extra calls
  mock.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });
  return { messages: { create: mock } } as unknown as Anthropic;
}

// Realistic Avidyne Entegra description text as an AFORS listing would produce it
// (under 'seller_notes', not 'description' — tests the non-standard-key fix)
const AFORS_SR20_SELLER_NOTES = [
  'Wilco Aviation are pleased to exclusively present to the market a 1/4 share in this Cirrus Design',
  'SR20 G2, registration G-CHPG, currently based at Dunkeswell Aerodrome in the South West of England.',
  'This particular aircraft, G-CHPG, is a 2006 example and is equipped with the Avidyne Entegra avionics',
  'suite, further enhanced by a pair of upgraded Avidyne IFD440 NAV/COM/GPS units along with an Avidyne',
  'AXP340 transponder, providing a well-equipped and capable avionics package suitable for both touring',
  'and instrument flying. Avidyne Entegra Primary Flight Display (PFD) provides a full glass cockpit.',
].join(' ');

const AFORS_SR20_INPUT: IndicatorDeriverInput = {
  listingId: 'afors-66905',
  rawAttributes: {
    // Intentionally no 'description' key — text is under 'seller_notes' (AFORS style)
    seller_notes: AFORS_SR20_SELLER_NOTES,
    Make: 'Cirrus',
    Model: 'SR20',
    Year: '2006',
    Registration: 'G-CHPG',
    Price: '£35,000',
  },
  aircraftType: 'Cirrus SR20 G2',
  make: 'Cirrus',
  model: 'SR20',
  registration: 'G-CHPG',
};

const AFORS_AVIONICS_LIST = JSON.stringify([
  'Avidyne Entegra PFD (Primary Flight Display)',
  'Avidyne Entegra MFD (Multi-Function Display)',
  'Avidyne IFD440 NAV/COM/GPS',
  'Avidyne AXP340 ADS-B transponder',
]);

const AFORS_AVIONICS_CLASS = JSON.stringify({
  avionics_type:         { value: 'Glass Cockpit',      confidence: 'High' },
  autopilot_capability:  { value: null,                 confidence: 'Low' },
  ifr_avionics_equipped: { value: 'Equipped',           confidence: 'High' },
  ifr_capability_level:  { value: 'Advanced',           confidence: 'High' },
});

describe('indicator-deriver agent', () => {
  it('returns error result (not throw) when LLM throws', async () => {
    const mock = vi.fn().mockRejectedValue(new Error('API error'));
    const anthropic = { messages: { create: mock } } as unknown as Anthropic;
    const result = await runIndicatorDeriver(BASE_INPUT, anthropic, 'test-model');
    expect(result.listingId).toBe(LISTING_ID);
    expect(result.error).toBeTruthy();
    expect(result.indicators).toBeUndefined();
  });

  it('normalises null confidence to "Low"', async () => {
    const withNullConf = JSON.stringify({ avionics_type: { value: 'Glass Cockpit', confidence: null } });
    const result = await runIndicatorDeriver(
      BASE_INPUT,
      makeAnthropicMock('{}', AVIONICS_LIST_RESPONSE, withNullConf),
      'test-model',
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators!.avionics_type.confidence).toBe('Low');
  });

  it('normalises numeric confidence values (e.g. 0.9 → "High")', async () => {
    const withNumericConf = JSON.stringify({
      avionics_type:         { value: 'Glass Cockpit', confidence: 0.9 },
      autopilot_capability:  { value: null,            confidence: 0.6 },
      ifr_avionics_equipped: { value: 'Equipped',      confidence: 0.3 },
      ifr_capability_level:  { value: null,            confidence: null },
    });
    const result = await runIndicatorDeriver(
      BASE_INPUT,
      makeAnthropicMock('{}', AVIONICS_LIST_RESPONSE, withNumericConf),
      'test-model',
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators!.avionics_type.confidence).toBe('High');
    expect(result.indicators!.autopilot_capability.confidence).toBe('Medium');
    expect(result.indicators!.ifr_capability_level.confidence).toBe('Low');
  });

  it('fills missing fields with null/Low placeholders when LLM omits them', async () => {
    const partialClass = JSON.stringify({ avionics_type: { value: 'Glass Cockpit', confidence: 'High' } });
    const result = await runIndicatorDeriver(
      BASE_INPUT,
      makeAnthropicMock('{}', AVIONICS_LIST_RESPONSE, partialClass),
      'test-model',
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators).toBeDefined();
    // Provided field is preserved
    expect(result.indicators!.avionics_type.value).toBe('Glass Cockpit');
    // Missing listing-facts field is null/Low
    expect(result.indicators!.engine_state.value).toBeNull();
    expect(result.indicators!.engine_state.confidence).toBe('Low');
  });

  it('returns all-null indicators (not error) for empty rawAttributes', async () => {
    const result = await runIndicatorDeriver(
      { ...BASE_INPUT, rawAttributes: {} },
      makeAnthropicMock('{}', '[]'),
      'test-model',
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators).toBeDefined();
  });

  it('G- registration prefix → registration_country.value = "United Kingdom"', async () => {
    const result = await runIndicatorDeriver(
      { ...BASE_INPUT, registration: 'G-ABCD' },
      makeAnthropicMock('{}', '[]'),
      'test-model',
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators?.registration_country.value).toBe('United Kingdom');
  });

  it('output listingId matches input listingId', async () => {
    const result = await runIndicatorDeriver(
      BASE_INPUT,
      makeAnthropicMock(FACTS_RESPONSE, AVIONICS_LIST_RESPONSE, AVIONICS_CLASS_RESPONSE),
      'test-model',
    );
    expect(result.listingId).toBe(LISTING_ID);
  });

  it('returns valid indicators for well-formed LLM response', async () => {
    const result = await runIndicatorDeriver(
      BASE_INPUT,
      makeAnthropicMock(FACTS_RESPONSE, AVIONICS_LIST_RESPONSE, AVIONICS_CLASS_RESPONSE),
      'test-model',
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators).toBeDefined();
    expect(result.indicators!.engine_state.value).toBe('Green');
    expect(result.indicators!.avionics_type.value).toBe('Glass Cockpit');
    expect(result.indicators!.registration_country.value).toBe('United Kingdom');
  });

  describe('regression: avionics text under non-"description" key (AFORS G-CHPG bug)', () => {
    it('extracts avionics list when description is under "seller_notes" key', async () => {
      const mock = vi.fn()
        .mockResolvedValueOnce({ content: [{ type: 'text', text: '{}' }] })           // Call 1: facts
        .mockResolvedValueOnce({ content: [{ type: 'text', text: AFORS_AVIONICS_LIST }] }) // Call 2: avionics list
        .mockResolvedValueOnce({ content: [{ type: 'text', text: AFORS_AVIONICS_CLASS }] }); // Call 3: classification
      const anthropic = { messages: { create: mock } } as unknown as Anthropic;

      const result = await runIndicatorDeriver(AFORS_SR20_INPUT, anthropic, 'test-model');

      expect(result.error).toBeUndefined();
      expect(result.indicators).toBeDefined();
      expect(result.indicators!.avionics_type.value).toBe('Glass Cockpit');
      expect(result.indicators!.ifr_capability_level.value).toBe('Advanced');
      expect(result.indicators!.registration_country.value).toBe('United Kingdom');
    });

    it('passes long text values to the avionics-list LLM call (not just raw JSON)', async () => {
      const mock = vi.fn()
        .mockResolvedValueOnce({ content: [{ type: 'text', text: '{}' }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: AFORS_AVIONICS_LIST }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: AFORS_AVIONICS_CLASS }] });
      const anthropic = { messages: { create: mock } } as unknown as Anthropic;

      await runIndicatorDeriver(AFORS_SR20_INPUT, anthropic, 'test-model');

      // The second LLM call (avionics list) must include the seller_notes prose text,
      // not just the JSON attribute dump — this is the fix for the non-standard key bug.
      const call2UserContent = mock.mock.calls[1][0].messages
        .find((m: { role: string }) => m.role === 'user')?.content as string;
      expect(call2UserContent).toContain('Avidyne Entegra');
      expect(call2UserContent).toContain('IFD440');
    });
  });
});
