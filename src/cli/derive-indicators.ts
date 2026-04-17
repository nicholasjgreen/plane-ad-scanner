/**
 * Re-run the indicator deriver on all pending/stale listings without running a full scan.
 * Useful when debugging indicator derivation or after resetting indicators.
 *
 * Usage:
 *   make derive-indicators
 *   docker compose run --rm scan npm run derive-indicators
 */
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig, logger } from '../config.js';
import { initDb } from '../db/index.js';
import { getPendingOrStaleListingIds, setIndicatorsReady, setIndicatorsFailed } from '../db/listing-indicators.js';
import { runIndicatorDeriver } from '../agents/indicator-deriver.js';
import type { IndicatorDeriverInput } from '../types.js';

const config = loadConfig();
const db = initDb();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const model = config.agent.matcher_model;

const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
const allPendingIds = getPendingOrStaleListingIds(db);
const pendingIds = limitArg && limitArg > 0 ? allPendingIds.slice(0, limitArg) : allPendingIds;
logger.info({ total: allPendingIds.length, running: pendingIds.length, model }, 'Derive indicators: starting');

if (pendingIds.length === 0) {
  logger.info('Nothing pending — run "make reset-indicators" first if you want to re-derive all listings');
  db.close();
  process.exit(0);
}

interface DbRow {
  id: string;
  aircraft_type: string | null;
  make: string | null;
  model: string | null;
  registration: string | null;
  raw_attributes: string | null;
}

const CONCURRENCY = 3;
let succeeded = 0;
let failed = 0;

for (let i = 0; i < pendingIds.length; i += CONCURRENCY) {
  const batch = pendingIds.slice(i, i + CONCURRENCY);
  await Promise.allSettled(
    batch.map(async (listingId) => {
      const row = db
        .prepare(`SELECT id, aircraft_type, make, model, registration, raw_attributes FROM listings WHERE id = ?`)
        .get(listingId) as DbRow | undefined;
      if (!row) return;

      const input: IndicatorDeriverInput = {
        listingId: row.id,
        rawAttributes: JSON.parse(row.raw_attributes ?? '{}') as Record<string, string>,
        aircraftType: row.aircraft_type,
        make: row.make,
        model: row.model,
        registration: row.registration,
      };

      const result = await runIndicatorDeriver(input, anthropic, model);

      if (result.error || !result.indicators) {
        logger.warn({ listingId, error: result.error }, 'Derive indicators: failed for listing');
        setIndicatorsFailed(db, listingId);
        failed++;
      } else {
        setIndicatorsReady(db, listingId, result.indicators);
        logger.debug({ listingId }, 'Derive indicators: done');
        succeeded++;
      }
    })
  );
}

logger.info({ total: pendingIds.length, succeeded, failed }, 'Derive indicators: complete');
db.close();
