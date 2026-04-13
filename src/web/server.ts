import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import express from 'express';
import type { Application } from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import cron from 'node-cron';
import { renderListingsPage, renderSuggestWeightsPage } from './render.js';
import type { ListingRow, LastScanInfo, ScanError, ListingsPageData, ActiveFilters, EvidenceRow, SuggestWeightsPageData } from './render.js';
import { runPresenter } from '../agents/presenter.js';
import { setStatusReady, setStatusFailed } from '../db/listing-ai.js';
import { logger, loadConfig } from '../config.js';
import { initDb } from '../db/index.js';
import { runScan } from '../agents/orchestrator.js';
import { createAdminRouter } from '../admin/routes.js';
import type { AdminRouterDeps } from '../admin/routes.js';
import { runWeightSuggester } from '../agents/weight-suggester.js';
import type { InterestProfile, FeedbackRecord, PresenterInput } from '../types.js';
import type { Config } from '../config.js';
import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { writeFileSync, readFileSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
  thumbnail_url: string | null;
  all_image_urls: string | null;  // JSON: string[]
  ai_headline: string | null;      // from listing_ai via LEFT JOIN
  ai_explanation: string | null;   // from listing_ai via LEFT JOIN
  ai_status: string | null;        // from listing_ai via LEFT JOIN
}

interface DbScanRun {
  started_at: string;
  listings_found: number;
  listings_new: number;
  error_summary: string | null;
}

interface DbListingScore {
  listing_id: string;
  profile_name: string;
  evidence: string;  // JSON: EvidenceItem[]
}

function toListingRow(r: DbListingRow): ListingRow {
  let allImageUrls: string[] = [];
  if (r.all_image_urls) {
    try {
      allImageUrls = JSON.parse(r.all_image_urls) as string[];
    } catch { /* ignore malformed JSON */ }
  }
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
    headline: r.ai_headline,
    explanation: r.ai_explanation,
    aiStatus: (r.ai_status as ListingRow['aiStatus']) ?? null,
    thumbnailUrl: r.thumbnail_url,
    allImageUrls,
  };
}

interface AppDeps {
  adminDeps?: AdminRouterDeps;
  anthropic?: Anthropic;
  config?: Config;
  profiles?: InterestProfile[];
  profilesDir?: string;
  presenter?: (input: PresenterInput, anthropic: Anthropic, model: string) => Promise<import('../types.js').PresenterOutput>;
}

