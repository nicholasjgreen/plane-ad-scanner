// Verifier agent — checks whether a site can yield structured listing data.
// Uses Anthropic tool-use agentic loop with HTTP GET tool; haiku model; max 15 turns.
// Returns VerifierOutput (sample listings + pass/fail) without writing to the DB.

import Anthropic from '@anthropic-ai/sdk';
import type { VerifierOutput, RawListing } from '../types.js';
import { logger } from '../config.js';

const MAX_TURNS = 15;
const MAX_HTML_CHARS = 40_000;

export interface VerifierDeps {
  fetchHtml?: (url: string) => Promise<string>;
}

async function defaultFetch(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'plane-ad-scanner/0.1 (personal)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`);
  return resp.text();
}

const HTTP_GET_TOOL: Anthropic.Tool = {
  name: 'http_get',
  description:
    'Fetch the HTML content of a URL. Use this to load listing pages and follow pagination links.',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  },
};

export async function runVerifier(
  site: { name: string; url: string },
  anthropic: Anthropic,
  config: { maxTokensPerAgent: number },
  deps: VerifierDeps = {}
): Promise<VerifierOutput> {
  const fetchHtml = deps.fetchHtml ?? defaultFetch;
  const maxSamples = 5;

  const systemPrompt = `You are verifying that the aircraft-for-sale website "${site.name}" can yield structured listing data.

Use the http_get tool to fetch pages starting from: ${site.url}
Extract up to ${maxSamples} sample aircraft listings. If listings are not directly visible, follow up to 2 pagination or search-result links before giving up.

For each listing extract as many of these fields as available:
- listingUrl (required; convert relative URLs to absolute using the page's origin)
- aircraftType, make, model, year, price (numeric only), priceCurrency, location, registration

When done, respond with ONLY a valid JSON object (no markdown fences):
{
  "canFetchListings": true,
  "sampleListings": [{ "listingUrl": "...", "aircraftType": "...", ... }]
}

If you cannot extract any listings after following pagination, respond with:
{
  "canFetchListings": false,
  "failureReason": "brief explanation"
}`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: `Please verify: ${site.url}` },
  ];

  let turnsUsed = 0;

  try {
    while (turnsUsed < MAX_TURNS) {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: Math.min(config.maxTokensPerAgent, 4096),
        system: systemPrompt,
        tools: [HTTP_GET_TOOL],
        messages,
      });
      turnsUsed++;

      logger.debug(
        { site: site.name, turn: turnsUsed, stop: response.stop_reason },
        'Verifier turn'
      );

      if (response.stop_reason === 'end_turn') {
        // Model has finished — parse JSON result from text blocks
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          return {
            siteName: site.name,
            sampleListings: [],
            canFetchListings: false,
            failureReason: 'Agent did not return valid JSON',
            turnsUsed,
          };
        }

        const parsed = JSON.parse(match[0]) as {
          canFetchListings: boolean;
          sampleListings?: unknown[];
          failureReason?: string;
        };

        if (!parsed.canFetchListings) {
          return {
            siteName: site.name,
            sampleListings: [],
            canFetchListings: false,
            failureReason: parsed.failureReason ?? 'No listings found',
            turnsUsed,
          };
        }

        const raw = (parsed.sampleListings ?? []) as Record<string, unknown>[];
        const currentYear = new Date().getFullYear();
        const sampleListings: RawListing[] = raw
          .filter((item) => typeof item === 'object' && item !== null)
          .slice(0, maxSamples)
          .map((item) => {
            const listing: RawListing = {
              listingUrl: String(item.listingUrl ?? ''),
              attributes: {},
            };
            if (item.aircraftType) listing.aircraftType = String(item.aircraftType);
            if (item.make) listing.make = String(item.make);
            if (item.model) listing.model = String(item.model);
            if (item.registration) listing.registration = String(item.registration);
            if (item.year) {
              const y = Number(item.year);
              if (y >= 1900 && y <= currentYear + 1) listing.year = y;
            }
            if (item.price) {
              const p = Number(item.price);
              if (p > 0) listing.price = p;
            }
            if (item.priceCurrency) listing.priceCurrency = String(item.priceCurrency);
            if (item.location) listing.location = String(item.location);
            return listing;
          })
          .filter((l) => /^https?:\/\//.test(l.listingUrl));

        logger.info(
          { site: site.name, listings: sampleListings.length, turnsUsed },
          'Verifier done'
        );

        return {
          siteName: site.name,
          sampleListings,
          canFetchListings: sampleListings.length > 0,
          failureReason:
            sampleListings.length === 0 ? 'No valid listings extracted' : undefined,
          turnsUsed,
        };
      }

      if (response.stop_reason === 'tool_use') {
        // Process http_get tool calls
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          if (block.name === 'http_get') {
            const input = block.input as { url?: string };
            const targetUrl = input.url ?? '';
            let html = '';
            try {
              html = await fetchHtml(targetUrl);
              html = html.slice(0, MAX_HTML_CHARS);
            } catch (err) {
              html = `Error fetching ${targetUrl}: ${(err as Error).message}`;
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: html,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
      }
    }

    // Exceeded max turns
    return {
      siteName: site.name,
      sampleListings: [],
      canFetchListings: false,
      failureReason: `Exceeded max turns (${MAX_TURNS})`,
      turnsUsed,
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ site: site.name, err: message }, 'Verifier failed');
    return {
      siteName: site.name,
      sampleListings: [],
      canFetchListings: false,
      failureReason: message,
      turnsUsed: 0,
    };
  }
}
