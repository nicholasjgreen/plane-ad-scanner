import Anthropic from '@anthropic-ai/sdk';
import type { PresenterInput, PresenterOutput } from '../types.js';

const MAX_HEADLINE_LEN = 60;
const MAX_TURNS = 3;

// ---------------------------------------------------------------------------
// Output validation — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Apply validation rules to raw LLM JSON output and return a typed PresenterOutput.
 * All fields are normalised so the output is always safe to store and render.
 */
export function validatePresenterOutput(
  raw: Record<string, unknown>,
  input: PresenterInput
): PresenterOutput {
  // --- Headline ---
  let headline = typeof raw.headline === 'string' ? raw.headline.trim() : '';
  if (!headline) {
    headline = buildFallbackHeadline(input);
  } else if (headline.length > MAX_HEADLINE_LEN) {
    headline = headline.slice(0, MAX_HEADLINE_LEN - 1) + '…';
  }

  // --- Explanation ---
  let explanation = typeof raw.explanation === 'string' ? raw.explanation.trim() : '';
  if (!explanation) {
    explanation = 'No summary available.';
  }

  // --- Status ---
  const rawStatus = raw.status;
  let status: 'ok' | 'partial' = 'partial';
  if ((rawStatus === 'ok' || rawStatus === 'partial') && input.profiles.length > 0) {
    status = rawStatus;
  }

  return {
    listingId: input.listing.id,
    headline,
    explanation,
    status,
  };
}

function buildFallbackHeadline(input: PresenterInput): string {
  const { listing } = input;
  const site = listing.sourceSite || 'Unknown site';
  if (listing.price !== null && listing.price !== undefined) {
    const sym: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' };
    const prefix = sym[listing.priceCurrency] ?? `${listing.priceCurrency} `;
    const price = `${prefix}${listing.price.toLocaleString()}`;
    return `Listing on ${site} — ${price}`;
  }
  return `Listing on ${site}`;
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(input: PresenterInput): string {
  const { listing, profiles } = input;

  const listingStr = JSON.stringify(
    {
      make: listing.make,
      model: listing.model,
      year: listing.year,
      price: listing.price !== null ? `${listing.priceCurrency} ${listing.price}` : null,
      location: listing.location,
      sourceSite: listing.sourceSite,
      ...listing.attributes,
    },
    null,
    2
  );

  const profileStr =
    profiles.length === 0
      ? 'No interest profiles defined — provide a general summary of the aircraft.'
      : profiles
          .map((p) => {
            const criteria = p.criteria
              .map((c) => `  - ${c.type}${c.intent ? ` (${c.intent})` : ''}`)
              .join('\n');
            return `Profile: ${p.name} (weight: ${p.weight})\n${criteria || '  (no criteria)'}`;
          })
          .join('\n\n');

  return `You are helping a private pilot evaluate an aircraft listing. Generate a JSON summary with two fields:

- "headline": max 60 characters, specific and factual. Include year, make/model, and one distinguishing attribute (role, ownership type, location, or notable equipment). No marketing language.
- "explanation": 2–4 sentences in plain English. For each relevant attribute, describe its practical significance to the buyer's interests — do not present bare numbers without context (e.g. say "priced well within budget" not just "£45,000"). Be honest about gaps. Where data is absent, do not speculate. If no profiles are given, summarise what the listing offers in neutral terms.
- "status": "ok" if profiles were used and data was sufficient, otherwise "partial".

Examples:
Input: { make: "Cessna", model: "172N", year: 1978, location: "Doncaster" }
Output: { "headline": "1978 Cessna 172N at Doncaster", "explanation": "A classic trainer well-suited to VFR touring. The 1978 vintage means lower acquisition cost but expect avionics upgrades.", "status": "ok" }

Input: { make: "Piper", model: "PA-28 Arrow", year: 1982, price: "GBP 52000" }
Output: { "headline": "1982 Piper Arrow — retractable, IFR capable", "explanation": "The Arrow's retractable undercarriage provides meaningful cruise speed gains over fixed-gear alternatives. At this price it is competitive for the type.", "status": "ok" }

Now generate for:

Listing data:
${listingStr}

Buyer interest profiles:
${profileStr}

Respond with only a JSON object — no markdown fences, no commentary.`;
}

// ---------------------------------------------------------------------------
// Main presenter function
// ---------------------------------------------------------------------------

/**
 * Generate a headline and plain-English explanation for a listing using Claude.
 * Retries up to MAX_TURNS times on JSON parse failure.
 * Throws on unrecoverable failure (caller sets listing_ai.status = 'failed').
 */
export async function runPresenter(
  input: PresenterInput,
  anthropic: Anthropic,
  model: string
): Promise<PresenterOutput> {
  const prompt = buildPrompt(input);
  let lastError: Error | undefined;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      lastError = new Error('Presenter: no text block in response');
      continue;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(textBlock.text) as Record<string, unknown>;
    } catch {
      lastError = new Error(`Presenter: JSON parse failure on turn ${turn + 1}: ${textBlock.text.slice(0, 100)}`);
      continue;
    }

    return validatePresenterOutput(raw, input);
  }

  throw lastError ?? new Error('Presenter: exceeded max turns without valid output');
}
