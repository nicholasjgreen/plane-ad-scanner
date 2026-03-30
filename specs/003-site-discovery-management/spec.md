# Feature Specification: Site Discovery and Management

**Feature Branch**: `003-site-discovery-management`
**Created**: 2026-03-29
**Status**: Draft
**Input**: User description: "site list maintenance and discovery. Some of this has been added into feature 001, but can be moved into this feature. There must be a way to add known site as well as being able to discover new ones by automated searching. Admin users must be able to disable sites. When a site is disabled we ignore all listing from it, and do not re-add it when auto scanning. For each site we add we need to verify that we can successfully pull the listings from the site. This could mean navigating through web pages meant for humans."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manually Add a Known Site (Priority: P1)

As an admin, I want to add a known aircraft-for-sale website to the monitored list by providing its URL and a display name, so the scanner begins fetching listings from it.

**Why this priority**: Manual addition is the baseline capability — without it no sites exist to scan, discover, or disable.

**Independent Test**: Can be tested by submitting a URL and name, confirming the site appears in the site list with a "pending verification" status, and then triggering verification to confirm it transitions to enabled or fails with a clear reason.

**Acceptance Scenarios**:

1. **Given** I provide a valid URL and display name, **When** I submit the new site, **Then** the site is added to the list in a "pending verification" state and verification is triggered automatically.
2. **Given** verification succeeds (at least one listing is extracted), **When** the result is returned, **Then** the site status changes to "enabled" and it is included in future scans.
3. **Given** verification fails (no listings can be extracted), **When** the result is returned, **Then** the site is marked "verification failed" and is not scanned until re-verified or confirmed manually.
4. **Given** a URL already exists in the site list, **When** I attempt to add it again, **Then** the system rejects the duplicate and informs me.

---

### User Story 2 - Disable a Site (Priority: P1)

As an admin, I want to disable a site whose listing quality I consider poor, so its listings are excluded from results and it is not re-added by automated discovery.

**Why this priority**: Control over data quality is critical — a bad source pollutes the entire listing view.

**Independent Test**: Can be tested by disabling an enabled site, running a scan, and confirming no new listings are fetched from it; then running auto-discovery and confirming the same URL is not re-proposed or re-enabled.

**Acceptance Scenarios**:

1. **Given** a site is currently enabled, **When** I disable it, **Then** it is marked "disabled" and excluded from all future scans.
2. **Given** a site is disabled, **When** auto-discovery runs and encounters the same URL, **Then** the site is not re-added or re-enabled.
3. **Given** a site is disabled, **When** I view the site list, **Then** the site is clearly shown as disabled (visually distinct from "verification failed" or "error").
4. **Given** I want to re-enable a previously disabled site, **When** I enable it, **Then** it is included in subsequent scans.

---

### User Story 3 - Verify a Site Can Yield Listings (Priority: P2)

As an admin, I want the system to verify that a newly added site can actually return structured listing data before including it in regular scans, so I don't waste scan cycles on sites that cannot be read.

**Why this priority**: Verification prevents silent failures and surfaces integration issues early, before a site enters the regular scan rotation.

**Independent Test**: Can be tested by adding a site that requires interactive browsing and confirming the verification process still extracts at least one representative listing and presents the sample for review.

**Acceptance Scenarios**:

1. **Given** a site has been added, **When** verification runs, **Then** the system attempts to extract a sample of listings from the site.
2. **Given** verification produces at least one listing, **When** the result is available, **Then** the sample is shown to me so I can confirm data quality before the site is fully enabled.
3. **Given** the site requires interactive browsing to display listings, **When** verification runs, **Then** the process still attempts to extract listings and does not immediately fail.
4. **Given** I review a verification sample and reject it, **When** I reject, **Then** the site is set to "verification failed" and not included in scans.
5. **Given** I want to re-verify a previously failed site, **When** I trigger re-verification, **Then** the process runs again from scratch.

---

### User Story 4 - Automatically Discover New Sites (Priority: P3)

As an admin, I want the system to periodically search for aircraft-for-sale websites I may not know about and propose them as candidates, so my site list grows without constant manual research.

**Why this priority**: Automated discovery adds ongoing value but the tool is functional without it; manual addition covers the immediate need.

**Independent Test**: Can be tested by running the discovery process in isolation and confirming it produces candidate URLs not already in the site list, each with a name and brief description for evaluation.

**Acceptance Scenarios**:

1. **Given** auto-discovery runs, **When** it finds candidate sites not already in the list, **Then** those candidates are presented to me as proposals with a name, URL, and brief description.
2. **Given** a candidate is proposed, **When** I approve it, **Then** it is added to the site list and verification is triggered.
3. **Given** a candidate is proposed, **When** I dismiss it, **Then** it is not added and is suppressed from all future discovery proposals.
4. **Given** a URL was previously disabled, **When** auto-discovery encounters it, **Then** it is not proposed again.
5. **Given** a candidate is already pending my review, **When** discovery runs again, **Then** the same candidate is not proposed twice.

---

### User Story 5 - Review the Site List (Priority: P2)

As an admin, I want to see all configured sites in one view with their status, listing count, and last result, so I can make informed decisions about which sites to enable, disable, or re-verify.

