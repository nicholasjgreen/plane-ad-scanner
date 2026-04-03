# Contract: Listing Card and Expanded View

**Feature**: 004-listing-presentation
**Date**: 2026-03-30

This document defines the data contract between the backend (web server) and the frontend (rendered HTML page) for listing presentation. The web server renders HTML server-side; these contracts define the data shape passed to templates.

---

## Listing Card Data (summary view)

Used to render the collapsed `<details>` summary. All cards on the page are rendered from this shape.

```typescript
interface ListingCardData {
  id: string;
  headline: string | null;        // null → show constructed fallback (site + price)
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  priceCurrency: string;          // e.g. "GBP", "USD"
  sourceSite: string;             // display name of source site
  sourceUrl: string;              // direct link to original listing
  thumbnailUrl: string | null;    // null → show placeholder image
  matchScore: number;             // 0.0–1.0, used for sort order
  isNew: boolean;                 // true if found in the most recent scan run
  dateFirstFound: string;         // ISO 8601 date string
}
```

**Sort order**: Cards are rendered in descending `matchScore` order. Ties broken by `dateFirstFound` descending.

**Headline fallback**: If `headline` is null, the frontend renders a minimal fallback: `"Listing on {sourceSite}` + (price if available) e.g. `"Listing on Trade-A-Plane — £32,000"`.

---

## Expanded View Data (detail on card open)

Populated when a `<details>` element is opened. Rendered server-side alongside the summary — no separate request required.

```typescript
interface ListingExpandedData extends ListingCardData {
  explanation: string | null;         // null → show placeholder message
  explanationStatus: 'ready' | 'pending' | 'failed';
  allImageUrls: string[];             // empty array if no images available
  // Structured evidence from feature 002 — displayed below the explanation:
  profileScores: ProfileScore[];      // one entry per active profile
  // Additional listing fields for the expanded facts section:
  location: string | null;
  listingDate: string | null;         // date the listing appeared on the source site
  rawAttributes: Record<string, string>; // any additional scraped key/value pairs
}

interface ProfileScore {
  profileName: string;
  score: number;                      // 0–100
  evidence: EvidenceItem[];
}

interface EvidenceItem {
  criterionName: string;
  matched: boolean;
  contribution: number;               // points contributed to profile score
  note: string;                       // human-readable explanation
  inferenceConfidence?: 'high' | 'medium' | 'low'; // present only when inferred
}
```

**Explanation rendering rules**:
- `status === 'ready'` and `explanation !== null` → render explanation text
- `status === 'pending'` → render "Summary is being generated and will appear after the next scan."
- `status === 'failed'` and `explanation !== null` → render stale explanation with no special warning (it is the best available)
- `status === 'failed'` and `explanation === null` → render "Summary not yet available for this listing."

**Image gallery rendering rules**:
- `allImageUrls.length === 0` → render single placeholder
- `allImageUrls.length >= 1` → render all as `<img src="...">` tags; the first is scrolled into view by default

---

## Page-Level Data

Passed once per page render (not per listing).

```typescript
interface ListingPageData {
  listings: ListingExpandedData[];   // pre-sorted by matchScore desc
  lastScanAt: string | null;         // ISO 8601; null if no scan has run
  scanErrors: ScanError[];           // sites that failed on the last run
}

interface ScanError {
  siteName: string;
  errorSummary: string;
}
```
