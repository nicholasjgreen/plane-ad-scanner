// Detail fetcher agent — fetches a single listing detail page and extracts
// full attributes + images via a local Ollama model (OpenAI-compat endpoint).
// Never throws — all failure paths return an error-annotated DetailFetchResult.

import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import type { DetailFetcherInput, DetailFetchResult } from '../types.js';
import { logger } from '../config.js';

export type { DetailFetcherInput, DetailFetchResult };

export interface DetailFetcherDeps {
  fetchHtml?: (url: string) => Promise<string>;
  retryBaseMs?: number;  // Base delay for 429 exponential backoff; injectable for tests (pass 0)
}

export interface ListingExtraction {
  /** Compact text sent to the LLM for structured attribute extraction */
  text: string;
  /** Long prose blocks (description, notes) extracted directly — bypasses LLM truncation */
  proseBlocks: string[];
  /** Image URLs found in the page */
  imageUrls: string[];
}

/**
 * Strip a full listing-detail HTML page down to meaningful text before sending
 * to the LLM. A typical listing page is 100-200k chars; the actual content
 * (specs, description, images) is usually 3-10k. Sending raw HTML to a small
 * local model wastes its context window and degrades extraction quality.
 *
 * Prose blocks are returned separately so the caller can inject them directly
 * into attributes without relying on the LLM to faithfully copy long strings.
 * Exported for unit testing.
 */
export function extractListingText(html: string, origin: string): ListingExtraction {
  const $ = cheerio.load(html);

  // Remove pure noise — these never contain listing content
  $('script, style, svg, noscript, iframe, header, footer, nav').remove();

  const parts: string[] = [];
  const seenText = new Set<string>();

  // --- Title ---
  const title = $('h1').first().text().trim() || $('title').text().replace(/\s*\|.*$/, '').trim();
  if (title) parts.push(`Title: ${title}`);

  // --- Structured spec pairs ---
  // Handles: .spec-label/.spec-value, dl/dt/dd, table th/td
  const specParts: string[] = [];
  const seenLabels = new Set<string>();

  const addSpec = (label: string, value: string) => {
    const l = label.replace(/:+$/, '').trim();
    const v = value.trim();
    if (!l || !v || seenLabels.has(l)) return;
    // Skip nav/admin fields that aren't listing data
    if (/section|category|views|status|created|refreshed/i.test(l)) return;
    seenLabels.add(l);
    specParts.push(`${l}: ${v}`);
  };

  $('[class*="spec-label"], [class*="detail-label"], [class*="field-label"]').each((_, el) => {
    addSpec($(el).text(), $(el).next().text());
  });
  $('dl dt').each((_, el) => addSpec($(el).text(), $(el).next('dd').text()));
  $('table tr').each((_, tr) => {
    addSpec($(tr).find('th').first().text(), $(tr).find('td').first().text());
  });

  if (specParts.length) {
    parts.push('');
    parts.push('Specifications:');
    parts.push(...specParts);
  }

  // --- Prose blocks ---
  // Collected separately so the caller can inject them directly into attributes,
  // bypassing LLM truncation of long strings.
  const proseBlocks: string[] = [];
  $('p, [class*="description"], [class*="notes"], [class*="summary"], [class*="detail-text"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length < 80) return;
    if (seenText.has(text)) return;
    if (/cookie|privacy policy|terms of use|all rights reserved/i.test(text.slice(0, 60))) return;
    seenText.add(text);
    proseBlocks.push(text);
  });

  // Include a short hint in the LLM text so it knows a description exists
  if (proseBlocks.length > 0) {
    parts.push('');
    parts.push(`seller_notes: ${proseBlocks[0].slice(0, 300)}…`);
  }

  // --- Image URLs ---
  const imageUrls: string[] = [];
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) {
    try { imageUrls.push(new URL(ogImage, origin).href); } catch { /* skip */ }
  }
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    if (!src || src.startsWith('data:')) return;
    try { imageUrls.push(new URL(src, origin).href); } catch { /* skip */ }
  });

  if (imageUrls.length) {
    parts.push('');
    parts.push('Images:');
    parts.push(...imageUrls.slice(0, 20));
  }

  return { text: parts.join('\n').trim(), proseBlocks, imageUrls };
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
    const origin = new URL(listingUrl).origin;
    const { text: pageText, proseBlocks, imageUrls: extractedImageUrls } = extractListingText(html, origin);

    logger.debug(
      { listingId, sourceSite, inputChars: html.length, extractedChars: pageText.length },
      'Detail fetcher: extracted listing text'
    );

    const response = await ollamaClient.chat.completions.create({
      model: ollamaModel,
      response_format: { type: 'json_object' },
      // Disable qwen3 thinking mode — thinking tokens waste context and degrade JSON extraction
      ...({ think: false } as object),
      messages: [
        {
          role: 'system',
          content: `You are a data extractor. Read the aircraft listing in the user message and return a JSON object with exactly two keys:
- "attributes": an object containing every labelled field from the listing (e.g. make, model, year, price, registration, airframe_hours, engine_hours, avionics, seller_notes, location, and anything else labelled)
- "imageUrls": an array of image URL strings found in the listing

Rules:
- Only extract values that are explicitly present in the user message. Do not invent or infer values.
- Use the exact values as written in the listing.
- If a field has no value in the listing, omit it.
- Relative image URLs should be made absolute using origin: ${origin}
- If nothing can be extracted, return {"attributes":{},"imageUrls":[]}`,
        },
        {
          role: 'user',
          content: `Extract all data from this aircraft listing:\n\n${pageText}`,
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

    // Inject prose blocks directly — don't rely on the LLM to copy long strings faithfully.
    // seller_notes wins only if the LLM didn't already populate it with something meaningful.
    if (proseBlocks.length > 0 && (!attributes['seller_notes'] || attributes['seller_notes'].length < 100)) {
      attributes['seller_notes'] = proseBlocks[0];
    }
    for (let i = 1; i < proseBlocks.length; i++) {
      const key = `additional_notes_${i}`;
      if (!attributes[key]) attributes[key] = proseBlocks[i];
    }

    // Normalise image URLs: LLM output first, then fall back to cheerio-extracted URLs.
    const rawUrls = Array.isArray(parsed.imageUrls) ? parsed.imageUrls : [];
    const llmImageUrls = rawUrls
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((u) => {
        try { return new URL(u).href; }
        catch { try { return new URL(u, origin).href; } catch { return u; } }
      });
    const imageUrls = llmImageUrls.length > 0 ? llmImageUrls : extractedImageUrls;

    logger.debug(
      { listingId, sourceSite, attributeCount: Object.keys(attributes).length, imageCount: imageUrls.length },
      'Detail fetcher: done'
    );
    return { listingId, attributes, imageUrls };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    logger.warn({ listingId, sourceSite, err: msg }, 'Detail fetcher: failed');
    return { listingId, attributes: {}, imageUrls: [], error: msg };
  }
}
