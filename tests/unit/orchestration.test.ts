import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import { runScan } from '../../src/agents/orchestrator.js';
import type { ScraperOutput, MatcherOutput, HistorianResult } from '../../src/types.js';
import type { Config } from '../../src/config.js';

const NOW = '2026-03-30T12:00:00.000Z';

const minimalConfig: Config = {
  schedule: null,
  web: { port: 3000 },
  agent: {
    token_budget_per_run: 10000,
    max_turns_per_agent: 5,
    scraper_model: 'claude-haiku-4-5-20251001',
    matcher_model: 'claude-sonnet-4-6',
    require_approval: false,
  },
  criteria: [],
  sites: [],
  ollama: null,
  home_location: null,
  feedback_min_count: 5,
};

function seedSite(db: Database.Database, name: string, url: string, enabled = true) {
  db.prepare(
    'INSERT INTO sites (id, name, url, enabled, priority, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(randomUUID(), name, url, enabled ? 1 : 0, NOW);
}

function makeListing(url = 'https://example.com/1'): ScraperOutput['listings'][0] {
  return { listingUrl: url, aircraftType: 'Cessna 172', attributes: {} };
}

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe('happy path — all sites succeed', () => {
  it('creates a scan_runs row with correct counts', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');
    seedSite(db, 'SiteB', 'https://site-b.com');

    const scraper = vi
      .fn()
      .mockResolvedValueOnce({ siteName: 'SiteA', listings: [makeListing('https://site-a.com/1')] } as ScraperOutput)
      .mockResolvedValueOnce({ siteName: 'SiteB', listings: [makeListing('https://site-b.com/1'), makeListing('https://site-b.com/2')] } as ScraperOutput);

    const historian = vi.fn().mockResolvedValue({ newCount: 1, updatedCount: 0, listingIds: [] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);

    await runScan(db, minimalConfig, { scraper, historian, matcher });

    const row = db
      .prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1')
      .get() as Record<string, unknown>;

    expect(row.sites_attempted).toBe(2);
    expect(row.sites_succeeded).toBe(2);
    expect(row.sites_failed).toBe(0);
    expect(row.listings_found).toBe(3);
    expect(row.completed_at).not.toBeNull();
    expect(row.error_summary).toBeNull();
  });

  it('resets is_new flags before processing', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');
    // Seed an existing listing with is_new = 1
    db.prepare(
      `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'https://old.com/1', 'OldSite', 0, 1, ?, ?, '{}') `
    ).run(randomUUID(), NOW, NOW);

    const scraper = vi.fn().mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi.fn().mockResolvedValue({ newCount: 0, updatedCount: 0, listingIds: [] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);

    await runScan(db, minimalConfig, { scraper, historian, matcher });

    const { is_new } = db
      .prepare("SELECT is_new FROM listings WHERE listing_url = 'https://old.com/1'")
      .get() as { is_new: number };
    expect(is_new).toBe(0);
  });
});

describe('one site fails', () => {
  it('records error in scan_runs.error_summary and continues other sites', async () => {
    seedSite(db, 'BadSite', 'https://bad.com');
    seedSite(db, 'GoodSite', 'https://good.com');

    const scraper = vi
      .fn()
      .mockResolvedValueOnce({ siteName: 'BadSite', listings: [], error: 'HTTP 500' } as ScraperOutput)
      .mockResolvedValueOnce({ siteName: 'GoodSite', listings: [makeListing('https://good.com/1')] } as ScraperOutput);

    const historian = vi.fn().mockResolvedValue({ newCount: 1, updatedCount: 0, listingIds: [] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);

    const result = await runScan(db, minimalConfig, { scraper, historian, matcher });

    expect(result.sitesFailed).toBe(1);
    expect(result.sitesSucceeded).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].site).toBe('BadSite');

    const row = db
      .prepare('SELECT error_summary FROM scan_runs ORDER BY started_at DESC LIMIT 1')
      .get() as { error_summary: string };
    const summary = JSON.parse(row.error_summary) as { site: string; error: string }[];
    expect(summary[0].site).toBe('BadSite');
    expect(summary[0].error).toBe('HTTP 500');
  });

  it('records sites_failed count correctly in scan_runs DB row', async () => {
    seedSite(db, 'BadSite', 'https://bad.com');
    seedSite(db, 'GoodSite', 'https://good.com');

    const scraper = vi
      .fn()
      .mockResolvedValueOnce({ siteName: 'BadSite', listings: [], error: 'timeout' } as ScraperOutput)
      .mockResolvedValueOnce({ siteName: 'GoodSite', listings: [makeListing('https://good.com/1')] } as ScraperOutput);
    const historian = vi.fn().mockResolvedValue({ newCount: 1, updatedCount: 0, listingIds: [] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);

    await runScan(db, minimalConfig, { scraper, historian, matcher });

    const row = db
      .prepare('SELECT sites_attempted, sites_succeeded, sites_failed FROM scan_runs ORDER BY started_at DESC LIMIT 1')
      .get() as { sites_attempted: number; sites_succeeded: number; sites_failed: number };
    expect(row.sites_attempted).toBe(2);
    expect(row.sites_succeeded).toBe(1);
    expect(row.sites_failed).toBe(1);
  });

  it('does not call historian for failed sites', async () => {
    seedSite(db, 'BadSite', 'https://bad.com');

    const scraper = vi
      .fn()
      .mockResolvedValue({ siteName: 'BadSite', listings: [], error: 'timeout' } as ScraperOutput);
    const historian = vi.fn().mockResolvedValue({ newCount: 0, updatedCount: 0, listingIds: [] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);

    await runScan(db, minimalConfig, { scraper, historian, matcher });

    expect(historian).not.toHaveBeenCalled();
  });
});

describe('matcher scores written to DB', () => {
  it('updates match_score for each listing returned by matcher', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');
    const listingId = randomUUID();
    db.prepare(
      `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'https://site-a.com/1', 'SiteA', 0, 0, ?, ?, '{}')`
    ).run(listingId, NOW, NOW);

    const scraper = vi.fn().mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi
      .fn()
      .mockResolvedValue({ newCount: 0, updatedCount: 1, listingIds: [listingId] } as HistorianResult);
    const matcher = vi
      .fn()
      .mockResolvedValue({ scores: [{ listingId, score: 85.0 }] } as MatcherOutput);

    await runScan(db, minimalConfig, { scraper, historian, matcher });

    expect(matcher).toHaveBeenCalledOnce();
    const { match_score } = db
      .prepare('SELECT match_score FROM listings WHERE id = ?')
      .get(listingId) as { match_score: number };
    expect(match_score).toBe(85.0);
  });
});

describe('detail fetcher phase', () => {
  it('calls detailFetcher for each listing in allListingIds', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');

    const listingId = randomUUID();
    db.prepare(
      `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'https://site-a.com/l/1', 'SiteA', 0, 0, ?, ?, '{}')`
    ).run(listingId, NOW, NOW);

    const scraper = vi.fn().mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi
      .fn()
      .mockResolvedValue({ newCount: 1, updatedCount: 0, listingIds: [listingId] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);
    const detailFetcher = vi
      .fn()
      .mockResolvedValue({ listingId, attributes: {}, imageUrls: [] });

    await runScan(db, minimalConfig, { scraper, historian, matcher, detailFetcher });

    expect(detailFetcher).toHaveBeenCalledOnce();
    expect(detailFetcher).toHaveBeenCalledWith(
      listingId,
      'https://site-a.com/l/1',
      expect.any(String)
    );
  });

  it('does not abort scan when detailFetcher returns an error for one listing', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');

    const idA = randomUUID();
    const idB = randomUUID();
    for (const [id, url] of [[idA, 'https://site-a.com/l/1'], [idB, 'https://site-a.com/l/2']]) {
      db.prepare(
        `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
         VALUES (?, ?, 'SiteA', 0, 0, ?, ?, '{}')`
      ).run(id, url, NOW, NOW);
    }

    const scraper = vi.fn().mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi
      .fn()
      .mockResolvedValue({ newCount: 2, updatedCount: 0, listingIds: [idA, idB] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);
    const detailFetcher = vi
      .fn()
      .mockResolvedValueOnce({ listingId: idA, attributes: {}, imageUrls: [], error: 'HTTP 404' })
      .mockResolvedValueOnce({ listingId: idB, attributes: { make: 'Cessna' }, imageUrls: [] });

    const result = await runScan(db, minimalConfig, { scraper, historian, matcher, detailFetcher });

    // Scan must complete successfully
    expect(result.id).toBeTruthy();
    const row = db
      .prepare('SELECT completed_at FROM scan_runs ORDER BY started_at DESC LIMIT 1')
      .get() as { completed_at: string | null };
    expect(row.completed_at).not.toBeNull();

    // Both listings processed — detailFetcher called twice
    expect(detailFetcher).toHaveBeenCalledTimes(2);
  });
});

describe('indicator deriver phase', () => {
  it('calls indicatorDeriver for each listing with a pending indicator row', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');

    const listingId = randomUUID();
    db.prepare(
      `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'https://site-a.com/l/1', 'SiteA', 0, 0, ?, ?, '{}')`
    ).run(listingId, NOW, NOW);
    // Seed a pending indicator row
    db.prepare(`INSERT INTO listing_indicators (listing_id, status) VALUES (?, 'pending')`).run(listingId);

    const scraper = vi.fn().mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi.fn().mockResolvedValue({ newCount: 1, updatedCount: 0, listingIds: [listingId] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);
    const indicatorDeriver = vi.fn().mockResolvedValue({
      listingId,
      indicators: {
        avionics_type:          { value: 'Glass Cockpit', confidence: 'High' },
        autopilot_capability:   { value: null, confidence: 'Low' },
        ifr_approval:           { value: 'IFR Approved', confidence: 'High' },
        ifr_capability_level:   { value: 'Advanced', confidence: 'High' },
        engine_state:           { value: 'Green', confidence: 'High' },
        smoh_hours:             { value: null, confidence: 'Low' },
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
      },
    });

    await runScan(db, minimalConfig, { scraper, historian, matcher, indicatorDeriver });

    expect(indicatorDeriver).toHaveBeenCalledOnce();
    const row = db
      .prepare(`SELECT status FROM listing_indicators WHERE listing_id = ?`)
      .get(listingId) as { status: string } | undefined;
    expect(row?.status).toBe('ready');
  });

  it('sets status=failed and preserves indicators when indicatorDeriver returns error', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');

    const listingId = randomUUID();
    db.prepare(
      `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'https://site-a.com/l/2', 'SiteA', 0, 0, ?, ?, '{}')`
    ).run(listingId, NOW, NOW);
    db.prepare(`INSERT INTO listing_indicators (listing_id, status) VALUES (?, 'pending')`).run(listingId);

    const scraper = vi.fn().mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi.fn().mockResolvedValue({ newCount: 1, updatedCount: 0, listingIds: [listingId] } as HistorianResult);
    const matcher = vi.fn().mockResolvedValue({ scores: [] } as MatcherOutput);
    const indicatorDeriver = vi.fn().mockResolvedValue({ listingId, error: 'LLM error' });

    await runScan(db, minimalConfig, { scraper, historian, matcher, indicatorDeriver });

    const row = db
      .prepare(`SELECT status FROM listing_indicators WHERE listing_id = ?`)
      .get(listingId) as { status: string } | undefined;
    expect(row?.status).toBe('failed');
  });
});

