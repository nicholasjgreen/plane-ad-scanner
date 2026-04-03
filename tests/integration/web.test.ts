/**
 * T019 — Web integration test.
 * Seeds DB with 3 listings at different scores; asserts page order, badges, empty state, error banner.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import { createApp } from '../../src/web/server.js';

const NOW = '2026-03-30T12:00:00.000Z';

// ---- seeding helpers --------------------------------------------------------

function seedListing(
  db: Database.Database,
  opts: { url: string; type: string; score: number; isNew?: boolean }
) {
  db.prepare(
    `INSERT INTO listings
       (id, aircraft_type, listing_url, source_site, match_score, is_new,
        date_first_found, date_last_seen, raw_attributes, price_currency)
     VALUES (?, ?, ?, 'TestSite', ?, ?, ?, ?, '{}', 'GBP')`
  ).run(randomUUID(), opts.type, opts.url, opts.score, opts.isNew ? 1 : 0, NOW, NOW);
}

function seedScanRun(db: Database.Database, errorSummary: string | null = null) {
  db.prepare(
    `INSERT INTO scan_runs
       (id, started_at, completed_at, sites_attempted, sites_succeeded, sites_failed,
        listings_found, listings_new, error_summary)
     VALUES (?, ?, ?, 1, 1, 0, 3, 1, ?)`
  ).run(randomUUID(), NOW, NOW, errorSummary);
}

// ---- server helper ----------------------------------------------------------

function startTestServer(db: Database.Database): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const app = createApp(db);
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve({ server, base: `http://localhost:${port}` });
    });
  });
}

// ---- tests ------------------------------------------------------------------

describe('GET / — listings in score order', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(async () => {
    db = createTestDb();
    seedListing(db, { url: 'https://ex.com/1', type: 'Cessna 172', score: 80, isNew: true });
    seedListing(db, { url: 'https://ex.com/2', type: 'Piper PA-28', score: 50 });
    seedListing(db, { url: 'https://ex.com/3', type: 'Grob G115',   score: 20 });
    seedScanRun(db);
    ({ server, base } = await startTestServer(db));
  });

  afterAll(() => { server.close(); db.close(); });

  it('returns 200', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
  });

  it('lists all 3 aircraft types', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).toContain('Cessna 172');
    expect(html).toContain('Piper PA-28');
    expect(html).toContain('Grob G115');
  });

  it('renders listings in descending match-score order', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    const cessnaPos = html.indexOf('Cessna 172');
    const piperPos  = html.indexOf('Piper PA-28');
    const grobPos   = html.indexOf('Grob G115');
    expect(cessnaPos).toBeLessThan(piperPos);
    expect(piperPos).toBeLessThan(grobPos);
  });

  it('shows New badge for is_new listing', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).toContain('badge--new');
  });

  it('does not show empty-state message when listings exist', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).not.toContain('No listings yet');
  });

  it('shows last scan timestamp', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).toContain('Last scan');
  });

  it('does not show error banner when scan had no errors', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    // Check for the rendered <div> element, not the CSS class definition in <style>
    expect(html).not.toContain('<div class="banner banner--error"');
  });
});

describe('GET / — empty state (no scan run yet)', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterAll(() => { server.close(); db.close(); });

  it('shows the pre-scan empty state message', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).toContain('No listings yet');
    expect(html).toContain('run the scanner');
  });
});

describe('GET / — error banner', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(async () => {
    db = createTestDb();
    seedScanRun(db, JSON.stringify([{ site: 'BadSite', error: 'HTTP 503' }]));
    ({ server, base } = await startTestServer(db));
  });

  afterAll(() => { server.close(); db.close(); });

  it('shows banner listing the failed site and error', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).toContain('<div class="banner banner--error"');
    expect(html).toContain('BadSite');
    expect(html).toContain('HTTP 503');
  });
});

describe('GET / — query-param filtering', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(async () => {
    db = createTestDb();
    seedListing(db, { url: 'https://ex.com/1', type: 'Cessna 172', score: 80, isNew: true });
    seedListing(db, { url: 'https://ex.com/2', type: 'Piper PA-28', score: 50 });
    seedScanRun(db);
    ({ server, base } = await startTestServer(db));
  });

  afterAll(() => { server.close(); db.close(); });

  it('?type=cessna returns only Cessna', async () => {
    const html = await fetch(`${base}/?type=cessna`).then((r) => r.text());
    expect(html).toContain('Cessna 172');
    expect(html).not.toContain('Piper PA-28');
  });

  it('?type= filter is case-insensitive', async () => {
    const html = await fetch(`${base}/?type=CESSNA`).then((r) => r.text());
    expect(html).toContain('Cessna 172');
    expect(html).not.toContain('Piper PA-28');
  });

  it('?max_price=55000 excludes listings with no price (treated as included) and price > max', async () => {
    // Seed a listing with price to test max_price filtering
    db.prepare(
      `INSERT INTO listings
         (id, aircraft_type, listing_url, source_site, match_score, is_new,
          date_first_found, date_last_seen, raw_attributes, price_currency, price)
       VALUES (?, 'Robin DR400', 'https://ex.com/3', 'TestSite', 30, 0, ?, ?, '{}', 'GBP', 90000)`
    ).run(randomUUID(), NOW, NOW);

    const html = await fetch(`${base}/?max_price=55000`).then((r) => r.text());
    expect(html).not.toContain('Robin DR400');
  });

  it('?new_only=1 returns only new listings', async () => {
    const html = await fetch(`${base}/?new_only=1`).then((r) => r.text());
    expect(html).toContain('Cessna 172');
    expect(html).not.toContain('Piper PA-28');
  });

  it('filter bar is rendered with type input pre-populated', async () => {
    const html = await fetch(`${base}/?type=cessna`).then((r) => r.text());
    expect(html).toContain('name="type"');
    expect(html).toContain('value="cessna"');
  });

  it('Clear filters link appears when a filter is active', async () => {
    const html = await fetch(`${base}/?type=cessna`).then((r) => r.text());
    expect(html).toContain('Clear filters');
    expect(html).toContain('href="/"');
  });

  it('Clear filters link absent when no filters active', async () => {
    const html = await fetch(`${base}/`).then((r) => r.text());
    expect(html).not.toContain('Clear filters');
  });
});

describe('GET /health', () => {
  let server: http.Server;
  let base: string;
  let db: ReturnType<typeof createTestDb>;

  beforeAll(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterAll(() => { server.close(); db.close(); });

  it('returns { status: "ok" }', async () => {
    const body = await fetch(`${base}/health`).then((r) => r.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});
