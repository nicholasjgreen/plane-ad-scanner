# Quickstart: Plane Listing Scanner

**Feature**: 001-plane-listing-scanner

This is the foundation feature. It provides the scanner, the database, the built-in scoring engine, and the web page. All other features (002, 003, 004) extend this base.

---

## Prerequisites

**Option A — Docker (recommended, avoids Node.js installation issues)**:
- Docker + Docker Compose

**Option B — local Node.js**:
- Node.js LTS (v20+) running on Linux/macOS
- `ANTHROPIC_API_KEY` set in your environment

---

## Installation

### Docker (recommended)

```bash
cp config.yml.example config.yml
# Edit config.yml
cp .env.example .env
# Add ANTHROPIC_API_KEY to .env

docker compose build
```

### Local Node.js

```bash
npm install
```

---

## Configuration

```bash
cp config.yml.example config.yml
```

Edit `config.yml` to set:
- `sites` — list of aircraft listing sites to scan
- `criteria` — scoring rules (type, price range, year, location)
- `schedule` — cron expression for automatic scanning (or `null` to disable)
- `web.port` — port for the web server (default: 3000)

```bash
cp .env.example .env
# Edit .env and add:
# ANTHROPIC_API_KEY=sk-ant-...
```

Config is validated at startup. If anything is missing or invalid, you'll see a clear error message.

---

## Run a Scan (one-off)

```bash
npm run scan
# or: npx tsx src/cli/scan.ts
```

The scanner will:
1. Load all enabled sites from the database (seeded from `config.yml` on first run)
2. Run a Scraper agent per site in parallel
3. Deduplicate results via the Historian agent (registration-based)
4. Score listings via the Matcher agent (built-in criteria engine)
5. Persist results to SQLite
6. Log token usage and any errors

---

## Start the Web Server

```bash
npm run serve
# or: npx tsx src/web/server.ts
```

Open [http://localhost:3000](http://localhost:3000).

The web page shows:
- All listings ordered by match score (highest first)
- A "New" badge on listings found in the most recent scan
- The timestamp of the last scan
- A banner if any sites failed during the last scan

---

## Start Everything (scan + serve together)

```bash
npm start
```

This starts the web server and enables the in-process scheduler. Scans run automatically on the configured cron schedule.

---

## Database

SQLite database at `./data/listings.db` (created automatically on first run). Migrations are applied at startup.

To inspect the database directly:

```bash
npx tsx src/cli/db-shell.ts
# or: sqlite3 data/listings.db
```

---

## Validation Scenarios (from spec)

| Scenario | How to test |
|----------|-------------|
| Listings ranked by match score | Seed DB with listings at different scores; open page; verify order |
| "New" badge on most-recent scan | Run scan; check badge appears; run again; check badge refreshes |
| Site failure surfaced on page | Set a site URL to something unreachable; run scan; check banner |
| Empty state before first scan | Delete `data/listings.db`; start server; check message |
| Deduplication by registration | Scrape a listing with registration G-ABCD twice; confirm only one row in DB |

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start web server + scheduler (production mode) |
| `npm run scan` | Run a one-off scan |
| `npm run serve` | Start web server only (no scanner) |
| `npm test` | Run all tests (Vitest) |
| `npm run lint` | ESLint + Prettier check |
| `npm run lint:fix` | Auto-fix lint issues |

---

## Troubleshooting

**"Config validation failed"**: Check `config.yml` for missing or invalid fields. The error message will name the field.

**"ANTHROPIC_API_KEY not set"**: Add the key to your `.env` file or export it in your shell.

**Page shows "No listings yet"**: Run `npm run scan` first.

**Listings have score 0**: No `criteria` are configured in `config.yml`, or no criteria matched any listing. Add rules and re-run the scan.
