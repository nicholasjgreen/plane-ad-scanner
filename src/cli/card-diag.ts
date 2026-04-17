/**
 * Shows what cheerio extracts for the first N listing cards on a page.
 * Helps tune the card-ancestor depth used by the pre-filter.
 *
 * Usage:
 *   npm run card-diag -- <url> [depth]
 *   npm run card-diag -- "https://afors.uk/light-aircraft/for-sale?page=1" 3
 */
import * as cheerio from 'cheerio';

const url = process.argv[2];
const depth = parseInt(process.argv[3] ?? '4', 10);

if (!url) {
  console.error('Usage: tsx src/cli/card-diag.ts <url> [ancestorDepth=4]');
  process.exit(1);
}

const LISTING_URL_PATTERNS = [
  /\/listing[s]?\//i,
  /\/advert[s]?\//i,
  /\/standardView-/i,
  /\/aircraft\//i,
  /\/for-sale\//i,
  /\/sale\//i,
  /[?&]id=\d+/i,
  /\/\d{5,}/,
];

function isListingUrl(href: string): boolean {
  return LISTING_URL_PATTERNS.some((p) => p.test(href));
}

console.log(`Fetching: ${url}\n`);
const resp = await fetch(url, {
  headers: { 'User-Agent': 'plane-ad-scanner/0.1 (personal)' },
  signal: AbortSignal.timeout(30_000),
});
if (!resp.ok) { console.error(`HTTP ${resp.status}`); process.exit(1); }

const html = await resp.text();
const $ = cheerio.load(html);
const origin = new URL(url).origin;
const seen = new Set<string>();

let count = 0;
$('a[href]').each((_, el) => {
  if (count >= 5) return false; // show first 5 only

  const href = $(el).attr('href') ?? '';
  if (!isListingUrl(href)) return true;

  let absUrl: string;
  try { absUrl = new URL(href, origin).href; } catch { return true; }
  if (seen.has(absUrl)) return true;
  seen.add(absUrl);

  // Walk up `depth` levels and show text at each level
  console.log(`=== Listing ${++count} ===`);
  console.log(`URL: ${absUrl}`);

  let cur = $(el) as ReturnType<typeof $>;
  for (let d = 0; d <= depth; d++) {
    const text = cur.text().replace(/\s+/g, ' ').trim().slice(0, 300);
    const tag = (cur[0] as { tagName?: string })?.tagName ?? '?';
    const cls = (cur.attr('class') ?? '').slice(0, 60);
    console.log(`  depth ${d} <${tag} class="${cls}">: ${JSON.stringify(text.slice(0, 120))}`);
    const parent = cur.parent();
    if (!parent.length) break;
    cur = parent as ReturnType<typeof $>;
  }
  console.log();
  return true;
});

console.log(`Total unique listing links found: ${seen.size}`);
