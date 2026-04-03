// Server-rendered HTML template for the listings page.
// All rendering rules from contracts/web-routes.md are implemented here.

export interface ListingRow {
  id: string;
  registration: string | null;
  aircraftType: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  priceCurrency: string;
  location: string | null;
  listingUrl: string;
  sourceSite: string;
  matchScore: number;
  isNew: boolean;
  dateFirstFound: string;
  dateLastSeen: string;
}

export interface LastScanInfo {
  startedAt: string;
  listingsFound: number;
  listingsNew: number;
}

export interface ScanError {
  site: string;
  error: string;
}

export interface ListingsPageData {
  listings: ListingRow[];
  lastScan: LastScanInfo | null;
  scanErrors: ScanError[];
  totalCount: number;
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPrice(price: number | null, currency: string): string {
  if (price === null) return 'Price not listed';
  const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };
  const prefix = sym[currency] ?? `${currency} `;
  return `${prefix}${price.toLocaleString()}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function renderErrorBanner(errors: ScanError[]): string {
  if (errors.length === 0) return '';
  const items = errors.map((e) => `<li><strong>${esc(e.site)}</strong>: ${esc(e.error)}</li>`).join('');
  return `
    <div class="banner banner--error" role="alert">
      <strong>Warning:</strong> ${errors.length} site(s) failed in the last scan:
      <ul>${items}</ul>
    </div>`;
}

function renderListing(l: ListingRow): string {
  const title = [l.aircraftType ?? [l.make, l.model].filter(Boolean).join(' ') ?? 'Unknown aircraft']
    .join('');
  const reg = l.registration ? `<span class="reg">${esc(l.registration)}</span>` : '';
  const newBadge = l.isNew ? `<span class="badge badge--new">New</span>` : '';
  return `
    <article class="listing${l.isNew ? ' listing--new' : ''}">
      <header class="listing__header">
        <h2 class="listing__title">
          <a href="${esc(l.listingUrl)}" target="_blank" rel="noopener">${esc(title)}</a>
          ${reg}${newBadge}
        </h2>
        <span class="listing__score" title="Match score">${l.matchScore.toFixed(1)}</span>
      </header>
      <dl class="listing__details">
        <dt>Price</dt>    <dd>${fmtPrice(l.price, l.priceCurrency)}</dd>
        <dt>Year</dt>     <dd>${l.year ?? '—'}</dd>
        <dt>Location</dt> <dd>${esc(l.location) || '—'}</dd>
        <dt>Source</dt>   <dd>${esc(l.sourceSite)}</dd>
        <dt>First seen</dt><dd>${fmtDate(l.dateFirstFound)}</dd>
      </dl>
    </article>`;
}

function renderBody(data: ListingsPageData): string {
  const { listings, lastScan, totalCount } = data;

  if (totalCount === 0 && lastScan === null) {
    return `<p class="empty">No listings yet — run the scanner to populate the page.</p>`;
  }
  if (totalCount === 0) {
    return `<p class="empty">No listings found. The last scan ran at ${esc(lastScan!.startedAt)} but returned no results.</p>`;
  }
  return listings.map(renderListing).join('\n');
}

export function renderListingsPage(data: ListingsPageData): string {
  const { lastScan, scanErrors, totalCount } = data;
  const scanMeta = lastScan
    ? `<p class="meta">Last scan: ${esc(lastScan.startedAt)} — ${lastScan.listingsFound} found, ${lastScan.listingsNew} new</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plane Listings${totalCount > 0 ? ` (${totalCount})` : ''}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem 1.5rem; }
    h1 { margin-bottom: .25rem; }
    .meta { color: #666; font-size: .875rem; margin-top: 0; }
    .banner--error { background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: .75rem 1rem; margin-bottom: 1.5rem; }
    .banner--error ul { margin: .5rem 0 0; padding-left: 1.25rem; }
    .listing { border: 1px solid #ddd; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
    .listing--new { border-color: #0d6efd; }
    .listing__header { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
    .listing__title { margin: 0; font-size: 1.1rem; }
    .listing__title a { text-decoration: none; color: inherit; }
    .listing__title a:hover { text-decoration: underline; }
    .listing__score { font-size: 1.5rem; font-weight: bold; color: #0d6efd; white-space: nowrap; }
    .listing__details { display: grid; grid-template-columns: auto 1fr; gap: .15rem .75rem; margin: .75rem 0 0; font-size: .9rem; }
    dt { font-weight: 600; color: #555; }
    dd { margin: 0; }
    .reg { font-family: monospace; background: #f0f0f0; padding: .1em .4em; border-radius: 3px; margin-left: .5rem; }
    .badge { font-size: .7rem; font-weight: 700; padding: .15em .5em; border-radius: 3px; vertical-align: middle; margin-left: .4rem; text-transform: uppercase; }
    .badge--new { background: #0d6efd; color: white; }
    .empty { color: #666; font-style: italic; }
  </style>
</head>
<body>
  <h1>Plane Listings</h1>
  ${scanMeta}
  ${renderErrorBanner(scanErrors)}
  <main>
    ${renderBody(data)}
  </main>
</body>
</html>`;
}