export function createApp(db: Database.Database, adminDeps: AdminRouterDeps = {}, appDeps: AppDeps = {}): Application {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use('/admin', createAdminRouter(db, adminDeps));

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
          `SELECT l.*, lai.headline AS ai_headline, lai.explanation AS ai_explanation, lai.status AS ai_status
           FROM listings l
           LEFT JOIN listing_ai lai ON lai.listing_id = l.id
           ${where}
           ORDER BY l.match_score DESC, l.date_first_found DESC`
        )
        .all(...params) as DbListingRow[]
    ).map(toListingRow);

    // Populate per-criterion evidence from listing_scores
    if (listings.length > 0) {
      const ids = listings.map((l) => l.id);
      const placeholders = ids.map(() => '?').join(',');
      const scoreRows = db
        .prepare(
          `SELECT listing_id, profile_name, evidence FROM listing_scores WHERE listing_id IN (${placeholders})`
        )
        .all(...ids) as DbListingScore[];

      const evidenceMap = new Map<string, EvidenceRow[]>();
      for (const row of scoreRows) {
        try {
          const items = JSON.parse(row.evidence) as Array<{
            criterionName: string;
            matched: boolean;
            contribution: number;
            note: string;
          }>;
          const rows: EvidenceRow[] = items.map((item) => ({
            profileName: row.profile_name,
            criterionName: item.criterionName,
            matched: item.matched,
            contribution: item.contribution,
            note: item.note,
          }));
          const existing = evidenceMap.get(row.listing_id) ?? [];
          evidenceMap.set(row.listing_id, [...existing, ...rows]);
        } catch {
          // skip unparseable evidence rows
        }
      }

      for (const listing of listings) {
        const ev = evidenceMap.get(listing.id);
        if (ev) listing.evidence = ev;
      }
    }

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

    const filters: ActiveFilters = { type: typeFilter, maxPrice: maxPrice !== null && !isNaN(maxPrice) ? maxPrice : null, newOnly };
    const data: ListingsPageData = { listings, lastScan, scanErrors, totalCount, filters };
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderListingsPage(data));
  });

  // -------------------------------------------------------------------------
  // POST /feedback — store a listing rating
  // -------------------------------------------------------------------------
  app.post('/feedback', (req, res) => {
    const { listing_id, rating } = req.body as { listing_id?: string; rating?: string };
    const validRatings = ['more_interesting', 'as_expected', 'less_interesting'];

    if (!listing_id || typeof listing_id !== 'string') {
      res.status(400).send('Invalid listing_id');
      return;
    }
    if (!rating || !validRatings.includes(rating)) {
      res.status(400).send('Invalid rating');
      return;
    }

    const row = db.prepare('SELECT id FROM listings WHERE id = ?').get(listing_id);
    if (!row) {
      res.status(404).send('Listing not found');
      return;
    }

    const profiles = appDeps.profiles ?? [];
    const weightsSnapshot = JSON.stringify(
      profiles.map((p) => ({ profileName: p.name, weight: p.weight }))
    );

    db.prepare(
      `INSERT INTO listing_feedback (id, listing_id, rating, weights_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(randomUUID(), listing_id, rating, weightsSnapshot, new Date().toISOString());

    res.redirect('/');
  });

  // -------------------------------------------------------------------------
  // POST /rescore — regenerate AI headline/explanation for a listing (PRG)
  // -------------------------------------------------------------------------
  app.post('/rescore', async (req, res) => {
    const { listing_id } = req.body as { listing_id?: string };
    if (!listing_id) { res.redirect('/'); return; }

    interface DbRescoreRow {
      id: string; make: string | null; model: string | null; year: number | null;
      price: number | null; price_currency: string; location: string | null;
      source_site: string; raw_attributes: string | null;
    }
    const row = db.prepare(
      `SELECT id, make, model, year, price, price_currency, location, source_site, raw_attributes
       FROM listings WHERE id = ?`
    ).get(listing_id) as DbRescoreRow | undefined;

    if (!row) { res.redirect('/'); return; }

    const anthropicClient = appDeps.anthropic ?? new Anthropic();
    const config = appDeps.config;
    const presenterModel = config?.agent?.matcher_model ?? 'claude-sonnet-4-6';
    const profiles = appDeps.profiles ?? [];

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
        attributes: JSON.parse(row.raw_attributes ?? '{}') as Record<string, string>,
      },
      profiles,
    };

    const presenterFn = appDeps.presenter ?? runPresenter;

    try {
      const output = await presenterFn(input, anthropicClient, presenterModel);
      setStatusReady(db, listing_id, {
        headline: output.headline,
        explanation: output.explanation,
        modelVer: '',
      });
      logger.info({ listingId: listing_id }, 'Rescore: done');
    } catch (err) {
      logger.error({ listingId: listing_id, err }, 'Rescore: presenter failed');
      setStatusFailed(db, listing_id);
    }

    res.redirect('/');
  });

  // -------------------------------------------------------------------------
  // GET /suggest-weights — show pending or newly-generated weight suggestions
  // -------------------------------------------------------------------------
  app.get('/suggest-weights', async (_req, res) => {
    const config = appDeps.config;
    const minCount = config?.feedback_min_count ?? 5;

    const feedbackCount = (
      db.prepare(`SELECT COUNT(*) as n FROM listing_feedback WHERE rating != 'as_expected'`).get() as { n: number }
    ).n;

    const suggestData: SuggestWeightsPageData = { suggestions: [], feedbackCount, minCount };

    if (feedbackCount >= minCount) {
      // Check for existing pending suggestions
      const existing = db
        .prepare(`SELECT id, profile_name, current_weight, proposed_weight, rationale, feedback_count FROM weight_suggestions WHERE status = 'pending' ORDER BY created_at DESC`)
        .all() as Array<{
          id: string;
          profile_name: string;
          current_weight: number;
          proposed_weight: number;
          rationale: string;
          feedback_count: number;
        }>;

      if (existing.length > 0) {
        suggestData.suggestions = existing.map((r) => ({
          id: r.id,
          profileName: r.profile_name,
          currentWeight: r.current_weight,
          proposedWeight: r.proposed_weight,
          rationale: r.rationale,
          feedbackCount: r.feedback_count,
        }));
      } else if (appDeps.anthropic && config) {
        // Generate new suggestions
        const feedbackRows = db
          .prepare(`SELECT id, listing_id, rating, weights_snapshot, created_at FROM listing_feedback ORDER BY created_at DESC LIMIT 100`)
          .all() as Array<{
            id: string;
            listing_id: string;
            rating: string;
            weights_snapshot: string;
            created_at: string;
          }>;

        const feedback: FeedbackRecord[] = feedbackRows.map((r) => ({
          id: r.id,
          listingId: r.listing_id,
          rating: r.rating as FeedbackRecord['rating'],
          weightsSnapshot: JSON.parse(r.weights_snapshot) as Record<string, number>,
          createdAt: r.created_at,
        }));

        const profiles = appDeps.profiles ?? [];
        type SuggestionResult = Awaited<ReturnType<typeof runWeightSuggester>>;
        const proposed: SuggestionResult = await runWeightSuggester(feedback, profiles, appDeps.anthropic, config).catch((err) => {
          logger.error({ err }, 'WeightSuggester failed');
          return [] as SuggestionResult;
        });

        if (proposed.length > 0) {
          const createdAt = new Date().toISOString();
          const insert = db.prepare(
            `INSERT INTO weight_suggestions (id, profile_name, current_weight, proposed_weight, rationale, feedback_count, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
          );
          db.transaction(() => {
            for (const s of proposed) {
              insert.run(randomUUID(), s.profileName, s.currentWeight, s.proposedWeight, s.rationale, s.feedbackCount, createdAt);
            }
          })();

          suggestData.suggestions = proposed.map((s) => {
            const id = (db.prepare(`SELECT id FROM weight_suggestions WHERE profile_name = ? AND created_at = ? LIMIT 1`).get(s.profileName, createdAt) as { id: string } | undefined)?.id ?? '';
            return { id, profileName: s.profileName, currentWeight: s.currentWeight, proposedWeight: s.proposedWeight, rationale: s.rationale, feedbackCount: s.feedbackCount };
          });
        }
      }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderSuggestWeightsPage(suggestData));
  });

  // -------------------------------------------------------------------------
  // POST /suggest-weights/:action — accept or reject a suggestion
  // -------------------------------------------------------------------------
  app.post('/suggest-weights/:action', (req, res) => {
    const { action } = req.params;
    const { suggestion_id } = req.body as { suggestion_id?: string };

    if (action !== 'accept' && action !== 'reject') {
      res.status(400).send('Invalid action');
      return;
    }
    if (!suggestion_id) {
      res.status(400).send('Missing suggestion_id');
      return;
    }

    const suggestion = db
      .prepare(`SELECT * FROM weight_suggestions WHERE id = ? AND status = 'pending'`)
      .get(suggestion_id) as {
        id: string;
        profile_name: string;
        proposed_weight: number;
      } | undefined;

    if (!suggestion) {
      res.status(404).send('Suggestion not found or already resolved');
      return;
    }

    if (action === 'accept') {
      // Find profile YAML file and update weight atomically
      const profilesDir = appDeps.profilesDir ?? join(process.cwd(), 'profiles');
      let profileFiles: string[] = [];
      try {
        profileFiles = readdirSync(profilesDir).filter((f) => f.endsWith('.yml') && !f.endsWith('.bak'));
      } catch {
        // profiles dir not found
      }

      let updated = false;
      for (const file of profileFiles) {
        const filePath = join(profilesDir, file);
        try {
          const raw = yaml.load(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
          if (raw.name === suggestion.profile_name) {
            const tmpPath = filePath + '.tmp';
            const bakPath = filePath + '.bak';
            raw.weight = suggestion.proposed_weight;
            writeFileSync(tmpPath, yaml.dump(raw, { quotingType: '"', forceQuotes: false }), 'utf8');
            if (existsSync(filePath)) renameSync(filePath, bakPath);
            renameSync(tmpPath, filePath);
            updated = true;
            break;
          }
        } catch {
          // skip unreadable files
        }
      }

      if (updated) {
        logger.info({ profileName: suggestion.profile_name, newWeight: suggestion.proposed_weight }, 'Profile weight updated via suggestion accept');
      }
    }

    db.prepare(`UPDATE weight_suggestions SET status = ?, resolved_at = ? WHERE id = ?`)
      .run(action === 'accept' ? 'accepted' : 'rejected', new Date().toISOString(), suggestion_id);

    res.redirect('/suggest-weights');
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

// ---------------------------------------------------------------------------
// Entry point — only runs when this file is executed directly (npm start / npm run serve)
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const db = initDb();
  const anthropic = new Anthropic();
  const ollamaClient = config.ollama
    ? new OpenAI({ baseURL: `${config.ollama.url}/v1`, apiKey: 'ollama' })
    : undefined;

  // Load interest profiles (feature 002)
  const { loadProfiles } = await import('../services/profile-loader.js');
  const profilesDir = join(process.cwd(), 'profiles');  // join imported at top-level
  const profiles = loadProfiles(profilesDir);
  if (profiles.length > 0) {
    logger.info({ count: profiles.length }, 'Loaded interest profiles');
  }

  const app = createApp(
    db,
    {
      anthropic,
      config: { maxTokensPerAgent: config.agent.token_budget_per_run },
      ollamaClient,
      ollamaModel: config.ollama?.verification_model,
    },
    { anthropic, config, profiles, profilesDir }
  );
  startServer(app, config.web.port);

  const serveOnly = process.env.SERVE_ONLY === 'true';

  const ollamaScraperModel =
    config.ollama?.scraper_model ?? config.ollama?.verification_model;

  const scoringClient: Anthropic | OpenAI | null = config.ollama?.scoring_model
    ? new OpenAI({ baseURL: `${config.ollama.url}/v1`, apiKey: 'ollama' })
    : anthropic;
  const scoringModel = config.ollama?.scoring_model ?? 'claude-haiku-4-5-20251001';

  const scanDeps = {
    ...(ollamaClient && ollamaScraperModel ? { ollamaClient, ollamaScraperModel } : {}),
    scoringClient,
    scoringModel,
    profiles,
  };

  if (!serveOnly && config.schedule) {
    if (!cron.validate(config.schedule)) {
      logger.error({ schedule: config.schedule }, 'Invalid cron expression — scheduler disabled');
    } else {
      cron.schedule(config.schedule, () => {
        logger.info({ schedule: config.schedule }, 'Scheduled scan starting');
        runScan(db, config, scanDeps)
          .then((result) => logger.info(result, 'Scheduled scan complete'))
          .catch((err) => logger.error({ err }, 'Scheduled scan failed'));
      });
      logger.info({ schedule: config.schedule }, 'Cron scheduler registered');
    }
  }
}
