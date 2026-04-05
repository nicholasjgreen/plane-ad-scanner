# Feature Specification: Profile-Based Interest Scoring

**Feature Branch**: `002-interest-profiles`
**Created**: 2026-03-29
**Status**: Draft — all clarifications resolved
**Input**: User description: "Help me find airplane listings that are interesting to me. Support
multiple named interest profiles with criteria and weights; listings scored against each profile;
overall interest is a weighted average with a feedback loop to refine weights over time. Criteria
are defined by stating high-level intent (e.g., 'IFR touring') and the system researches and agrees
what that means concretely. Output is a ranked list of listings by interest level — no push alerts."

## Clarifications

### Session 2026-04-05

- Q: How should ICAO airfield coordinates be resolved for the proximity criterion? → A: Bundled static `airports.csv` from ourairports.com; loaded into an in-memory index at startup; resolved entries cached in the `airfield_locations` SQLite table.
- Q: How should users record feedback against a listing? → A: HTTP `POST /feedback` endpoint on the existing web server, with an inline thumbs-up/thumbs-down/neutral form on each listing row on the web page.
- Q: Where does the minimum interest threshold (FR-016) live — global or per-profile? → A: Per-profile; each profile has its own `min_score` floor (0–100, default 0); a listing is excluded only if it falls below every active profile's floor (i.e., it is shown if it clears at least one profile's minimum).
- Q: Where are profiles stored and how does the tool write back to them? → A: Each profile is its own YAML file in a `profiles/` directory (e.g. `profiles/ifr-touring.yml`); the tool reads all `*.yml` files in that directory at startup; accepting a weight suggestion atomically rewrites only the relevant profile file (with a timestamped backup).
- Q: Does feature 002 add new web routes, or only change scoring data? → A: Two new routes: `POST /feedback` and `GET /suggest-weights`; `GET /` gains inline feedback forms on each listing row but no new route; `listings.match_score` continues to drive ordering (now written by the 002 Matcher rather than 001's built-in engine).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse a Ranked List of Interesting Listings (Priority: P1)

As a prospective aircraft buyer, I want to run the scanner and get back a ranked list of current
listings sorted by how interesting they are to me — most interesting first — so I can work through
them in priority order without manual triage.

**Why this priority**: This is the primary output of the entire system. Everything else supports
producing this list.

**Independent Test**: Run the scanner with two active profiles. Confirm the output is a list of
listings sorted descending by overall interest level, each with its per-profile scores and evidence,
and that a listing scoring below the configured minimum is absent from the list.

**Acceptance Scenarios**:

1. **Given** the scanner runs and finds five listings, **When** the ranked list is produced, **Then**
   listings appear in descending order of overall interest level, with the highest-scoring listing first.
2. **Given** a listing's overall interest level is below the configured minimum, **When** the ranked
   list is produced, **Then** that listing is excluded entirely.
3. **Given** two listings have identical overall interest levels, **When** the ranked list is produced,
   **Then** they are both included, with a secondary sort by most recently listed.
4. **Given** no listings clear the minimum threshold, **When** the ranked list is produced, **Then**
   the output clearly states that no interesting listings were found this run (not a silent empty result).

---

### User Story 2 - Set Up a Profile by Stating High-Level Intent (Priority: P2)

As a user, I want to define a profile by describing what I mean in plain language (e.g., "IFR
touring capability in the UK and Europe"), and have the system research what that actually requires
in terms of equipment, certification, and capability — presenting concrete proposed criteria for me
to confirm or refine — so I don't have to know the technical details upfront.

**Why this priority**: The profile setup quality determines the quality of everything downstream.
Getting criteria right through a research-and-confirm loop is better than the user guessing at
avionics codes.

**Independent Test**: Provide the intent "IFR touring in UK/Europe" to the profile setup flow.
Confirm the system presents a researched list of concrete criteria (e.g., IFR-certified avionics,
valid instrument rating currency equipment, UK/EU airspace capability) and that the user can
accept, modify, or reject individual criteria before the profile is saved.

**Acceptance Scenarios**:

1. **Given** I describe a profile intent as "IFR touring in the UK and Europe", **When** I run
   profile setup, **Then** the system presents researched concrete criteria (e.g., "GPS navigator
   capable of IFR approaches", "Mode S transponder", "Current IFR avionics suite") with a brief
   explanation of why each criterion matters for that mission type.
2. **Given** the system presents proposed criteria, **When** I reject one criterion and modify
   another, **Then** the profile is saved with only my confirmed criteria.
3. **Given** a profile has been set up and confirmed, **When** I view it in config, **Then** the
   confirmed concrete criteria are stored alongside the original high-level intent description.
4. **Given** I later update the high-level intent description, **When** I re-run profile setup for
   that profile, **Then** the system proposes a revised criterion set, showing what would change,
   and asks me to confirm before overwriting.

---

### User Story 3 - Understand Why a Listing Scored as It Did (Priority: P3)

As a user, I want each entry in the ranked list to show why it received its scores — which criteria
matched, which didn't, and any inferences made — so I can trust the scores and iteratively tune
my profiles.

**Why this priority**: A score alone is not actionable. Evidence is also the input the feedback
loop needs to be meaningful.

**Independent Test**: Given a listing with known attributes and a profile with confirmed criteria,
verify the ranked list entry shows all criteria, marks each matched/unmatched, shows point
contribution, and notes any inferences with confidence level.

**Acceptance Scenarios**:

1. **Given** a listing matches 3 out of 5 criteria in a profile, **When** the score is shown,
   **Then** all 5 criteria are listed: 3 as matched with their contribution, 2 as unmatched with
   what they would have added.
2. **Given** the matcher inferred a capability rather than reading it explicitly, **When** the
   evidence is shown, **Then** the entry notes the inference and its confidence (e.g., "IFR
   capability inferred from avionics list — medium confidence").

---

### User Story 4 - Match Share Listings by Proximity to Home Airfield (Priority: P4)

As a user considering aircraft shares, I want share listings scored by how close the aircraft's
home airfield is to me — because a share at the other end of the country has little practical
value — with the system able to resolve 4-letter ICAO airfield codes (e.g., `EGBJ`) to a real
location automatically.

**Why this priority**: Proximity is only meaningful for shares; it is largely irrelevant for full
aircraft purchases. ICAO codes are the standard way airfields are listed in ads.

**Independent Test**: Configure a home location. Provide two share listings: one at `EGBJ`
(Gloucestershire, ~5 miles from a test home) and one at `EGPD` (Aberdeen, ~450 miles). Confirm
`EGBJ` scores substantially higher on a proximity criterion, and that the system resolved both
codes to coordinates without manual input.

**Acceptance Scenarios**:

1. **Given** a share listing includes a 4-letter ICAO airfield code as its location, **When** the
   proximity criterion is evaluated, **Then** the system resolves the code to geographic coordinates
   and computes the distance to home.
2. **Given** a proximity criterion with a maximum distance, **When** a share listing's airfield is
   within that distance of home, **Then** the criterion scores positively, with score decreasing
   as distance increases toward the maximum.
3. **Given** a full-ownership (non-share) listing, **When** a profile contains a proximity criterion,
   **Then** the proximity criterion does not apply to that listing and contributes 0, with a note
   in evidence explaining it only applies to shares.
4. **Given** a share listing's location is unrecognised or missing, **When** the proximity criterion
   is evaluated, **Then** it contributes 0 (not penalised) and this is noted in evidence.

---

### User Story 5 - Refine Profile Weights Through Feedback (Priority: P5)

As a user, I want to mark listings in the ranked output as "more interesting" or "less interesting"
than their score suggested, so the system can propose profile weight adjustments I can review and
accept — making the ranking more accurate over time.

**Why this priority**: Initial weights are guesses. The feedback loop is how the system improves
without requiring the user to understand the maths.

**Independent Test**: Submit 5+ "more interesting than scored" entries tied to listings that scored
highly on "IFR touring" but lowly on "Hour building". Request a weight suggestion report. Confirm
the suggestion increases the weight of "IFR touring" relative to "Hour building", with reasoning
referencing those specific feedback entries.

**Acceptance Scenarios**:

1. **Given** a listing appears in the ranked output, **When** I record feedback ("more interesting",
   "as expected", or "less interesting"), **Then** the feedback is stored with the listing reference,
   rating, timestamp, and the profile weights active at the time.
2. **Given** sufficient feedback has accumulated (configurable minimum, default 5), **When** I
   request a weight suggestion report, **Then** the system analyses the feedback and proposes
   adjusted weights with a plain-language explanation and a count of supporting feedback entries.
3. **Given** a suggestion is presented, **When** I accept it, **Then** the config is updated, a
   timestamped backup of the previous config is retained, and the next scan uses the new weights.
4. **Given** a suggestion is presented, **When** I reject it, **Then** the config is unchanged and
   the rejection is noted so the same suggestion is not re-proposed unless contradicting feedback
   accumulates.
5. **Given** fewer than the minimum feedback records exist, **When** I request suggestions, **Then**
   the system states how many more entries are needed before it can make reliable proposals.

---

### Edge Cases

- What if all configured profiles have weight 0 — is that a config error or a valid "paused" state?
- What if a listing's location is expressed as free text (e.g., "near London") rather than an ICAO code or postcode — can distance still be estimated?
- What if an ICAO code in a listing is valid but the airfield has no publicly available coordinates?
- What if the AI matcher's inferred capability contradicts information explicitly stated in the listing?
- What if feedback signals are contradictory (same profile marked "more" and "less interesting"
  for similar listings)?
- What if the research step for a criterion produces no meaningful concrete criteria?
- What if a listing contains only free text with no structured fields?

## Requirements *(mandatory)*

### Functional Requirements

**Profiles & criteria:**

- **FR-001**: The system MUST support multiple named interest profiles, each stored as a separate
  YAML file in a `profiles/` directory (e.g. `profiles/ifr-touring.yml`). Each profile file
  contains: display name, relative weight (positive number), optional description, `min_score`
  floor (0–100, default 0), and a list of confirmed criteria.
- **FR-002**: The system MUST score each listing against each active (weight > 0) profile on a
  0–100 scale.
- **FR-003**: The system MUST compute an overall interest level as a weighted average of per-profile
  scores: `overall = Σ(score × weight) / Σ(weights)` across active profiles only.
- **FR-004**: Each profile MUST support per-criterion weights so some criteria contribute more to
  the profile score than others.
- **FR-004a**: Each profile MUST have a configurable `min_score` floor (0–100, default 0). A
  listing is excluded from the ranked list only if its per-profile score falls below every active
  profile's `min_score` (i.e., it is included if it clears at least one profile's floor).
- **FR-005**: A single home location MUST be configured globally for all proximity criteria.
- **FR-006**: Any profile with weight 0 MUST be treated as inactive and excluded from all scoring.
- **FR-007**: All `*.yml` files in the `profiles/` directory MUST be loaded and validated at
  startup. Any invalid profile file MUST prevent the system from starting, with a descriptive
  error identifying the offending file.

**Criterion types:**

- **FR-008**: The system MUST support the following criterion types:
  - **Mission type** — high-level intent (e.g., "IFR touring") translated into concrete sub-criteria
    via a research-and-confirm setup step; matched by inference from listing text and aircraft knowledge,
    confidence-weighted (high confidence for explicit statement, lower for inferred).
  - **Make/model** — aircraft manufacturer and/or type, supporting wildcards.
  - **Price range** — asking price (min, max, or both).
  - **Year range** — manufacture year.
  - **Listing type** — full-ownership, share/syndicate, or both.
  - **Proximity to home** — applies to share/syndicate listings only; scored by distance from the
    globally configured home location. Listing locations expressed as 4-letter ICAO airfield codes
    MUST be resolved to geographic coordinates using a bundled static `airports.csv` dataset
    (ourairports.com); the dataset is loaded into an in-memory index at startup and resolved entries
    are cached in the `airfield_locations` SQLite table. Proximity criterion MUST contribute 0 for
    full-ownership listings, with a note in evidence.
- **FR-009**: The system MUST report inference confidence in evidence when capability is inferred
  rather than explicitly stated.

**Profile setup flow:**

- **FR-010**: The system MUST provide a profile setup flow in which the user provides a high-level
  intent description for a criterion, and a research step proposes concrete matching sub-criteria
  with explanations.
- **FR-011**: The user MUST be able to accept, modify, or reject each proposed sub-criterion
  individually before the profile is saved.
- **FR-012**: The original high-level intent description MUST be stored alongside the confirmed
  concrete criteria in the profile config.
- **FR-013**: Re-running profile setup for an existing profile MUST show a diff of what would
  change and require explicit confirmation before overwriting.

**Ranked output:**

- **FR-014**: The primary output of each scan run MUST be a ranked list of listings sorted
  descending by overall interest level. The Matcher agent writes the computed overall interest
  level to `listings.match_score`, replacing feature 001's built-in scorer; `GET /` displays
  the ranked list using this column as before.
- **FR-015**: The system MUST persist for each listing: overall interest level, per-profile scores,
  and structured evidence (matched/unmatched criteria with contributions and any inference notes).
  This data is displayed in the expanded view of the web page (feature 004) after the plain-English
  explanation — not as a standalone CLI output.
- **FR-016**: A listing MUST be excluded from the ranked list if its per-profile score falls below
  every active profile's `min_score` floor. A listing is included if it clears at least one active
  profile's floor. The `min_score` is a per-profile value (0–100, default 0) stored in profile
  config alongside its criteria.
- **FR-017**: When no listings clear the threshold, the output MUST explicitly state this rather
  than producing silent empty output.

**Feedback & weight refinement:**

- **FR-018**: The system MUST allow feedback to be recorded against any listing in the ranked
  output: "more interesting than scored", "as expected", or "less interesting than scored".
  Feedback is submitted via `POST /feedback` on the web server; the listings page MUST include
  an inline thumbs-up / neutral / thumbs-down form on each listing row.
- **FR-019**: Feedback MUST be stored persistently with the listing reference, rating, timestamp,
  and the profile weights active at the time.
- **FR-020**: On demand, the system MUST generate a weight suggestion report via `GET /suggest-weights`,
  analysing accumulated feedback and proposing per-profile weight changes with plain-language
  rationale and supporting feedback counts. The page includes accept/reject controls that POST
  back to trigger FR-022/FR-023.
- **FR-021**: The system MUST require a configurable minimum feedback count (default: 5) before
  generating suggestions.
- **FR-022**: Accepting a suggestion MUST atomically rewrite only the relevant profile's YAML file
  (e.g. `profiles/ifr-touring.yml`) with updated weights, retaining a timestamped backup of the
  prior file (e.g. `profiles/ifr-touring.yml.2026-04-05T120000Z.bak`) before overwriting.
- **FR-023**: Rejecting a suggestion MUST record the rejection so it is not re-proposed unless new
  contradicting feedback accumulates.

### Key Entities

- **InterestProfile**: Named, weighted set of confirmed criteria. Stores display name, relative
  weight, optional description, high-level intent, and one or more ProfileCriteria.
- **ProfileCriterion**: One matching rule — type, confirmed target values, per-criterion weight,
  and the original high-level intent if set up via the research flow.
- **CriterionResearchSession**: The record of a profile setup session — original intent input,
  proposed sub-criteria with explanations, user's accept/modify/reject decisions, and outcome.
- **ListingScore**: Result of one listing against one profile — 0–100 score and evidence list.
- **EvidenceItem**: One criterion's result — name, matched/unmatched, contribution, human-readable
  note, confidence level if inferred.
- **InterestResult**: Aggregated result for one listing — all ListingScores, overall interest level,
  listing reference, timestamp.
- **RankedListingReport**: The output of a scan run — ordered list of InterestResults that cleared
  the threshold, run timestamp, and a summary (how many listings found, how many cleared threshold).
- **HomeLocation**: Single global geographic reference point (address or coordinates) configured
  by the user; used as the origin for all proximity distance calculations.
- **AirfieldLocation**: A resolved airfield record — ICAO code, airfield name, and geographic
  coordinates. Looked up on demand and cached to avoid repeated external lookups.
- **FeedbackRecord**: User rating of a ranked listing — listing reference, rating, timestamp,
  weights active at the time.
- **WeightSuggestion**: Proposed profile weight change — profile name, current weight, proposed
  weight, explanation, supporting feedback count, accept/reject status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The ranked list output includes per-profile scores and full evidence for every listed
  entry — zero entries without explanation.
- **SC-002**: A listing that meets no criterion on any active profile does not appear in the ranked list.
- **SC-003**: The profile setup flow produces concrete, named criteria that a non-aviation-expert
  user can understand and confirm, for any plain-language mission intent supplied.
- **SC-004**: After accepting a weight suggestion, the very next scan uses the updated weights and
  produces a visibly different ranking for listings that are strongly differentiated by those profiles.
- **SC-005**: After 5 or more feedback entries, a weight suggestion report is available and
  references specific feedback records in its reasoning.
- **SC-006**: When listing location data is unavailable, proximity criteria degrade to 0 contribution
  without error or exclusion of the listing.
- **SC-007**: The output explicitly states when no listings cleared the threshold, rather than
  producing a silent empty result.

## Assumptions

- Aircraft capability for mission-type criteria must often be inferred from listing text and
  aircraft type knowledge; the AI Matcher agent handles this inference.
- The profile setup research step uses an AI agent to look up what a mission type requires; the
  output is proposed criteria, not automatically applied criteria.
- Feedback is submitted via `POST /feedback` on the web server (inline form on the listings page); no automatic click-tracking or read receipts.
- Weight suggestions are generated on demand, not automatically triggered.
- A single home location is sufficient for v1; multiple locations (e.g., home and work) are out of scope.
- Listing locations for share listings are commonly expressed as 4-letter ICAO airfield codes
  (e.g., `EGBJ`, `EGLL`); the system will resolve these to coordinates using a publicly available
  airfield database or lookup service.
- Proximity scoring applies only to share/syndicate listings; for full-ownership listings the
  buyer can relocate the aircraft, making the airfield largely irrelevant.
- Where a listing location cannot be resolved to coordinates (unrecognised code, free-text only),
  the proximity criterion degrades to 0 contribution rather than failing.
- Each profile is its own YAML file in a `profiles/` directory; all `*.yml` files in that directory are loaded at startup. Adding a new profile means dropping a new file in the directory; removing one means deleting it. There is no GUI for profile management.
- The system is personal and single-user.
- Listing type (share vs. full ownership) may need to be inferred from listing text when not
  explicitly stated (e.g., "1/4 share", "syndicate").
- Initial profile weights will be imprecise; the feedback loop is how they become accurate.
