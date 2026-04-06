import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { resetIsNew, runHistorian } from './historian.js';
import { runScraper } from './scraper.js';
import { runScraperOllama } from './scraper-ollama.js';
import { runMatcher } from './matcher.js';
import OpenAI from 'openai';
import type {
  ScraperOutput,
  RawListing,
  MatcherOutput,
  ListingForScoring,
  HistorianResult,
  ScanRunResult,
  ScanError,
  InterestProfile,
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
  matcher?: (listings: ListingForScoring[], criteria: Criterion[], profiles?: InterestProfile[], db?: Database.Database, homeLocation?: { lat: number; lon: number } | null) => Promise<MatcherOutput>;
  ollamaClient?: OpenAI;
  ollamaScraperModel?: string;
  profiles?: InterestProfile[];
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
    .prepare("SELECT id, name, url FROM sites WHERE status = 'enabled' ORDER BY priority ASC")
    .all() as { id: string; name: string; url: string }[];

  logger.info({ scanId, sites: sites.length }, 'Scan started');

  const anthropic = new Anthropic();
  const tokenBudgetPerSite = Math.max(
    1000,
    Math.floor(config.agent.token_budget_per_run / Math.max(sites.length, 1))
  );

  const scraperFn =
    deps.scraper ??
    (deps.ollamaClient && deps.ollamaScraperModel
      ? (site) => runScraperOllama(site, deps.ollamaClient!, deps.ollamaScraperModel!)
      : (site) => runScraper(site, anthropic, { maxTokensPerAgent: tokenBudgetPerSite }));

  const historianFn =
    deps.historian ??
    ((listings, siteName, ts) => runHistorian(db, listings, siteName, ts));

  const matcherFn = deps.matcher ?? runMatcher;
  const profiles = deps.profiles ?? [];

  // Run all scrapers in parallel
  const settled = await Promise.allSettled(sites.map((s) => scraperFn(s)));

  const errors: ScanError[] = [];
  let totalFound = 0;
  let totalNew = 0;
  let succeeded = 0;
  const allListingIds: string[] = [];

  const updateSiteOutcome = (
    siteName: string,
    outcome: { date: string; listingsFound: number; error?: string }
  ) => {
    try {
      db.prepare(
        `UPDATE sites
           SET last_scan_outcome = ?,
               total_listings    = (SELECT COUNT(*) FROM listings WHERE source_site = ?)
         WHERE name = ?`
      ).run(JSON.stringify(outcome), siteName, siteName);
    } catch (err) {
      logger.warn({ site: siteName, err }, 'Failed to update site scan outcome');
    }
  };

  for (let i = 0; i < settled.length; i++) {
    const site = sites[i];
    const result = settled[i];

    if (result.status === 'rejected') {
      const errMsg = String(result.reason);
      errors.push({ site: site.name, error: errMsg });
      updateSiteOutcome(site.name, { date: startedAt, listingsFound: 0, error: errMsg });
      continue;
    }

    const output = result.value;
    if (output.error) {
      errors.push({ site: site.name, error: output.error });
      updateSiteOutcome(site.name, { date: startedAt, listingsFound: 0, error: output.error });
      continue;
    }

    succeeded++;
    const valid = validate(output.listings);
    totalFound += valid.length;

    const hist = await historianFn(valid, site.name, startedAt);
    totalNew += hist.newCount;
    allListingIds.push(...hist.listingIds);
    updateSiteOutcome(site.name, { date: startedAt, listingsFound: valid.length });
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
        const matcherOut = await matcherFn(rows, config.criteria, profiles, db, config.home_location);
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
