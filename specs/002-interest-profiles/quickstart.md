# Quickstart: Profile-Based Interest Scoring (Feature 002)

**Feature**: 002-interest-profiles | **Date**: 2026-04-05

---

## Prerequisites

- Feature 001 complete and passing tests
- Docker + Docker Compose (for all builds and tests)
- `ANTHROPIC_API_KEY` set in `.env`

---

## 1. Download airports.csv

```bash
# From repo root — download the ourairports.com airports CSV and save to data/
curl -L "https://davidmegginson.github.io/ourairports-data/airports.csv" -o data/airports.csv
```

This file (~7 MB) should be committed to git. After downloading, commit it:
```bash
git add data/airports.csv
git commit -m "add bundled ourairports.com airports.csv for ICAO lookup"
```

---

## 2. Create your first profile

Copy the example profile and edit to taste:
```bash
cp profiles/example-ifr-touring.yml profiles/my-profile.yml
# Edit profiles/my-profile.yml with your criteria
```

Or use the interactive setup CLI (requires ANTHROPIC_API_KEY):
```bash
docker compose run --rm app npm run setup-profile
```

The setup CLI will:
1. Ask for a profile name and high-level intent description
2. Call the ProfileResearcher agent to propose concrete criteria
3. Let you accept (y), modify (m), or reject (r) each criterion
4. Write the confirmed profile to `profiles/<slug>.yml`

---

## 3. Configure home location (for proximity scoring)

Add to `config.yml`:
```yaml
home_location:
  lat: 51.8942    # Your home airfield latitude
  lon: -2.16722   # Your home airfield longitude
```

If omitted, proximity criteria contribute 0 for all listings.

---

## 4. Run a scan

```bash
docker compose run --rm scan
```

The Matcher now scores each listing against all active profiles and writes:
- `listings.match_score` — overall weighted average score
- `listing_scores` rows — per-profile scores + evidence

---

## 5. View ranked listings

```bash
docker compose up -d serve
open http://localhost:3000
```

Each listing row now has:
- Overall match score (from all active profiles)
- Thumbs-up / neutral / thumbs-down feedback buttons

---

## 6. Record feedback

Click the thumbs-up or thumbs-down icon on any listing row. Feedback is recorded via `POST /feedback` and stored with the current profile weights snapshot.

---

## 7. View weight suggestions

After recording 5+ non-neutral feedback entries:
```
open http://localhost:3000/suggest-weights
```

The page shows proposed weight changes with plain-language rationale. Click **Accept** to apply a change (atomically rewrites the profile YAML with a timestamped backup) or **Reject** to dismiss.

---

## 8. Run tests

```bash
docker compose run --rm app npm test
docker compose run --rm app npm run lint
```

All existing tests should continue to pass. New tests for feature 002 live in:
- `tests/unit/profile-scorer.test.ts`
- `tests/unit/icao.test.ts`
- `tests/integration/web.test.ts` (extended)

---

## Validation scenarios

| Scenario | Expected result |
|----------|----------------|
| Profile YAML with unknown criterion type | Startup error naming the file |
| `min: 50000, max: 30000` in price_range | Startup error: "price_range min must be <= max" |
| Listing with ICAO code `EGBJ` within `maxDistanceKm` | Proximity criterion contributes positively |
| Listing with ICAO code `EGPD` (Aberdeen) vs home in Gloucestershire | Proximity contributes 0 (beyond maxDistanceKm) or low score |
| Full-ownership listing with proximity criterion in profile | Proximity contributes 0; evidence note explains it only applies to shares |
| All listings score below every profile's `min_score` | Output explicitly states "No listings cleared the minimum threshold" |
| Fewer than 5 non-neutral feedback entries | `/suggest-weights` shows "Need N more entries" |
| Accept a weight suggestion | Profile YAML rewritten; `.bak` file created; next scan uses new weight |

---

## File locations

| Path | Purpose |
|------|---------|
| `profiles/*.yml` | Interest profile definitions (edit to customise) |
| `profiles/*.bak` | Timestamped backups created on weight acceptance |
| `data/airports.csv` | Bundled ICAO coordinate data |
| `data/listings.db` | SQLite database (including new feature 002 tables) |
