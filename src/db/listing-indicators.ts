import Database from 'better-sqlite3';
import type { StructuredIndicators } from '../types.js';

/**
 * Insert a listing_indicators row with status='pending' if none exists.
 * No-op if a row already exists (INSERT OR IGNORE).
 */
export function upsertListingIndicators(db: Database.Database, listingId: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO listing_indicators (listing_id, status)
    VALUES (?, 'pending')
  `).run(listingId);
}

/**
 * Store the derived indicators JSON blob, set status='ready', and record derived_at timestamp.
 */
export function setIndicatorsReady(
  db: Database.Database,
  listingId: string,
  indicators: StructuredIndicators
): void {
  db.prepare(`
    UPDATE listing_indicators
    SET status     = 'ready',
        indicators = ?,
        derived_at = ?
    WHERE listing_id = ?
  `).run(JSON.stringify(indicators), new Date().toISOString(), listingId);
}

/**
 * Mark indicators as failed. Preserves the existing indicators blob (best-effort display).
 */
export function setIndicatorsFailed(db: Database.Database, listingId: string): void {
  db.prepare(`
    UPDATE listing_indicators
    SET status = 'failed'
    WHERE listing_id = ?
  `).run(listingId);
}

/**
 * Mark indicators as stale (raw_attributes changed — re-derivation needed on next cycle).
 * No-op if no row exists for this listing.
 */
export function markIndicatorsStale(db: Database.Database, listingId: string): void {
  db.prepare(`
    UPDATE listing_indicators
    SET status = 'stale'
    WHERE listing_id = ?
  `).run(listingId);
}

/**
 * Return the IDs of all listings whose indicators are pending or stale (need derivation).
 */
export function getPendingOrStaleListingIds(db: Database.Database): string[] {
  const rows = db
    .prepare(`SELECT listing_id FROM listing_indicators WHERE status IN ('pending', 'stale')`)
    .all() as { listing_id: string }[];
  return rows.map((r) => r.listing_id);
}

/**
 * Return the parsed StructuredIndicators for a listing, or null if none or not yet derived.
 */
export function getListingIndicators(
  db: Database.Database,
  listingId: string
): StructuredIndicators | null {
  const row = db
    .prepare(`SELECT indicators FROM listing_indicators WHERE listing_id = ?`)
    .get(listingId) as { indicators: string | null } | undefined;
  if (!row || row.indicators === null) return null;
  try {
    return JSON.parse(row.indicators) as StructuredIndicators;
  } catch {
    return null;
  }
}
