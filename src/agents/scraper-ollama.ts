// Ollama-backed scraper — same contract as scraper.ts but uses the OpenAI-compatible
// API that Ollama exposes at /v1/chat/completions. Single-turn extraction, no tool use.

import OpenAI from 'openai';
import type { ScraperOutput, RawListing } from '../types.js';
import { logger } from '../config.js';
import { preFilterHtml, formatCardsForLlm } from './html-prefilter.js';

// Registration patterns (UK / US / EU common) — mirrors scraper.ts
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

export type OllamaFetchHtmlFn = (url: string) => Promise<string>;

export interface ScraperOllamaDeps {
  fetchHtml?: OllamaFetchHtmlFn;
}

async function defaultFetch(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'plane-ad-scanner/0.1 (personal)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp.text();
}

async function llmExtractOllama(
  html: string,
  siteUrl: string,
  client: OpenAI,
  model: string
): Promise<RawListing[]> {
  const origin = new URL(siteUrl).origin;

  const cards = preFilterHtml(html, siteUrl);
  let userContent: string;

  if (cards.length > 0) {
    logger.debug({ site: siteUrl, cards: cards.length }, 'Ollama scraper: pre-filter found cards');
    userContent = `Extract structured data from these aircraft listing cards:\n\n${formatCardsForLlm(cards)}`;
  } else {
    logger.debug({ site: siteUrl }, 'Ollama scraper: no cards found, falling back to raw HTML');
    userContent = `Extract listings from:\n\n${html.slice(0, 100_000)}`;
  }

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You extract aircraft-for-sale listings into JSON.
Return ONLY a JSON object {"listings": [...]} where each item has these fields (omit absent):
- listingUrl: string (required — use the URL from the "URL:" line exactly as given; relative URLs → prepend ${origin})
- aircraftType: string
- make: string
- model: string
- registration: string (e.g. G-ABCD, N12345A)
- year: number
- price: number (numeric only, no symbols; omit if POA or unknown)
- priceCurrency: string (default "GBP")
- location: string

Example: {"listings":[{"listingUrl":"https://example.com/ad/123","make":"Cessna","model":"172","price":45000,"priceCurrency":"GBP"}]}
If no listings found: {"listings":[]}`,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';

  // Strip markdown fences and <think> blocks that some local models emit
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  let parsed: { listings?: unknown[] };
  try {
    parsed = JSON.parse(text) as { listings?: unknown[] };
  } catch {
    logger.warn({ model, preview: text.slice(0, 200) }, 'Ollama scraper: JSON parse failed');
    return [];
  }

  const items = (parsed.listings ?? []) as Record<string, unknown>[];
  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const listing: RawListing = {
        listingUrl: String(item.listingUrl ?? ''),
        attributes: {},
      };
      if (item.aircraftType) listing.aircraftType = String(item.aircraftType);
      if (item.make) listing.make = String(item.make);
      if (item.model) listing.model = String(item.model);
      if (item.year) listing.year = Number(item.year);
      if (item.price) listing.price = Number(item.price);
      if (item.priceCurrency) listing.priceCurrency = String(item.priceCurrency);
      if (item.location) listing.location = String(item.location);
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

export async function runScraperOllama(
  site: { name: string; url: string },
  client: OpenAI,
  model: string,
  deps: ScraperOllamaDeps = {}
): Promise<ScraperOutput> {
  const fetchHtml = deps.fetchHtml ?? defaultFetch;

  try {
    const html = await fetchHtml(site.url);
    const listings = await llmExtractOllama(html, site.url, client, model);
    logger.debug({ site: site.name, count: listings.length, model }, 'Ollama scraper done');
    return { siteName: site.name, listings };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ site: site.name, model, err: msg }, 'Ollama scraper failed');
    return { siteName: site.name, listings: [], error: msg };
  }
}