describe('matcher throws', () => {
  it('retains existing scores and still completes the scan', async () => {
    seedSite(db, 'SiteA', 'https://site-a.com');
    // Seed a listing with existing score
    const existingId = randomUUID();
    db.prepare(
      `INSERT INTO listings (id, listing_url, source_site, match_score, is_new, date_first_found, date_last_seen, raw_attributes)
       VALUES (?, 'https://site-a.com/1', 'SiteA', 75, 0, ?, ?, '{}')`
    ).run(existingId, NOW, NOW);

    const scraper = vi
      .fn()
      .mockResolvedValue({ siteName: 'SiteA', listings: [] } as ScraperOutput);
    const historian = vi
      .fn()
      .mockResolvedValue({ newCount: 0, updatedCount: 0, listingIds: [existingId] } as HistorianResult);
    const matcher = vi.fn().mockRejectedValue(new Error('LLM unavailable'));

    const result = await runScan(db, minimalConfig, { scraper, historian, matcher });

    // Scan still completes
    expect(result.id).toBeTruthy();
    const row = db
      .prepare('SELECT completed_at FROM scan_runs ORDER BY started_at DESC LIMIT 1')
      .get() as { completed_at: string | null };
    expect(row.completed_at).not.toBeNull();

    // Existing score retained
    const listing = db
      .prepare('SELECT match_score FROM listings WHERE id = ?')
      .get(existingId) as { match_score: number };
    expect(listing.match_score).toBe(75);
  });
});