**Why this priority**: Without a consolidated overview, site management decisions are made blind.

**Independent Test**: Can be tested by configuring sites in all possible states (pending, enabled, disabled, failed) and confirming each is correctly represented in a single view, along with any pending discovery proposals.

**Acceptance Scenarios**:

1. **Given** sites exist in various states, **When** I view the site list, **Then** each site shows its name, URL, current status, total listings found to date, and the date/outcome of its last scan or verification attempt.
2. **Given** pending discovery proposals exist, **When** I view the site list, **Then** they appear in a distinct section so I can review and act on them separately from confirmed sites.

---

### Edge Cases

- What happens if a site changes its structure after verification and listings can no longer be extracted — is it automatically flagged on the next failed scan?
- What if the same site is reachable under multiple URLs (e.g., `www.` and non-`www.`)? How are URL duplicates detected?
- What if auto-discovery returns a large number of candidates at once? Is there a cap on proposals per run?
- What if verification is triggered but the site is temporarily unavailable — is it retried or immediately marked failed?
- What if a site requires a login to view listings — can it be added but held in a permanent "cannot verify" state?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow an admin to add a site by providing a URL and display name.
- **FR-002**: The system MUST automatically trigger listing verification when a new site is added.
- **FR-003**: Verification MUST attempt to extract a representative sample of listings from the site, including sites that require interactive browsing to display content.
- **FR-004**: The extracted verification sample MUST be presented to the admin for review before the site is marked as enabled.
- **FR-005**: The admin MUST be able to approve or reject a verification sample; approval transitions the site to "enabled", rejection marks it "verification failed".
- **FR-006**: The admin MUST be able to re-trigger verification for any site in "verification failed" or "enabled" state.
- **FR-007**: The admin MUST be able to disable any site regardless of its current status.
- **FR-008**: A disabled site MUST NOT be scanned and MUST NOT have its listing data updated in future runs.
- **FR-009**: A disabled site's URL MUST NOT be re-added or re-enabled by the automated discovery process under any circumstances.
- **FR-010**: The system MUST reject duplicate URLs; adding a URL already present in the site list (in any status) MUST be prevented.
- **FR-011**: The system MUST periodically run an automated discovery process to find candidate aircraft-for-sale websites not already in the site list.
- **FR-012**: Each discovery candidate MUST be presented to the admin with at minimum a URL, a suggested name, and a brief description before any action is taken.
- **FR-013**: The admin MUST be able to approve or dismiss each discovery candidate; dismissed candidates MUST be permanently suppressed from future proposals.
- **FR-014**: The system MUST provide a site list view showing all configured sites with name, URL, status, listing count, and last scan/verification outcome.
- **FR-015**: The site list MUST visually distinguish the following statuses: pending verification, enabled, disabled, verification failed.
- **FR-016**: The admin MUST be able to set a display priority order for enabled sites; the scanner MUST process sites in that order.

### Key Entities

- **Site**: A configured aircraft-for-sale website — display name, URL, status (pending / enabled / disabled / verification failed), priority order, date added, date last scanned, last scan outcome summary, and total listings found to date.
- **VerificationResult**: The outcome of a single verification attempt — site reference, timestamp, sample listings extracted, pass/fail, and failure reason if applicable.
- **DiscoveryCandidate**: A site proposed by automated discovery — URL, suggested name, brief description, discovery date, and admin decision (pending / approved / dismissed).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new site can be added, verified, and included in the next scan without any external assistance or code change.
- **SC-002**: When a site is disabled, no listings from that site appear in any subsequent scan output.
- **SC-003**: A disabled site's URL is never re-proposed or re-enabled by automated discovery under any circumstances.
- **SC-004**: Verification successfully identifies at least one extractable listing for 80% of publicly accessible aircraft-for-sale sites submitted.
- **SC-005**: The automated discovery process surfaces at least one previously unknown candidate site per month of unattended operation.
- **SC-006**: All site management actions (add, disable, re-verify, approve/dismiss candidate) complete and are reflected in the site list within one interaction cycle.

## Assumptions

- This feature supersedes the site management aspects described in feature 001 (Site entity, FR-001, FR-002, FR-013). Feature 001 will defer to this spec for all site lifecycle concerns.
- "Admin" refers to the single personal user of the tool; no separate authentication or role-based access control is introduced.
- Automated discovery uses a web search mechanism to find aircraft-for-sale websites; the search strategy is an implementation detail.
- The minimum sample size for a passing verification is one extractable listing; a larger sample improves confidence but is not required.
- Sites that require authentication to view listings cannot be verified and will remain in "verification failed" indefinitely in v1; this is acceptable.
- Listings already stored from a site that is subsequently disabled are retained and remain visible in the listing view; this feature does not purge historical listing data.
- The automated discovery process runs on a configurable schedule; the default cadence is an implementation choice.
- Priority ordering is a simple integer rank; drag-and-drop reordering UI is out of scope for v1.
- All admin actions (add site, disable, re-verify, approve/dismiss discovery candidates, set priority order) are performed via a dedicated admin/config web page served alongside the main listing page. The main listing page (feature 001) remains read-only; the admin page is a separate route.
