// Server-rendered HTML template for the admin page.
// Follows the same pattern as src/web/render.ts (template literals, no client-side JS).

export interface AdminVerificationResult {
  listingsSample: string | null; // JSON: RawListing[]
  passed: number | null;         // 1 = passed, 0 = failed, null = in progress
  failureReason: string | null;
  attemptedAt: string;
}

export interface AdminSite {
  id: string;
  name: string;
  url: string;
  status: 'pending' | 'enabled' | 'disabled' | 'verification_failed';
  priority: number;
  totalListings: number;
  lastScanOutcome: string | null; // JSON: { date, listingsFound, error? }
  lastVerified: string | null;
  verificationResult?: AdminVerificationResult | null;
}

export interface AdminCandidate {
  id: string;
  url: string;
  name: string;
  description: string | null;
}

export interface AdminPageData {
  sites: AdminSite[];
  candidates: AdminCandidate[];
  flash?: { msg: string; type: 'success' | 'error' } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface ScanOutcome {
  date?: string;
  listingsFound?: number;
  error?: string;
}

function fmtScanOutcome(json: string | null): string {
  if (!json) return '—';
  try {
    const o = JSON.parse(json) as ScanOutcome;
    const date = o.date ? fmtDate(o.date) : '?';
    if (o.error) {
      return `<span class="text-error">${esc(date)}: ${esc(o.error)}</span>`;
    }
    return `${esc(date)}: ${o.listingsFound ?? 0} listings`;
  } catch {
    return '—';
  }
}

function statusBadge(status: AdminSite['status']): string {
  const classes: Record<string, string> = {
    pending: 'badge--pending',
    enabled: 'badge--enabled',
    disabled: 'badge--disabled',
    verification_failed: 'badge--failed',
  };
  const labels: Record<string, string> = {
    pending: 'Pending',
    enabled: 'Enabled',
    disabled: 'Disabled',
    verification_failed: 'Verification Failed',
  };
  return `<span class="badge ${classes[status] ?? ''}">${labels[status] ?? esc(status)}</span>`;
}

function actionButtons(site: AdminSite): string {
  const buttons: string[] = [];
  const btn = (path: string, label: string, cls = '') =>
    `<form method="post" action="/admin/sites/${esc(site.id)}${path}" style="display:inline">
      <button type="submit" class="btn${cls ? ' ' + cls : ''}">${label}</button>
    </form>`;

  switch (site.status) {
    case 'pending':
      buttons.push(btn('/disable', 'Disable'));
      break;
    case 'enabled':
      buttons.push(btn('/disable', 'Disable'));
      buttons.push(btn('/verify', 'Re-verify'));
      break;
    case 'disabled':
      buttons.push(btn('/enable', 'Enable'));
      break;
    case 'verification_failed':
      buttons.push(btn('/disable', 'Disable'));
      buttons.push(btn('/verify', 'Re-verify'));
      break;
  }
  return buttons.join(' ');
}

function priorityForm(site: AdminSite): string {
  if (site.status !== 'enabled') return `<span>${site.priority}</span>`;
  return `<form method="post" action="/admin/sites/${esc(site.id)}/priority" style="display:inline">
    <input type="number" name="priority" value="${site.priority}" min="0" style="width:4rem">
    <button type="submit" class="btn btn--small">Set</button>
  </form>`;
}

function renderVerificationResult(site: AdminSite): string {
  const vr = site.verificationResult;
  if (!vr) return '';

  if (vr.passed === null) {
    // In progress
    return `<div class="vr vr--progress">Verification in progress…</div>`;
  }

  if (vr.passed === 0) {
    // Failed
    return `<div class="vr vr--failed">Verification failed: ${esc(vr.failureReason)}</div>`;
  }

  // Passed — show sample count and approve/reject buttons
  let sampleCount = 0;
  try {
    const samples = JSON.parse(vr.listingsSample ?? '[]') as unknown[];
    sampleCount = samples.length;
  } catch {
    sampleCount = 0;
  }

  return `<div class="vr vr--ready">
    Sample: ${sampleCount} listing${sampleCount !== 1 ? 's' : ''} extracted
    (${fmtDate(vr.attemptedAt)})
    <form method="post" action="/admin/sites/${esc(site.id)}/verify/approve" style="display:inline;margin-left:.5rem">
      <button type="submit" class="btn btn--success btn--small">Approve</button>
    </form>
    <form method="post" action="/admin/sites/${esc(site.id)}/verify/reject" style="display:inline">
      <button type="submit" class="btn btn--danger btn--small">Reject</button>
    </form>
  </div>`;
}

function renderSiteRow(site: AdminSite): string {
  const vrHtml = site.status === 'pending' ? renderVerificationResult(site) : '';
  return `
    <tr>
      <td>
        <a href="${esc(site.url)}" target="_blank" rel="noopener">${esc(site.name)}</a>
        ${vrHtml}
      </td>
      <td>${statusBadge(site.status)}</td>
      <td>${priorityForm(site)}</td>
      <td>${site.totalListings}</td>
      <td>${fmtScanOutcome(site.lastScanOutcome)}</td>
      <td>${fmtDate(site.lastVerified)}</td>
      <td>${actionButtons(site)}</td>
    </tr>`;
}

function renderFlash(flash: AdminPageData['flash']): string {
  if (!flash) return '';
  const cls = flash.type === 'success' ? 'banner--success' : 'banner--error';
  return `<div class="banner ${cls}" role="alert">${esc(flash.msg)}</div>`;
}

function renderCandidates(candidates: AdminCandidate[]): string {
  if (candidates.length === 0) return '';
  const rows = candidates
    .map(
      (c) => `
    <tr>
      <td><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a></td>
      <td>${esc(c.description)}</td>
      <td>
        <form method="post" action="/admin/discovery/candidates/${esc(c.id)}/approve" style="display:inline">
          <button type="submit" class="btn btn--success">Approve</button>
        </form>
        <form method="post" action="/admin/discovery/candidates/${esc(c.id)}/dismiss" style="display:inline">
          <button type="submit" class="btn btn--danger">Dismiss</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  return `
  <section class="candidates">
    <h2>Discovery Proposals</h2>
    <table>
      <thead><tr><th>Name / URL</th><th>Description</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

export function renderAdminPage(data: AdminPageData): string {
  const siteRows = data.sites.map(renderSiteRow).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin — Plane Ad Scanner</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; padding: 1rem 2rem; background: #f8f9fa; color: #212529; }
    h1, h2 { margin-top: 1.5rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; margin-bottom: 1.5rem; }
    th, td { padding: .5rem .75rem; border: 1px solid #dee2e6; text-align: left; font-size: .9rem; }
    th { background: #e9ecef; font-weight: 600; }
    a { color: #0d6efd; }
    .btn { padding: .25rem .6rem; border: 1px solid #6c757d; border-radius: .25rem; background: #fff; cursor: pointer; font-size: .85rem; }
    .btn--small { padding: .15rem .4rem; font-size: .8rem; }
    .btn--success { background: #198754; color: #fff; border-color: #198754; }
    .btn--danger  { background: #dc3545; color: #fff; border-color: #dc3545; }
    .badge { padding: .2rem .5rem; border-radius: .25rem; font-size: .8rem; font-weight: 600; }
    .badge--pending  { background: #fff3cd; color: #664d03; }
    .badge--enabled  { background: #d1e7dd; color: #0a3622; }
    .badge--disabled { background: #e2e3e5; color: #41464b; }
    .badge--failed   { background: #f8d7da; color: #58151c; }
    .banner { padding: .75rem 1rem; margin-bottom: 1rem; border-radius: .25rem; }
    .banner--success { background: #d1e7dd; color: #0a3622; }
    .banner--error   { background: #f8d7da; color: #58151c; }
    .text-error { color: #dc3545; }
    .vr { margin-top: .35rem; font-size: .82rem; padding: .25rem .4rem; border-radius: .2rem; }
    .vr--progress { background: #e9ecef; color: #495057; }
    .vr--failed   { background: #f8d7da; color: #58151c; }
    .vr--ready    { background: #d1e7dd; color: #0a3622; }
    .add-form { display: flex; gap: .5rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .add-form input { padding: .35rem .5rem; border: 1px solid #ced4da; border-radius: .25rem; font-size: .9rem; }
    .add-form input[name="name"] { width: 180px; }
    .add-form input[name="url"]  { width: 320px; }
    .candidates { margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Plane Ad Scanner — Admin</h1>

  ${renderFlash(data.flash ?? null)}

  <h2>Sites</h2>
  <table>
    <thead>
      <tr>
        <th>Name</th>
        <th>Status</th>
        <th>Priority</th>
        <th>Listings</th>
        <th>Last Scan</th>
        <th>Last Verified</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>${siteRows}</tbody>
  </table>

  ${renderCandidates(data.candidates)}

  <form method="post" action="/admin/discovery/run">
    <button type="submit" class="btn">Run Discovery</button>
  </form>

  <h2>Add Site</h2>
  <form method="post" action="/admin/sites" class="add-form">
    <input type="text" name="name" placeholder="Display name" required>
    <input type="url" name="url" placeholder="https://..." required>
    <button type="submit" class="btn btn--success">Add Site</button>
  </form>

</body>
</html>`;
}
