# Quickstart: Site Discovery and Management

**Feature**: 003-site-discovery-management

This feature adds a site admin page at `/admin` for managing the list of aircraft-for-sale websites the scanner monitors. It supersedes the config.yml `sites` array from feature 001.

---

## Prerequisites

Feature 001 must be installed and working:
- Docker Compose up (`docker compose up -d`) **or** `npm start` running
- `ANTHROPIC_API_KEY` set in `.env`

---

## Accessing the Admin Page

With the server running:

```
http://localhost:3000/admin
```

---

## Workflow: Adding a Site

1. Open `/admin`
2. Enter a display name (e.g. `"Trade-A-Plane"`) and URL (e.g. `"https://www.trade-a-plane.com/search?category=Single+Engine+Piston"`) in the "Add site" form
3. Click **Add Site** — the site appears with status **Pending Verification**
4. Verification runs in the background (allow 10–30 seconds)
5. Refresh `/admin` — the site now shows a verification sample:
   - If the sample looks correct → click **Approve** → site becomes **Enabled**
   - If the sample is wrong or empty → click **Reject** → site becomes **Verification Failed**

---

## Workflow: Disabling a Site

1. Open `/admin`
2. Find the site in the list
3. Click **Disable** → site becomes **Disabled** and is excluded from all future scans

To re-enable: click **Enable** (no re-verification required).

---

## Workflow: Automated Discovery

1. Open `/admin`
2. Click **Run Discovery** — the Discoverer agent searches the web for unknown aircraft-for-sale sites
3. Allow 20–60 seconds; refresh `/admin`
4. Review proposed candidates in the **Discovery Proposals** section:
   - Click **Approve** to add to the site list and trigger verification
   - Click **Dismiss** to permanently suppress the URL from future proposals

---

## Workflow: Re-verifying a Site

1. Open `/admin`
2. Find the site with status **Verification Failed** or **Enabled**
3. Click **Re-verify** → verification runs again; review the sample when complete

---

## Validation Scenarios

| Scenario | Expected Outcome |
|----------|-----------------|
| Add site with valid URL | Site added with status `pending`; verification starts automatically |
| Add duplicate URL | Error flash: "URL already exists" |
| Add URL without `https://` | Error flash: "Invalid URL" |
| Approve valid verification sample | Site status → `enabled`; included in next scan |
| Reject verification sample | Site status → `verification_failed`; excluded from scans |
| Disable enabled site | Site status → `disabled`; scan skips it |
| Enable disabled site | Site status → `enabled`; next scan includes it |
| Run discovery | New candidates appear in proposals section |
| Dismiss discovery candidate | Candidate suppressed; same URL never proposed again |
| Approve discovery candidate | Site added as `pending`; verification starts |
| Run discovery after dismiss | Dismissed URL absent from new proposals |
| Scan runs with a disabled site | No listings fetched or updated from that site |

---

## Migrating from config.yml Site Seeding

After feature 003 is installed, sites are managed via the admin page — not `config.yml`. The `sites` array in `config.yml` is no longer used.

To migrate existing sites from your config:
1. Open `/admin`
2. Use **Add Site** to manually add each site from your config
3. Approve each verification sample
4. Remove the `sites:` block from `config.yml` (the scanner now reads from the DB)

---

## npm Scripts (unchanged from feature 001)

| Script | Purpose |
|--------|---------|
| `npm start` | Web server + cron scheduler |
| `npm run serve` | Web server only (no scheduler) |
| `npm run scan` | One-off scan |
| `npm test` | Run all tests |
| `npm run lint` | Lint check |
