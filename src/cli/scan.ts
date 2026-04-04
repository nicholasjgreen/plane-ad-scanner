// One-off scan entry point: npm run scan
import { loadConfig, logger } from '../config.js';
import { initDb } from '../db/index.js';
import { runScan } from '../agents/orchestrator.js';

const config = loadConfig();
const db = initDb();

logger.info('Starting one-off scan...');
runScan(db, config)
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
