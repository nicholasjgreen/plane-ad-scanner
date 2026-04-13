# Contract: Detail Fetcher Agent

**File**: `src/agents/detail-fetcher.ts`  
**Agent role**: Fetches and extracts structured data from a single listing detail page  
**Model**: Ollama model from `config.ollama.verification_model` (e.g. `qwen2.5:7b`) via OpenAI-compat client (`openai` npm package → `http://localhost:11434/v1`)  
**Tools**: HTTP GET only (fetch listing URL)  
**Max turns**: 1 (single `chat.completions.create` call — no agentic loop needed)

---

## Input

```typescript
interface DetailFetcherInput {
  listingId: string;     // DB primary key — for correlation only, not sent to LLM
  listingUrl: string;    // Full URL of the listing detail page
  sourceSite: string;    // Site name — used for logging
}
```

## Output

```typescript
interface DetailFetchResult {
  listingId: string;
  attributes: Record<string, string>;  // All labelled fields extracted from detail page
  imageUrls: string[];                 // All image URLs found (absolute)
  error?: string;                      // Present if fetch or LLM extraction failed
}
```

`error` being set does NOT throw — callers receive the result and decide how to handle it.

---

## Behaviour Contract

### Happy path
1. Fetch `listingUrl` with same `User-Agent` header as existing scraper; 30s timeout.
   - On HTTP 429: wait `1000ms * 2^attempt`, retry up to 3 attempts total before returning error.
2. Trim HTML to 40,000 characters (same cap as scraper).
3. Call Ollama via `ollamaClient.chat.completions.create({ model: ollamaModel, ... })`.
4. Parse response for a JSON object matching `{ attributes: {...}, imageUrls: [...] }`.
5. Normalise image URLs: prepend origin for relative URLs (same logic as scraper).
6. Return `{ listingId, attributes, imageUrls }`.

### Failure cases
| Failure | Behaviour |
|---------|-----------|
| HTTP 429 (after 3 retries) | Return `{ listingId, attributes: {}, imageUrls: [], error: "HTTP 429" }` |
| HTTP non-200 (other) | Return `{ listingId, attributes: {}, imageUrls: [], error: "HTTP {status}" }` |
| Network timeout | Return `{ listingId, attributes: {}, imageUrls: [], error: "timeout" }` |
| LLM returns no parseable JSON | Return `{ listingId, attributes: {}, imageUrls: [], error: "parse error" }` |
| Any thrown exception | Catch and return `{ listingId, attributes: {}, imageUrls: [], error: message }` |

**Never throws.** All failures produce an error-annotated result so the orchestrator can log and move on (Principle II: Resilience over Completeness).

---

## Exported API

```typescript
import OpenAI from 'openai';

export interface DetailFetcherInput { listingId: string; listingUrl: string; sourceSite: string; }
export interface DetailFetchResult  { listingId: string; attributes: Record<string, string>; imageUrls: string[]; error?: string; }

export async function runDetailFetcher(
  input: DetailFetcherInput,
  ollamaClient: OpenAI,
  ollamaModel: string,
  deps?: { fetchHtml?: (url: string) => Promise<string> }
): Promise<DetailFetchResult>
```

`deps.fetchHtml` is injectable for testing (same pattern as `runScraper`). In tests, mock `fetchHtml` directly — no Ollama client needed (mock the LLM response too via a stub `ollamaClient`).

---

## Orchestrator Integration

The orchestrator calls the detail fetcher in batches of 5 (bounded concurrency) between the historian pass and the matcher pass:

```
allListingIds → chunks of 5 → Promise.allSettled(chunk.map(runDetailFetcher))
  → on success: UPDATE listings SET ..., call markListingAiStale
  → on failure: log error, leave listing unchanged
→ matcher pass (now sees enriched raw_attributes)
→ presenter pass (picks up pending listing_ai rows)
```

`OrchestratorDeps` gains an optional `detailFetcher?` injectable for testing.
