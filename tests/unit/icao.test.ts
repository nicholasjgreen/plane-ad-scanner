// TDD: write tests first, confirm FAIL, then implement src/services/icao.ts

import { describe, it, expect } from 'vitest';
import { haversineKm, resolveIcao, proximityScore } from '../../src/services/icao.js';

// EGBJ (Gloucestershire) approx 51.8942° N, -2.1672° W
// EGLL (London Heathrow) approx 51.4775° N, -0.4614° W
// Haversine gives ~126 km (tolerance ±15 km)

describe('haversineKm', () => {
  it('calculates EGBJ → EGLL distance within 15 km tolerance', () => {
    const dist = haversineKm(51.8942, -2.1672, 51.4775, -0.4614);
    expect(dist).toBeGreaterThan(111);
    expect(dist).toBeLessThan(141);
  });

  it('returns 0 for identical coordinates', () => {
    expect(haversineKm(51.5, -1.0, 51.5, -1.0)).toBe(0);
  });

  it('is symmetric', () => {
    const d1 = haversineKm(51.5, -1.0, 52.0, -2.0);
    const d2 = haversineKm(52.0, -2.0, 51.5, -1.0);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

describe('resolveIcao', () => {
  it('resolves a known UK airport (EGBJ)', () => {
    const result = resolveIcao('EGBJ');
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(51.89, 1);
    expect(result!.lon).toBeCloseTo(-2.17, 1);
  });

  it('resolves a known airport case-insensitively', () => {
    const lower = resolveIcao('egbj');
    const upper = resolveIcao('EGBJ');
    expect(lower).toEqual(upper);
  });

  it('returns null for an unknown ICAO code', () => {
    expect(resolveIcao('ZZZZ')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(resolveIcao('')).toBeNull();
  });
});

describe('proximityScore', () => {
  // Home at EGBJ coords
  const homeLat = 51.8942;
  const homeLon = -2.1672;

  it('returns score 0 when ICAO code is unknown', () => {
    const result = proximityScore('ZZZZ', 'share', homeLat, homeLon, 150);
    expect(result.score).toBe(0);
    expect(result.note).toMatch(/unknown/i);
  });

  it('returns score 0 when icaoCode is null', () => {
    const result = proximityScore(null, 'share', homeLat, homeLon, 150);
    expect(result.score).toBe(0);
  });

  it('returns full score (100) for a listing at the home airfield', () => {
    const result = proximityScore('EGBJ', 'share', homeLat, homeLon, 150);
    expect(result.score).toBe(100);
  });

  it('returns score 0 for a listing beyond maxDistanceKm', () => {
    // EGPD (Aberdeen) is ~450 km from EGBJ; max 150 km
    const result = proximityScore('EGPD', 'share', homeLat, homeLon, 150);
    expect(result.score).toBe(0);
    expect(result.note).toMatch(/beyond/i);
  });

  it('returns intermediate score for a listing within maxDistanceKm', () => {
    // EGFF (Cardiff) is ~60 km from EGBJ; max 150 km → should score > 0 and < 100
    const result = proximityScore('EGFF', 'share', homeLat, homeLon, 150);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });

  it('score decreases as distance increases', () => {
    // EGFF (Cardiff ~60 km) should score higher than EGNM (Leeds ~180 km) at max 200 km
    const near = proximityScore('EGFF', 'share', homeLat, homeLon, 200);
    const far = proximityScore('EGNM', 'share', homeLat, homeLon, 200);
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('returns score 0 for full_ownership listings regardless of distance', () => {
    const result = proximityScore('EGBJ', 'full_ownership', homeLat, homeLon, 150);
    expect(result.score).toBe(0);
    expect(result.note).toMatch(/full.?ownership|only applies/i);
  });

  it('returns score 0 for any listing type with home_location not configured (0,0 sentinel)', () => {
    // When home_location is null, caller passes NaN or we handle it
    const result = proximityScore('EGBJ', 'share', NaN, NaN, 150);
    expect(result.score).toBe(0);
  });
});
