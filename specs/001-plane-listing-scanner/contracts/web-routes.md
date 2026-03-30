# Contract: Web Routes

**Feature**: 001-plane-listing-scanner
**Date**: 2026-03-30

---

## Overview

The web server exposes a single read-only route for the listing page. It is served by Express on `localhost:3000` (port configurable). No authentication is required. All responses are server-rendered HTML — no JSON API.

---

## Route: `GET /`

Returns the main listing page.

### Response

**Content-Type**: `text/html`

**Template data shape**:

```typescript
interface ListingsPageData {
  listings: ListingRow[];
  lastScan: LastScanInfo | null;    // null if no scan has ever run
  scanErrors: ScanError[];          // empty array if no errors in last scan
  totalCount: number;
}

interface ListingRow {
  id: string;
  registration: string | null;
  aircraftType: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  priceCurrency: string;
  location: string | null;
  listingUrl: string;
  sourceSite: string;
  matchScore: number;
  isNew: boolean;
  dateFirstFound: string;   // ISO 8601; formatted for display in template
  dateLastSeen: string;     // ISO 8601; formatted for display in template
}

interface LastScanInfo {
  startedAt: string;        // Formatted datetime string
  listingsFound: number;
  listingsNew: number;
}

interface ScanError {
  site: string;
  error: string;
}
```

### Rendering rules

| Condition | Rendered output |
|-----------|----------------|
| `listings.length === 0` AND `lastScan === null` | "No listings yet — run the scanner to populate the page." |
| `listings.length === 0` AND `lastScan !== null` | "No listings found. The last scan ran at {lastScan.startedAt} but returned no results." |
| `scanErrors.length > 0` | Banner at top: "Warning: {N} site(s) failed in the last scan: {site list with errors}" |
| `listing.isNew === true` | "New" badge shown on the listing row |
| `listing.price === null` | Display "Price not listed" |
| `listing.registration !== null` | Display registration prominently |

### Ordering

Listings are ordered by `match_score DESC`, then `date_first_found DESC` as a tiebreaker.

---

## Route: `GET /health`

Returns a minimal health check response (for monitoring/debugging; not linked from the UI).

**Response**:
```json
{ "status": "ok", "uptime": 12345 }
```

---

## No API Routes

This feature exposes no JSON API. All data access is server-side. Feature 004 will extend the template with expanded listing detail; no new routes are needed for that feature.
