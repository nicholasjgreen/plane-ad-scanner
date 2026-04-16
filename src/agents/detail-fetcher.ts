// Detail fetcher agent — fetches a single listing detail page and extracts
// full attributes + images via a local Ollama model (OpenAI-compat endpoint).
// Never throws — all failure paths return an error-annotated DetailFetchResult.

import OpenAI from 'openai';
import type { DetailFetcherInput, DetailFetchResult } from '../types.js';
import { logger } from '../config.js';

export type { DetailFetcherInput, DetailFetchResult };

export interface DetailFetcherDeps {
  fetchHtml?: (url: string) => Promise<string>;
  retryBaseMs?: number;  // Base delay for 429 exponential backoff; injectable for tests (pass 0)
}

/**
 * Merge detail-page attributes into existing stored attributes.
 * Detail keys overwrite existing only when the detail value is a non-empty string.
 * Exported for direct unit testing.
 */
export function mergeAttributes(
  existing: Record<string, string>,
  detail: Record<string, string>
): Record<string, string> {
  const merged = { ...existing };
  for (const [k, v] of Object.entries(detail)) {
    if (v !== '') merged[k] = v;
  }
  return merged;
}

async function defaultFetch(url: string): Promise<string> {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'plane-ad-scanner/0.1 (personal)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

async function fetchWithRetry(
  url: string,
  fetchHtml: (url: string) => Promise<string>,
  retryBaseMs: number
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchHtml(url);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.startsWith('HTTP 429') && attempt < 2) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, retryBaseMs * Math.pow(2, attempt))
        );
        continue;
      }
      throw err;
    }
  }
  // Exhausted retries on 429
  throw new Error('HTTP 429');
}

export async function runDetailFetcher(
  input: DetailFetcherInput,
  ollamaClient: OpenAI,
  ollamaModel: string,
  deps: DetailFetcherDeps = {}
): Promise<DetailFetchResult> {
  const { listingId, listingUrl, sourceSite } = input;
  const fetchHtml = deps.fetchHtml ?? defaultFetch;
  const retryBaseMs = deps.retryBaseMs ?? 1000;

  try {
    const html = await fetchWithRetry(listingUrl, fetchHtml, retryBaseMs);
    const trimmed = html.slice(0, 40_000);
    const origin = new URL(listingUrl).origin;

    const response = await ollamaClient.chat.completions.create({
      model: ollamaModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You extract structured data from a single aircraft-for-sale listing page.
Return ONLY a JSON object with two keys:
- "attributes": flat key-value pairs of all labelled fields (make, model, year, price, registration, total_time, engine_time, avionics, damage_history, seller_notes, and any other labelled fields present)
- "imageUrls": array of all image URLs found on the page (from <img src> and og:image); relative URLs should be prepended with ${origin}

Example: {"attributes":{"make":"Cessna","total_time":"1200h"},"imageUrls":["https://example.com/img/plane.jpg"]}
If no data found return: {"attributes":{},"imageUrls":[]}`,
        },
        {
          role: 'user',
          content: `Extract data from this aircraft listing page:\n\n${trimmed}`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '';
    // Strip markdown fences local models sometimes add despite response_format
    const text = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

    let parsed: { attributes?: unknown; imageUrls?: unknown };
    try {
      parsed = JSON.parse(text) as { attributes?: unknown; imageUrls?: unknown };
    } catch {
      logger.warn(
        { listingId, sourceSite, preview: text.slice(0, 200) },
        'Detail fetcher: JSON parse failed'
      );
      return { listingId, attributes: {}, imageUrls: [], error: 'parse error' };
    }

    // Coerce attributes to Record<string, string>
    const rawAttrs =
      typeof parsed.attributes === 'object' && parsed.attributes !== null
        ? (parsed.attributes as Record<string, unknown>)
        : {};
    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawAttrs)) {
      attributes[k] = String(v ?? '');
    }

    // Normalise image URLs: resolve relative against listing origin
    const rawUrls = Array.isArray(parsed.imageUrls) ? parsed.imageUrls : [];
    const imageUrls = rawUrls
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((u) => {
        try {
          return new URL(u).href; // already absolute
        } catch {
          try {
            return new URL(u, origin).href; // relative → absolute
          } catch {
            return u;
          }
        }
      });

    logger.debug(
      {
        listingId,
        sourceSite,
        attributeCount: Object.keys(attributes).length,
        imageCount: imageUrls.length,
      },
      'Detail fetcher: done'
    );
    return { listingId, attributes, imageUrls };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    logger.warn({ listingId, sourceSite, err: msg }, 'Detail fetcher: failed');
    return { listingId, attributes: {}, imageUrls: [], error: msg };
  }
}
