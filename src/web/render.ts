// Server-rendered HTML template for the listings page.
// All rendering rules from contracts/web-routes.md are implemented here.

import type { StructuredIndicators, Confidence } from '../types.js';

export interface EvidenceRow {
  profileName: string;
  criterionName: string;
  matched: boolean;
  contribution: number;
  note: string;
}

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
  evidence?: EvidenceRow[];      // Per-criterion breakdown from listing_scores
  headline: string | null;       // AI-generated headline; null until Presenter runs
  explanation: string | null;    // AI-generated interest explanation; null until ready
  aiStatus: 'pending' | 'ready' | 'failed' | null;  // null = no listing_ai row yet
  thumbnailUrl: string | null;   // First scraped image URL; null if none found
  allImageUrls: string[];        // All scraped image URLs for the gallery
  indicators: StructuredIndicators | null;  // Structured indicators; null until derived
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

export interface ActiveFilters {
  type: string | null;
  maxPrice: number | null;
  newOnly: boolean;
}

export interface WeightSuggestionRow {
  id: string;
  profileName: string;
  currentWeight: number;
  proposedWeight: number;
  rationale: string;
  feedbackCount: number;
}

export interface SuggestWeightsPageData {
  suggestions: WeightSuggestionRow[];
  feedbackCount: number;
  minCount: number;
}

