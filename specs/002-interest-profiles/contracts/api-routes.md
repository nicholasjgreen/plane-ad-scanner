# Contract: New Web API Routes (Feature 002)

**Feature**: 002-interest-profiles | **Date**: 2026-04-05

---

## Existing routes (unchanged interface, updated data)

### `GET /`

Unchanged route. Now renders with:
- **Inline feedback form** on each listing row: thumbs-up (more_interesting), neutral (as_expected), thumbs-down (less_interesting)
- Scores continue to come from `listings.match_score` (now written by profile-aware Matcher)
- A per-listing "Show evidence" toggle links to listing_scores data when available

---

## New routes

### `POST /feedback`

Record user feedback on a listing.

**Request body** (JSON or form-encoded):
```
listing_id  : string (UUID)  — required
rating      : string         — required; one of: 'more_interesting' | 'as_expected' | 'less_interesting'
```

**Success response**: `302 Found` redirect to `GET /` (or `200 OK` with JSON `{ ok: true }` if `Accept: application/json`)

**Error responses**:
- `400 Bad Request` — missing or invalid `listing_id` or `rating`
- `404 Not Found` — `listing_id` does not exist

**Storage**: Inserts a row in `listing_feedback` with the listing_id, rating, current profile weights snapshot, and timestamp.

**Weights snapshot**: captured at request time by reading all active profile YAMLs.

---

### `GET /suggest-weights`

Generate (or retrieve cached) weight suggestion report.

**Query parameters**: none

**Success response**: HTML page with:
- If fewer than `feedback_min_count` non-neutral feedback records exist:
  - Message: "Need N more feedback entries before suggestions can be generated."
  - Count of current non-neutral feedback entries
- If all suggestions are rejected and no new feedback: "No new suggestions — add more feedback to get revised proposals."
- Otherwise: table of `WeightSuggestion` rows with:
  - Profile name | Current weight | Proposed weight | Rationale | Feedback count | Accept/Reject buttons

**Suggestion generation**: If no `pending` suggestions exist, invokes the WeightSuggester agent to generate a fresh set. Results are stored in `weight_suggestions`. Subsequent requests within the same session return the stored pending suggestions (no re-generation unless all are resolved).

**Idempotency**: Hitting `GET /suggest-weights` twice without submitting feedback does not re-run the agent on the second call.

---

### `POST /suggest-weights/:action`

Accept or reject a weight suggestion.

**URL parameters**:
- `action`: `accept` or `reject`

**Request body** (form-encoded):
```
suggestion_id : string (UUID) — required
```

**Accept behaviour** (FR-022):
1. Load the suggestion from `weight_suggestions`
2. Locate the profile YAML file by `profile_name`
3. Write new YAML with updated weight (atomic: tmp → bak → rename)
4. Update `weight_suggestions.status = 'accepted'`, set `resolved_at`

**Reject behaviour** (FR-023):
1. Update `weight_suggestions.status = 'rejected'`, set `resolved_at`

**Success response**: `302 Found` redirect to `GET /suggest-weights`

**Error responses**:
- `400 Bad Request` — missing or invalid `suggestion_id`
- `404 Not Found` — suggestion does not exist
- `409 Conflict` — suggestion is already accepted/rejected

---

## Updated server dependencies

The Express app receives two new deps in addition to existing ones:

```typescript
interface ServerDeps {
  // existing:
  db: Database.Database;
  config: Config;
  anthropic: Anthropic;
  // new:
  profiles: InterestProfile[];          // loaded at startup
  profilesDir: string;                  // absolute path to profiles/ directory
}
```
