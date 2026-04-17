/**
 * T011 — TDD tests for src/agents/indicator-deriver.ts
 * Write BEFORE implementing the agent — confirm these fail first.
 */
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runIndicatorDeriver } from '../../src/agents/indicator-deriver.js';
import type { IndicatorDeriverInput, StructuredIndicators } from '../../src/types.js';

const LISTING_ID = 'test-listing-001';

const BASE_INPUT: IndicatorDeriverInput = {
  listingId: LISTING_ID,
  rawAttributes: { 'Engine hours': '450 SMOH', 'Avionics': 'Garmin G1000' },
  aircraftType: 'Cessna 172',
  make: 'Cessna',
  model: '172',
  registration: 'G-ABCD',
};

const VALID_INDICATORS: StructuredIndicators = {
  avionics_type:          { value: 'Glass Cockpit', confidence: 'High' },
  autopilot_capability:   { value: 'Modern Integrated', confidence: 'High' },
  ifr_approval:           { value: 'IFR Approved', confidence: 'High' },
  ifr_capability_level:   { value: 'Advanced', confidence: 'High' },
  engine_state:           { value: 'Green', confidence: 'High' },
  smoh_hours:             { value: 450, confidence: 'High' },
  condition_band:         { value: 'Green', confidence: 'High' },
  airworthiness_basis:    { value: 'CAA EASA', confidence: 'High' },
  aircraft_type_category: { value: 'Single-Engine Piston', confidence: 'High' },
  passenger_capacity:     { value: 4, band: '3–4 seats', confidence: 'High' },
  typical_range:          { value: 700, band: 'Green', confidence: 'High' },
  typical_cruise_speed:   { value: 122, band: 'Amber', confidence: 'High' },
  typical_fuel_burn:      { value: 8, band: 'Green', confidence: 'High' },
  maintenance_cost_band:  { value: 'Green', confidence: 'Medium' },
  fuel_cost_band:         { value: 'Green', confidence: 'High' },
  maintenance_program:    { value: null, confidence: 'Low' },
  registration_country:   { value: 'United Kingdom', confidence: 'High' },
  ownership_structure:    { value: 'Full Ownership', confidence: 'High' },
  hangar_situation:       { value: 'Hangared', confidence: 'High' },
  redundancy_level:       { value: 'Low', confidence: 'High' },
};

function makeAnthropicMock(responseText: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  } as unknown as Anthropic;
}

describe('indicator-deriver agent', () => {
  it('returns error result (not throw) when LLM returns invalid JSON', async () => {
    const anthropic = makeAnthropicMock('this is not json at all');
    const result = await runIndicatorDeriver(BASE_INPUT, anthropic, 'test-model');
    expect(result.listingId).toBe(LISTING_ID);
    expect(result.error).toBeTruthy();
    expect(result.indicators).toBeUndefined();
  });

  it('returns error result when LLM returns JSON missing required fields', async () => {
    // Missing most fields
    const partial = JSON.stringify({ avionics_type: { value: 'Glass Cockpit', confidence: 'High' } });
    const anthropic = makeAnthropicMock(partial);
    const result = await runIndicatorDeriver(BASE_INPUT, anthropic, 'test-model');
    expect(result.listingId).toBe(LISTING_ID);
    expect(result.error).toBeTruthy();
    expect(result.indicators).toBeUndefined();
  });

  it('returns all-null indicators (not error) for empty rawAttributes', async () => {
    const allNull: StructuredIndicators = Object.fromEntries(
      Object.keys(VALID_INDICATORS).map((k) => {
        const field = VALID_INDICATORS[k as keyof StructuredIndicators];
        if ('band' in field) return [k, { value: null, band: null, confidence: 'Low' }];
        return [k, { value: null, confidence: 'Low' }];
      })
    ) as unknown as StructuredIndicators;
    const anthropic = makeAnthropicMock(JSON.stringify(allNull));
    const result = await runIndicatorDeriver(
      { ...BASE_INPUT, rawAttributes: {} },
      anthropic,
      'test-model'
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators).toBeDefined();
  });

  it('G- registration prefix → registration_country.value = "United Kingdom"', async () => {
    // LLM returns registration_country = null; agent should derive from prefix G-
    const withNullCountry: StructuredIndicators = {
      ...VALID_INDICATORS,
      registration_country: { value: null, confidence: 'Low' },
    };
    const anthropic = makeAnthropicMock(JSON.stringify(withNullCountry));
    const result = await runIndicatorDeriver(
      { ...BASE_INPUT, registration: 'G-ABCD' },
      anthropic,
      'test-model'
    );
    expect(result.error).toBeUndefined();
    expect(result.indicators?.registration_country.value).toBe('United Kingdom');
  });

  it('output listingId matches input listingId', async () => {
    const anthropic = makeAnthropicMock(JSON.stringify(VALID_INDICATORS));
    const result = await runIndicatorDeriver(BASE_INPUT, anthropic, 'test-model');
    expect(result.listingId).toBe(LISTING_ID);
  });

  it('returns valid indicators for well-formed LLM response', async () => {
    const anthropic = makeAnthropicMock(JSON.stringify(VALID_INDICATORS));
    const result = await runIndicatorDeriver(BASE_INPUT, anthropic, 'test-model');
    expect(result.error).toBeUndefined();
    expect(result.indicators).toBeDefined();
    expect(result.indicators!.engine_state.value).toBe('Green');
  });
});
