/**
 * T008 — TDD: write FIRST, confirm FAIL, then implement profile-scorer.ts (T009).
 */
import { describe, it, expect } from 'vitest';
import { scoreListingAgainstProfiles } from '../../src/services/profile-scorer.js';
import type { ListingForScoring, InterestProfile } from '../../src/types.js';

const baseListing: ListingForScoring = {
  id: 'listing-1',
  registration: 'G-ABCD',
  aircraftType: 'Cessna 172S',
  make: 'Cessna',
  model: '172S',
  year: 2005,
  price: 55000,
  priceCurrency: 'GBP',
  location: 'Yorkshire',
  listingType: 'full_ownership',
  icaoCode: null,
};

const priceProfile: InterestProfile = {
  name: 'Price Seeker',
  weight: 1.0,
  min_score: 0,
  criteria: [
    { type: 'price_range', min: 30000, max: 80000, weight: 2.0 },
    { type: 'year_range', yearMin: 2000, yearMax: 2025, weight: 1.0 },
  ],
};

describe('make_model criterion', () => {
  it('matches when make and model both match', () => {
    const profile: InterestProfile = {
      name: 'Cessna Profile',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'make_model', make: 'Cessna', model: '172S', weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [profile]);
    expect(overallScore).toBe(100);
  });

  it('matches with wildcard model (*)', () => {
    const profile: InterestProfile = {
      name: 'Any Cessna',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'make_model', make: 'Cessna', model: '*', weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [profile]);
    expect(overallScore).toBe(100);
  });

  it('fails when make does not match', () => {
    const profile: InterestProfile = {
      name: 'Piper Only',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'make_model', make: 'Piper', model: null, weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [profile]);
    expect(overallScore).toBe(0);
  });

  it('is case-insensitive', () => {
    const profile: InterestProfile = {
      name: 'Cessna Lower',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'make_model', make: 'cessna', model: null, weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [profile]);
    expect(overallScore).toBe(100);
  });
});

describe('price_range criterion', () => {
  it('scores 100 when price is within range', () => {
    const { overallScore } = scoreListingAgainstProfiles(
      { ...baseListing, price: 55000 },
      [{ name: 'P', weight: 1.0, min_score: 0, criteria: [{ type: 'price_range', min: 30000, max: 80000, weight: 1.0 }] }]
    );
    expect(overallScore).toBe(100);
  });

  it('scores 0 when price is above max', () => {
    const { overallScore } = scoreListingAgainstProfiles(
      { ...baseListing, price: 120000 },
      [{ name: 'P', weight: 1.0, min_score: 0, criteria: [{ type: 'price_range', min: 30000, max: 80000, weight: 1.0 }] }]
    );
    expect(overallScore).toBe(0);
  });

  it('scores 0 when price is null', () => {
    const { overallScore } = scoreListingAgainstProfiles(
      { ...baseListing, price: null },
      [{ name: 'P', weight: 1.0, min_score: 0, criteria: [{ type: 'price_range', min: 30000, max: 80000, weight: 1.0 }] }]
    );
    expect(overallScore).toBe(0);
  });
});

describe('year_range criterion', () => {
  it('scores 100 within range', () => {
    const { overallScore } = scoreListingAgainstProfiles(
      { ...baseListing, year: 2005 },
      [{ name: 'P', weight: 1.0, min_score: 0, criteria: [{ type: 'year_range', yearMin: 2000, yearMax: 2025, weight: 1.0 }] }]
    );
    expect(overallScore).toBe(100);
  });

  it('scores 0 when year is null', () => {
    const { overallScore } = scoreListingAgainstProfiles(
      { ...baseListing, year: null },
      [{ name: 'P', weight: 1.0, min_score: 0, criteria: [{ type: 'year_range', yearMin: 2000, yearMax: 2025, weight: 1.0 }] }]
    );
    expect(overallScore).toBe(0);
  });
});

