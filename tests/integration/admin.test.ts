/**
 * T007 [TDD] — Admin route integration tests (US1 + US2).
 * Write first; confirm failing before routes + render are implemented (T009, T010).
 * Covers: GET /admin renders site list with status badges; POST /admin/sites adds site;
 * duplicate/invalid URL rejected; POST disable/enable change status.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTestDb } from '../helpers/db.js';
import { createApp } from '../../src/web/server.js';

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
