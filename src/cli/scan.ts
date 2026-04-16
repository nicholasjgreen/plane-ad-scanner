// One-off scan entry point: npm run scan
import OpenAI from 'openai';
import { join } from 'node:path';
import { loadConfig, logger } from '../config.js';
import { initDb } from '../db/index.js';
import { runScan } from '../agents/orchestrator.js';
import { loadProfiles } from '../services/profile-loader.js';

const config = loadConfig();
const db = initDb();

const profilesDir = join(process.cwd(), 'profiles');
const profiles = loadProfiles(profilesDir);
if (profiles.length > 0) {
  logger.info({ count: profiles.length }, 'Loaded interest profiles');
}

const ollamaScraperModel = config.ollama?.scraper_model ?? null;
const ollamaClient =
  config.ollama && ollamaScraperModel
    ? new OpenAI({ baseURL: `${config.ollama.url}/v1`, apiKey: 'ollama' })
    : undefined;
const scanDeps = {
  ...(ollamaClient && ollamaScraperModel ? { ollamaClient, ollamaScraperModel } : {}),
  profiles,
};

logger.info('Starting one-off scan...');
runScan(db, config, scanDeps)
  .then((result) => {
    logger.info(result, 'Scan complete');
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Scan failed');
    db.close();
    process.exit(1);
  });
