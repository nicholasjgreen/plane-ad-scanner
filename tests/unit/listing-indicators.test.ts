/**
 * T003 — TDD tests for src/db/listing-indicators.ts
 * Write BEFORE implementing the module — confirm these fail first.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import {
  upsertListingIndicators,
  setIndicatorsReady,
  setIndicatorsFailed,
  markIndicatorsStale,
  getPendingOrStaleListingIds,
  getListingIndicators,
} from '../../src/db/listing-indicators.js';
import type { StructuredIndicators } from '../../src/types.js';

const MINIMAL_INDICATORS: StructuredIndicators = {
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

function seedListing(db: Database.Database): string {
  const id = 'test-listing-' + Math.random().toString(36).slice(2);
  db.prepare(
    `INSERT INTO listings (id, price_currency, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
     VALUES (?, 'GBP', 'https://ex.com/1', 'TestSite', 0, 0, '2026-01-01', '2026-01-01', '{}')`
  ).run(id);
  return id;
}

describe('listing-indicators DB module', () => {
  let db: Database.Database;
  let listingId: string;

  beforeEach(() => {
    db = createTestDb();
    listingId = seedListing(db);
  });

  it('upsertListingIndicators inserts a pending row', () => {
    upsertListingIndicators(db, listingId);
    const row = db.prepare(`SELECT status, indicators, derived_at FROM listing_indicators WHERE listing_id = ?`).get(listingId) as { status: string; indicators: string | null; derived_at: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.status).toBe('pending');
    expect(row!.indicators).toBeNull();
    expect(row!.derived_at).toBeNull();
  });

  it('upsertListingIndicators second call is a no-op (INSERT OR IGNORE)', () => {
    upsertListingIndicators(db, listingId);
    upsertListingIndicators(db, listingId);
    const count = (db.prepare(`SELECT COUNT(*) as c FROM listing_indicators WHERE listing_id = ?`).get(listingId) as { c: number }).c;
    expect(count).toBe(1);
  });

  it('setIndicatorsReady stores JSON blob, sets status=ready and derived_at', () => {
    upsertListingIndicators(db, listingId);
    setIndicatorsReady(db, listingId, MINIMAL_INDICATORS);
    const row = db.prepare(`SELECT status, indicators, derived_at FROM listing_indicators WHERE listing_id = ?`).get(listingId) as { status: string; indicators: string; derived_at: string };
    expect(row.status).toBe('ready');
    expect(row.derived_at).toBeTruthy();
    const parsed = JSON.parse(row.indicators) as StructuredIndicators;
    expect(parsed.engine_state.value).toBe('Green');
  });

  it('setIndicatorsFailed sets status=failed and preserves existing indicators blob', () => {
    upsertListingIndicators(db, listingId);
    setIndicatorsReady(db, listingId, MINIMAL_INDICATORS);
    setIndicatorsFailed(db, listingId);
    const row = db.prepare(`SELECT status, indicators FROM listing_indicators WHERE listing_id = ?`).get(listingId) as { status: string; indicators: string };
    expect(row.status).toBe('failed');
    // indicators blob should still be present from previous setIndicatorsReady
    const parsed = JSON.parse(row.indicators) as StructuredIndicators;
    expect(parsed.engine_state.value).toBe('Green');
  });

  it('markIndicatorsStale sets status=stale', () => {
    upsertListingIndicators(db, listingId);
    setIndicatorsReady(db, listingId, MINIMAL_INDICATORS);
    markIndicatorsStale(db, listingId);
    const row = db.prepare(`SELECT status FROM listing_indicators WHERE listing_id = ?`).get(listingId) as { status: string };
    expect(row.status).toBe('stale');
  });

  it('markIndicatorsStale is a no-op if row does not exist', () => {
    // Should not throw
    expect(() => markIndicatorsStale(db, 'nonexistent')).not.toThrow();
  });

  it('getPendingOrStaleListingIds returns ids with status pending or stale', () => {
    const id2 = seedListing(db);
    const id3 = seedListing(db);
    const id4 = seedListing(db);

    upsertListingIndicators(db, listingId);  // pending
    upsertListingIndicators(db, id2);
    setIndicatorsReady(db, id2, MINIMAL_INDICATORS);
    markIndicatorsStale(db, id2);           // stale

    upsertListingIndicators(db, id3);
    setIndicatorsReady(db, id3, MINIMAL_INDICATORS); // ready

    upsertListingIndicators(db, id4);
    setIndicatorsFailed(db, id4);           // failed

    const ids = getPendingOrStaleListingIds(db);
    expect(ids).toContain(listingId);
    expect(ids).toContain(id2);
    expect(ids).not.toContain(id3);
    expect(ids).not.toContain(id4);
  });

  it('getListingIndicators returns parsed StructuredIndicators for a ready row', () => {
    upsertListingIndicators(db, listingId);
    setIndicatorsReady(db, listingId, MINIMAL_INDICATORS);
    const result = getListingIndicators(db, listingId);
    expect(result).not.toBeNull();
    expect(result!.engine_state.value).toBe('Green');
    expect(result!.typical_range.band).toBe('Green');
  });

  it('getListingIndicators returns null when no row exists', () => {
    const result = getListingIndicators(db, 'no-such-id');
    expect(result).toBeNull();
  });

  it('getListingIndicators returns null when indicators column is NULL (pending)', () => {
    upsertListingIndicators(db, listingId);
    const result = getListingIndicators(db, listingId);
    expect(result).toBeNull();
  });
});
