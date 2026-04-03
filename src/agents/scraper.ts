import Anthropic from '@anthropic-ai/sdk';
import type { ScraperOutput, RawListing } from '../types.js';
import { logger } from '../config.js';

// Registration patterns (UK / US / EU common)
const REG_PATTERNS = [
  /\bG-[A-Z]{4}\b/,
  /\bN\d{1,5}[A-Z]{0,2}\b/,
  /\b[A-Z]{2}-[A-Z]{3}\b/,
];

function findRegistration(text: string): string | undefined {
  for (const pat of REG_PATTERNS) {
    const m = text.match(pat);
    if (m) return m[0];
  }
  return undefined;
}

export type FetchHtmlFn = (url: string) => Promise<string>;
export type ExtractListingsFn = (html: string, siteUrl: string) => Promise<RawListing[]>;

export interface ScraperDeps {
  fetchHtml?: FetchHtmlFn;
  extractListings?: ExtractListingsFn;
}

async function defaultFetch(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'plane-ad-scanner/0.1 (personal)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp.text();
}

async function llmExtract(
  html: string,
  siteUrl: string,
  anthropic: Anthropic,
  maxTokens: number
): Promise<RawListing[]> {
  const origin = new URL(siteUrl).origin;
  const trimmed = html.slice(0, 40_000);

  // Cap output tokens — scraper only returns a JSON array, 4096 is ample.
  // token_budget_per_run controls spend, not per-call output size.
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: Math.min(maxTokens, 4096),
    system: `You extract aircraft-for-sale listings from HTML into JSON.
Return ONLY a JSON array of objects with these fields (omit absent fields):
- listingUrl: string (required; relative URLs → prepend ${origin})
- aircraftType: string
- make: string
- model: string
- registration: string (e.g. G-ABCD, N12345A)
- year: number
- price: number (numeric only, no symbols)
- priceCurrency: string (default "GBP")
- location: string
- attributes: object of any other key-value pairs`,
    messages: [{ role: 'user', content: `Extract listings from:\n\n${trimmed}` }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  const raw = JSON.parse(match[0]) as unknown[];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const listing: RawListing = {
        listingUrl: String(item.listingUrl ?? ''),
        attributes: (item.attributes as Record<string, string>) ?? {},
      };
      if (item.aircraftType) listing.aircraftType = String(item.aircraftType);
      if (item.make) listing.make = String(item.make);
      if (item.model) listing.model = String(item.model);
      if (item.year) listing.year = Number(item.year);
      if (item.price) listing.price = Number(item.price);
      if (item.priceCurrency) listing.priceCurrency = String(item.priceCurrency);
      if (item.location) listing.location = String(item.location);
      // Registration: use LLM-provided value or fall back to regex scan
      const reg = item.registration
        ? String(item.registration)
        : findRegistration(
            [listing.aircraftType, listing.make, listing.model, listing.listingUrl]
              .filter(Boolean)
              .join(' ')
          );
      if (reg) listing.registration = reg;
      return listing;
    });
}

export async function runScraper(
  site: { name: string; url: string },
  anthropic: Anthropic,
  config: { maxTokensPerAgent: number },
  deps: ScraperDeps = {}
): Promise<ScraperOutput> {
  const fetchHtml = deps.fetchHtml ?? defaultFetch;
  const extractListings =
    deps.extractListings ??
    ((html, siteUrl) => llmExtract(html, siteUrl, anthropic, config.maxTokensPerAgent));

  try {
    const html = await fetchHtml(site.url);
    const listings = await extractListings(html, site.url);
    logger.debug({ site: site.name, count: listings.length }, 'Scraper done');
    return { siteName: site.name, listings };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ site: site.name, err: msg }, 'Scraper failed');
    return { siteName: site.name, listings: [], error: msg };
  }
}