describe('listing_type criterion', () => {
  it('full_ownership matches full_ownership listing', () => {
    const profile: InterestProfile = {
      name: 'Owners',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'listing_type', listingType: 'full_ownership', weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles({ ...baseListing, listingType: 'full_ownership' }, [profile]);
    expect(overallScore).toBe(100);
  });

  it('share criterion does not match full_ownership listing', () => {
    const profile: InterestProfile = {
      name: 'Sharers',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'listing_type', listingType: 'share', weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles({ ...baseListing, listingType: 'full_ownership' }, [profile]);
    expect(overallScore).toBe(0);
  });

  it('any matches any listing type', () => {
    const profile: InterestProfile = {
      name: 'Any',
      weight: 1.0,
      min_score: 0,
      criteria: [{ type: 'listing_type', listingType: 'any', weight: 1.0 }],
    };
    expect(scoreListingAgainstProfiles({ ...baseListing, listingType: 'share' }, [profile]).overallScore).toBe(100);
    expect(scoreListingAgainstProfiles({ ...baseListing, listingType: 'full_ownership' }, [profile]).overallScore).toBe(100);
  });
});

describe('weighted average and multi-profile', () => {
  it('computes weighted average across criteria within one profile', () => {
    // price matches (weight 2), year matches (weight 1) → 3/3 = 100
    const { profileScores } = scoreListingAgainstProfiles(baseListing, [priceProfile]);
    expect(profileScores[0].score).toBe(100);
  });

  it('partial match: only price in range', () => {
    const profile: InterestProfile = {
      name: 'P',
      weight: 1.0,
      min_score: 0,
      criteria: [
        { type: 'price_range', min: 30000, max: 80000, weight: 2.0 },  // matches
        { type: 'year_range', yearMin: 2010, yearMax: 2025, weight: 1.0 }, // 2005 fails
      ],
    };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [profile]);
    // satisfied weight = 2; total weight = 3; score = 2/3 * 100 ≈ 66.7
    expect(overallScore).toBeCloseTo(66.7, 1);
  });

  it('inactive profile (weight=0) is excluded from overall score', () => {
    const active: InterestProfile = { name: 'Active', weight: 1.0, min_score: 0, criteria: [{ type: 'price_range', min: 30000, max: 80000, weight: 1.0 }] };
    const inactive: InterestProfile = { name: 'Inactive', weight: 0, min_score: 0, criteria: [{ type: 'year_range', yearMin: 2010, yearMax: 2025, weight: 1.0 }] };
    const { overallScore, profileScores } = scoreListingAgainstProfiles(baseListing, [active, inactive]);
    // Only active profile contributes; inactive not in profileScores
    expect(profileScores).toHaveLength(1);
    expect(profileScores[0].profileName).toBe('Active');
    expect(overallScore).toBe(100);
  });

  it('returns overall 0 when no profiles provided', () => {
    const { overallScore } = scoreListingAgainstProfiles(baseListing, []);
    expect(overallScore).toBe(0);
  });

  it('overall score is weighted average across multiple active profiles', () => {
    const p1: InterestProfile = { name: 'P1', weight: 2.0, min_score: 0, criteria: [{ type: 'price_range', min: 30000, max: 80000, weight: 1.0 }] }; // score 100
    const p2: InterestProfile = { name: 'P2', weight: 1.0, min_score: 0, criteria: [{ type: 'price_range', min: 90000, max: 200000, weight: 1.0 }] }; // score 0
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [p1, p2]);
    // overall = (100*2 + 0*1) / (2+1) = 66.7
    expect(overallScore).toBeCloseTo(66.7, 1);
  });
});

describe('min_score exclusion', () => {
  it('excludes listing from overall score when ALL profiles have min_score > listing score', () => {
    const profile: InterestProfile = {
      name: 'High Bar',
      weight: 1.0,
      min_score: 80,
      // price doesn't match → score 0, below min_score 80
      criteria: [{ type: 'price_range', min: 200000, max: 500000, weight: 1.0 }],
    };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [profile]);
    expect(overallScore).toBe(0);
  });

  it('does not exclude when at least one profile score meets its min_score', () => {
    const passing: InterestProfile = { name: 'Pass', weight: 1.0, min_score: 50, criteria: [{ type: 'price_range', min: 30000, max: 80000, weight: 1.0 }] };
    const failing: InterestProfile = { name: 'Fail', weight: 1.0, min_score: 90, criteria: [{ type: 'price_range', min: 200000, max: 500000, weight: 1.0 }] };
    const { overallScore } = scoreListingAgainstProfiles(baseListing, [passing, failing]);
    // At least one profile (Pass) meets its min_score → overallScore > 0
    expect(overallScore).toBeGreaterThan(0);
  });
});
