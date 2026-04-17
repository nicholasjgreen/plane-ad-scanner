/**
 * Reset site scan metadata without removing sites or listings.
 * Clears: last_scan_outcome, last_verified, total_listings on all sites.
 *
 * Usage:
 *   make reset-sites
 *   docker compose run --rm scan npm run reset-sites
 */
import { initDb } from '../db/index.js';
import { logger } from '../config.js';

const db = initDb();

const sites = db
  .prepare('SELECT name, status, last_scan_outcome, last_verified FROM sites ORDER BY priority')
  .all() as { name: string; status: string; last_scan_outcome: string | null; last_verified: string | null }[];

logger.info({ count: sites.length }, 'Resetting site scan metadata');

const result = db.prepare(`
  UPDATE sites SET
    last_scan_outcome = NULL,
    last_verified     = NULL,
    total_listings    = 0
`).run();

for (const s of sites) {
  logger.info({ site: s.name, status: s.status }, 'Reset');
}

logger.info({ updated: result.changes }, 'Done — sites reset');

db.close();
