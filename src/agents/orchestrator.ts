import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { resetIsNew, runHistorian } from './historian.js';
import { runScraper } from './scraper.js';
import { runScraperOllama } from './scraper-ollama.js';
import { runDetailFetcher, mergeAttributes } from './detail-fetcher.js';
import { runMatcher } from './matcher.js';
import { runPresenter } from './presenter.js';
import { getPendingListingIds, setStatusReady, setStatusFailed, markListingAiStale } from '../db/listing-ai.js';
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
  PresenterInput,
  PresenterOutput,
  DetailFetchResult,
} from '../types.js';
import type { Config, Criterion } from '../config.js';
import { logger } from '../config.js';

// Phase 3: Detail fetcher — see plan.md §Orchestrator Phase Order
const DETAIL_CONCURRENCY = 5;

export interface OrchestratorDeps {
  scraper?: (site: { name: string; url: string }) => Promise<ScraperOutput>;
  historian?: (
    listings: RawListing[],
    siteName: string,
    scanStartedAt: string
  ) => Promise<HistorianResult>;
  matcher?: (listings: ListingForScoring[], criteria: Criterion[], profiles?: InterestProfile[], db?: Database.Database, homeLocation?: { lat: number; lon: number } | null, scoringClient?: Anthropic | OpenAI | null, scoringModel?: string | null) => Promise<MatcherOutput>;
  presenter?: (input: PresenterInput, anthropic: Anthropic, model: string) => Promise<PresenterOutput>;
  detailFetcher?: (listingId: string, listingUrl: string, sourceSite: string) => Promise<DetailFetchResult>;
  presenterModel?: string;
  ollamaClient?: OpenAI;
  ollamaScraperModel?: string;
  scoringClient?: Anthropic | OpenAI | null;
  scoringModel?: string | null;
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

interface DbPresenterRow {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  price_currency: string;
  location: string | null;
  source_site: string;
  raw_attributes: string | null;
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

  // Phase order: see plan.md §Orchestrator Phase Order
  // Detail fetcher — fetch listing detail pages for richer attributes + images.
  // Runs BEFORE the matcher so enriched data is available for scoring.
  if (allListingIds.length > 0 && (deps.detailFetcher !== undefined || deps.ollamaClient)) {
    const ollamaClient = deps.ollamaClient;
    const ollamaModel = deps.ollamaScraperModel ?? '';

    interface DbUrlRow { listing_url: string; source_site: string; }

    const detailFetchFn =
      deps.detailFetcher ??
      ((listingId: string, listingUrl: string, sourceSite: string) =>
        runDetailFetcher(
          { listingId, listingUrl, sourceSite },
          ollamaClient!,
          ollamaModel
        ));

    let dfSucceeded = 0;
    let dfFailed = 0;

    for (let i = 0; i < allListingIds.length; i += DETAIL_CONCURRENCY) {
      const batch = allListingIds.slice(i, i + DETAIL_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (listingId) => {
          const urlRow = db
            .prepare('SELECT listing_url, source_site FROM listings WHERE id = ?')
            .get(listingId) as DbUrlRow | undefined;
          if (!urlRow) return;

          const result = await detailFetchFn(listingId, urlRow.listing_url, urlRow.source_site);

          if (result.error) {
            logger.warn({ listingId, error: result.error }, 'Detail fetcher: skipping listing');
            dfFailed++;
            return;
          }

          // Merge attributes: detail overwrites existing only when value is non-empty
          const existingRow = db
            .prepare('SELECT raw_attributes, thumbnail_url, all_image_urls FROM listings WHERE id = ?')
            .get(listingId) as {
              raw_attributes: string | null;
              thumbnail_url: string | null;
              all_image_urls: string | null;
            } | undefined;

          const existingAttrs: Record<string, string> = JSON.parse(
            existingRow?.raw_attributes ?? '{}'
          ) as Record<string, string>;
          const mergedAttrs = mergeAttributes(existingAttrs, result.attributes);

          const newThumbnail =
            result.imageUrls.length > 0
              ? result.imageUrls[0]
              : existingRow?.thumbnail_url ?? null;
          const newAllImages =
            result.imageUrls.length > 0
              ? JSON.stringify(result.imageUrls)
              : existingRow?.all_image_urls ?? null;

          db.prepare(`
            UPDATE listings SET
              raw_attributes  = ?,
              thumbnail_url   = ?,
              all_image_urls  = ?
            WHERE id = ?
          `).run(JSON.stringify(mergedAttrs), newThumbnail, newAllImages, listingId);

          markListingAiStale(db, listingId);
          dfSucceeded++;
        })
      );
    }

    logger.info(
      { total: allListingIds.length, succeeded: dfSucceeded, failed: dfFailed },
      'Detail fetch phase complete'
    );
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
        const matcherOut = await matcherFn(rows, config.criteria, profiles, db, config.home_location, deps.scoringClient, deps.scoringModel);
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

  // Run Presenter for all listings with pending AI content (new + stale)
  const pendingIds = getPendingListingIds(db);
  if (pendingIds.length > 0) {
    const presenterFn = deps.presenter ?? runPresenter;
    const presenterModel = deps.presenterModel ?? config.agent.matcher_model;

    logger.info({ count: pendingIds.length }, 'Presenter: generating headlines and explanations');

    await Promise.allSettled(
      pendingIds.map(async (listingId) => {
        try {
          const row = db
            .prepare(
              `SELECT id, make, model, year, price, price_currency, location, source_site, raw_attributes
               FROM listings WHERE id = ?`
            )
            .get(listingId) as DbPresenterRow | undefined;
          if (!row) return;

          const input: PresenterInput = {
            listing: {
              id: row.id,
              make: row.make,
              model: row.model,
              year: row.year,
              price: row.price,
              priceCurrency: row.price_currency,
              location: row.location,
              sourceSite: row.source_site,
              attributes: (JSON.parse(row.raw_attributes ?? '{}') as Record<string, string>),
            },
            profiles,
          };

          const output = await presenterFn(input, anthropic, presenterModel);
          setStatusReady(db, listingId, {
            headline: output.headline,
            explanation: output.explanation,
            modelVer: '',  // Populated with profile hash in Phase 6 (T016)
          });
          logger.debug({ listingId }, 'Presenter: done');
        } catch (err) {
          logger.error({ listingId, err }, 'Presenter: failed for listing');
          setStatusFailed(db, listingId);
        }
      })
    );
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
