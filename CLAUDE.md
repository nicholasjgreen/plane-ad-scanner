# plane-ad-scanner Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-30

## Active Technologies
- SQLite (feature 001's existing store) — two new columns on `listings`, one new `listing_ai` table (004-listing-presentation)
- TypeScript (strict mode) on Node.js LTS (v20+) + `@anthropic-ai/sdk`, `express`, `cheerio`, `better-sqlite3`, `node-cron`, `zod`, `pino` (001-plane-listing-scanner)
- SQLite (`better-sqlite3`); file at `./data/listings.db` (001-plane-listing-scanner)

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
- 001-plane-listing-scanner: Added TypeScript (strict mode) on Node.js LTS (v20+) + `@anthropic-ai/sdk`, `express`, `cheerio`, `better-sqlite3`, `node-cron`, `zod`, `pino`
- 004-listing-presentation: Added TypeScript (strict mode), Node.js LTS + Anthropic Agent SDK (`@anthropic-ai/sdk`); existing web server and DB from feature 001

- 004-listing-presentation: Added TypeScript (strict mode), Node.js LTS + Anthropic Agent SDK (`@anthropic-ai/sdk`); existing web server and DB from feature 001

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
