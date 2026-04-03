# Quickstart: Listing Presentation

**Feature**: 004-listing-presentation

This feature extends the base scanner (feature 001) — the scanner must already be running and have produced listings before presentation content appears.

---

## Prerequisites

- Feature 001 (plane listing scanner) installed and configured
- At least one scan run completed (listings exist in the database)
- `ANTHROPIC_API_KEY` set in the environment (required for Presenter agent)

---

## What This Feature Adds

1. **Listing cards**: each listing on the web page now shows a generated headline, key facts, and one thumbnail image.
2. **Expanded view**: click any listing to expand it and see the AI-generated plain-English explanation of why it matches your interests, plus the full image gallery.
3. **Presenter agent**: runs automatically as part of each scan. No separate invocation needed.

---

## Database Migration

On first run after installing this feature, the database is automatically migrated:

```
# Applied automatically at startup — no manual action needed
ALTER TABLE listings ADD COLUMN thumbnail_url TEXT;
ALTER TABLE listings ADD COLUMN all_image_urls TEXT;
CREATE TABLE listing_ai (...);
```

Existing listings will have `listing_ai.status = 'pending'` until the next scan run generates their headlines and explanations.

---

## Running a Scan (generates headlines and explanations)

```bash
npm run scan
# or: npx tsx src/cli/scan.ts
```

The Orchestrator now invokes the Presenter agent for each listing after the Matcher runs. Token usage from the Presenter agent is logged per run.

---

## Viewing the Web Page

```bash
npm run serve
# or: npx tsx src/web/server.ts
```

Open [http://localhost:3000](http://localhost:3000). Each listing appears as a card showing:
- AI-generated headline
- Make · Model · Year · Price
- Thumbnail image (or placeholder)

Click any card to expand it and see the full explanation and image gallery.

---

## Configuration

No new configuration keys are required. The Presenter agent draws from the existing per-run token budget configured in your `config.yml`:

```yaml
# Existing key — covers all agents including the new Presenter
agent:
  token_budget_per_run: 100000
  max_turns_per_agent: 10
```

To change the Presenter agent's model (default: `claude-sonnet-4-6`):

```yaml
agent:
  presenter_model: claude-sonnet-4-6   # override if needed
```

---

## Regenerating Explanations

Explanations are automatically regenerated at the next scan when your interest profiles change. To force regeneration of all explanations immediately (e.g. after a prompt template change):

```bash
npm run regenerate-ai
# or: npx tsx src/cli/regenerate-ai.ts
```

This sets all `listing_ai.status` rows to `pending` and triggers a Presenter-only scan pass.

---

## Troubleshooting

**Cards show "Summary not yet available"**: A scan has not yet run since this feature was installed, or the Presenter agent failed. Run `npm run scan` and check logs for errors.

**Thumbnails not showing**: The source listing may have no images, or the URL has expired. The placeholder is shown automatically. Thumbnails refresh on the next scan.

**Headline is generic (e.g. "Listing on Trade-A-Plane")**: The listing had very little data when scraped. The minimal fallback headline is correct behaviour — the next scan may pick up more data if the listing is updated on the source site.
