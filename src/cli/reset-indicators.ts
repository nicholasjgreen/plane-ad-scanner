/**
 * Reset all listing_indicators rows back to 'pending' so the next scan
 * re-derives structured features for every listing.
 *
 * Usage:
 *   make reset-indicators
 *   docker compose run --rm scan npm run reset-indicators
 */
import { initDb } from '../db/index.js';
import { logger } from '../config.js';

const db = initDb();

const result = db.prepare(`
  UPDATE listing_indicators
  SET status = 'pending',
      indicators = NULL,
      derived_at = NULL
`).run();

logger.info({ reset: result.changes }, 'All listing_indicators reset to pending — re-run make scan to re-derive');

db.close();
