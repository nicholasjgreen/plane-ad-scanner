// Admin Express router — handles all /admin/* routes.
// All POST routes use PRG (Post/Redirect/Get) pattern — no HTML rendered from POST.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { applyTransition, canTransition } from '../services/siteStatus.js';
import type { SiteStatus } from '../services/siteStatus.js';
import { renderAdminPage } from './render.js';
import type { AdminSite, AdminCandidate, AdminVerificationResult } from './render.js';
import { runVerifier } from '../agents/verifier.js';
import { runVerifierOllama } from '../agents/verifier-ollama.js';
import { runDiscoverer } from '../agents/discoverer.js';
import type { DiscovererOutput } from '../types.js';
import { logger } from '../config.js';
import OpenAI from 'openai';

export interface AdminRouterDeps {
  anthropic?: Anthropic;
  config?: { maxTokensPerAgent: number };
  /** When set, verification uses Ollama instead of Anthropic */
  ollamaClient?: OpenAI;
  ollamaModel?: string;
  /** Injectable for testing — pre-bound discovery function */
  runDiscovery?: (existingUrls: string[]) => Promise<DiscovererOutput>;
}

export function createAdminRouter(db: Database.Database, deps: AdminRouterDeps = {}): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // Serialised verification queue — one site at a time to avoid rate limits.
  // -------------------------------------------------------------------------

  type VerificationTask = () => Promise<void>;
  const verificationQueue: VerificationTask[] = [];
  let verificationRunning = false;

  async function drainVerificationQueue(): Promise<void> {
    if (verificationRunning) return;
    verificationRunning = true;
    while (verificationQueue.length > 0) {
      const task = verificationQueue.shift()!;
      await task();
      if (verificationQueue.length > 0) {
        // Brief pause between verifications to ease rate-limit pressure.
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    verificationRunning = false;
  }

  function triggerVerification(
    site: { id: string; name: string; url: string },
    vrId: string
  ): void {
    const hasAnthropic = deps.anthropic && deps.config;
    const hasOllama = deps.ollamaClient && deps.ollamaModel;
    if (!hasAnthropic && !hasOllama) return;

    const anthropic = deps.anthropic!;
    const config = deps.config!;

    const task: VerificationTask = async () => {
      logger.info({ siteId: site.id, vrId, queue: verificationQueue.length }, 'Starting verification');
      try {
        const result =
          deps.ollamaClient && deps.ollamaModel
            ? await runVerifierOllama(site, deps.ollamaClient, deps.ollamaModel)
            : await runVerifier(site, anthropic, config);
        const now = new Date().toISOString();
        db.prepare(
          `UPDATE verification_results
             SET listings_sample = ?, passed = ?, completed_at = ?, failure_reason = ?
           WHERE id = ?`
        ).run(
          JSON.stringify(result.sampleListings),
          result.canFetchListings ? 1 : 0,
          now,
          result.failureReason ?? null,
          vrId
        );
        logger.info(
          { siteId: site.id, vrId, canFetch: result.canFetchListings, turns: result.turnsUsed },
          'Verification complete'
        );
      } catch (err: unknown) {
        const msg = (err as Error).message;
        logger.error({ siteId: site.id, vrId, err: msg }, 'Verification threw unexpectedly');
        try {
          db.prepare(
            `UPDATE verification_results
               SET passed = 0, completed_at = ?, failure_reason = ?
             WHERE id = ?`
          ).run(new Date().toISOString(), msg, vrId);
        } catch {
          // ignore secondary DB error
        }
      }
    };

    verificationQueue.push(task);
    void drainVerificationQueue();
  }

  // -------------------------------------------------------------------------
  // GET /admin — render site list with latest verification results
  // -------------------------------------------------------------------------

  router.get('/', (req, res) => {
    const siteRows = db
      .prepare(
        `SELECT id, name, url, status, priority, total_listings, last_scan_outcome, last_verified
         FROM sites ORDER BY
           CASE status WHEN 'enabled' THEN 0 WHEN 'pending' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
           priority ASC, name ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      url: string;
      status: string;
      priority: number;
      total_listings: number;
      last_scan_outcome: string | null;
      last_verified: string | null;
    }>;

    // Latest verification result per site (one query, matched by Map)
    const vrRows = db
      .prepare(
        `SELECT site_id, listings_sample, passed, failure_reason, attempted_at
         FROM verification_results
         WHERE attempted_at = (
           SELECT MAX(vr2.attempted_at) FROM verification_results vr2
           WHERE vr2.site_id = verification_results.site_id
         )`
      )
      .all() as Array<{
      site_id: string;
      listings_sample: string | null;
      passed: number | null;
      failure_reason: string | null;
      attempted_at: string;
    }>;

    const vrBySite = new Map(vrRows.map((r) => [r.site_id, r]));

    const sites: AdminSite[] = siteRows.map((r) => {
      const vr = vrBySite.get(r.id);
      const verificationResult: AdminVerificationResult | null = vr
        ? {
            listingsSample: vr.listings_sample,
            passed: vr.passed,
            failureReason: vr.failure_reason,
            attemptedAt: vr.attempted_at,
          }
        : null;

      return {
        id: r.id,
        name: r.name,
        url: r.url,
        status: r.status as AdminSite['status'],
        priority: r.priority,
        totalListings: r.total_listings,
        lastScanOutcome: r.last_scan_outcome,
        lastVerified: r.last_verified,
        verificationResult,
      };
    });

    const candidateRows = db
      .prepare(
        `SELECT id, url, name, description FROM discovery_candidates
         WHERE status = 'pending_review' ORDER BY discovered_at DESC`
      )
      .all() as Array<{
      id: string;
      url: string;
      name: string;
      description: string | null;
    }>;

    const candidates: AdminCandidate[] = candidateRows.map((r) => ({
      id: r.id,
      url: r.url,
      name: r.name,
      description: r.description,
    }));

    const msg = typeof req.query.msg === 'string' ? req.query.msg : undefined;
    const type = req.query.type === 'error' ? 'error' : 'success';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      renderAdminPage({
        sites,
        candidates,
        flash: msg ? { msg, type } : null,
      })
    );
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites — add a site (triggers verification async)
  // -------------------------------------------------------------------------

  router.post('/sites', (req, res) => {
    const name = (req.body?.name as string | undefined)?.trim() ?? '';
    const url = (req.body?.url as string | undefined)?.trim() ?? '';

    if (!name) {
      res.redirect('/admin?msg=Name+required&type=error');
      return;
    }
    if (!url.match(/^https?:\/\//)) {
      res.redirect('/admin?msg=Invalid+URL&type=error');
      return;
    }

    const existing = db.prepare('SELECT id FROM sites WHERE url = ?').get(url);
    if (existing) {
      res.redirect('/admin?msg=URL+already+exists&type=error');
      return;
    }

    const id = randomUUID();
    const vrId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sites (id, name, url, enabled, status, priority, created_at)
       VALUES (?, ?, ?, 0, 'pending', 0, ?)`
    ).run(id, name, url, now);
    db.prepare(
      `INSERT INTO verification_results (id, site_id, attempted_at) VALUES (?, ?, ?)`
    ).run(vrId, id, now);

    logger.info({ siteId: id, vrId, name, url }, 'Site added via admin, verification triggered');
    triggerVerification({ id, name, url }, vrId);
    res.redirect('/admin?msg=Site+added&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites/:id/disable
  // -------------------------------------------------------------------------

  router.post('/sites/:id/disable', (req, res) => {
    const site = db
      .prepare('SELECT id, status FROM sites WHERE id = ?')
      .get(req.params.id) as { id: string; status: string } | undefined;

    if (!site) {
      res.redirect('/admin?msg=Site+not+found&type=error');
      return;
    }

    try {
      applyTransition(site.status as SiteStatus, 'disable');
      db.prepare("UPDATE sites SET status = 'disabled' WHERE id = ?").run(site.id);
      logger.info({ siteId: site.id }, 'Site disabled via admin');
      res.redirect('/admin?msg=Site+disabled&type=success');
    } catch {
      res.redirect('/admin?msg=Cannot+disable+site&type=error');
    }
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites/:id/enable
  // -------------------------------------------------------------------------

  router.post('/sites/:id/enable', (req, res) => {
    const site = db
      .prepare('SELECT id, status FROM sites WHERE id = ?')
      .get(req.params.id) as { id: string; status: string } | undefined;

    if (!site) {
      res.redirect('/admin?msg=Site+not+found&type=error');
      return;
    }

    if (!canTransition(site.status as SiteStatus, 'enable')) {
      res.redirect('/admin?msg=Cannot+enable+site+from+current+status&type=error');
      return;
    }

    db.prepare("UPDATE sites SET status = 'enabled' WHERE id = ?").run(site.id);
    logger.info({ siteId: site.id }, 'Site enabled via admin');
    res.redirect('/admin?msg=Site+enabled&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites/:id/verify — trigger/re-trigger verification
  // -------------------------------------------------------------------------

  router.post('/sites/:id/verify', (req, res) => {
    const site = db
      .prepare('SELECT id, name, url, status FROM sites WHERE id = ?')
      .get(req.params.id) as { id: string; name: string; url: string; status: string } | undefined;

    if (!site) {
      res.redirect('/admin?msg=Site+not+found&type=error');
      return;
    }

    if (!canTransition(site.status as SiteStatus, 'trigger_verify')) {
      res.redirect('/admin?msg=Cannot+verify+site+from+current+status&type=error');
      return;
    }

    const now = new Date().toISOString();
    const vrId = randomUUID();
    db.prepare("UPDATE sites SET status = 'pending' WHERE id = ?").run(site.id);
    db.prepare(
      `INSERT INTO verification_results (id, site_id, attempted_at) VALUES (?, ?, ?)`
    ).run(vrId, site.id, now);

    logger.info({ siteId: site.id, vrId }, 'Verification triggered via admin');
    triggerVerification(site, vrId);
    res.redirect('/admin?msg=Verification+started&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites/:id/verify/approve
  // -------------------------------------------------------------------------

  router.post('/sites/:id/verify/approve', (req, res) => {
    const site = db
      .prepare('SELECT id, status FROM sites WHERE id = ?')
      .get(req.params.id) as { id: string; status: string } | undefined;

    if (!site) {
      res.redirect('/admin?msg=Site+not+found&type=error');
      return;
    }

    try {
      applyTransition(site.status as SiteStatus, 'approve_verification');
    } catch {
      res.redirect('/admin?msg=Cannot+approve+verification&type=error');
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE verification_results SET passed = 1, completed_at = ?
       WHERE site_id = ? AND passed IS NULL
       ORDER BY attempted_at DESC LIMIT 1`
    ).run(now, site.id);
    db.prepare(
      `UPDATE sites SET status = 'enabled', last_verified = ? WHERE id = ?`
    ).run(now, site.id);

    logger.info({ siteId: site.id }, 'Verification approved via admin');
    res.redirect('/admin?msg=Site+enabled&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites/:id/verify/reject
  // -------------------------------------------------------------------------

  router.post('/sites/:id/verify/reject', (req, res) => {
    const site = db
      .prepare('SELECT id, status FROM sites WHERE id = ?')
      .get(req.params.id) as { id: string; status: string } | undefined;

    if (!site) {
      res.redirect('/admin?msg=Site+not+found&type=error');
      return;
    }

    try {
      applyTransition(site.status as SiteStatus, 'reject_verification');
    } catch {
      res.redirect('/admin?msg=Cannot+reject+verification&type=error');
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE verification_results SET passed = 0, completed_at = ?, failure_reason = 'Rejected by admin'
       WHERE site_id = ? AND passed IS NULL
       ORDER BY attempted_at DESC LIMIT 1`
    ).run(now, site.id);
    db.prepare(
      `UPDATE sites SET status = 'verification_failed' WHERE id = ?`
    ).run(site.id);

    logger.info({ siteId: site.id }, 'Verification rejected via admin');
    res.redirect('/admin?msg=Site+verification+failed&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/sites/:id/priority
  // -------------------------------------------------------------------------

  router.post('/sites/:id/priority', (req, res) => {
    const site = db
      .prepare('SELECT id FROM sites WHERE id = ?')
      .get(req.params.id) as { id: string } | undefined;

    if (!site) {
      res.redirect('/admin?msg=Site+not+found&type=error');
      return;
    }

    const rawPriority = req.body?.priority as string | undefined;
    const priority = rawPriority !== undefined ? parseInt(rawPriority, 10) : NaN;
    if (isNaN(priority) || priority < 0) {
      res.redirect('/admin?msg=Invalid+priority&type=error');
      return;
    }

    db.prepare('UPDATE sites SET priority = ? WHERE id = ?').run(priority, site.id);
    res.redirect('/admin?msg=Priority+updated&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/discovery/run
  // -------------------------------------------------------------------------

  router.post('/discovery/run', (_req, res) => {
    logger.info('Discovery run triggered via admin');

    // Collect all known URLs to pass to the discoverer for exclusion
    const existingUrls = [
      ...(
        db.prepare('SELECT url FROM sites').all() as { url: string }[]
      ).map((r) => r.url),
      ...(
        db.prepare('SELECT url FROM discovery_candidates').all() as { url: string }[]
      ).map((r) => r.url),
    ];

    // Resolve the discovery function: injected dep (tests) or real discoverer
    const discoveryFn: ((existingUrls: string[]) => Promise<DiscovererOutput>) | null =
      deps.runDiscovery ??
      (deps.anthropic && deps.config
        ? (urls) => runDiscoverer({ existingUrls: urls }, deps.anthropic!, deps.config!)
        : null);

    if (discoveryFn) {
      discoveryFn(existingUrls)
        .then((result) => {
          const now = new Date().toISOString();
          const insert = db.prepare(
            `INSERT INTO discovery_candidates (id, url, name, description, discovered_at, status)
             VALUES (?, ?, ?, ?, ?, 'pending_review')
             ON CONFLICT(url) DO NOTHING`
          );
          db.transaction(() => {
            for (const c of result.candidates) {
              insert.run(randomUUID(), c.url, c.name, c.description, now);
            }
          })();
          logger.info({ inserted: result.candidates.length }, 'Discovery run complete');
        })
        .catch((err: unknown) => {
          logger.error({ err: (err as Error).message }, 'Discovery run failed');
        });
    }

    res.redirect('/admin?msg=Discovery+running&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/discovery/candidates/:id/approve
  // -------------------------------------------------------------------------

  router.post('/discovery/candidates/:id/approve', (req, res) => {
    const candidate = db
      .prepare('SELECT id, url, name FROM discovery_candidates WHERE id = ?')
      .get(req.params.id) as { id: string; url: string; name: string } | undefined;

    if (!candidate) {
      res.redirect('/admin?msg=Candidate+not+found&type=error');
      return;
    }

    const existing = db.prepare('SELECT id FROM sites WHERE url = ?').get(candidate.url);
    if (existing) {
      res.redirect('/admin?msg=Already+exists&type=error');
      return;
    }

    const siteId = randomUUID();
    const vrId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sites (id, name, url, enabled, status, priority, created_at)
       VALUES (?, ?, ?, 0, 'pending', 0, ?)`
    ).run(siteId, candidate.name, candidate.url, now);
    db.prepare(
      `INSERT INTO verification_results (id, site_id, attempted_at) VALUES (?, ?, ?)`
    ).run(vrId, siteId, now);
    db.prepare("UPDATE discovery_candidates SET status = 'approved' WHERE id = ?").run(candidate.id);

    logger.info({ candidateId: candidate.id, siteId, vrId }, 'Discovery candidate approved, verification triggered');
    triggerVerification({ id: siteId, name: candidate.name, url: candidate.url }, vrId);
    res.redirect('/admin?msg=Candidate+approved&type=success');
  });

  // -------------------------------------------------------------------------
  // POST /admin/discovery/candidates/:id/dismiss
  // -------------------------------------------------------------------------

  router.post('/discovery/candidates/:id/dismiss', (req, res) => {
    const candidate = db
      .prepare('SELECT id FROM discovery_candidates WHERE id = ?')
      .get(req.params.id) as { id: string } | undefined;

    if (!candidate) {
      res.redirect('/admin?msg=Candidate+not+found&type=error');
      return;
    }

    db.prepare("UPDATE discovery_candidates SET status = 'dismissed' WHERE id = ?").run(candidate.id);
    logger.info({ candidateId: candidate.id }, 'Discovery candidate dismissed via admin');
    res.redirect('/admin?msg=Candidate+dismissed&type=success');
  });

  return router;
}
