// One-off scan entry point: npm run scan
import OpenAI from 'openai';
import { loadConfig, logger } from '../config.js';
import { initDb } from '../db/index.js';
import { runScan } from '../agents/orchestrator.js';

const config = loadConfig();
const db = initDb();

const ollamaScraperModel = config.ollama?.scraper_model ?? config.ollama?.verification_model;
const ollamaClient = config.ollama && ollamaScraperModel
  ? new OpenAI({ baseURL: `${config.ollama.url}/v1`, apiKey: 'ollama' })
  : undefined;
const scanDeps = ollamaClient && ollamaScraperModel ? { ollamaClient, ollamaScraperModel } : {};

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
