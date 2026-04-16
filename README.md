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

## Interest profiles

Profiles live in the `profiles/` directory. Each profile is a YAML file describing what you are
looking for and how much weight to give each criterion. Listings are scored against every active
profile; the overall score is a weighted average across profiles.

### Creating a profile

Copy the example and edit it:

```bash
cp profiles/example-ifr-touring.yml profiles/my-search.yml
```

```yaml
name: "VFR Tourer"
weight: 1.0
description: "Affordable VFR touring aircraft in the UK"
min_score: 10          # hide listings that score below this threshold
criteria:
  - type: make_model
    make: "Cessna"
    model: "*"         # wildcard — any Cessna
    weight: 2.0
  - type: price_range
    min: 20000
    max: 60000
    weight: 2.0
  - type: year_range
    yearMin: 1980
    weight: 0.5
  - type: proximity
    maxDistanceKm: 150
    weight: 1.0        # requires home_location in config.yml
```

### Profile criterion types

| Type | What it matches |
|------|----------------|
| `make_model` | Manufacturer and/or model; `*` as wildcard |
| `price_range` | Asking price within `min`/`max` |
| `year_range` | Year of manufacture within `yearMin`/`yearMax` |
| `listing_type` | `full_ownership`, `share`, or `any` |
| `proximity` | Distance from `home_location` to the aircraft's airfield |
| `mission_type` | AI-assessed suitability for a described capability (e.g. "IFR avionics") |

Set `weight: 0` to disable a profile without deleting it.

### Proximity criterion

To use `proximity`, set your home location in `config.yml`:

```yaml
home_location:
  lat: 53.97   # Doncaster
  lon: -1.11
```

Aircraft airfields are resolved from their ICAO code (e.g. `EGCC`) using a bundled airport
database. Distance is calculated as the crow flies.

### Re-scoring without a full scan

After editing a profile you can update scores immediately without re-scraping:

```bash
make rescore
```

This reads every listing from the database, runs the scorer against the current profiles, and writes updated `match_score` values. The web page reflects the new order on the next reload.

### Evidence and scoring

Each listing card shows which criteria matched and which didn't, and how much each contributed
to the score. Use the **👍 / 👌 / 👎** buttons to rate listings — after a few ratings the
**Suggest weights** page (`/suggest-weights`) proposes weight adjustments based on your feedback.
Accept or reject suggestions individually; accepted changes are written back to the profile YAML.

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

| Command | What it does |
|---------|-------------|
| `make start` | Build image (if needed) and start the server + scheduler in the background |
| `make stop` | Stop everything |
| `make logs` | Tail live logs from the running container |
| `make scan` | Run a one-off scan and exit |
| `make rescore` | Re-score all listings against current profiles without re-scraping |
| `make dev` | Start with live reload — syncs `src/` into the container on every save |
| `make test` | Build image and run the test suite |
| `make build` | Build image and type-check (`tsc --noEmit`) |
| `make lint` | Build image and lint all sources |

The web UI is available at **http://localhost:3000**

Admin panel (site management): **http://localhost:3000/admin**

---

## Development

### Live reload on code changes

```bash
make dev
```

Syncs `src/` into the running container and restarts on every save. Only `package.json` /
`package-lock.json` changes trigger a full image rebuild.

### Run tests

```bash
make test
```

### Lint / type-check

```bash
make lint
make build
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
| 002 | Interest profiles (YAML-based scoring, proximity, evidence, feedback, weight suggestions) | ✅ Complete |
| 003 | Site discovery and management (admin UI, verification, Ollama backend) | ✅ Complete |
| 004 | Listing presentation (AI headlines) | Planned |
