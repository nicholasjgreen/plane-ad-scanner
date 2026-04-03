# Research: Plane Listing Scanner

**Feature**: 001-plane-listing-scanner
**Date**: 2026-03-30

---

## Decision 1: HTML Scraping Library

**Decision**: `node-fetch` (built-in `fetch` in Node 18 LTS) for HTTP GET + `cheerio` for HTML parsing.

**Rationale**: Aircraft listing sites are predominantly server-rendered HTML — `cheerio` gives a jQuery-like API for extracting structured data without spinning up a browser. No headless browser overhead, aligns with the constitution's Haiku-model extraction approach (Scraper agent uses HTTP GET only). If a site requires JS execution in future, Playwright can be added per-site without redesigning the scraper interface.

**Alternatives considered**:
- `playwright` / `puppeteer` — full browser automation; appropriate for JS-heavy SPAs but over-engineered for sites that serve HTML directly; significant startup cost per invocation; violates Simplicity First for v1
- Native `fetch` alone — can retrieve HTML but provides no DOM querying; requires manual regex/string parsing, fragile and hard to test

---

## Decision 2: SQLite Client

**Decision**: `better-sqlite3`

**Rationale**: Synchronous API eliminates async/await complexity in DB calls, ideal for a single-user personal tool with no concurrent writers. Excellent TypeScript typings. Battle-tested, actively maintained. Raw SQL migrations (no ORM) keep the schema legible and auditable.

**Alternatives considered**:
- `@databases/sqlite` — async wrapper; extra complexity for no benefit in single-user context
- `Prisma` — ORM; heavy, schema-migration tooling adds friction; constitution Simplicity First principle rules this out

---

## Decision 3: Scheduled Scanning

**Decision**: `node-cron` for in-process scheduling; web server and scanner share the same Node.js process.

**Rationale**: Single process keeps deployment simple (one `npm start` command starts everything). `node-cron` uses standard cron expressions, so the schedule field in config.yml is immediately understood by anyone familiar with cron. No external scheduler dependency.

**Alternatives considered**:
- OS-level cron (`crontab`) — decouples scanner from web server; requires the user to configure their OS cron separately; `npm run scan` is documented as an alternative for one-off runs
- `Bull`/`BullMQ` — Redis-backed job queue; massively over-engineered for a personal single-machine tool

---

## Decision 4: Web Server

**Decision**: `Express.js` (minimal, no middleware beyond `compression` and `express.static` if needed); server-rendered HTML using template literals or `eta` for templating.

**Rationale**: Express is the most widely understood Node.js web framework; tiny footprint; no build step; server-rendered HTML with zero client-side JavaScript meets the spec's read-only page requirement and keeps the stack minimal. No React/Vue/Angular needed.

**Alternatives considered**:
- `Fastify` — marginally faster but offers no practical benefit at personal-tool scale
- `Hono` — newer, good TypeScript support, but less familiar and no advantage here
- Native `http` module — workable but requires manual routing and response serialisation; more boilerplate than Express buys simplicity

---

## Decision 5: Built-in Scoring Engine

**Decision**: Rule-based weighted scoring from `config.yml`. Score = (sum of matched rule weights / sum of all rule weights) × 100, rounded to one decimal.

**Rule types**:
- `type_match`: case-insensitive substring match against `make`/`model`/`aircraft_type`
- `price_max`: listing price ≤ configured maximum
- `price_range`: listing price within min–max bounds
- `year_min` / `year_range`: listing year ≥ min (and ≤ max if both given)
- `location_contains`: case-insensitive substring match against location field

**Rationale**: Deterministic, fully testable without any AI calls. Can be TDD'd cleanly. Feature 002's Matcher agent supersedes this engine; the `match_score` column and its semantics are unchanged — only the thing writing it changes.

**Alternatives considered**:
- Boolean filter (pass/fail) — loses ranking signal; all matching listings would be equally ranked
- AI-based scoring in 001 — premature; that's explicitly feature 002's job

---

## Decision 6: Registration Extraction

**Decision**: Extract aircraft registration via a prioritised strategy:
1. Explicit "Registration" / "Reg" field if present in the listing's structured data
2. Regex scan of the listing title and description: UK pattern `[A-Z]-[A-Z]{4}`, US pattern `N[0-9]{1,5}[A-Z]{0,2}`, common EU patterns
3. If no match found, `registration = null` (listing treated as unique)

**Rationale**: Registration is the deduplication key (per clarifications). Many UK/EU listing sites include the registration prominently. A regex-first approach avoids an LLM call for extraction, keeping cost zero for most listings. Edge cases (registration not mentioned) gracefully fall back to treating the listing as unique.

**Alternatives considered**:
- Always use Haiku to extract registration — adds latency and token cost for every listing; over-engineered given most sites surface it as a structured field
- Use ICAO database lookup to verify registrations — adds external dependency; unnecessary for deduplication purposes

---

## Decision 7: Logging

**Decision**: `pino` for structured JSON logging to stdout. Log level configurable via `LOG_LEVEL` env var (default: `info`).

**Rationale**: Constitution Principle III requires structured log entries for all run events and agent token usage. `pino` is fast, produces structured JSON by default, and has excellent TypeScript support. `pino-pretty` can be added as a dev dependency for human-readable output during development.

**Alternatives considered**:
- `winston` — heavier, more config boilerplate; no advantage here
- `console.log` — no structure, no levels, no timestamps; violates Principle III

---

## Decision 8: Config Validation

**Decision**: `zod` for config.yml schema validation at startup.

**Rationale**: Constitution Principle IV requires config validation with clear error messages. `zod` provides TypeScript-native schema definitions, precise error messages identifying which field failed and why, and zero-cost type inference (the validated config object is fully typed). Already implicitly justified by the `@anthropic-ai/sdk` integration (the SDK's TypeScript types benefit from the same strict typing philosophy).

**Alternatives considered**:
- `joi` — JavaScript-first, less ergonomic with TypeScript
- Manual validation — verbose, error-prone, harder to maintain as config schema grows
