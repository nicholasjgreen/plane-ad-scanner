import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

const DEFAULT_DB_PATH = './data/listings.db';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function initDb(config?: Config, dbPath?: string): Database.Database {
  _db = new Database(dbPath ?? DEFAULT_DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  runMigrations(_db);
  if (config) {
    seedSitesFromConfig(_db, config);
  }
  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT filename FROM _migrations').all() as { filename: string }[]).map(
      (r) => r.filename
    )
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)').run(
      file,
      new Date().toISOString()
    );
  }
}

function seedSitesFromConfig(db: Database.Database, config: Config): void {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM sites').get() as { n: number };
  if (n > 0) return;

  const insert = db.prepare(
    'INSERT INTO sites (id, name, url, enabled, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertAll = db.transaction((sites: Config['sites']) => {
    sites.forEach((site, i) => {
      insert.run(randomUUID(), site.name, site.url, site.enabled ? 1 : 0, i, new Date().toISOString());
    });
  });
  insertAll(config.sites);
}
