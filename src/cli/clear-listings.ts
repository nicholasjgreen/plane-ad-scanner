/**
 * Wipe all listing data from the DB while preserving the sites table.
 * Clears: listings, scan_runs, listing_ai, listing_scores, listing_feedback, weight_suggestions.
 *
 * Usage:
 *   docker compose run --rm scan npm run clear-listings
 *   npm run clear-listings    (local Node.js)
 */
import { initDb } from '../db/index.js';
import { logger } from '../config.js';

const db = initDb();

const before = {
  listings: (db.prepare('SELECT COUNT(*) as n FROM listings').get() as { n: number }).n,
  scan_runs: (db.prepare('SELECT COUNT(*) as n FROM scan_runs').get() as { n: number }).n,
  sites: (db.prepare('SELECT COUNT(*) as n FROM sites').get() as { n: number }).n,
};

logger.info({ before }, 'Clearing listing data (sites preserved)');

db.exec(`
  DELETE FROM listing_ai;
  DELETE FROM listing_scores;
  DELETE FROM listing_feedback;
  DELETE FROM weight_suggestions;
  DELETE FROM scan_runs;
  DELETE FROM listings;
  VACUUM;
`);

const sitesKept = (db.prepare("SELECT name FROM sites ORDER BY priority").all() as { name: string }[])
  .map((r) => r.name);

logger.info(
  {
    cleared: { listings: before.listings, scan_runs: before.scan_runs },
    sites_kept: sitesKept,
  },
  'Done'
);

db.close();
