# Feature Specification: Plane Listing Scanner

**Feature Branch**: `001-plane-listing-scanner`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "A personal tool that periodically scans aircraft-for-sale websites, identifies new or interesting plane listings based on my criteria, and presents them on a web page so I can review the market without manually checking sites every day."

## Clarifications

### Session 2026-03-30

- Q: What fields identify a listing as a duplicate? → A: Aircraft registration number (e.g. G-ABCD). If registrations match, treat as the same aircraft and update the existing record. If no registration can be extracted, treat as a unique listing.
- Q: Does feature 001 need its own scoring engine, or does it depend on feature 002? → A: Feature 001 includes a simple built-in scoring engine (type/price/year from a config file); feature 002 supersedes it later when integrated.
- Q: What does the "new" badge on FR-011 mean? → A: A listing is "new" if it was found in the most recent scan run; the badge clears automatically when the next scan runs.
- Q: What does the web page show before any scan has run? → A: A plain message: "No listings yet — run the scanner to populate the page."
- Q: How are site scan failures surfaced on the web page? → A: A banner/alert section at the top of the page listing each failed site and its error.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Prioritised Listings on a Web Page (Priority: P1)

As a prospective aircraft buyer, I want to open a web page and see all discovered listings ranked by how well they match my criteria, so I can quickly identify the most interesting aircraft without manually checking each site.

**Why this priority**: This is the core value of the tool — a single place to see what's on the market, ordered by relevance.

**Independent Test**: Can be tested by seeding the database with a set of listings at varying match scores and confirming the web page renders them in descending priority order with the correct details.

**Acceptance Scenarios**:

1. **Given** the scanner has run and found listings, **When** I open the web page, **Then** I see a ranked list of listings showing aircraft type, price, location, year, source site, and a direct link.
2. **Given** listings have different match scores, **When** the page loads, **Then** listings are ordered highest-to-lowest match score.
3. **Given** a listing was found in a previous scan, **When** I view the page, **Then** it remains visible in the list (not hidden after first view).

---

### User Story 2 - Define Search Criteria (Priority: P2)

As a user, I want to configure what makes a listing "interesting" (aircraft type, price range, location, year, etc.) so the scanner filters and ranks listings accordingly.

**Why this priority**: Without criteria, every listing has equal weight; criteria drive the prioritisation that makes the page useful.

**Independent Test**: Can be tested by configuring specific criteria and verifying that listings meeting more criteria appear higher on the page than listings meeting fewer.

**Acceptance Scenarios**:

1. **Given** I have defined a max price, **When** the scanner finds a listing above that price, **Then** that listing appears lower in the ranking or is excluded.
2. **Given** I have defined criteria for a specific aircraft type, **When** a matching listing is found, **Then** it scores higher than a non-matching listing.
3. **Given** I update my criteria, **When** the scanner next runs, **Then** the page reflects the re-ranked results.

---

### User Story 3 - Scheduled Automatic Scanning (Priority: P3)

As a user, I want the scanner to run automatically on a schedule without me manually triggering it, so the web page always reflects the current market.

**Why this priority**: Automation keeps the page fresh without manual effort.

**Independent Test**: Can be tested by configuring a schedule and confirming the scanner runs and the page reflects new listings at the expected intervals without manual invocation.

**Acceptance Scenarios**:

1. **Given** a schedule is configured, **When** the scheduled time arrives, **Then** the scanner runs automatically and the page is updated.
2. **Given** the scanner encounters an error fetching a site, **When** it continues, **Then** it still processes remaining sites and surfaces the error visibly on the page.

---

### User Story 4 - Filter and Browse the Listing Page (Priority: P4)

As a user, I want to filter the listing page by criteria such as aircraft type, price band, or "new since last visit", so I can focus on specific subsets of the market.

**Why this priority**: Useful once the listing volume grows; not required for initial usefulness.

**Independent Test**: Can be tested by applying a price filter on a seeded dataset and confirming only listings within the specified range are shown.

**Acceptance Scenarios**:

1. **Given** I apply a type filter on the page, **When** the filter is active, **Then** only listings matching that type are shown.
2. **Given** I apply a "new since last visit" filter, **When** the filter is active, **Then** only listings added since I last loaded the page are highlighted or isolated.

