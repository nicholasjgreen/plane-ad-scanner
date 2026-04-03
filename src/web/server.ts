import express from 'express';
import type { Application } from 'express';
import http from 'node:http';
import Database from 'better-sqlite3';
import { renderListingsPage } from './render.js';
import type { ListingRow, LastScanInfo, ScanError, ListingsPageData } from './render.js';
import { logger } from '../config.js';

interface DbListingRow {
  id: string;
  registration: string | null;
  aircraft_type: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  price_currency: string;
  location: string | null;
  listing_url: string;
  source_site: string;
  match_score: number;
  is_new: number;
  date_first_found: string;
  date_last_seen: string;
}

interface DbScanRun {
  started_at: string;
  listings_found: number;
  listings_new: number;
  error_summary: string | null;
}

function toListingRow(r: DbListingRow): ListingRow {
  return {
    id: r.id,
    registration: r.registration,
    aircraftType: r.aircraft_type,
    make: r.make,
    model: r.model,
    year: r.year,
    price: r.price,
    priceCurrency: r.price_currency,
    location: r.location,
    listingUrl: r.listing_url,
    sourceSite: r.source_site,
    matchScore: r.match_score,
    isNew: r.is_new === 1,
    dateFirstFound: r.date_first_found,
    dateLastSeen: r.date_last_seen,
  };
}

export function createApp(db: Database.Database): Application {
  const app = express();

  app.get('/', (req, res) => {
    const typeFilter = typeof req.query.type === 'string' ? req.query.type.trim() : null;
    const maxPrice =
      typeof req.query.max_price === 'string' ? Number(req.query.max_price) : null;
    const newOnly = req.query.new_only === '1' || req.query.new_only === 'true';

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (typeFilter) {
      conditions.push(
        '(LOWER(aircraft_type) LIKE ? OR LOWER(make) LIKE ? OR LOWER(model) LIKE ?)'
      );
      const pat = `%${typeFilter.toLowerCase()}%`;
      params.push(pat, pat, pat);
    }
    if (maxPrice !== null && !isNaN(maxPrice)) {
      conditions.push('(price IS NULL OR price <= ?)');
      params.push(maxPrice);
    }
    if (newOnly) {
      conditions.push('is_new = 1');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const listings = (
      db
        .prepare(
          `SELECT * FROM listings ${where} ORDER BY match_score DESC, date_first_found DESC`
        )
        .all(...params) as DbListingRow[]
    ).map(toListingRow);

    const totalCount = (
      db.prepare('SELECT COUNT(*) as n FROM listings').get() as { n: number }
    ).n;

    const lastScanRow = db
      .prepare(
        `SELECT started_at, listings_found, listings_new, error_summary
         FROM scan_runs WHERE completed_at IS NOT NULL
         ORDER BY started_at DESC LIMIT 1`
      )
      .get() as DbScanRun | undefined;

    const lastScan: LastScanInfo | null = lastScanRow
      ? {
          startedAt: lastScanRow.started_at,
          listingsFound: lastScanRow.listings_found,
          listingsNew: lastScanRow.listings_new,
        }
      : null;

    const scanErrors: ScanError[] = lastScanRow?.error_summary
      ? (JSON.parse(lastScanRow.error_summary) as ScanError[])
      : [];

    const data: ListingsPageData = { listings, lastScan, scanErrors, totalCount };
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderListingsPage(data));
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  return app;
}

export function startServer(app: Application, port: number): http.Server {
  return app.listen(port, () => {
    logger.info({ port }, 'Web server listening');
  });
}
