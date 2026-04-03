import Database from 'better-sqlite3';
import { upsertListing } from '../services/dedup.js';
import type { RawListing, HistorianResult } from '../types.js';
import { logger } from '../config.js';

export function resetIsNew(db: Database.Database): void {
  db.prepare('UPDATE listings SET is_new = 0').run();
}

export async function runHistorian(
  db: Database.Database,
  listings: RawListing[],
  siteName: string,
  scanStartedAt: string
): Promise<HistorianResult> {
  let newCount = 0;
  let updatedCount = 0;
  const listingIds: string[] = [];

  for (const listing of listings) {
    try {
      const result = upsertListing(db, listing, siteName, scanStartedAt);
      listingIds.push(result.id);
      if (result.isNew) newCount++;
      else updatedCount++;
    } catch (err) {
      logger.error({ url: listing.listingUrl, err }, 'Historian: failed to upsert listing');
    }
  }

  logger.debug({ site: siteName, new: newCount, updated: updatedCount }, 'Historian done');
  return { newCount, updatedCount, listingIds };
}
