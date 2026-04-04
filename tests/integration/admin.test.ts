/**
 * T007 [TDD] — Admin route integration tests (US1 + US2).
 * T014 — Verification flow (US3): approve/reject.
 * T017 — Site health dashboard (US5): all four statuses, listing counts, candidates.
 * T020 — Discovery flow (US4): run, approve candidate, dismiss candidate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import { createApp } from '../../src/web/server.js';
import { createAdminRouter } from '../../src/admin/routes.js';
import express from 'express';

const NOW = '2026-04-04T10:00:00.000Z';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedSite(
  db: Database.Database,
  opts: {
    name?: string;
    url?: string;
    status?: string;
    priority?: number;
  } = {}
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sites (id, name, url, enabled, status, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.name ?? 'Test Site',
    opts.url ?? 'https://example.com',
    opts.status === 'enabled' || opts.status == null ? 1 : 0,
    opts.status ?? 'enabled',
    opts.priority ?? 0,
    NOW
  );
  return id;
}

function startTestServer(db: Database.Database): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const app = createApp(db);
    const server = app.listen(0, () => {
      const { port } = server.address() as { port: number };
      resolve({ server, base: `http://localhost:${port}` });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// GET /admin — site list
// ---------------------------------------------------------------------------

describe('GET /admin', () => {
  let db: Database.Database;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  it('returns 200 and renders site list', async () => {
    seedSite(db, { name: 'Trade-A-Plane', url: 'https://trade-a-plane.com', status: 'enabled' });
    const res = await fetch(`${base}/admin`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Trade-A-Plane');
    expect(html).toContain('https://trade-a-plane.com');
  });

  it('shows status badge for enabled site', async () => {
    seedSite(db, { status: 'enabled' });
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('badge--enabled');
  });

  it('shows status badge for pending site', async () => {
    seedSite(db, { status: 'pending' });
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('badge--pending');
  });

  it('shows status badge for disabled site', async () => {
    seedSite(db, { status: 'disabled' });
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('badge--disabled');
  });

  it('shows status badge for verification_failed site', async () => {
    seedSite(db, { status: 'verification_failed' });
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('badge--failed');
  });

  it('includes Add site form', async () => {
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('action="/admin/sites"');
  });

  it('shows flash message from query string', async () => {
    const html = await (await fetch(`${base}/admin?msg=Site+added&type=success`)).text();
    expect(html).toContain('Site added');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/sites — add site
// ---------------------------------------------------------------------------

describe('POST /admin/sites', () => {
  let db: Database.Database;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  async function postForm(path: string, body: Record<string, string>): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      redirect: 'manual',
    });
  }

  it('adds site with status=pending and redirects', async () => {
    const res = await postForm('/admin/sites', {
      name: 'New Site',
      url: 'https://new-site.com',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/admin');
    expect(location).toContain('type=success');

    const site = db.prepare("SELECT * FROM sites WHERE name = 'New Site'").get() as
      | { status: string }
      | undefined;
    expect(site).toBeDefined();
    expect(site!.status).toBe('pending');
  });

  it('rejects duplicate URL with error redirect', async () => {
    seedSite(db, { url: 'https://existing.com' });
    const res = await postForm('/admin/sites', {
      name: 'Another',
      url: 'https://existing.com',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=error');
  });

  it('rejects invalid URL (no https://) with error redirect', async () => {
    const res = await postForm('/admin/sites', {
      name: 'Bad',
      url: 'not-a-url',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=error');
  });

  it('rejects blank name with error redirect', async () => {
    const res = await postForm('/admin/sites', {
      name: '',
      url: 'https://valid.com',
    });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=error');
  });
});

// ---------------------------------------------------------------------------
// POST /admin/sites/:id/disable and /enable
// ---------------------------------------------------------------------------

describe('POST /admin/sites/:id/disable and /enable', () => {
  let db: Database.Database;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  async function postEmpty(path: string): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: 'POST',
      redirect: 'manual',
    });
  }

  it('disable changes status to disabled and redirects', async () => {
    const id = seedSite(db, { status: 'enabled' });
    const res = await postEmpty(`/admin/sites/${id}/disable`);
    expect(res.status).toBe(302);
    const site = db.prepare('SELECT status FROM sites WHERE id = ?').get(id) as {
      status: string;
    };
    expect(site.status).toBe('disabled');
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=success');
  });

  it('enable changes status to enabled and redirects', async () => {
    const id = seedSite(db, { status: 'disabled' });
    const res = await postEmpty(`/admin/sites/${id}/enable`);
    expect(res.status).toBe(302);
    const site = db.prepare('SELECT status FROM sites WHERE id = ?').get(id) as {
      status: string;
    };
    expect(site.status).toBe('enabled');
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=success');
  });

  it('enable from non-disabled status redirects with error', async () => {
    const id = seedSite(db, { status: 'pending' });
    const res = await postEmpty(`/admin/sites/${id}/enable`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=error');
  });

  it('unknown site ID returns error redirect', async () => {
    const res = await postEmpty(`/admin/sites/${randomUUID()}/disable`);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('type=error');
  });
});

// ---------------------------------------------------------------------------
// T014 — POST /admin/sites/:id/verify/approve and /reject
// ---------------------------------------------------------------------------

describe('POST /admin/sites/:id/verify/approve and /reject', () => {
  let db: Database.Database;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  async function postEmpty(path: string): Promise<Response> {
    return fetch(`${base}${path}`, { method: 'POST', redirect: 'manual' });
  }

  function seedVerificationResult(
    siteId: string,
    passed: 1 | 0 | null,
    listingsSample = '[]'
  ): string {
    const vrId = randomUUID();
    const now = NOW;
    db.prepare(
      `INSERT INTO verification_results (id, site_id, attempted_at, completed_at, listings_sample, passed)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(vrId, siteId, now, passed !== null ? now : null, listingsSample, passed);
    return vrId;
  }

  it('approve pending site changes status to enabled', async () => {
    const id = seedSite(db, { status: 'pending' });
    seedVerificationResult(id, 1);
    const res = await postEmpty(`/admin/sites/${id}/verify/approve`);
    expect(res.status).toBe(302);
    const site = db.prepare('SELECT status FROM sites WHERE id = ?').get(id) as { status: string };
    expect(site.status).toBe('enabled');
    expect(res.headers.get('location') ?? '').toContain('type=success');
  });

  it('reject pending site changes status to verification_failed', async () => {
    const id = seedSite(db, { status: 'pending' });
    seedVerificationResult(id, 1);
    const res = await postEmpty(`/admin/sites/${id}/verify/reject`);
    expect(res.status).toBe(302);
    const site = db.prepare('SELECT status FROM sites WHERE id = ?').get(id) as { status: string };
    expect(site.status).toBe('verification_failed');
    expect(res.headers.get('location') ?? '').toContain('type=success');
  });

  it('approve from non-pending status redirects with error', async () => {
    const id = seedSite(db, { status: 'enabled' });
    const res = await postEmpty(`/admin/sites/${id}/verify/approve`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('type=error');
  });

  it('GET /admin shows approve/reject buttons for pending site with completed verification', async () => {
    const id = seedSite(db, { name: 'Verified Site', status: 'pending' });
    seedVerificationResult(id, 1, JSON.stringify([{ listingUrl: 'https://example.com/1' }]));
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('vr--ready');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  it('GET /admin shows in-progress message for pending verification', async () => {
    const id = seedSite(db, { status: 'pending' });
    seedVerificationResult(id, null);
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('vr--progress');
  });

  it('unknown site ID returns error redirect', async () => {
    const res = await postEmpty(`/admin/sites/${randomUUID()}/verify/approve`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('type=error');
  });
});

// ---------------------------------------------------------------------------
// T017 — GET /admin site health dashboard (US5)
// ---------------------------------------------------------------------------

describe('GET /admin site health dashboard', () => {
  let db: Database.Database;
  let server: http.Server;
  let base: string;

  beforeEach(async () => {
    db = createTestDb();
    ({ server, base } = await startTestServer(db));
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  function seedCandidate(
    opts: { url?: string; name?: string; status?: string } = {}
  ): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO discovery_candidates (id, url, name, description, discovered_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      opts.url ?? `https://candidate-${id}.com`,
      opts.name ?? 'Test Candidate',
      'A test candidate',
      NOW,
      opts.status ?? 'pending_review'
    );
    return id;
  }

  it('shows all four status badges for sites in each state', async () => {
    seedSite(db, { name: 'Enabled Site', status: 'enabled' });
    seedSite(db, { name: 'Pending Site', url: 'https://pending.com', status: 'pending' });
    seedSite(db, { name: 'Disabled Site', url: 'https://disabled.com', status: 'disabled' });
    seedSite(db, {
      name: 'Failed Site',
      url: 'https://failed.com',
      status: 'verification_failed',
    });

    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('badge--enabled');
    expect(html).toContain('badge--pending');
    expect(html).toContain('badge--disabled');
    expect(html).toContain('badge--failed');
  });

  it('shows listing count column', async () => {
    seedSite(db, { name: 'Count Site', status: 'enabled' });
    const html = await (await fetch(`${base}/admin`)).text();
    // total_listings column header
    expect(html).toContain('Listings');
  });

  it('shows pending candidates section when candidates exist', async () => {
    seedCandidate({ name: 'New Candidate' });
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).toContain('New Candidate');
    expect(html).toContain('Discovery Proposals');
  });

  it('does not show candidates section when no pending candidates', async () => {
    // dismissed candidate should not appear
    seedCandidate({ name: 'Dismissed', status: 'dismissed' });
    const html = await (await fetch(`${base}/admin`)).text();
    expect(html).not.toContain('Discovery Proposals');
  });
});

// ---------------------------------------------------------------------------
// T020 — Discovery flow integration tests (US4)
// ---------------------------------------------------------------------------

describe('Discovery flow — POST /admin/discovery/run, approve, dismiss', () => {
  let db: Database.Database;
  let server: http.Server;
  let base: string;

  function makeServer(
    testDb: Database.Database,
    runDiscovery: (existingUrls: string[]) => Promise<{ candidates: { url: string; name: string; description: string }[] }>
  ): Promise<{ server: http.Server; base: string }> {
    return new Promise((resolve) => {
      const app = express();
      app.use(express.urlencoded({ extended: false }));
      app.use('/admin', createAdminRouter(testDb, { runDiscovery }));
      const s = app.listen(0, () => {
        const { port } = s.address() as { port: number };
        resolve({ server: s, base: `http://localhost:${port}` });
      });
    });
  }

  beforeEach(async () => {
    db = createTestDb();
  });

  afterEach(async () => {
    await stopServer(server);
    db.close();
  });

  async function postEmpty(path: string): Promise<Response> {
    return fetch(`${base}${path}`, { method: 'POST', redirect: 'manual' });
  }

  it('run discovery inserts new candidates', async () => {
    ({ server, base } = await makeServer(db, async (_existingUrls) => ({
      candidates: [{ url: 'https://newsite.com', name: 'New Site', description: 'A new site' }],
    })));

    const res = await postEmpty('/admin/discovery/run');
    expect(res.status).toBe(302);

    // Give the async task a tick to complete
    await new Promise((r) => setTimeout(r, 50));

    const candidate = db
      .prepare("SELECT * FROM discovery_candidates WHERE url = 'https://newsite.com'")
      .get() as { status: string } | undefined;
    expect(candidate).toBeDefined();
    expect(candidate!.status).toBe('pending_review');
  });

  it('run discovery does not re-insert existing site URL', async () => {
    seedSite(db, { url: 'https://existing.com' });
    let capturedUrls: string[] = [];

    ({ server, base } = await makeServer(db, async (existingUrls) => {
      capturedUrls = existingUrls;
      return { candidates: [] };
    }));

    await postEmpty('/admin/discovery/run');
    await new Promise((r) => setTimeout(r, 50));
    expect(capturedUrls).toContain('https://existing.com');
  });

  it('run discovery does not re-insert dismissed candidate URL', async () => {
    const dismissedId = randomUUID();
    db.prepare(
      `INSERT INTO discovery_candidates (id, url, name, description, discovered_at, status)
       VALUES (?, 'https://dismissed.com', 'Dismissed', 'desc', ?, 'dismissed')`
    ).run(dismissedId, NOW);

    let capturedUrls: string[] = [];
    ({ server, base } = await makeServer(db, async (existingUrls) => {
      capturedUrls = existingUrls;
      return { candidates: [{ url: 'https://dismissed.com', name: 'D', description: '' }] };
    }));

    await postEmpty('/admin/discovery/run');
    await new Promise((r) => setTimeout(r, 50));
    expect(capturedUrls).toContain('https://dismissed.com');
    // ON CONFLICT DO NOTHING means dismissed one is not duplicated
    const rows = db
      .prepare("SELECT id FROM discovery_candidates WHERE url = 'https://dismissed.com'")
      .all();
    expect(rows.length).toBe(1);
  });

  it('approve candidate creates site with status pending', async () => {
    const candId = randomUUID();
    db.prepare(
      `INSERT INTO discovery_candidates (id, url, name, description, discovered_at, status)
       VALUES (?, 'https://approved.com', 'Approved Site', 'desc', ?, 'pending_review')`
    ).run(candId, NOW);

    ({ server, base } = await makeServer(db, async () => ({ candidates: [] })));

    const res = await postEmpty(`/admin/discovery/candidates/${candId}/approve`);
    expect(res.status).toBe(302);

    const site = db
      .prepare("SELECT status FROM sites WHERE url = 'https://approved.com'")
      .get() as { status: string } | undefined;
    expect(site).toBeDefined();
    expect(site!.status).toBe('pending');

    const cand = db
      .prepare('SELECT status FROM discovery_candidates WHERE id = ?')
      .get(candId) as { status: string };
    expect(cand.status).toBe('approved');
    expect(res.headers.get('location') ?? '').toContain('type=success');
  });

  it('dismiss candidate sets status to dismissed', async () => {
    const candId = randomUUID();
    db.prepare(
      `INSERT INTO discovery_candidates (id, url, name, description, discovered_at, status)
       VALUES (?, 'https://dismiss-me.com', 'Dismiss Me', 'desc', ?, 'pending_review')`
    ).run(candId, NOW);

    ({ server, base } = await makeServer(db, async () => ({ candidates: [] })));

    const res = await postEmpty(`/admin/discovery/candidates/${candId}/dismiss`);
    expect(res.status).toBe(302);

    const cand = db
      .prepare('SELECT status FROM discovery_candidates WHERE id = ?')
      .get(candId) as { status: string };
    expect(cand.status).toBe('dismissed');
    expect(res.headers.get('location') ?? '').toContain('type=success');
  });
});
