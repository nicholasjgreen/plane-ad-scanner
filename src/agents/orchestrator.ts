import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { resetIsNew, runHistorian } from './historian.js';
import { runScraper } from './scraper.js';
import { runMatcher } from './matcher.js';
import type {
  ScraperOutput,
  RawListing,
  MatcherOutput,
  ListingForScoring,
  HistorianResult,
  ScanRunResult,
  ScanError,
} from '../types.js';
import type { Config, Criterion } from '../config.js';
import { logger } from '../config.js';

export interface OrchestratorDeps {
  scraper?: (site: { name: string; url: string }) => Promise<ScraperOutput>;
  historian?: (
    listings: RawListing[],
    siteName: string,
    scanStartedAt: string
  ) => Promise<HistorianResult>;
  matcher?: (listings: ListingForScoring[], criteria: Criterion[]) => Promise<MatcherOutput>;
}

// Validate raw listings from the scraper before passing to the Historian.
function validate(listings: RawListing[]): RawListing[] {
  const currentYear = new Date().getFullYear();
  return listings.filter((l) => {
    if (!/^https?:\/\//.test(l.listingUrl)) {
      logger.warn({ url: l.listingUrl }, 'Discarding listing: invalid URL');
      return false;
    }
    if (l.price !== undefined && l.price <= 0) l.price = undefined;
    if (l.year !== undefined && (l.year < 1900 || l.year > currentYear + 1)) l.year = undefined;
    return true;
  });
}

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
}

function toListingForScoring(row: DbListingRow): ListingForScoring {
  return {
    id: row.id,
    registration: row.registration,
    aircraftType: row.aircraft_type,
    make: row.make,
    model: row.model,
    year: row.year,
    price: row.price,
    priceCurrency: row.price_currency,
    location: row.location,
  };
}

export async function runScan(
  db: Database.Database,
  config: Config,
  deps: OrchestratorDeps = {}
): Promise<ScanRunResult> {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO scan_runs (id, started_at, sites_attempted, sites_succeeded, sites_failed, listings_found, listings_new)
     VALUES (?, ?, 0, 0, 0, 0, 0)`
  ).run(scanId, startedAt);

  resetIsNew(db);

  const sites = db
    .prepare('SELECT name, url FROM sites WHERE enabled = 1 ORDER BY priority ASC')
    .all() as { name: string; url: string }[];

  logger.info({ scanId, sites: sites.length }, 'Scan started');

  const anthropic = new Anthropic();
  const tokenBudgetPerSite = Math.max(
    1000,
    Math.floor(config.agent.token_budget_per_run / Math.max(sites.length, 1))
  );

  const scraperFn =
    deps.scraper ??
    ((site) =>
      runScraper(site, anthropic, { maxTokensPerAgent: tokenBudgetPerSite }));

  const historianFn =
    deps.historian ??
    ((listings, siteName, ts) => runHistorian(db, listings, siteName, ts));

  const matcherFn = deps.matcher ?? runMatcher;

  // Run all scrapers in parallel
  const settled = await Promise.allSettled(sites.map((s) => scraperFn(s)));

  const errors: ScanError[] = [];
  let totalFound = 0;
  let totalNew = 0;
  let succeeded = 0;
  const allListingIds: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const site = sites[i];
    const result = settled[i];

    if (result.status === 'rejected') {
      errors.push({ site: site.name, error: String(result.reason) });
      continue;
    }

    const output = result.value;
    if (output.error) {
      errors.push({ site: site.name, error: output.error });
      continue;
    }

    succeeded++;
    const valid = validate(output.listings);
    totalFound += valid.length;

    const hist = await historianFn(valid, site.name, startedAt);
    totalNew += hist.newCount;
    allListingIds.push(...hist.listingIds);
  }

  // Score all listings via Matcher; on failure, retain existing DB scores
  if (allListingIds.length > 0) {
    try {
      const rows = allListingIds
        .map(
          (id) =>
            db
              .prepare(
                `SELECT id, registration, aircraft_type, make, model, year, price, price_currency, location
                 FROM listings WHERE id = ?`
              )
              .get(id) as DbListingRow | undefined
        )
        .filter((r): r is DbListingRow => r !== undefined)
        .map(toListingForScoring);

      if (rows.length > 0) {
        const matcherOut = await matcherFn(rows, config.criteria);
        if (matcherOut.scores.length > 0) {
          const upd = db.prepare('UPDATE listings SET match_score = ? WHERE id = ?');
          db.transaction(() => {
            for (const s of matcherOut.scores) upd.run(s.score, s.listingId);
          })();
        }
      }
    } catch (err) {
      logger.error({ err }, 'Matcher failed — retaining existing scores');
    }
  }

  db.prepare(
    `UPDATE scan_runs SET
       completed_at    = ?,
       sites_attempted = ?,
       sites_succeeded = ?,
       sites_failed    = ?,
       listings_found  = ?,
       listings_new    = ?,
       error_summary   = ?
     WHERE id = ?`
  ).run(
    new Date().toISOString(),
    sites.length,
    succeeded,
    errors.length,
    totalFound,
    totalNew,
    errors.length > 0 ? JSON.stringify(errors) : null,
    scanId
  );

  logger.info({ scanId, found: totalFound, new: totalNew, errors: errors.length }, 'Scan complete');

  return {
    id: scanId,
    sitesAttempted: sites.length,
    sitesSucceeded: succeeded,
    sitesFailed: errors.length,
    listingsFound: totalFound,
    listingsNew: totalNew,
    errors,
  };
}
