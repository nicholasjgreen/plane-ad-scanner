# plane-ad-scanner

Monitors aircraft-for-sale websites and surfaces interesting listings based on your criteria.
Runs on a schedule, deduplicates listings across runs, scores them against your interest
profile, and serves them via a local web UI.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- An [Anthropic API key](https://console.anthropic.com/)

---

## Setup

1. **Create your environment file**:

   ```bash
   echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
   ```

2. **Review `config.yml`** — set your search criteria, schedule, and web port:

   ```yaml
   web:
     port: 3000
   schedule: "0 */6 * * *"    # every 6 hours; null to disable
   criteria:
     - type: type_match
       value: "cessna 172"
       weight: 2
   ```

---

## Running

### Start the server + scheduler

```bash
docker compose up -d --build
```

The `--build` flag ensures the image is rebuilt from your latest code before starting.

The web UI is available at **http://localhost:3000**

Admin panel (site management): **http://localhost:3000/admin**

View logs:

```bash
docker compose logs -f app
```

### Run a one-off scan

```bash
docker compose run --rm scan
```

### Start the web server only (no scheduler)

```bash
docker compose up serve --build
```

### Stop everything

```bash
docker compose down
```

---

## Development

### Live reload on code changes (recommended)

```bash
docker compose watch
```

Docker Compose Watch detects changes in `src/` and automatically syncs the files into the
running container and restarts the process — no manual rebuild needed. Only changes to
`package.json` or `package-lock.json` trigger a full image rebuild (new dependencies).

Run this in one terminal and keep coding; the server restarts in a few seconds after each save.

### Run tests

```bash
docker build -t plane-scanner . && docker run --rm plane-scanner npm test
```

### Lint

```bash
docker run --rm plane-scanner npm run lint
```

### Type-check

```bash
docker run --rm plane-scanner npm run build
```

---

## Project structure

```
src/
  agents/       # Scraper, Historian, Matcher, Orchestrator, Verifier, Discoverer
  services/     # Dedup, scoring, site status state machine
  admin/        # Admin UI routes and HTML renderer
  web/          # Public listings page routes and HTML renderer
  db/           # SQLite init, migration runner
  cli/          # One-off scan entry point
tests/
  unit/         # Pure-logic tests (TDD)
  integration/  # HTTP and scraper integration tests
specs/          # Feature specs, plans, and task breakdowns
data/           # SQLite database (gitignored; created on first run)
```

---

## Feature status

| Feature | Description | Status |
|---------|-------------|--------|
| 001 | Plane listing scanner (scrape, deduplicate, score, display) | ✅ Complete |
| 002 | Interest profiles | Planned |
| 003 | Site discovery and management (admin UI) | 🔄 In progress |
| 004 | Listing presentation (AI headlines) | Planned |
