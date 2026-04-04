// Ollama-backed verifier — same contract as verifier.ts but uses the OpenAI-compatible
// API that Ollama exposes at /v1/chat/completions. No rate limits, no API key required.

import OpenAI from 'openai';
import type { VerifierOutput, RawListing } from '../types.js';
import { logger } from '../config.js';

const MAX_TURNS = 15;
const MAX_HTML_CHARS = 40_000;

export interface OllamaVerifierDeps {
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

const HTTP_GET_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'http_get',
    description:
      'Fetch the HTML content of a URL. Use this to load listing pages and follow pagination links.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
      },
      required: ['url'],
    },
  },
};

export async function runVerifierOllama(
  site: { name: string; url: string },
  client: OpenAI,
  model: string,
  deps: OllamaVerifierDeps = {}
): Promise<VerifierOutput> {
  const fetchHtml = deps.fetchHtml ?? defaultFetch;
  const maxSamples = 5;

  const systemPrompt = `You are verifying that the aircraft-for-sale website "${site.name}" can yield structured listing data.

Use the http_get tool to fetch pages starting from: ${site.url}
Extract up to ${maxSamples} sample aircraft listings. If listings are not directly visible, follow up to 2 pagination or search-result links before giving up.

For each listing extract as many of these fields as available:
- listingUrl (required; convert relative URLs to absolute using the page's origin)
- aircraftType, make, model, year, price (numeric only), priceCurrency, location, registration

IMPORTANT: After fetching pages, your FINAL response must be ONLY a raw JSON object — no prose,
no analysis, no markdown fences, no explanation. Just the JSON.

If listings were found:
{"canFetchListings":true,"sampleListings":[{"listingUrl":"https://...","aircraftType":"...","make":"...","model":"...","year":2005,"price":45000,"priceCurrency":"GBP","location":"..."}]}

If no listings could be extracted:
{"canFetchListings":false,"failureReason":"one sentence reason"}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Please verify: ${site.url}` },
  ];

  let turnsUsed = 0;

  try {
    while (turnsUsed < MAX_TURNS) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: [HTTP_GET_TOOL],
        response_format: { type: 'json_object' },
      });
      turnsUsed++;

      const choice = response.choices[0];
      const message = choice.message;
      const hasToolCalls = (message.tool_calls?.length ?? 0) > 0;

      logger.debug(
        { site: site.name, turn: turnsUsed, finish: choice.finish_reason, hasToolCalls },
        'Ollama verifier turn'
      );

      // Some Ollama builds report finish_reason='stop' even when tool_calls are present.
      // Check for tool_calls in the message first regardless of finish_reason.
      if (hasToolCalls) {
        // fall through to the tool_calls handler below
      } else if (choice.finish_reason === 'stop' || choice.finish_reason === null) {
        // Model finished — parse JSON from text content.
        // Strip markdown fences (```json ... ```) that local models often add.
        const modelOutput = typeof message.content === 'string' ? message.content : '';
        const text = modelOutput.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

        logger.debug({ site: site.name, preview: text.slice(0, 500) }, 'Ollama raw output');

        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
          logger.warn(
            { site: site.name, modelOutput: text.slice(0, 300) },
            'Ollama verifier: no JSON in model output'
          );
          return {
            siteName: site.name,
            sampleListings: [],
            canFetchListings: false,
            failureReason: `Model did not return JSON. Got: ${text.slice(0, 200)}`,
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
          { site: site.name, listings: sampleListings.length, turnsUsed, model },
          'Ollama verifier done'
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

      if (choice.finish_reason === 'tool_calls') {
        // Model wants to call http_get — execute and feed results back
        messages.push(message);

        const toolCalls = (message.tool_calls ?? []).filter(
          (tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } =>
            tc.type === 'function'
        );
        for (const toolCall of toolCalls) {
          if (toolCall.function.name !== 'http_get') continue;

          let html = '';
          try {
            const args = JSON.parse(toolCall.function.arguments) as { url?: string };
            const targetUrl = args.url ?? '';
            html = await fetchHtml(targetUrl);
            html = html.slice(0, MAX_HTML_CHARS);
          } catch (err) {
            html = `Error: ${(err as Error).message}`;
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: html,
          });
        }
      }
    }

    return {
      siteName: site.name,
      sampleListings: [],
      canFetchListings: false,
      failureReason: `Exceeded max turns (${MAX_TURNS})`,
      turnsUsed,
    };
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ site: site.name, model, err: message }, 'Ollama verifier failed');
    return {
      siteName: site.name,
      sampleListings: [],
      canFetchListings: false,
      failureReason: message,
      turnsUsed: 0,
    };
  }
}
