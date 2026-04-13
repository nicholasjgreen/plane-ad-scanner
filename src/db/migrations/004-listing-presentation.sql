-- Migration 004: listing-presentation
-- Adds thumbnail_url and all_image_urls to listings; creates listing_ai table.

ALTER TABLE listings ADD COLUMN thumbnail_url TEXT;
-- URL of the representative thumbnail image (og:image or first non-decorative <img>).
-- NULL if no image was found at scrape time.

ALTER TABLE listings ADD COLUMN all_image_urls TEXT;
-- JSON array of all image URLs scraped from the listing page. e.g. '["https://...","https://..."]'
-- NULL if no images were found. Used to populate the expanded view gallery.

-- ---------------------------------------------------------------------------
-- listing_ai: AI-generated headline and explanation per listing.
-- One row per listing; keyed by listing_id (not a separate UUID).
-- ---------------------------------------------------------------------------

CREATE TABLE listing_ai (
  listing_id   TEXT PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  headline     TEXT,          -- Generated headline (max 60 chars). NULL until first generation.
  explanation  TEXT,          -- Plain-English explanation. NULL until first generation.
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'ready', 'failed')),
  model_ver    TEXT,          -- SHA-256 of the profile JSON at generation time (for staleness detection).
  generated_at TEXT           -- ISO 8601 datetime of last successful generation.
);

CREATE INDEX idx_listing_ai_status    ON listing_ai(status);
CREATE INDEX idx_listing_ai_model_ver ON listing_ai(model_ver);
