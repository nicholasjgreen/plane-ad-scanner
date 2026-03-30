# Data Model: Listing Presentation

**Feature**: 004-listing-presentation
**Date**: 2026-03-30

---

## Schema Changes

### Extend: `listings` table (from feature 001)

Two new columns are added to the existing `listings` table:

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `thumbnail_url` | TEXT | YES | URL of the selected representative image. NULL if no image was found at scrape time. Populated using the og:image → first non-decorative img heuristic. |
| `all_image_urls` | TEXT | YES | JSON array of all image URLs scraped from the listing page. Used to populate the expanded view gallery. Example: `["https://...", "https://..."]` |

### New: `listing_ai` table

Stores AI-generated content for each listing. One row per listing, keyed by `listing_id`.

| Column | Type | Nullable | Constraints | Description |
|--------|------|----------|-------------|-------------|
| `listing_id` | TEXT | NO | PK, FK → listings.id | The listing this AI content belongs to |
| `headline` | TEXT | YES | — | Generated headline (max 60 chars). NULL if generation has not yet run or failed. |
| `explanation` | TEXT | YES | — | Plain-English explanation of why the listing matches (or doesn't) the user's interest profiles. NULL if generation has not yet run or failed. |
| `status` | TEXT | NO | DEFAULT 'pending' | One of: `pending`, `ready`, `failed` |
| `model_ver` | TEXT | YES | — | Hash or label identifying the prompt template and model version used. Used to detect stale content that should be regenerated. |
| `generated_at` | DATETIME | YES | — | Timestamp of the last successful generation. |

---

## Entity Relationships

```
listings (1) ──── (0..1) listing_ai
listings (N) ──── (1)    sites          [from feature 003]
listings (N) ──── (N)    profiles       [scored by Matcher — from feature 002]
```

---

## State Transitions: `listing_ai.status`

```
[not yet created]
        │  scan run starts, listing is new or profiles changed
        ▼
    pending
        │  Presenter agent runs successfully
        ▼
     ready  ◄──────────────────────────────────────────────┐
        │  profile change detected on next scan             │
        ▼                                                   │
    pending ──► Presenter agent runs successfully ──────────┘
        │
        │  Presenter agent fails (all retry attempts exhausted)
        ▼
    failed  (previous content, if any, retained in headline/explanation columns)
```

**Key rules:**
- A listing enters `pending` state on first scan (when the row is created) and whenever the active interest profile version changes since last generation.
- `failed` status leaves any previously generated `headline`/`explanation` values intact — they are shown to the user until a future scan succeeds.
- If a listing has never had a successful generation and status is `failed`, the `headline` and `explanation` columns will be NULL — the UI shows the placeholder.

---

## Validation Rules

- `listing_ai.status` MUST be one of: `pending`, `ready`, `failed`. Any other value is rejected at the application layer.
- `listing_ai.headline` MUST NOT exceed 60 characters (enforced by the Presenter agent prompt; validated before insert).
- `listings.all_image_urls` MUST be a valid JSON array of strings, or NULL. No other types permitted.
- `listings.thumbnail_url` MUST be a valid `http` or `https` URL if non-NULL (same validation rule as listing URLs per constitution Principle VII).

---

## Indexes

- `listing_ai(status)` — to efficiently query all `pending` rows at scan time
- `listing_ai(model_ver)` — to identify rows needing regeneration after a prompt/model upgrade
