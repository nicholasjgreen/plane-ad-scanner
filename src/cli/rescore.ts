/**
 * Re-score all existing listings against the current profiles without running a scan.
 * Useful after editing a profile YAML or accepting a weight suggestion.
 *
 * Usage:
 *   npm run rescore
 *   docker compose run --rm rescore
 */
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { loadConfig, logger } from '../config.js';
import { initDb } from '../db/index.js';
import { runMatcher } from '../agents/matcher.js';
import { loadProfiles } from '../services/profile-loader.js';
import type { ListingForScoring } from '../types.js';

const config = loadConfig();
const db = initDb();

const profilesDir = join(process.cwd(), 'profiles');
const profiles = loadProfiles(profilesDir);

if (profiles.length === 0) {
  logger.warn('No profiles found in profiles/ — nothing to score against. Exiting.');
  db.close();
  process.exit(0);
}

logger.info({ profiles: profiles.map((p) => p.name) }, 'Loaded profiles');

// Fetch every listing from the DB, aliasing snake_case columns to camelCase.
const listings = db
  .prepare(
    `SELECT
       id,
       registration,
       aircraft_type  AS aircraftType,
       make,
       model,
       year,
       price,
       price_currency AS priceCurrency,
       location
     FROM listings`
  )
  .all() as ListingForScoring[];

logger.info({ count: listings.length }, 'Re-scoring listings');

// Build scoring client: prefer Ollama if configured, otherwise Anthropic
const scoringClient = config.ollama?.scoring_model
  ? new OpenAI({ baseURL: `${config.ollama.url}/v1`, apiKey: 'ollama' })
  : process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;
const scoringModel = config.ollama?.scoring_model ?? 'claude-haiku-4-5-20251001';

if (scoringClient) {
  const backend = config.ollama?.scoring_model ? `Ollama (${scoringModel})` : `Anthropic (${scoringModel})`;
  logger.info({ backend }, 'AI scoring enabled for mission_type criteria');
} else {
  logger.warn('No scoring client available (set ANTHROPIC_API_KEY or configure ollama.scoring_model) — mission_type criteria will not be evaluated');
}

runMatcher(listings, config.criteria, profiles, db, config.home_location, scoringClient, scoringModel)
  .then((result) => {
    logger.info({ scored: result.scores.length }, 'Rescore complete');
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Rescore failed');
    db.close();
    process.exit(1);
  });
