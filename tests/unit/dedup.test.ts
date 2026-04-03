import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import { upsertListing } from '../../src/services/dedup.js';

let db: Database.Database;
const NOW = '2026-03-30T12:00:00.000Z';

const base = {
  listingUrl: 'https://example.com/listing/1',
  aircraftType: 'Cessna 172',
  attributes: {},
};

beforeEach(() => {
  db = createTestDb();
});

describe('registration present', () => {
  it('inserts a new row when registration not seen before', () => {
    const result = upsertListing(db, { ...base, registration: 'G-ABCD' }, 'Site', NOW);
    expect(result.isNew).toBe(true);
    const row = db.prepare('SELECT * FROM listings WHERE id = ?').get(result.id) as Record<string, unknown>;
    expect(row.registration).toBe('G-ABCD');
    expect(row.is_new).toBe(1);
    expect(row.source_site).toBe('Site');
  });

  it('updates existing row when registration matches', () => {
    const first = upsertListing(db, { ...base, registration: 'G-ABCD', price: 50000 }, 'Site', NOW);
    const second = upsertListing(db, { ...base, registration: 'G-ABCD', price: 45000 }, 'Site', NOW);

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(first.id).toBe(second.id);

    const row = db.prepare('SELECT price FROM listings WHERE id = ?').get(first.id) as { price: number };
    expect(row.price).toBe(45000);

    const count = (db.prepare('SELECT COUNT(*) as n FROM listings').get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('deduplicates same registration from different sites', () => {
    const first = upsertListing(db, { ...base, registration: 'G-ABCD' }, 'SiteA', NOW);
    const second = upsertListing(db, { ...base, registration: 'G-ABCD' }, 'SiteB', NOW);

    const count = (db.prepare('SELECT COUNT(*) as n FROM listings').get() as { n: number }).n;
    expect(count).toBe(1);
    expect(first.id).toBe(second.id);
    expect(second.isNew).toBe(false);
  });

  it('sets is_new = 1 on UPDATE', () => {
    const { id } = upsertListing(db, { ...base, registration: 'G-ABCD' }, 'Site', NOW);
    // Simulate scan reset
    db.prepare('UPDATE listings SET is_new = 0').run();
    upsertListing(db, { ...base, registration: 'G-ABCD' }, 'Site', NOW);
    const row = db.prepare('SELECT is_new FROM listings WHERE id = ?').get(id) as { is_new: number };
    expect(row.is_new).toBe(1);
  });
});

describe('no registration', () => {
  it('inserts a new row for listing without registration', () => {
    const result = upsertListing(db, base, 'Site', NOW);
    expect(result.isNew).toBe(true);
    const row = db.prepare('SELECT registration FROM listings WHERE id = ?').get(result.id) as { registration: unknown };
    expect(row.registration).toBeNull();
  });

  it('creates separate rows for two listings without registration', () => {
    upsertListing(db, base, 'Site', NOW);
    upsertListing(db, base, 'Site', NOW);
    const count = (db.prepare('SELECT COUNT(*) as n FROM listings').get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it('does not mix no-registration listings with registered ones', () => {
    upsertListing(db, { ...base, registration: 'G-ABCD' }, 'Site', NOW);
    upsertListing(db, base, 'Site', NOW);
    const count = (db.prepare('SELECT COUNT(*) as n FROM listings').get() as { n: number }).n;
    expect(count).toBe(2);
  });
});
