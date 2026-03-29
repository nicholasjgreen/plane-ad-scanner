# Feature Specification: Plane Listing Scanner

**Feature Branch**: `001-plane-listing-scanner`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "A personal tool that periodically scans aircraft-for-sale websites, identifies new or interesting plane listings based on my criteria, and notifies me so I can stay aware of the market without manually checking sites every day."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive Alerts for New Matching Listings (Priority: P1)

As a prospective aircraft buyer, I want to be notified when new plane listings matching my criteria appear on monitored sites, so I can act quickly without manually checking daily.

**Why this priority**: This is the core value of the tool — passive awareness of the market.

**Independent Test**: Can be tested by adding a known new listing to a site (or mocking one) and confirming a notification is received with the listing's key details.

**Acceptance Scenarios**:

1. **Given** the scanner has not seen a listing before, **When** it runs and finds a listing matching my criteria, **Then** I receive a notification containing the aircraft type, price, location, and link.
2. **Given** a listing was already seen and notified, **When** the scanner runs again, **Then** no duplicate notification is sent for that listing.
3. **Given** no new matching listings exist, **When** the scanner runs, **Then** no notification is sent.

---

### User Story 2 - Define Search Criteria (Priority: P2)

As a user, I want to configure what makes a listing "interesting" (aircraft type, price range, location, year, etc.) so the scanner filters out irrelevant listings.

**Why this priority**: Without filtering, every listing would be noise; criteria make notifications actionable.

**Independent Test**: Can be tested by configuring specific criteria and verifying that only matching listings trigger notifications while non-matching ones are silently skipped.

**Acceptance Scenarios**:

1. **Given** I have defined a max price in my criteria, **When** the scanner finds a listing above that price, **Then** that listing is excluded from notifications.
2. **Given** I have defined criteria for a specific aircraft type, **When** a listing matches that type, **Then** it is included in notifications.
3. **Given** I update my criteria, **When** the scanner next runs, **Then** it applies the updated criteria.

---

### User Story 3 - Scheduled Automatic Scanning (Priority: P3)

As a user, I want the scanner to run automatically on a schedule without me manually triggering it, so I stay informed passively.

**Why this priority**: Automation is what makes this "passive awareness" rather than just a search helper.

**Independent Test**: Can be tested by configuring a schedule and confirming the scanner runs and produces output at the expected intervals without manual invocation.

**Acceptance Scenarios**:

1. **Given** a schedule is configured, **When** the scheduled time arrives, **Then** the scanner runs automatically.
2. **Given** the scanner encounters an error fetching a site, **When** it continues, **Then** it still processes remaining sites and surfaces the error.

---

### User Story 4 - Review History of Matched Listings (Priority: P4)

As a user, I want to see a history of listings that have been found and notified, so I can revisit interesting aircraft I may have missed or forgotten.

**Why this priority**: Useful but not essential for the core scanning loop.

**Independent Test**: Can be tested by running the scanner multiple times and confirming all previously matched listings are accessible in a history query.

**Acceptance Scenarios**:

1. **Given** listings have been notified in the past, **When** I query the history, **Then** I can see all previously matched listings with their original details and timestamps.

---

### Edge Cases

- What happens when a monitored website is unavailable or returns an error?
- What if a listing's price changes after first being seen — should it be re-notified?
- How does the scanner handle structurally identical listings posted across multiple sites?
- What if configuration criteria are invalid or missing?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST periodically scan one or more configured aircraft-for-sale websites for listings.
- **FR-002**: The system MUST allow the user to configure matching criteria including aircraft type/model, price range, location, and year range.
- **FR-003**: The system MUST track which listings have already been seen to prevent duplicate notifications.
- **FR-004**: The system MUST send a notification when a new listing matching configured criteria is found.
- **FR-005**: Each notification MUST include: aircraft type, asking price, location, listing date, and a direct link to the listing.
- **FR-006**: The system MUST continue scanning remaining sites if one site fails, and report the failure.
- **FR-007**: The system MUST persist seen-listing state across runs so deduplication survives restarts.
- **FR-008**: The system MUST support running on a configurable schedule.
- **FR-009**: The system SHOULD provide a way to view the history of previously notified listings.

### Key Entities

- **Listing**: A single aircraft-for-sale ad — aircraft type, asking price, location, year, listing URL, source site, and date found.
- **Criteria**: User-defined filter rules that determine whether a listing is "interesting" (type pattern, price bounds, year range, location).
- **Seen Listing**: A record of a listing that has been processed and notified, used to prevent duplicate alerts.
- **Notification**: An outbound alert sent to the user summarising one or more new matching listings.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New matching listings are detected and notified within one scan cycle of appearing on a monitored site.
- **SC-002**: No listing is notified more than once under normal operating conditions.
- **SC-003**: When a monitored site is temporarily unavailable, the tool continues scanning other sites and reports the error without crashing.
- **SC-004**: Each notification contains enough information to judge whether a listing is worth clicking through, without visiting the site first.
- **SC-005**: The tool runs unattended for at least 30 days without requiring manual intervention.

## Assumptions

- The initial target sites are publicly accessible without authentication (no login required to browse listings).
- Notifications are delivered to a single personal channel (e.g., email or webhook); multi-user support is out of scope.
- The tool runs on a single personal machine or server (not distributed).
- Price changes to already-seen listings will not trigger re-notification in v1.
- Removed listings will not trigger a "removed" notification in v1 — only new listings generate alerts.
- The user is comfortable editing a configuration file to set criteria; a GUI is out of scope for v1.
