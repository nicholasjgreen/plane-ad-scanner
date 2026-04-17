/**
 * Pre-filter for listing index pages.
 *
 * Instead of feeding 40k of raw HTML to the LLM, we use cheerio to:
 *   1. Find all unique links that look like listing detail pages
 *   2. Extract the surrounding card text for each (title, price, location, etc.)
 *   3. Return a compact [{url, cardText}] array — typically a few hundred chars per listing
 *
 * The LLM then only has to parse clean card snippets, not wade through nav/scripts/CSS.
 *
 * If no listing links are found (JS-rendered page), the caller should fall back to raw HTML.
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import TurndownService from 'turndown';

const td = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
});
// Drop noise elements entirely
td.remove(['script', 'style', 'svg', 'img', 'button', 'iframe']);

// URL patterns that suggest a listing detail page
const LISTING_PATH_PATTERNS = [
  /\/listing[s]?\//i,
  /\/advert[s]?\//i,
  /\/standardView-/i,
  /\/aircraft\//i,
  /\/plane[s]?\//i,
  /\/detail\//i,
  /\/view\//i,
  /\/sale\//i,
  /[?&]id=\d+/i,
  /\/\d{5,}/,         // path segment with 5+ digit numeric ID
];

// Patterns that indicate navigation / category / pagination links — not individual listings
const EXCLUDE_PATH_PATTERNS = [
  /[?&]page=\d+/,     // pagination query param
  /\/page\/\d+/i,     // pagination path segment
  /\/category\//i,
  /\/search[/?]/i,
  /\/tag\//i,
  /\/filter\//i,
];

function isListingUrl(href: string): boolean {
  if (EXCLUDE_PATH_PATTERNS.some((p) => p.test(href))) return false;
  return LISTING_PATH_PATTERNS.some((p) => p.test(href));
}

/**
 * Walk up the DOM from the link to find the "card" ancestor — the smallest
 * block element whose text content is 30–800 chars (i.e. one listing, not a
 * whole list container).  Converts the card HTML to Markdown via turndown so
 * the LLM receives clean, compact, structure-aware text.
 */
function getCardMarkdown(
  $: cheerio.CheerioAPI,
  $link: ReturnType<typeof $>,
  maxChars = 600
): string {
  const INLINE_TAGS = new Set(['span', 'strong', 'em', 'b', 'i', 'a', 'small']);
  let cur: cheerio.Cheerio<AnyNode> = $link.parent();
  let best: cheerio.Cheerio<AnyNode> | null = null;

  for (let d = 0; d < 8; d++) {
    if (!cur.length) break;

    const tag = ((cur[0] as { tagName?: string })?.tagName ?? '').toLowerCase();
    if (INLINE_TAGS.has(tag)) {
      cur = cur.parent();
      continue;
    }

    const text = cur.text().replace(/\s+/g, ' ').trim();
    if (text.length >= 30 && text.length <= 800) {
      best = cur;
    }
    if (text.length > 800 && best) break;

    cur = cur.parent();
  }

  if (!best) return '';

  const html = best.html() ?? '';
  const markdown = td.turndown(html).replace(/\n{3,}/g, '\n\n').trim();
  return markdown.slice(0, maxChars);
}

export interface CardData {
  url: string;
  cardMarkdown: string;
}

/**
 * Extract listing cards from a listing index page HTML.
 *
 * @param html   Raw HTML of the page
 * @param siteUrl  The URL the HTML was fetched from (used to resolve relative links and origin)
 * @returns Array of {url, cardText} — empty if no listing links found (JS-rendered page)
 */
export function preFilterHtml(html: string, siteUrl: string): CardData[] {
  const $ = cheerio.load(html);
  const origin = new URL(siteUrl).origin;
  const seen = new Set<string>();
  const results: CardData[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (!isListingUrl(href)) return;

    let absUrl: string;
    try {
      absUrl = new URL(href, origin).href;
    } catch {
      return;
    }

    // Normalise: strip fragment and trailing slash for dedup
    const key = absUrl.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);

    const cardMarkdown = getCardMarkdown($, $(el) as ReturnType<typeof $>);
    results.push({ url: absUrl, cardMarkdown });
  });

  return results;
}

/**
 * Format extracted cards as a compact text block for the LLM.
 * Each card becomes:
 *   --- LISTING N ---
 *   URL: <absolute url>
 *   <card text>
 */
export function formatCardsForLlm(cards: CardData[]): string {
  return cards
    .map((c, i) => `--- LISTING ${i + 1} ---\nURL: ${c.url}\n${c.cardMarkdown}`)
    .join('\n\n');
}
