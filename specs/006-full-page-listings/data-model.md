# Data Model: Full Page Listing Details (006)

## No Schema Changes

No new tables or columns. This feature enriches data in existing columns.

## Affected Columns (existing)

### `listings` table

| Column | Type | Change |
|--------|------|--------|
| `raw_attributes` | `TEXT` (JSON) | Enriched by detail fetch — new keys added, existing keys updated with detail-page values |
| `thumbnail_url` | `TEXT` | Updated if detail page provides a better (non-null) value |
| `all_image_urls` | `TEXT` (JSON array) | Replaced entirely if detail page returns any images; left unchanged on failure or empty result |
| `make`, `model`, `year`, `price`, `location`, `registration` | various | Updated via `COALESCE(detail_value, existing_value)` — detail value wins only if non-null |

### `listing_ai` table

| Column | Type | Change |
|--------|------|--------|
| `status` | `TEXT` | Reset to `'pending'` after a successful detail fetch (via existing `markListingAiStale`) |

## Merge Rules

1. **Top-level scalar columns**: `COALESCE(detail_value, existing_value)` — detail page value used only when non-null.
2. **`raw_attributes` JSON**: Shallow merge — `{ ...existing_attributes, ...detail_attributes }` where detail keys overwrite existing only when the detail value is a non-empty string.
3. **`all_image_urls`**: Full replacement if the detail fetch returns ≥ 1 image URL; existing value kept if detail fetch returns zero images or fails.
4. **`thumbnail_url`**: Set to first image URL from detail fetch if at least one was found; otherwise leave unchanged.

## Detail Fetch Result Shape (transient — not persisted separately)

```typescript
interface DetailFetchResult {
  listingId: string;
  attributes: Record<string, string>;   // All labelled fields from detail page
  imageUrls: string[];                  // All image URLs found on detail page
  error?: string;                       // Set if fetch or parse failed
}
```

This type is consumed by the orchestrator and used to build the UPDATE statement; it is never stored as a separate entity.
