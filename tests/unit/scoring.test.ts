/**
 * T020 — TDD: Scoring engine unit tests.
 * Write these FIRST; confirm they FAIL (module not found); then implement src/services/scoring.ts.
 */
import { describe, it, expect } from 'vitest';
import { scoreListing } from '../../src/services/scoring.js';
import type { ListingForScoring } from '../../src/types.js';
import type { Criterion } from '../../src/config.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_LISTING: ListingForScoring = {
  id: 'test-id',
  registration: 'G-ABCD',
  aircraftType: 'Cessna 172',
  make: 'Cessna',
  model: '172',
  year: 2005,
  price: 50000,
  priceCurrency: 'GBP',
  location: 'Yorkshire, UK',
};

// All 6 criterion types, each satisfied by BASE_LISTING
const ALL_CRITERIA: Criterion[] = [
  { type: 'type_match',        pattern: 'cessna',     weight: 1 },
  { type: 'price_max',         max: 60000,             weight: 1 },
  { type: 'price_range',       min: 40000, max: 60000, weight: 1 },
  { type: 'year_min',          yearMin: 2000,          weight: 1 },
  { type: 'year_range',        yearMin: 2000, yearMax: 2010, weight: 1 },
  { type: 'location_contains', locationPattern: 'yorkshire', weight: 1 },
];

// ---------------------------------------------------------------------------
// (a) All 6 criterion types satisfied → 100
// ---------------------------------------------------------------------------

describe('scoreListing — all criteria satisfied', () => {
  it('returns 100 when all criteria are satisfied', () => {
    const score = scoreListing(BASE_LISTING, ALL_CRITERIA);
    expect(score).toBe(100.0);
  });
});

// ---------------------------------------------------------------------------
// (b) Partial matches → correct weighted fraction
// ---------------------------------------------------------------------------

describe('scoreListing — partial matches', () => {
  it('returns proportional score when only some criteria are met', () => {
    // type_match (weight 3) satisfied; price_range (weight 2) not satisfied; total weight 5
    const listing: ListingForScoring = { ...BASE_LISTING, price: 100000 };
    const criteria: Criterion[] = [
      { type: 'type_match',  pattern: 'cessna',     weight: 3 },
      { type: 'price_range', min: 40000, max: 60000, weight: 2 },
    ];
    // satisfied weight = 3, total = 5 → 3/5 * 100 = 60.0
    expect(scoreListing(listing, criteria)).toBe(60.0);
  });

  it('returns 0 when no criteria are satisfied', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, aircraftType: 'Piper PA-28', make: 'Piper', model: 'PA-28', price: 200000 };
    const criteria: Criterion[] = [
      { type: 'type_match',  pattern: 'cessna', weight: 1 },
      { type: 'price_max',   max: 50000,        weight: 1 },
    ];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });

  it('rounds to 1 decimal place', () => {
    // 1 of 3 equal-weight criteria → 33.333... → 33.3
    const listing: ListingForScoring = { ...BASE_LISTING, price: 200000, year: null };
    const criteria: Criterion[] = [
      { type: 'type_match', pattern: 'cessna', weight: 1 },
      { type: 'price_max',  max: 50000,        weight: 1 },
      { type: 'year_min',   yearMin: 2000,      weight: 1 },
    ];
    expect(scoreListing(listing, criteria)).toBe(33.3);
  });
});

// ---------------------------------------------------------------------------
// (c) Null price/year → criterion not satisfied, no crash
// ---------------------------------------------------------------------------

describe('scoreListing — null fields', () => {
  it('treats price_max as NOT satisfied when price is null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, price: null };
    const criteria: Criterion[] = [{ type: 'price_max', max: 60000, weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });

  it('treats price_range as NOT satisfied when price is null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, price: null };
    const criteria: Criterion[] = [{ type: 'price_range', min: 40000, max: 60000, weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });

  it('treats year_min as NOT satisfied when year is null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, year: null };
    const criteria: Criterion[] = [{ type: 'year_min', yearMin: 2000, weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });

  it('treats year_range as NOT satisfied when year is null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, year: null };
    const criteria: Criterion[] = [{ type: 'year_range', yearMin: 2000, yearMax: 2010, weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });

  it('treats location_contains as NOT satisfied when location is null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, location: null };
    const criteria: Criterion[] = [{ type: 'location_contains', locationPattern: 'yorkshire', weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });

  it('does not throw when multiple fields are null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, price: null, year: null, location: null };
    expect(() => scoreListing(listing, ALL_CRITERIA)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (d) Empty criteria → score 0 for all
// ---------------------------------------------------------------------------

describe('scoreListing — empty criteria', () => {
  it('returns 0 when criteria array is empty', () => {
    expect(scoreListing(BASE_LISTING, [])).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// (e) price_range with min > max edge case
// ---------------------------------------------------------------------------

describe('scoreListing — price_range min > max', () => {
  it('treats price_range as NOT satisfied when min > max', () => {
    // An inverted range can never be satisfied
    const criteria: Criterion[] = [{ type: 'price_range', min: 80000, max: 20000, weight: 1 }];
    expect(scoreListing(BASE_LISTING, criteria)).toBe(0.0);
  });
});

// ---------------------------------------------------------------------------
// (f) type_match case-insensitive across aircraftType, make, model
// ---------------------------------------------------------------------------

describe('scoreListing — type_match case insensitivity', () => {
  it('matches pattern in aircraftType case-insensitively', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, aircraftType: 'CESSNA 172', make: null, model: null };
    const criteria: Criterion[] = [{ type: 'type_match', pattern: 'cessna', weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(100.0);
  });

  it('matches pattern in make when aircraftType is null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, aircraftType: null, make: 'Cessna', model: '172' };
    const criteria: Criterion[] = [{ type: 'type_match', pattern: 'CESSNA', weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(100.0);
  });

  it('matches pattern in model when aircraftType and make are null', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, aircraftType: null, make: null, model: 'Skyhawk' };
    const criteria: Criterion[] = [{ type: 'type_match', pattern: 'skyhawk', weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(100.0);
  });

  it('returns 0 when pattern does not match any type field', () => {
    const listing: ListingForScoring = { ...BASE_LISTING, aircraftType: 'Piper PA-28', make: 'Piper', model: 'PA-28' };
    const criteria: Criterion[] = [{ type: 'type_match', pattern: 'cessna', weight: 1 }];
    expect(scoreListing(listing, criteria)).toBe(0.0);
  });
});
