# Research: Listing Presentation

**Feature**: 004-listing-presentation
**Date**: 2026-03-30

---

## 1. Thumbnail Selection Strategy

**Decision**: Priority-ordered heuristic chain — `og:image` meta tag first, then first non-decorative `<img>` in DOM order.

**Rationale**: `og:image` is set by the publisher to identify their primary representative photo — it is the highest-signal, zero-ambiguity choice. When absent, DOM order works: listing sites consistently place the hero photo first in their markup.

**Implementation heuristic**:
1. Check `<meta property="og:image">` or `<meta name="twitter:image:src">`
2. Fall back to first `<img src>` in the listing body whose URL does not match patterns like `/logo`, `/icon`, `/sprite`, `/pixel`, and whose declared `width` (if present) is ≥ 100px
3. If nothing matches, store null (placeholder shown on card)

**Alternatives rejected**: Downloading all images to compare dimensions (doubles HTTP traffic); ML-based relevance scoring (over-engineered for a personal tool).

---

## 2. Image Storage and Serving

**Decision**: Store the scraped image URL and serve it as a plain `<img src="...">` tag. No proxy, no local disk copy.

**Rationale**: CORS restrictions apply to JavaScript `fetch()` calls, not to HTML `<img src>` tags. A server-rendered page can reference any external image URL freely. A personal localhost tool has no CORS exposure. The only failure mode is URLs expiring after a listing is removed from the source site — acceptable for a scan-based tool where URLs are refreshed on each scan.

**Note**: If persistent historical images are later needed (after listings are removed), the simplest upgrade is to fetch and save the thumbnail to a local `/thumbnails/<listing-id>.<ext>` path on first scrape. This is deferred to a future feature.

**Alternatives rejected**: Local proxy pass-through (adds a request hop with no benefit for `<img>` tags); third-party CORS proxy (external dependency for a local tool).

---

## 3. Headline and Explanation Generation (Prompt Engineering)

**Decision**: Single LLM call per listing returning both headline and explanation via structured JSON output. Use few-shot examples to anchor the headline style. Skip chain-of-thought for headline generation.

**Rationale**: Headline generation is format-imitation, not reasoning. Few-shot examples teach the specific register (year, make, notable attribute, location) more reliably than instructions alone. Chain-of-thought is counterproductive — it produces verbose output. Combining headline + explanation in one call halves LLM invocations per listing.

**Prompt structure**:
```
Generate a listing summary as JSON with two fields:
- "headline": max 60 characters, specific, factual, no marketing language.
  Include year, make, and one distinguishing detail (location, role, equipment, ownership type).
- "explanation": 2–4 sentences in plain English. For each relevant attribute, describe its
  practical significance to the buyer's interests. Do not list bare numbers without context.
  Where data is absent, do not speculate.

Examples:
{ data: { make: "Cessna", model: "172N", year: 1978, ttaf: 4200, location: "Doncaster" } }
→ { "headline": "1978 C172N at Doncaster — 4,200 TTAF, fresh annual", "explanation": "..." }

{ data: { make: "Cirrus", model: "SR22", year: 2003, avionics: "Avidyne Entegra" } }
→ { "headline": "2003 Cirrus SR22 G2 — integrated Avidyne glass panel", "explanation": "..." }

Now generate for:
{ listing: {listing_data}, profiles: {active_profiles} }
```

**Model**: `claude-sonnet-4-6` (judgment task per constitution)
**Max turns**: 3
**Output schema**: `{ headline: string, explanation: string, status: "ok" | "partial" }`

**Fallback when data is sparse**: The prompt instructs the model to use whatever is available. The headline will be constructed from the minimum available data (source site + price) when attributes are absent.

**Alternatives rejected**: Separate calls for headline and explanation (doubles cost); zero-shot instructions alone (produces generic output without style anchoring); chain-of-thought (produces verbose, less specific headlines).

---

## 4. Card Expand/Collapse UI

**Decision**: Native HTML `<details>`/`<summary>` elements. No JavaScript or library required.

**Rationale**: Universal browser support (all modern browsers), zero dependencies, built-in keyboard accessibility and correct ARIA roles. The expanded content (explanation + gallery) drops in as the body of `<details>`. CSS `details[open]` selector allows full styling control including animated expand.

**Pattern**:
```html
<details class="listing-card">
  <summary>
    <img src="..." class="thumbnail" />
    <span class="headline">1978 C172N at Doncaster</span>
    <span class="key-facts">Cessna · 172N · 1978 · £32,000</span>
  </summary>
  <div class="expanded-body">
    <!-- AI explanation, image gallery, source link -->
  </div>
</details>
```

**Optional upgrade** (no library needed): To allow only one card open at a time, 5 lines of vanilla JS listening for the `toggle` event suffices.

**Alternatives rejected**: Alpine.js / HTMX (external dependency for something the browser does natively); React/Vue (over-engineered for a personal tool page).

---

## 5. Database Schema for AI-Generated Text

**Decision**: Separate `listing_ai` table with foreign key to `listings`. SQLite for the underlying store.

**Rationale**: AI content is generated and regenerated independently of the base listing data. A separate table makes re-generation clean (update or insert without touching the listing row), keeps base listing queries fast and narrow, and provides a `model_version` column to invalidate cached output when prompts change.

**Schema**:
```sql
-- Extend listings table (from feature 001):
ALTER TABLE listings ADD COLUMN thumbnail_url TEXT;
ALTER TABLE listings ADD COLUMN all_image_urls TEXT;  -- JSON array of strings

-- New table:
CREATE TABLE listing_ai (
  listing_id   TEXT PRIMARY KEY REFERENCES listings(id),
  headline     TEXT,
  explanation  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | ready | failed
  model_ver    TEXT,                              -- prompt/model version hash
  generated_at DATETIME
);
```

**Alternatives rejected**: Column on `listings` table (complicates regeneration, bloats base rows); pure JSON blob for all AI output (loses queryability on status and model version).
