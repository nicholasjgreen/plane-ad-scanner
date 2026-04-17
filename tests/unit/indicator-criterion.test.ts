/**
 * T004 — TDD tests for 'indicator' criterion type in profile-scorer.ts
 * Write BEFORE implementing the 'indicator' case — confirm these fail first.
 */
import { describe, it, expect } from 'vitest';
import { scoreListingAgainstProfiles } from '../../src/services/profile-scorer.js';
import type { ListingForScoring, InterestProfile, StructuredIndicators } from '../../src/types.js';

// A minimal listing for testing indicator criteria
const BASE_LISTING: ListingForScoring = {
  id: 'test-id',
  registration: 'G-ABCD',
  aircraftType: 'Cessna 172',
  make: 'Cessna',
  model: '172',
  year: 2005,
  price: 60000,
  priceCurrency: 'GBP',
  location: 'Biggin Hill',
};

const BASE_INDICATORS: StructuredIndicators = {
  avionics_type:          { value: 'Glass Cockpit', confidence: 'High' },
  autopilot_capability:   { value: 'Modern Integrated', confidence: 'High' },
  ifr_approval:           { value: 'IFR Approved', confidence: 'High' },
  ifr_capability_level:   { value: 'Advanced', confidence: 'High' },
  engine_state:           { value: 'Green', confidence: 'High' },
  smoh_hours:             { value: 250, confidence: 'Medium' },
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

function makeProfile(indicatorField: string, indicatorValue: string, weight = 10): InterestProfile {
  return {
    name: 'Test',
    weight: 1,
    min_score: 0,
    criteria: [{ type: 'indicator', weight, indicatorField, indicatorValue }],
  };
}

describe('indicator criterion in profile-scorer', () => {
  it('matched when indicator value equals expected', () => {
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Green')],
      null, undefined, undefined, BASE_INDICATORS
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(true);
  });

  it('not matched when value differs', () => {
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Amber')],
      null, undefined, undefined, BASE_INDICATORS
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(false);
  });

  it('not matched when indicator value is null (Unknown)', () => {
    const indicators = { ...BASE_INDICATORS, engine_state: { value: null, confidence: 'High' as const } };
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Green')],
      null, undefined, undefined, indicators
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(false);
  });

  it('not matched when indicatorField is absent from indicators (unknown field)', () => {
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('nonexistent_field', 'Green')],
      null, undefined, undefined, BASE_INDICATORS
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(false);
  });

  it('High confidence → full weight contribution', () => {
    const indicators = { ...BASE_INDICATORS, engine_state: { value: 'Green', confidence: 'High' as const } };
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Green', 10)],
      null, undefined, undefined, indicators
    );
    const contribution = result.profileScores[0].evidence[0].contribution;
    // With one criterion, weight=10/totalWeight=10 → full = 100, High multiplier = 1.0 → 100
    expect(contribution).toBeCloseTo(100, 0);
  });

  it('Medium confidence → 0.75 of weight contribution', () => {
    const indicators = { ...BASE_INDICATORS, engine_state: { value: 'Green', confidence: 'Medium' as const } };
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Green', 10)],
      null, undefined, undefined, indicators
    );
    const contribution = result.profileScores[0].evidence[0].contribution;
    // High would be 100; Medium = 100 × 0.75 = 75
    expect(contribution).toBeCloseTo(75, 0);
  });

  it('Low confidence → 0.5 of weight contribution', () => {
    const indicators = { ...BASE_INDICATORS, engine_state: { value: 'Green', confidence: 'Low' as const } };
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Green', 10)],
      null, undefined, undefined, indicators
    );
    const contribution = result.profileScores[0].evidence[0].contribution;
    // High would be 100; Low = 100 × 0.5 = 50
    expect(contribution).toBeCloseTo(50, 0);
  });

  it('banded field (typical_range) matched against band, not raw value', () => {
    // typical_range has value=700, band='Green'
    // criterion with indicatorValue='Green' should match (band match)
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('typical_range', 'Green')],
      null, undefined, undefined, BASE_INDICATORS
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(true);
  });

  it('banded field not matched when band differs (not value)', () => {
    // typical_range has band='Green', value=700 — criterion '700' should NOT match
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('typical_range', '700')],
      null, undefined, undefined, BASE_INDICATORS
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(false);
  });

  it('smoh_hours returns misconfigured note (display-only field)', () => {
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('smoh_hours', '250')],
      null, undefined, undefined, BASE_INDICATORS
    );
    const evidence = result.profileScores[0].evidence[0];
    expect(evidence.matched).toBe(false);
    expect(evidence.note).toContain('misconfigured');
  });

  it('not matched when no indicators provided (null)', () => {
    const result = scoreListingAgainstProfiles(
      BASE_LISTING,
      [makeProfile('engine_state', 'Green')],
      null, undefined, undefined, null
    );
    expect(result.profileScores[0].evidence[0].matched).toBe(false);
  });
});
