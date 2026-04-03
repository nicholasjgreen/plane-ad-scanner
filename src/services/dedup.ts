import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { RawListing } from '../types.js';

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
          raw_attributes  = ?
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
        listing.registration
      );
      return { id: existing.id, isNew: false };
    }
  }

  // No match — insert new row
  const id = randomUUID();
  db.prepare(`
    INSERT INTO listings (
      id, registration, aircraft_type, make, model, year, price, price_currency,
      location, listing_url, source_site, match_score, is_new,
      date_first_found, date_last_seen, raw_attributes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)
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
    JSON.stringify(listing.attributes)
  );

  return { id, isNew: true };
}
