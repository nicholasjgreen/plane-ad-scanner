# Contract: Admin HTTP Routes

**Feature**: 003-site-discovery-management
**Date**: 2026-04-04

---

## Overview

All admin routes are mounted under `/admin` on the existing Express server. They use server-rendered HTML forms (GET/POST, full-page reload). No client-side JavaScript. No authentication.

---

## Route Index

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin` | Site list + pending discovery candidates |
| POST | `/admin/sites` | Add a new site |
| POST | `/admin/sites/:id/disable` | Disable a site |
| POST | `/admin/sites/:id/enable` | Re-enable a disabled site |
| POST | `/admin/sites/:id/verify` | Trigger / re-trigger verification |
| POST | `/admin/sites/:id/verify/approve` | Approve latest verification sample |
| POST | `/admin/sites/:id/verify/reject` | Reject latest verification sample |
| POST | `/admin/sites/:id/priority` | Update site priority order |
| POST | `/admin/discovery/run` | Trigger a manual discovery run |
| POST | `/admin/discovery/candidates/:id/approve` | Approve a discovery candidate |
| POST | `/admin/discovery/candidates/:id/dismiss` | Dismiss a discovery candidate |

---

## GET `/admin`

**Response**: HTML page (200)

**Page sections** (in order):

1. **Flash message** (optional, one-time POST result): success or error message passed via query string `?msg=...&type=success|error`
2. **Sites list** — one row per site, grouped by status, showing:
   - Name, URL, status badge, priority, total listings, last scan outcome (date + count or error), last verified date
   - Action buttons appropriate to status (see action matrix below)
3. **Pending discovery candidates** — separate section, only shown when `COUNT > 0`:
   - Name, URL, description; Approve / Dismiss buttons
4. **"Run Discovery"** button — triggers `POST /admin/discovery/run`
5. **"Add site"** form — inline form: Name input, URL input, Submit button

**Status badge colour mapping** (for HTML/CSS classes):

| Status | CSS class |
|--------|-----------|
| `pending` | `badge--pending` (amber) |
| `enabled` | `badge--enabled` (green) |
| `disabled` | `badge--disabled` (grey) |
| `verification_failed` | `badge--failed` (red) |

**Action matrix per site status**:

| Status | Available actions |
|--------|------------------|
| `pending` | Disable |
| `enabled` | Disable, Re-verify, Set priority |
| `disabled` | Enable |
| `verification_failed` | Disable, Re-verify |

---

## POST `/admin/sites`

**Body** (form-encoded):
- `name`: string (required, 1–100 chars)
- `url`: string (required, must be `https?://...`)

**Success** (302 redirect):
- Creates site with `status = 'pending'`
- Triggers verification asynchronously (verification runs in the background; admin refreshes to see result)
- Redirects to `GET /admin?msg=Site+added&type=success`

**Error** (302 redirect):
- Duplicate URL → `GET /admin?msg=URL+already+exists&type=error`
- Invalid URL → `GET /admin?msg=Invalid+URL&type=error`
- Blank name → `GET /admin?msg=Name+required&type=error`

---

## POST `/admin/sites/:id/disable`

**Body**: (empty)

**Success**: Sets `status = 'disabled'`; redirects to `GET /admin?msg=Site+disabled&type=success`

**Error**: Site not found → 302 `GET /admin?msg=Site+not+found&type=error`

---

## POST `/admin/sites/:id/enable`

**Body**: (empty)

**Success**: Sets `status = 'enabled'`; redirects to `GET /admin?msg=Site+enabled&type=success`

**Constraint**: Only valid for `disabled` sites; ignored (redirect with error) for other statuses.

---

## POST `/admin/sites/:id/verify`

**Body**: (empty)

**Success**:
- Sets `status = 'pending'`; inserts new `verification_results` row with `passed = NULL`
- Runs verification asynchronously (does not block the redirect)
- Redirects to `GET /admin?msg=Verification+started&type=success`

**Valid from statuses**: `enabled`, `verification_failed` (also accepted from `pending` for re-trigger)

---

## POST `/admin/sites/:id/verify/approve`

**Body**: (empty)

**Success**:
- Updates latest `verification_results` row: `passed = 1`, `completed_at = now`
- Sets `site.status = 'enabled'`, `site.last_verified = now`
- Redirects to `GET /admin?msg=Site+enabled&type=success`

**Error**: No pending verification result → `GET /admin?msg=No+pending+verification&type=error`

---

## POST `/admin/sites/:id/verify/reject`

**Body**: (empty)

**Success**:
- Updates latest `verification_results` row: `passed = 0`, `completed_at = now`, `failure_reason = 'Rejected by admin'`
- Sets `site.status = 'verification_failed'`
- Redirects to `GET /admin?msg=Site+verification+failed&type=success`

---

## POST `/admin/sites/:id/priority`

**Body** (form-encoded):
- `priority`: integer string (0–999)

**Success**: Updates `site.priority`; redirects to `GET /admin?msg=Priority+updated&type=success`

---

## POST `/admin/discovery/run`

**Body**: (empty)

**Success**:
- Triggers discovery asynchronously; new candidates inserted into `discovery_candidates` with `status = 'pending_review'`
- Skips URLs already in `sites` (any status) or `discovery_candidates` (any status)
- Redirects to `GET /admin?msg=Discovery+running&type=success`
- Admin refreshes the page to see new candidates

---

## POST `/admin/discovery/candidates/:id/approve`

**Body**: (empty)

**Success**:
- Sets `discovery_candidates.status = 'approved'`
- Creates a new `sites` row with `status = 'pending'` and `name`/`url` from the candidate
- Triggers verification asynchronously
- Redirects to `GET /admin?msg=Candidate+approved&type=success`

**Error**: Candidate URL already in `sites` table (race condition) → `GET /admin?msg=Already+exists&type=error`

---

## POST `/admin/discovery/candidates/:id/dismiss`

**Body**: (empty)

**Success**:
- Sets `discovery_candidates.status = 'dismissed'`
- Redirects to `GET /admin?msg=Candidate+dismissed&type=success`

**Permanent suppression**: Dismissed URL is excluded from all future discovery proposals via DB query in Discoverer agent.

---

## Async Pattern for Verification and Discovery

Verification and discovery are triggered asynchronously:
1. Route handler starts the background task (non-blocking Promise)
2. Route handler immediately redirects (302)
3. Admin refreshes `/admin` to see updated state

This avoids HTTP timeouts on long-running LLM calls. Errors from background tasks are logged via pino; if verification fails completely (agent throws), the site status is updated to `verification_failed` with the error as `failure_reason`.

---

## Error Handling

All POST routes use try/catch; unhandled errors redirect to `GET /admin?msg=Internal+error&type=error`. Pino logs the full error stack. No HTML error pages — always redirect to `/admin`.
