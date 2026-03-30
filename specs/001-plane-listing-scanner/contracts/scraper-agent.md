# Contract: Scraper Agent

**Feature**: 001-plane-listing-scanner
**Date**: 2026-03-30

---

## Agent Role

One **Scraper agent** is instantiated per enabled site per scan run. It fetches the listing page(s) for its assigned site, parses the HTML, and returns a list of raw listing objects. Scraper agents for all sites run concurrently.

---

## Agent Configuration

| Parameter | Value |
|-----------|-------|
| Model | `claude-haiku-4-5-20251001` |
| Max turns | 10 |
| Tools | HTTP GET only (fetch URL, return body) |
| Parallelism | One instance per enabled site; all run concurrently |
| Failure handling | On exception, return `ScraperOutput` with `listings: []` and `error` set; Orchestrator records error and continues |

---

## Input Schema

```typescript
interface ScraperInput {
  site: {
    name: string;       // e.g. "Trade-A-Plane"
    url: string;        // Base listing page URL
  };
}
```

---

## Output Schema

```typescript
interface ScraperOutput {
  siteName: string;
  listings: RawListing[];
  error?: string;       // Set if the site could not be fetched or parsed
}

interface RawListing {
  listingUrl: string;         // MUST be http or https; validated before persistence
  aircraftType?: string;      // Free-text type as found on the page
  make?: string;
  model?: string;
  registration?: string;      // Aircraft registration if explicitly present
  year?: number;
  price?: number;
  priceCurrency?: string;     // e.g. "GBP", "USD"; defaults to "GBP" if absent
  location?: string;
  attributes: Record<string, string>;  // All other key-value pairs scraped from the listing
}
```

**Validation rules applied by Orchestrator before passing to Historian**:
- `listingUrl` MUST match `^https?://` — listings with invalid URLs are discarded and logged
- `price` MUST be a positive number if present
- `year` MUST be a 4-digit integer between 1900 and (current year + 1) if present

---

## Registration Extraction Strategy

The Scraper agent applies a prioritised extraction strategy for `registration`:

1. **Structured field**: If the listing page has an explicit "Registration" or "Reg" label/field, use its value directly.
2. **Regex scan**: If no structured field, scan the listing title and first 500 characters of the description for known registration patterns:
   - UK: `[A-Z]-[A-Z]{4}` (e.g. `G-ABCD`)
   - US: `N[0-9]{1,5}[A-Z]{0,2}` (e.g. `N12345A`)
   - EU common: `[A-Z]{2}-[A-Z]{3}` (e.g. `D-EABC`, `F-GNOP`)
3. **No match**: Set `registration = undefined`; Historian will treat the listing as unique.

---

## Invocation Sequence

```
Orchestrator
  └─► for each enabled site (parallel):
        └─► ScraperAgent({ site })
              ├─► fetch site URL (HTTP GET)
              ├─► parse HTML with cheerio
              ├─► extract RawListing[]
              └─► return ScraperOutput
        └─► validate RawListing[] (URL check, type coercion)
        └─► pass validated listings to Historian
```
