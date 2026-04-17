/**
 * T013 — POST /rescore integration test.
 * Seeds a listing + listing_ai row; mocks runPresenter; asserts PRG redirect and DB update.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import { createApp } from '../../src/web/server.js';
import type { PresenterInput, PresenterOutput } from '../../src/types.js';
import Anthropic from '@anthropic-ai/sdk';

const NOW = '2026-04-10T10:00:00.000Z';

const FIXED_OUTPUT: PresenterOutput = {
  listingId: '',  // filled per-test
  headline: 'Test headline for this aircraft',
  explanation: 'This listing matches your interest in low-hours trainers near you.',
  status: 'ok',
};

// ---- seeding helpers --------------------------------------------------------

function seedListing(db: Database.Database): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO listings
       (id, make, model, year, price, price_currency, location, listing_url, source_site,
        match_score, is_new, date_first_found, date_last_seen, raw_attributes)
     VALUES (?, 'Cessna', '172', 2001, 45000, 'GBP', 'Biggin Hill', 'https://ex.com/1',
             'TestSite', 75, 1, ?, ?, '{}')`
  ).run(id, NOW, NOW);
  return id;
}

function seedListingAi(db: Database.Database, listingId: string, status: string) {
  db.prepare(
    `INSERT INTO listing_ai (listing_id, status) VALUES (?, ?)`
  ).run(listingId, status);
}

// ---- server helper ----------------------------------------------------------

function startTestServer(
  db: Database.Database,
  presenterMock: (input: PresenterInput, anthropic: Anthropic, model: string) => Promise<PresenterOutput>
): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const app = createApp(db, {}, {
      anthropic: new Anthropic({ apiKey: 'test-key' }),
      presenter: presenterMock,
    });
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve({ server, base: `http://localhost:${port}` });
    });
  });
}

// ---- tests ------------------------------------------------------------------

describe('POST /rescore', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createTestDb>;
  let listingId: string;

  beforeAll(async () => {
    db = createTestDb();
    listingId = seedListing(db);
    seedListingAi(db, listingId, 'pending');

    const mock = async (input: PresenterInput): Promise<PresenterOutput> => ({
      ...FIXED_OUTPUT,
      listingId: input.listing.id,
    });

    ({ server, base } = await startTestServer(db, mock));
  });

  afterAll(() => { server.close(); });

  it('redirects to / (302 PRG)', async () => {
    const res = await fetch(`${base}/rescore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `listing_id=${encodeURIComponent(listingId)}`,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('sets listing_ai status to ready with headline and explanation', () => {
    const row = db.prepare(
      `SELECT status, headline, explanation, generated_at FROM listing_ai WHERE listing_id = ?`
    ).get(listingId) as { status: string; headline: string; explanation: string; generated_at: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.status).toBe('ready');
    expect(row!.headline).toBe(FIXED_OUTPUT.headline);
    expect(row!.explanation).toBe(FIXED_OUTPUT.explanation);
    expect(row!.generated_at).toBeTruthy();
  });

  it('redirects to / even when listing_id is missing', async () => {
    const res = await fetch(`${base}/rescore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('redirects to / when listing does not exist', async () => {
    const res = await fetch(`${base}/rescore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `listing_id=${encodeURIComponent(randomUUID())}`,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('sets status to failed when presenter throws', async () => {
    const failId = randomUUID();
    db.prepare(
      `INSERT INTO listings
         (id, price_currency, listing_url, source_site, match_score, is_new,
          date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'GBP', 'https://ex.com/fail', 'TestSite', 0, 0, ?, ?, '{}')`
    ).run(failId, NOW, NOW);
    seedListingAi(db, failId, 'pending');

    const failingMock = async (): Promise<PresenterOutput> => {
      throw new Error('LLM unavailable');
    };

    await new Promise<void>((resolve) => {
      const failApp = createApp(db, {}, {
        anthropic: new Anthropic({ apiKey: 'test-key' }),
        presenter: failingMock,
      });
      const failServer = failApp.listen(0, async () => {
        const { port } = failServer.address() as { port: number };
        const res = await fetch(`http://localhost:${port}/rescore`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `listing_id=${encodeURIComponent(failId)}`,
          redirect: 'manual',
        });
        expect(res.status).toBe(302);

        const row = db.prepare(`SELECT status FROM listing_ai WHERE listing_id = ?`).get(failId) as { status: string } | undefined;
        expect(row?.status).toBe('failed');

        failServer.close(() => resolve());
      });
    });
  });
});
