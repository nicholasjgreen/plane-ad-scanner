import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import {
  upsertListingAi,
  setStatusReady,
  setStatusFailed,
  getPendingListingIds,
  getListingAi,
  resetAllToPending,
} from '../../src/db/listing-ai.js';

const NOW = '2026-04-13T10:00:00.000Z';

let db: Database.Database;

function seedListing(id: string): void {
  db.prepare(`
    INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
    VALUES (?, 'https://example.com/1', 'TestSite', 0, 1, ?, ?, '{}')
  `).run(id, NOW, NOW);
}

beforeEach(() => {
  db = createTestDb();
});

describe('upsertListingAi', () => {
  it('creates a new row with status=pending when none exists', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    const row = db.prepare('SELECT * FROM listing_ai WHERE listing_id = ?').get(id) as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending');
    expect(row.headline).toBeNull();
    expect(row.explanation).toBeNull();
  });

  it('does not overwrite an existing row on second call', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    // Manually set status to ready
    db.prepare("UPDATE listing_ai SET status = 'ready' WHERE listing_id = ?").run(id);
    upsertListingAi(db, id);
    // Should still be ready (upsert is idempotent — does not reset existing rows)
    const row = db.prepare('SELECT status FROM listing_ai WHERE listing_id = ?').get(id) as { status: string };
    expect(row.status).toBe('ready');
  });

  it('creates only one row per listing_id', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    upsertListingAi(db, id);
    const count = (db.prepare('SELECT COUNT(*) as n FROM listing_ai WHERE listing_id = ?').get(id) as { n: number }).n;
    expect(count).toBe(1);
  });
});

describe('setStatusReady', () => {
  it('sets status to ready and stores headline, explanation, model_ver, generated_at', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    setStatusReady(db, id, {
      headline: 'Test headline',
      explanation: 'Test explanation.',
      modelVer: 'abc123',
    });
    const row = db.prepare('SELECT * FROM listing_ai WHERE listing_id = ?').get(id) as Record<string, unknown>;
    expect(row.status).toBe('ready');
    expect(row.headline).toBe('Test headline');
    expect(row.explanation).toBe('Test explanation.');
    expect(row.model_ver).toBe('abc123');
    expect(row.generated_at).toBeTruthy();
  });
});

describe('setStatusFailed', () => {
  it('sets status to failed', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    setStatusFailed(db, id);
    const row = db.prepare('SELECT status FROM listing_ai WHERE listing_id = ?').get(id) as { status: string };
    expect(row.status).toBe('failed');
  });

  it('preserves existing headline and explanation when failing', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    setStatusReady(db, id, { headline: 'Old headline', explanation: 'Old explanation.', modelVer: 'v1' });
    setStatusFailed(db, id);
    const row = db.prepare('SELECT * FROM listing_ai WHERE listing_id = ?').get(id) as Record<string, unknown>;
    expect(row.status).toBe('failed');
    expect(row.headline).toBe('Old headline');
    expect(row.explanation).toBe('Old explanation.');
  });
});

describe('getPendingListingIds', () => {
  it('returns only pending listing IDs', () => {
    const pendingId = randomUUID();
    const readyId = randomUUID();
    const failedId = randomUUID();
    seedListing(pendingId);
    seedListing(readyId);
    seedListing(failedId);
    upsertListingAi(db, pendingId);
    upsertListingAi(db, readyId);
    upsertListingAi(db, failedId);
    setStatusReady(db, readyId, { headline: 'H', explanation: 'E', modelVer: 'v1' });
    setStatusFailed(db, failedId);
    const ids = getPendingListingIds(db);
    expect(ids).toContain(pendingId);
    expect(ids).not.toContain(readyId);
    expect(ids).not.toContain(failedId);
  });

  it('returns empty array when no pending rows', () => {
    const ids = getPendingListingIds(db);
    expect(ids).toEqual([]);
  });
});

describe('getListingAi', () => {
  it('returns null when no row exists', () => {
    const result = getListingAi(db, randomUUID());
    expect(result).toBeNull();
  });

  it('returns the row when it exists', () => {
    const id = randomUUID();
    seedListing(id);
    upsertListingAi(db, id);
    const row = getListingAi(db, id);
    expect(row).toBeTruthy();
    expect(row?.status).toBe('pending');
  });
});

describe('resetAllToPending', () => {
  it('sets all listing_ai rows to pending', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    seedListing(id1);
    seedListing(id2);
    upsertListingAi(db, id1);
    upsertListingAi(db, id2);
    setStatusReady(db, id1, { headline: 'H', explanation: 'E', modelVer: 'v1' });
    setStatusReady(db, id2, { headline: 'H', explanation: 'E', modelVer: 'v1' });
    const count = resetAllToPending(db);
    expect(count).toBe(2);
    const pending = getPendingListingIds(db);
    expect(pending).toContain(id1);
    expect(pending).toContain(id2);
  });
});