export interface ListingsPageData {
  listings: ListingRow[];
  lastScan: LastScanInfo | null;
  scanErrors: ScanError[];
  totalCount: number;
  filters: ActiveFilters;
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

function renderEvidence(evidence: EvidenceRow[]): string {
  if (evidence.length === 0) return '';
  const matchCount = evidence.filter((e) => e.matched).length;
  const rows = evidence
    .map(
      (e) => `
        <tr class="${e.matched ? 'ev--match' : 'ev--miss'}">
          <td>${esc(e.profileName)}</td>
          <td>${esc(e.criterionName)}</td>
          <td class="ev__icon">${e.matched ? '✓' : '✗'}</td>
          <td class="ev__num">${e.contribution > 0 ? e.contribution.toFixed(1) : '—'}</td>
          <td>${esc(e.note)}</td>
        </tr>`
    )
    .join('');
  return `
    <details class="evidence">
      <summary class="evidence__summary">${matchCount}/${evidence.length} criteria matched — show details</summary>
      <table class="evidence__table">
        <thead><tr><th>Profile</th><th>Criterion</th><th></th><th>Score</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

function renderExplanation(
  explanation: string | null,
  aiStatus: 'pending' | 'ready' | 'failed' | null
): string {
  if (aiStatus === 'ready' && explanation) {
    return `<p class="explanation">${esc(explanation)}</p>`;
  }
  if (aiStatus === 'pending') {
    return `<p class="explanation explanation--pending">Summary is being generated…</p>`;
  }
  if (aiStatus === 'failed') {
    const stale = explanation
      ? `<p class="explanation explanation--stale">${esc(explanation)}</p>`
      : '';
    return `${stale}<p class="explanation explanation--failed">Summary not yet available for this listing.</p>`;
  }
  return '';
}

function renderThumbnail(thumbnailUrl: string | null): string {
  if (thumbnailUrl) {
    return `<img class="listing__thumbnail" src="${esc(thumbnailUrl)}" alt="" loading="lazy">`;
  }
  return `<div class="thumbnail-placeholder" aria-hidden="true">No photo</div>`;
}

function confidenceBadge(conf: Confidence): string {
  const cls = conf === 'High' ? 'conf--high' : conf === 'Medium' ? 'conf--medium' : 'conf--low';
  return `<span class="conf-badge ${cls}">${conf}</span>`;
}

// Returns a CSS modifier class for RAG (Red/Amber/Green) string values and High/Medium/Low
function ragClass(v: unknown): string {
  const s = typeof v === 'string' ? v.toLowerCase() : '';
  if (s === 'green' || s === 'high') return 'ind-val--green';
  if (s === 'amber' || s === 'medium') return 'ind-val--amber';
  if (s === 'red' || s === 'low') return 'ind-val--red';
  return '';
}

function renderIndicatorRow(icon: string, label: string, ind: { value: unknown; band?: unknown; confidence: Confidence } | undefined): string {
  const labelHtml = `<span class="ind-label"><span class="ind-icon">${icon}</span>${esc(label)}</span>`;
  if (!ind) return `<div class="ind-row">${labelHtml}<span class="ind-val ind-val--not-derived">Not derived</span><span></span></div>`;
  const isUnknown = ind.value === null || ind.value === undefined;
  const isBanded = 'band' in ind;
  let valText: string;
  if (isUnknown) {
    valText = '<span class="ind-val ind-val--unknown">—</span>';
  } else if (isBanded && ind.band !== null) {
    const cls = ragClass(ind.band);
    valText = `<span class="ind-val ${cls}">${esc(String(ind.band))}</span> <span class="ind-val--raw">(${esc(String(ind.value))})</span>`;
  } else {
    const cls = ragClass(ind.value);
    valText = `<span class="ind-val ${cls}">${esc(String(ind.value))}</span>`;
  }
  const badge = isUnknown ? '<span></span>' : confidenceBadge(ind.confidence);
  return `<div class="ind-row">${labelHtml}${valText}${badge}</div>`;
}

function renderIndicatorGroups(indicators: StructuredIndicators | null): string {
  const ind = indicators;

  const groups: Array<{ title: string; rows: string }> = [
    {
      title: '📡 Avionics &amp; IFR',
      rows: [
        renderIndicatorRow('🖥️', 'Avionics', ind?.avionics_type),
        renderIndicatorRow('🤖', 'Autopilot', ind?.autopilot_capability),
        renderIndicatorRow('✅', 'IFR Approval', ind?.ifr_approval),
        renderIndicatorRow('📶', 'IFR Capability', ind?.ifr_capability_level),
      ].join(''),
    },
    {
      title: '⚙️ Engine &amp; Airworthiness',
      rows: [
        renderIndicatorRow('🔧', 'Engine State', ind?.engine_state),
        renderIndicatorRow('⏱️', 'SMOH Hours', ind?.smoh_hours),
        renderIndicatorRow('🔍', 'Condition', ind?.condition_band),
        renderIndicatorRow('📜', 'Airworthiness', ind?.airworthiness_basis),
      ].join(''),
    },
    {
      title: '✈️ Aircraft Profile',
      rows: [
        renderIndicatorRow('🏷️', 'Type Category', ind?.aircraft_type_category),
        renderIndicatorRow('👥', 'Passengers', ind?.passenger_capacity),
        renderIndicatorRow('📏', 'Typical Range', ind?.typical_range),
        renderIndicatorRow('💨', 'Cruise Speed', ind?.typical_cruise_speed),
        renderIndicatorRow('⛽', 'Fuel Burn', ind?.typical_fuel_burn),
      ].join(''),
    },
    {
      title: '💰 Costs',
      rows: [
        renderIndicatorRow('🔩', 'Maintenance Cost', ind?.maintenance_cost_band),
        renderIndicatorRow('⛽', 'Fuel Cost', ind?.fuel_cost_band),
        renderIndicatorRow('📋', 'Maintenance Program', ind?.maintenance_program),
      ].join(''),
    },
    {
      title: '🌍 Provenance',
      rows: [
        renderIndicatorRow('🗺️', 'Registration Country', ind?.registration_country),
        renderIndicatorRow('🏢', 'Ownership', ind?.ownership_structure),
        renderIndicatorRow('🏠', 'Hangar', ind?.hangar_situation),
        renderIndicatorRow('🔄', 'Redundancy', ind?.redundancy_level),
      ].join(''),
    },
  ];

  const groupHtml = groups
    .map(
      (g) => `
      <details class="ind-group" open>
        <summary class="ind-group__title">${g.title}</summary>
        <div class="ind-group__body">${g.rows}</div>
      </details>`
    )
    .join('');

  return `<div class="ind-groups">${groupHtml}</div>`;
}

function renderListing(l: ListingRow): string {
  // Headline: AI-generated → aircraft type → make+model → site name
  const headline =
    l.headline ??
    l.aircraftType ??
    ([l.make, l.model].filter(Boolean).join(' ') || `Listing on ${l.sourceSite}`);

  const reg = l.registration ? `<span class="reg">${esc(l.registration)}</span>` : '';
  const newBadge = l.isNew ? `<span class="badge badge--new">New</span>` : '';

  // Key facts line: make · model · year · price
  const facts = [l.make, l.model, l.year ? String(l.year) : null, fmtPrice(l.price, l.priceCurrency)]
    .filter(Boolean)
    .join(' · ');

  return `
    <details class="listing${l.isNew ? ' listing--new' : ''}">
      <summary class="listing__summary">
        ${renderThumbnail(l.thumbnailUrl)}
        <div class="listing__summary-text">
          <div class="listing__headline">${esc(headline)}${reg}${newBadge}</div>
          <div class="listing__facts">${esc(facts)}</div>
        </div>
        <span class="listing__score" title="Match score">${l.matchScore.toFixed(1)}</span>
      </summary>
      <div class="listing__body">
        ${renderExplanation(l.explanation, l.aiStatus)}
        <dl class="listing__details">
          <dt>Price</dt>    <dd>${fmtPrice(l.price, l.priceCurrency)}</dd>
          <dt>Year</dt>     <dd>${l.year ?? '—'}</dd>
          <dt>Location</dt> <dd>${esc(l.location) || '—'}</dd>
          <dt>Source</dt>   <dd>${esc(l.sourceSite)}</dd>
          <dt>First seen</dt><dd>${fmtDate(l.dateFirstFound)}</dd>
        </dl>
        ${l.evidence && l.evidence.length > 0 ? renderEvidence(l.evidence) : ''}
        ${renderIndicatorGroups(l.indicators)}
        <div class="listing__actions">
          <a class="listing__source-link" href="${esc(l.listingUrl)}" target="_blank" rel="noopener">View original listing →</a>
          <form class="rescore-form" method="post" action="/rescore">
            <input type="hidden" name="listing_id" value="${esc(l.id)}">
            <button class="btn-rescore" type="submit" title="Regenerate AI summary for this listing">Re-score</button>
          </form>
        </div>
        <form class="feedback" method="post" action="/feedback">
          <input type="hidden" name="listing_id" value="${esc(l.id)}">
          <span class="feedback__label">Rate this listing:</span>
          <button class="feedback__btn feedback__btn--up" name="rating" value="more_interesting" title="More interesting than expected">👍</button>
          <button class="feedback__btn" name="rating" value="as_expected" title="As expected">👌</button>
          <button class="feedback__btn feedback__btn--down" name="rating" value="less_interesting" title="Less interesting than expected">👎</button>
        </form>
      </div>
    </details>`;
}

function renderFilterBar(filters: ActiveFilters): string {
  const typeVal = esc(filters.type);
  const maxPriceVal = filters.maxPrice !== null ? String(filters.maxPrice) : '';
  const newChecked = filters.newOnly ? ' checked' : '';
  const hasFilters = filters.type || filters.maxPrice !== null || filters.newOnly;
  return `
  <form class="filter-bar" method="get" action="/">
    <label class="filter-bar__field">
      <span>Type</span>
      <input type="text" name="type" value="${typeVal}" placeholder="e.g. cessna">
    </label>
    <label class="filter-bar__field">
      <span>Max price</span>
      <input type="number" name="max_price" value="${maxPriceVal}" placeholder="e.g. 80000" min="0">
    </label>
    <label class="filter-bar__field filter-bar__field--inline">
      <input type="checkbox" name="new_only" value="1"${newChecked}>
      <span>New only</span>
    </label>
    <button type="submit">Filter</button>
    ${hasFilters ? '<a class="filter-bar__clear" href="/">Clear filters</a>' : ''}
  </form>`;
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

export function renderSuggestWeightsPage(data: SuggestWeightsPageData): string {
  const { suggestions, feedbackCount, minCount } = data;

  let body: string;
  if (feedbackCount < minCount) {
    body = `<p class="empty">Not enough feedback yet — ${feedbackCount} of ${minCount} required ratings received. Rate some listings to unlock suggestions.</p>`;
  } else if (suggestions.length === 0) {
    body = `<p class="empty">No weight suggestions generated. Try rating more listings first.</p>`;
  } else {
    const rows = suggestions
      .map(
        (s) => `
      <tr>
        <td>${esc(s.profileName)}</td>
        <td>${s.currentWeight.toFixed(2)}</td>
        <td>${s.proposedWeight.toFixed(2)}</td>
        <td>${esc(s.rationale)}</td>
        <td>
          <div class="sw-actions">
            <form method="post" action="/suggest-weights/accept">
              <input type="hidden" name="suggestion_id" value="${esc(s.id)}">
              <button class="btn-accept" type="submit">Accept</button>
            </form>
            <form method="post" action="/suggest-weights/reject">
              <input type="hidden" name="suggestion_id" value="${esc(s.id)}">
              <button class="btn-reject" type="submit">Reject</button>
            </form>
          </div>
        </td>
      </tr>`
      )
      .join('');
    body = `
    <table class="sw-table">
      <thead><tr><th>Profile</th><th>Current weight</th><th>Proposed weight</th><th>Rationale</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Weight Suggestions — Plane Listings</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 1rem 1.5rem; }
    h1 { margin-bottom: .25rem; }
    .back { font-size: .875rem; color: #6c757d; }
    .empty { color: #666; font-style: italic; }
    .sw-table { width: 100%; border-collapse: collapse; font-size: .9rem; margin-top: 1rem; }
    .sw-table th { text-align: left; padding: .25rem .5rem; border-bottom: 2px solid #dee2e6; }
    .sw-table td { padding: .3rem .5rem; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
    .sw-actions { display: flex; gap: .5rem; }
    .btn-accept { padding: .2rem .7rem; background: #198754; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
    .btn-reject { padding: .2rem .7rem; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
  </style>
</head>
<body>
  <h1>Weight Suggestions</h1>
  <p class="back"><a href="/">&larr; Back to listings</a> &nbsp;|&nbsp; ${feedbackCount} feedback record${feedbackCount !== 1 ? 's' : ''} collected (minimum: ${minCount})</p>
  ${body}
</body>
</html>`;
}

export function renderListingsPage(data: ListingsPageData): string {
  const { lastScan, scanErrors, totalCount, filters } = data;
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
    .listing { border: 1px solid #ddd; border-radius: 6px; margin-bottom: 1rem; }
    .listing--new { border-color: #0d6efd; }
    .listing__summary { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; cursor: pointer; list-style: none; }
    .listing__summary::-webkit-details-marker { display: none; }
    .listing__summary-text { flex: 1; min-width: 0; }
    .listing__headline { font-size: 1rem; font-weight: 600; color: #212529; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .listing__facts { font-size: .85rem; color: #555; margin-top: .15rem; }
    .listing__score { font-size: 1.4rem; font-weight: bold; color: #0d6efd; white-space: nowrap; flex-shrink: 0; }
    .listing__thumbnail { width: 80px; height: 60px; object-fit: cover; border-radius: 4px; flex-shrink: 0; }
    .thumbnail-placeholder { width: 80px; height: 60px; background: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #aaa; font-size: .65rem; text-align: center; flex-shrink: 0; }
    .listing__body { border-top: 1px solid #eee; padding: .75rem 1rem; }
    .listing__details { display: grid; grid-template-columns: auto 1fr; gap: .15rem .75rem; margin: 0 0 .75rem; font-size: .9rem; }
    dt { font-weight: 600; color: #555; }
    dd { margin: 0; }
    .reg { font-family: monospace; background: #f0f0f0; padding: .1em .4em; border-radius: 3px; margin-left: .5rem; }
    .badge { font-size: .7rem; font-weight: 700; padding: .15em .5em; border-radius: 3px; vertical-align: middle; margin-left: .4rem; text-transform: uppercase; }
    .badge--new { background: #0d6efd; color: white; }
    .empty { color: #666; font-style: italic; }
    .filter-bar { display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-end; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: .75rem 1rem; margin-bottom: 1.5rem; }
    .filter-bar__field { display: flex; flex-direction: column; gap: .2rem; font-size: .875rem; font-weight: 600; color: #555; }
    .filter-bar__field--inline { flex-direction: row; align-items: center; gap: .4rem; }
    .filter-bar input[type="text"], .filter-bar input[type="number"] { padding: .3rem .5rem; border: 1px solid #ced4da; border-radius: 4px; font-size: .875rem; }
    .filter-bar button { padding: .35rem .9rem; background: #0d6efd; color: white; border: none; border-radius: 4px; font-size: .875rem; cursor: pointer; }
    .filter-bar button:hover { background: #0b5ed7; }
    .filter-bar__clear { font-size: .875rem; color: #6c757d; }
    .evidence { margin-top: .75rem; }
    .evidence__summary { font-size: .8rem; color: #6c757d; cursor: pointer; }
    .evidence__summary:hover { color: #0d6efd; }
    .evidence__table { width: 100%; border-collapse: collapse; font-size: .8rem; margin-top: .5rem; }
    .evidence__table th { text-align: left; padding: .25rem .4rem; border-bottom: 2px solid #dee2e6; color: #555; }
    .evidence__table td { padding: .2rem .4rem; border-bottom: 1px solid #f0f0f0; }
    .ev--match { background: #f0fff4; }
    .ev--miss { background: #fff8f8; color: #888; }
    .ev__icon { text-align: center; font-weight: bold; }
    .ev--match .ev__icon { color: #198754; }
    .ev--miss .ev__icon { color: #dc3545; }
    .ev__num { text-align: right; font-variant-numeric: tabular-nums; }
    .explanation { font-size: .9rem; color: #333; margin: 0 0 .75rem; line-height: 1.5; }
    .explanation--pending { color: #888; font-style: italic; }
    .explanation--stale { color: #555; margin-bottom: .25rem; }
    .explanation--failed { color: #888; font-style: italic; font-size: .8rem; }
    .listing__actions { display: flex; align-items: center; gap: 1rem; margin-bottom: .75rem; }
    .listing__source-link { font-size: .875rem; color: #0d6efd; text-decoration: none; }
    .listing__source-link:hover { text-decoration: underline; }
    .rescore-form { margin: 0; }
    .btn-rescore { padding: .2rem .7rem; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
    .btn-rescore:hover { background: #5c636a; }
    .feedback { display: flex; align-items: center; gap: .4rem; margin-top: .75rem; padding-top: .5rem; border-top: 1px solid #f0f0f0; }
    .feedback__label { font-size: .8rem; color: #888; }
    .feedback__btn { background: none; border: 1px solid #dee2e6; border-radius: 4px; padding: .15rem .4rem; cursor: pointer; font-size: .9rem; }
    .feedback__btn:hover { background: #f8f9fa; }
    .suggest-link { font-size: .875rem; color: #6c757d; margin-left: auto; }
    .suggest-weights { background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; padding: 1rem; margin-bottom: 1.5rem; }
    .sw-table { width: 100%; border-collapse: collapse; font-size: .9rem; margin-top: .75rem; }
    .sw-table th { text-align: left; padding: .25rem .5rem; border-bottom: 2px solid #dee2e6; }
    .sw-table td { padding: .3rem .5rem; border-bottom: 1px solid #f0f0f0; }
    .sw-actions { display: flex; gap: .5rem; }
    .btn-accept { padding: .2rem .7rem; background: #198754; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
    .btn-reject { padding: .2rem .7rem; background: #dc3545; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: .8rem; }
    /* Structured indicators */
    .ind-groups { margin-top: .75rem; border-top: 2px solid #e9ecef; padding-top: .5rem; display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; }
    .ind-group { border: 1px solid #e9ecef; border-radius: 5px; overflow: hidden; }
    .ind-group__title { display: flex; align-items: center; gap: .35rem; padding: .4rem .65rem; cursor: pointer; font-weight: 600; font-size: .8rem; background: #f8f9fa; color: #495057; list-style: none; user-select: none; }
    .ind-group__title::-webkit-details-marker { display: none; }
    .ind-group[open] .ind-group__title { border-bottom: 1px solid #e9ecef; }
    .ind-group__body { padding: .15rem .4rem .25rem; }
    .ind-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: .15rem .5rem; padding: .25rem .25rem; border-bottom: 1px solid #f8f9fa; font-size: .8rem; }
    .ind-row:last-child { border-bottom: none; }
    .ind-label { color: #6c757d; display: flex; align-items: center; gap: .3rem; }
    .ind-icon { font-size: .85rem; flex-shrink: 0; }
    .ind-val { font-weight: 600; color: #212529; }
    .ind-val--green { color: #146c43; }
    .ind-val--amber { color: #b45309; }
    .ind-val--red { color: #b02a37; }
    .ind-val--unknown { color: #adb5bd; font-weight: normal; }
    .ind-val--not-derived { color: #ced4da; font-style: italic; font-weight: normal; }
    .ind-val--raw { color: #6c757d; font-weight: normal; font-size: .75rem; }
    .conf-badge { font-size: .65rem; padding: .1em .35em; border-radius: 3px; font-weight: 700; white-space: nowrap; }
    .conf--high { background: #d1e7dd; color: #0a3622; }
    .conf--medium { background: #fff3cd; color: #664d03; }
    .conf--low { background: #f8d7da; color: #58151c; }
    @media (max-width: 600px) { .ind-groups { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Plane Listings</h1>
  ${scanMeta}
  ${renderErrorBanner(scanErrors)}
  <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
    ${renderFilterBar(filters)}
    <a class="suggest-link" href="/suggest-weights">Suggest weight adjustments</a>
  </div>
  <main>
    ${renderBody(data)}
  </main>
</body>
</html>`;
}
