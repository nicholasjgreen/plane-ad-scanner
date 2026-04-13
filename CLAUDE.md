# plane-ad-scanner Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-13

## Active Technologies
- SQLite (feature 001's existing store) — two new columns on `listings`, one new `listing_ai` table (004-listing-presentation)
- TypeScript (strict mode) on Node.js LTS (v20+) + `@anthropic-ai/sdk`, `express`, `cheerio`, `better-sqlite3`, `node-cron`, `zod`, `pino` (001-plane-listing-scanner)
- SQLite (`better-sqlite3`); file at `./data/listings.db` (001-plane-listing-scanner)
- TypeScript (strict mode), Node.js LTS v20 + `@anthropic-ai/sdk` v0.39+, `express`, `better-sqlite3`, `zod`, `pino`, `uuid` — all from feature 001; no new production dependencies (003-site-discovery-management)
- SQLite (`./data/listings.db`) — migration 002 extends existing schema (003-site-discovery-management)
- TypeScript (strict mode), Node.js LTS v20+ + `@anthropic-ai/sdk` (existing), `better-sqlite3` (existing), `express` (existing) — no new production dependencies (004-listing-presentation)
- SQLite — migration 004 adds `headline TEXT` + `image_urls TEXT` to `listings`; new `listing_ai` table for explanations (004-listing-presentation)

- TypeScript (strict mode), Node.js LTS + Anthropic Agent SDK (`@anthropic-ai/sdk`); existing web server and DB from feature 001 (004-listing-presentation)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript (strict mode), Node.js LTS: Follow standard conventions

## Recent Changes
- 004-listing-presentation: Added TypeScript (strict mode), Node.js LTS v20+ + `@anthropic-ai/sdk` (existing), `better-sqlite3` (existing), `express` (existing) — no new production dependencies
- 002-interest-profiles: Added [if applicable, e.g., PostgreSQL, CoreData, files or N/A]
- 003-site-discovery-management: Added TypeScript (strict mode), Node.js LTS v20 + `@anthropic-ai/sdk` v0.39+, `express`, `better-sqlite3`, `zod`, `pino`, `uuid` — all from feature 001; no new production dependencies


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
