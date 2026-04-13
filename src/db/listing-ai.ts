import Database from 'better-sqlite3';

export interface ListingAiRow {
  listing_id: string;
  headline: string | null;
  explanation: string | null;
  status: 'pending' | 'ready' | 'failed';
  model_ver: string | null;
  generated_at: string | null;
}

export interface ReadyData {
  headline: string;
  explanation: string;
  modelVer: string;
}

/**
 * Insert a listing_ai row with status='pending' if none exists for this listing.
 * No-op if a row already exists (preserves existing state).
 */
export function upsertListingAi(db: Database.Database, listingId: string): void {
  db.prepare(`
    INSERT OR IGNORE INTO listing_ai (listing_id, status)
    VALUES (?, 'pending')
  `).run(listingId);
}

/**
 * Mark a listing's AI content as ready, storing headline, explanation, model version,
 * and the current timestamp.
 */
export function setStatusReady(db: Database.Database, listingId: string, data: ReadyData): void {
  db.prepare(`
    UPDATE listing_ai
    SET status       = 'ready',
        headline     = ?,
        explanation  = ?,
        model_ver    = ?,
        generated_at = ?
    WHERE listing_id = ?
  `).run(data.headline, data.explanation, data.modelVer, new Date().toISOString(), listingId);
}

/**
 * Mark a listing's AI generation as failed.
 * Preserves any existing headline and explanation content (best-effort display).
 */
export function setStatusFailed(db: Database.Database, listingId: string): void {
  db.prepare(`
    UPDATE listing_ai
    SET status = 'failed'
    WHERE listing_id = ?
  `).run(listingId);
}

/**
 * Return the IDs of all listings whose AI content is pending generation.
 */
export function getPendingListingIds(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT listing_id FROM listing_ai WHERE status = 'pending'")
    .all() as { listing_id: string }[];
  return rows.map((r) => r.listing_id);
}

/**
 * Return the listing_ai row for a given listing, or null if none exists.
 */
export function getListingAi(db: Database.Database, listingId: string): ListingAiRow | null {
  const row = db
    .prepare('SELECT * FROM listing_ai WHERE listing_id = ?')
    .get(listingId) as ListingAiRow | undefined;
  return row ?? null;
}

/**
 * Reset all listing_ai rows to 'pending' status.
 * Used by the regenerate-ai CLI and profile staleness detection.
 * Returns the number of rows updated.
 */
export function resetAllToPending(db: Database.Database): number {
  const result = db.prepare("UPDATE listing_ai SET status = 'pending'").run();
  return result.changes;
}

/**
 * Reset a specific listing's AI content to 'pending' (e.g. after the listing data is updated).
 * No-op if no listing_ai row exists for that listing.
 */
export function markListingAiStale(db: Database.Database, listingId: string): void {
  db.prepare("UPDATE listing_ai SET status = 'pending' WHERE listing_id = ?").run(listingId);
}