---

### Edge Cases

- What happens when a monitored website is unavailable or returns an error?
- What if a listing's price changes after first being seen — should it be updated and re-ranked?
- How does the scanner handle structurally identical listings posted across multiple sites?
- What if configuration criteria are invalid or missing?
- What does the page show when no listings have been found yet? → Displays the message "No listings yet — run the scanner to populate the page."
- What happens to previously fetched listings from a site that is subsequently disabled — are they hidden or retained?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST periodically scan all enabled sites (as managed by feature 003) for listings on a configurable schedule.
- **FR-002**: The system MUST allow the user to configure matching criteria including aircraft type/model, price range, location, and year range.
- **FR-003**: The system MUST deduplicate listings by aircraft registration number (e.g. G-ABCD). If two scraped listings share the same registration, they are treated as the same aircraft; the existing record is updated rather than a new one created. If no registration can be extracted from a listing, it is treated as a unique listing regardless of other fields.
- **FR-004**: The system MUST persist all discovered listings so the web page always has a full picture of the market.
- **FR-005**: Each listing record MUST include: aircraft type, asking price, location, listing year, source site, date first found, date last seen, and a direct URL to the listing.
- **FR-006**: The system MUST assign each listing a match score based on the configured criteria and persist that score. In feature 001, scoring is performed by a simple built-in engine reading criteria from a config file (type/price/year rules). This engine is superseded by feature 002's Matcher agent when feature 002 is integrated.
- **FR-007**: The system MUST serve a web page that displays all listings ordered by match score (highest first).
- **FR-008**: The web page MUST be accessible on localhost without authentication.
- **FR-009**: The system MUST continue scanning remaining enabled sites if one site fails, and surface the failure on the web page as a banner/alert at the top of the page listing each failed site and its error message.
- **FR-010**: The system MUST persist listing state across runs so history survives restarts.
- **FR-011**: The web page SHOULD indicate which listings were found in the most recent scan run with a "new" badge. The badge is shown for all listings whose `date_last_seen` matches the most recent `ScanRun` timestamp, and clears automatically when the next scan runs.
- **FR-012**: The web page SHOULD display the timestamp of the last successful scan.

### Key Entities

- **Listing**: A single aircraft-for-sale ad — aircraft registration (nullable), aircraft type, asking price, location, year, listing URL, source site, date first found, date last seen, and current match score. Registration is the deduplication key when present.
- **Criteria**: User-defined filter and ranking rules that determine how interesting a listing is (type pattern, price bounds, year range, location).
- **ScanRun**: A record of a single scanner execution — timestamp, sites attempted, sites succeeded, sites failed, and listings found.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New listings are discoverable on the web page within one scan cycle of appearing on a monitored site.
- **SC-002**: No listing appears more than once in the list under normal operating conditions.
- **SC-003**: When a monitored site is temporarily unavailable, the tool continues scanning other sites, reports the error on the page, and does not crash.
- **SC-004**: The web page contains enough information per listing to judge whether it is worth clicking through, without visiting the source site first.
- **SC-005**: The tool runs unattended for at least 30 days without requiring manual intervention.
- **SC-006**: The web page loads within 2 seconds for up to 500 stored listings.

## Assumptions

- The initial target sites are publicly accessible without authentication (no login required to browse listings).
- The tool runs on a single personal machine or server (not distributed); the web page is local-only.
- Site lifecycle management (adding, enabling, disabling, verifying sites) is handled by feature 003; this feature consumes the enabled site list it produces.
- Feature 001 includes a simple built-in scoring engine (type/price/year criteria from a config file) so it is functional in isolation. When feature 002 is integrated, its Matcher agent supersedes this engine and the `Criteria` entity in this spec is replaced by feature 002's `InterestProfile` and `ProfileCriterion` entities.
- Listings from a disabled site are retained in the database and remain visible on the page; they are not purged when a site is disabled.
- Price changes to already-seen listings will not trigger re-ranking in v1; the original match score is retained.
- Removed listings will not be hidden automatically in v1 — they remain in the list.
- The user is comfortable editing a configuration file to set criteria; a criteria-editing UI is out of scope for v1.
- The web page is read-only in v1; no in-page actions (save, dismiss, mark as viewed) are required.
