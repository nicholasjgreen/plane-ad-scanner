/**
 * Scraper diagnostic — fetches a site URL and reports:
 * - Total HTML size
 * - Number of <a href> links in full vs first 40k chars
 * - Links that look like listing URLs (contain /listing, /aircraft, /for-sale, /plane, etc.)
 * - Sample of listing-like links
 *
 * Usage:
 *   docker compose run --rm scan tsx src/cli/scraper-diag.ts <url>
 *   docker compose run --rm scan tsx src/cli/scraper-diag.ts https://afors.uk/light-aircraft/for-sale?page=1
 */

const url = process.argv[2];
if (!url) {
  console.error('Usage: tsx src/cli/scraper-diag.ts <url>');
  process.exit(1);
}

const TRUNCATION_LIMIT = 40_000;
const LISTING_PATTERNS = [
  /\/listing[s]?\//i,
  /\/aircraft\//i,
  /\/plane\//i,
  /\/for-sale\//i,
  /\/advert\//i,
  /\/sale\//i,
  /id=\d+/i,
  /\/\d{4,}/,  // paths with long numeric IDs
];

function countLinks(html: string): { total: number; listingLike: string[] } {
  const hrefRe = /href="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  let total = 0;
  const listingLike: string[] = [];

  while ((match = hrefRe.exec(html)) !== null) {
    total++;
    const href = match[1];
    if (LISTING_PATTERNS.some((p) => p.test(href))) {
      listingLike.push(href);
    }
  }
  return { total, listingLike };
}

console.log(`Fetching: ${url}\n`);

const resp = await fetch(url, {
  headers: { 'User-Agent': 'plane-ad-scanner/0.1 (personal)' },
  signal: AbortSignal.timeout(30_000),
});

if (!resp.ok) {
  console.error(`HTTP ${resp.status} ${resp.statusText}`);
  process.exit(1);
}

const html = await resp.text();
const truncated = html.slice(0, TRUNCATION_LIMIT);

const full = countLinks(html);
const trunc = countLinks(truncated);

console.log(`=== HTML size ===`);
console.log(`  Full HTML:   ${html.length.toLocaleString()} chars`);
console.log(`  Truncated:   ${truncated.length.toLocaleString()} chars (${TRUNCATION_LIMIT.toLocaleString()} limit)`);
console.log(`  Truncated at: ${Math.round((truncated.length / html.length) * 100)}% of total`);

console.log(`\n=== Links in full HTML ===`);
console.log(`  Total <a href>:    ${full.total}`);
console.log(`  Listing-like:      ${full.listingLike.length}`);

console.log(`\n=== Links in truncated (first 40k) ===`);
console.log(`  Total <a href>:    ${trunc.total}`);
console.log(`  Listing-like:      ${trunc.listingLike.length}`);

if (full.listingLike.length > 0) {
  console.log(`\n=== Sample listing-like links (first 10 from full HTML) ===`);
  for (const link of full.listingLike.slice(0, 10)) {
    const inTrunc = trunc.listingLike.includes(link);
    console.log(`  ${inTrunc ? '[in 40k]' : '[AFTER 40k]'} ${link}`);
  }
  if (full.listingLike.length > 10) {
    console.log(`  ... and ${full.listingLike.length - 10} more`);
  }
}

// Show where in the HTML the first listing link appears
if (full.listingLike.length > 0) {
  const firstLink = full.listingLike[0];
  const pos = html.indexOf(firstLink);
  console.log(`\n=== First listing link position ===`);
  console.log(`  URL:      ${firstLink}`);
  console.log(`  Position: ${pos.toLocaleString()} chars (${pos < TRUNCATION_LIMIT ? 'within' : 'BEYOND'} 40k truncation)`);
}

// Check for JS-rendered content indicators
const jsIndicators = [
  'window.__INITIAL_STATE__',
  'window.__data',
  '__NEXT_DATA__',
  'data-react-',
  'ng-app',
  'vue-app',
  'id="app"',
  'id="root"',
];
const jsSignals = jsIndicators.filter((indicator) => html.includes(indicator));
if (jsSignals.length > 0) {
  console.log(`\n=== JS rendering indicators detected ===`);
  for (const s of jsSignals) console.log(`  ${s}`);
  console.log(`  (Listings may be loaded via JavaScript — static HTML may be empty or minimal)`);
}
