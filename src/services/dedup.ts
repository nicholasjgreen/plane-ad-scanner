import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { RawListing } from '../types.js';
import { upsertListingAi, markListingAiStale } from '../db/listing-ai.js';
import { upsertListingIndicators, markIndicatorsStale } from '../db/listing-indicators.js';

export interface DedupResult {
  id: string;
  isNew: boolean;
}

/**
 * Insert or update a listing based on aircraft registration.
 * If registration is present and already in DB → UPDATE, return isNew=false.
 * If registration absent, or not yet seen → INSERT, return isNew=true.
 */
export function upsertListing(
  db: Database.Database,
  listing: RawListing,
  sourceSite: string,
  scanStartedAt: string
): DedupResult {
  if (listing.registration) {
    const existing = db
      .prepare('SELECT id FROM listings WHERE registration = ?')
      .get(listing.registration) as { id: string } | undefined;

    if (existing) {
      const thumbnailUrl = listing.imageUrls?.[0] ?? null;
      const allImageUrls = listing.imageUrls && listing.imageUrls.length > 0
        ? JSON.stringify(listing.imageUrls)
        : null;
      db.prepare(`
        UPDATE listings SET
          date_last_seen  = ?,
          is_new          = 1,
          price           = ?,
          location        = COALESCE(?, location),
          aircraft_type   = COALESCE(?, aircraft_type),
          make            = COALESCE(?, make),
          model           = COALESCE(?, model),
          year            = COALESCE(?, year),
          listing_url     = ?,
          raw_attributes  = ?,
          thumbnail_url   = COALESCE(?, thumbnail_url),
          all_image_urls  = COALESCE(?, all_image_urls)
        WHERE registration = ?
      `).run(
        scanStartedAt,
        listing.price ?? null,
        listing.location ?? null,
        listing.aircraftType ?? null,
        listing.make ?? null,
        listing.model ?? null,
        listing.year ?? null,
        listing.listingUrl,
        JSON.stringify(listing.attributes),
        thumbnailUrl,
        allImageUrls,
        listing.registration
      );
      // Mark the existing AI content and indicators stale so they are regenerated
      markListingAiStale(db, existing.id);
      markIndicatorsStale(db, existing.id);
      return { id: existing.id, isNew: false };
    }
  }

  // No match — insert new row
  const id = randomUUID();
  const thumbnailUrl = listing.imageUrls?.[0] ?? null;
  const allImageUrls = listing.imageUrls && listing.imageUrls.length > 0
    ? JSON.stringify(listing.imageUrls)
    : null;
  db.prepare(`
    INSERT INTO listings (
      id, registration, aircraft_type, make, model, year, price, price_currency,
      location, listing_url, source_site, match_score, is_new,
      date_first_found, date_last_seen, raw_attributes,
      thumbnail_url, all_image_urls
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)
  `).run(
    id,
    listing.registration ?? null,
    listing.aircraftType ?? null,
    listing.make ?? null,
    listing.model ?? null,
    listing.year ?? null,
    listing.price ?? null,
    listing.priceCurrency ?? 'GBP',
    listing.location ?? null,
    listing.listingUrl,
    sourceSite,
    scanStartedAt,
    scanStartedAt,
    JSON.stringify(listing.attributes),
    thumbnailUrl,
    allImageUrls
  );

  // Create pending rows so Presenter and IndicatorDeriver know to process this listing
  upsertListingAi(db, id);
  upsertListingIndicators(db, id);

  return { id, isNew: true };
}
