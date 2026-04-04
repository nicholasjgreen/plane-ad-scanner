# plane-ad-scanner

Monitors aircraft-for-sale websites and surfaces interesting listings based on your criteria.
Runs on a schedule, deduplicates listings across runs, scores them against your interest
profile, and serves them via a local web UI.

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- An [Anthropic API key](https://console.anthropic.com/) — required for scanning and discovery;
  optional if you use Ollama for verification (see below)

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
       pattern: "cessna 172"
       weight: 2
   ```

3. **Add sites via the admin panel** at **http://localhost:3000/admin** — sites are managed
   through the UI, not `config.yml`. Each new site is verified before scanning begins.

---

## Site management (admin panel)

All site configuration is done through the admin panel at `/admin`. No need to edit `config.yml`
for sites.

### Adding a site

1. Enter the site name and URL in the "Add Site" form and click **Add Site**
2. The site is added with status `pending` and verification starts automatically in the background
3. Refresh the page to see the verification result
4. **Approve** the sample listings if they look correct → site becomes `enabled` and will be
   included in the next scan
5. **Reject** if the site didn't yield useful listings → status becomes `verification_failed`

### Site statuses

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting verification |
| `enabled` | Active — included in every scan |
| `disabled` | Manually paused — excluded from scans |
| `verification_failed` | Could not extract listings; use Re-verify to retry |

### Discovery

Click **Run Discovery** to have the AI search the web for aircraft-for-sale marketplaces you
haven't added yet. New candidates appear in the "Discovery Proposals" section — approve to add
them (verification is triggered automatically) or dismiss to permanently suppress them.

---

## Verification backends

Site verification checks whether a URL yields structured listing data before enabling it for
scanning. Two backends are supported:

### Anthropic (default)

Uses `claude-haiku` via the Anthropic API. Requires `ANTHROPIC_API_KEY`. Subject to your
organisation's rate limits — if many sites are pending at once, verifications are queued and
processed one at a time automatically.

### Ollama (local, no rate limits)

Runs verification against a local model with no API calls or rate limits. Requires
[Ollama](https://ollama.com) running locally with a tool-calling model.

```bash
ollama pull qwen2.5:7b
```

Add to `config.yml`:

```yaml
ollama:
  url: "http://host.docker.internal:11434"   # Mac/Windows (Docker)
  # url: "http://localhost:11434"            # outside Docker
  # url: "http://172.17.0.1:11434"          # Linux (Docker bridge IP)
  verification_model: "qwen2.5:7b"
```

Restart the container after changing this setting. When `ollama:` is set, all verification
uses Ollama; scanning and discovery still use the Anthropic API.

Recommended models for verification (in order of reliability):
- `qwen2.5:14b` — most reliable structured output
- `qwen2.5:7b` — good balance of speed and accuracy
- `llama3.1:8b` — solid alternative

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
| 003 | Site discovery and management (admin UI, verification, Ollama backend) | ✅ Complete |
| 004 | Listing presentation (AI headlines) | Planned |
