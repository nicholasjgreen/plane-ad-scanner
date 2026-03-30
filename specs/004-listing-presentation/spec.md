# Feature Specification: Listing Presentation

**Feature Branch**: `004-listing-presentation`
**Created**: 2026-03-30
**Status**: Draft
**Input**: User description: "let's make a feature about how to display the listings. I want the system to make its own headline about the listing that makes it clear what is interesting about it e.g. 'Share in IFR Tourer at Sherburn'. I also want a small number of features displayed (make/model/year/price). I also want a set of thumbnail images. There should also be a way to get an expanded explanation of what is good about it. I don't want you to throw the numbers at me, I want it expressed in real terms like 'This model of autopilot greatly lowers the workload of IFR flights in Europe', etc."

## Clarifications

### Session 2026-03-30

- Q: Should the headline be regenerated when interest profiles change, or is it stable? → A: The headline describes the listing's inherent attributes — generated once at scan time, stable thereafter; only the explanation is regenerated on profile changes.
- Q: What should be shown when explanation generation fails and no previous explanation exists? → A: Show a brief neutral placeholder, e.g. "Summary not yet available for this listing".
- Q: When should the plain-English explanation be generated? → A: Eagerly at scan time for every listing — stored and ready before the user views the page.
- Q: How many thumbnail images should appear on the collapsed listing card? → A: One thumbnail per card.
- Q: Which term should be used consistently — "expanded view" or "detail view"? → A: "Expanded view" throughout.
- Q: When a user updates an interest profile, when does explanation regeneration happen? → A: At the next scheduled scan — regeneration happens as part of the normal scan cycle.
- Q: When insufficient data exists to generate a meaningful headline, what should be shown? → A: Construct a minimal headline from whatever is available (e.g. site name and price).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan Listings as Informative Cards (Priority: P1)

As a buyer reviewing the listing page, I want each listing presented as a card with a system-generated headline, key facts, and thumbnail images, so I can quickly judge whether a listing is worth investigating further without reading raw data.

**Why this priority**: This is the primary interface — if the card is not informative at a glance, the entire listing page fails its purpose.

**Independent Test**: Can be tested by seeding the database with a set of listings and confirming each renders a card with a non-generic headline, four key fields (make, model, year, price), and exactly one thumbnail (or placeholder); and that none of these are blank or show raw field names.

**Acceptance Scenarios**:

1. **Given** a listing has been scanned and stored, **When** I view the listing page, **Then** each listing appears as a card showing a generated headline, make, model, year, price, and exactly one thumbnail image (or a placeholder if none are available).
2. **Given** a listing has notable intrinsic attributes, **When** the headline is generated at scan time, **Then** the headline reflects those attributes (e.g. aircraft role, ownership type, location) rather than being a generic title, and does not change when interest profiles are updated.
3. **Given** a listing has no images available, **When** the card renders, **Then** a placeholder is shown rather than a broken image or empty space.
4. **Given** a listing has multiple images, **When** the card renders, **Then** exactly one representative thumbnail is shown on the card and the remaining images are accessible in the expanded view.

---

### User Story 2 - Read a Plain-English Interest Explanation (Priority: P1)

As a buyer who has found an interesting-looking card, I want to expand it and read a plain-English explanation of why this listing matches my interests, so I can understand its appeal in real terms rather than interpreting raw specifications myself.

**Why this priority**: The explanation is what distinguishes this tool from a simple search engine — it translates data into meaning for this specific buyer.

**Independent Test**: Can be tested by expanding a listing for a buyer with defined interest profiles and confirming the explanation mentions the user's stated interests in natural language, with no bare numbers presented without context (e.g. "£45,000" alone is insufficient; "priced well within your stated budget" is acceptable).

**Acceptance Scenarios**:

1. **Given** I expand a listing card, **When** the expanded view opens, **Then** I see a plain-English explanation of what makes this listing relevant to my interests.
2. **Given** the listing has equipment or attributes that match my interest profiles, **When** the explanation is generated, **Then** those attributes are described in terms of their practical benefit (e.g. "greatly reduces IFR workload") rather than as bare specification values.
3. **Given** the listing has attributes that partially match my interests, **When** the explanation is generated, **Then** it honestly describes both the strengths and any notable gaps relative to my interests.
4. **Given** a listing has no interest profiles to evaluate against, **When** the explanation is generated, **Then** a general summary of the listing's notable characteristics is shown instead.

---

### User Story 3 - Browse Images in the Expanded View (Priority: P2)

As a buyer evaluating a listing, I want to browse all available images in the expanded view, so I can visually assess the aircraft's condition without leaving the tool.

**Why this priority**: Images are a key factor in assessing a listing's credibility and the aircraft's condition, but a full gallery is only needed once interest is confirmed.

**Independent Test**: Can be tested by expanding a listing with multiple scraped images and confirming all images are navigable, displayed at a usable size, and link back to the source listing.

**Acceptance Scenarios**:

1. **Given** a listing has multiple images, **When** I expand the card, **Then** all available images are displayed or browsable in a gallery within the expanded view.
2. **Given** I am viewing images, **When** I click an image, **Then** it opens at full size or links to the source listing page.

---

### User Story 4 - Explanation Reflects Current Interest Profiles (Priority: P3)

As a buyer whose interests evolve over time, I want the plain-English explanation to reflect my current interest profiles rather than the ones active at the time the listing was first found, so stale reasoning does not mislead me.

**Why this priority**: Interests change — an explanation generated against old criteria could be actively misleading.

**Independent Test**: Can be tested by updating an interest profile and confirming that the explanation for a previously stored listing changes to reflect the updated profile on the next page load or on demand.

**Acceptance Scenarios**:

1. **Given** I update an interest profile, **When** the next scheduled scan runs, **Then** all stored listing explanations are regenerated against the updated profile.
2. **Given** an interest profile has been updated but the next scan has not yet run, **When** I view the expanded explanation for a stored listing, **Then** the previous explanation is shown with no error or indication that it is stale.

---

### Edge Cases

- When listing data is sparse (e.g. only a price and a URL), the headline is constructed from whatever is available — at minimum the source site name and asking price (e.g. "Aircraft for sale on Trade-A-Plane — £45,000"). A generic placeholder is not acceptable.
- What if the interest profile explanation would be very short because very few criteria match — is a minimal explanation acceptable, or should it always reach a minimum length?
- What if images on the source site are behind authentication or have since been removed — how are broken images handled?
- What if two listings from different sites are for the same aircraft — do they get the same explanation and headline?
- How should the explanation handle attributes that are absent from the listing (e.g. no avionics information scraped) without inventing facts?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For each stored listing, the system MUST generate a concise headline that captures the listing's most notable intrinsic attributes (e.g. aircraft role, ownership type, location). The headline is generated once at scan time and is NOT regenerated when interest profiles change.
- **FR-002**: The headline MUST reflect the listing's notable attributes (aircraft role, ownership type, location, etc.) and MUST NOT be a generic or repeated placeholder. When insufficient data exists to generate a meaningful headline, the system MUST construct a minimal headline from whatever is available (e.g. source site name and asking price) rather than showing a generic fallback.
- **FR-003**: Each listing card MUST display the headline, make, model, year, and asking price.
- **FR-004**: Each listing card MUST display exactly one thumbnail image sourced from the listing; a placeholder MUST be shown if no images are available. Additional images are accessible in the expanded view only.
- **FR-005**: For each stored listing, the system MUST generate a plain-English explanation at scan time and persist it, so it is ready before the user views the page. On-demand generation is not required.
- **FR-006**: The explanation MUST describe the practical significance of relevant attributes in natural language; raw numbers or specification values MUST NOT appear without contextual interpretation.
- **FR-007**: The explanation MUST be available in the expanded view of a listing card and MUST NOT require navigation away from the tool.
- **FR-008**: The expanded view MUST display all available images from the listing in a browsable format.
- **FR-009**: The expanded view MUST include a direct link to the original listing on the source site.
- **FR-010**: Explanations MUST be regenerated at the next scheduled scan after the user's active interest profiles change. No immediate background regeneration is required; the previous explanation remains visible in the interim.
- **FR-011**: While explanation regeneration is in progress, the previous explanation MUST remain visible. If no previous explanation exists and generation fails, a neutral placeholder MUST be shown (e.g. "Summary not yet available for this listing") rather than a blank or error state.
- **FR-012**: The explanation MUST honestly represent partial matches, noting both strengths and gaps relative to the user's stated interests.

### Key Entities

- **ListingCard**: The summary presentation of a listing — generated headline, make, model, year, asking price, one thumbnail image URL (or placeholder indicator), and link to expanded view.
- **ListingExplanation**: The plain-English narrative for a listing — generated text describing the listing's relevance to the user's current interest profiles, generation timestamp, and the profile version it was generated against.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every listing card displays a unique, non-generic headline — no two cards for different listings show identical headlines.
- **SC-002**: A buyer can assess whether a listing warrants further investigation from the card alone, without opening the expanded view, for at least 80% of listings.
- **SC-003**: The expanded explanation for any listing contains no bare specification values without contextual interpretation.
- **SC-004**: After an interest profile update, all listing explanations reflect the updated profile within one scan cycle.
- **SC-005**: The expanded view loads and displays the explanation within 3 seconds for any stored listing.

## Assumptions

- This feature depends on feature 002 (interest profiles) for the interest context used to generate headlines and explanations; if no profiles are defined, a general summary is generated instead.
- Image thumbnails are sourced from the listing page at scan time and stored by the system; they are not fetched live on page load.
- If images are no longer accessible at their original URLs, a placeholder is shown; the system does not re-fetch them on demand in v1.
- The explanation is generated eagerly at scan time for every listing and stored; it is regenerated when interest profiles change but not on every page view. There is no on-demand generation path.
- The headline is generated once at scan time from the listing's intrinsic data and is stable thereafter; it is not affected by interest profile updates.
- Headline and explanation generation is performed by the system's AI matching agent (per the project constitution); prompt engineering and model choice are implementation concerns.
- The expanded view replaces or overlays the card in the existing web page from feature 001; a separate page per listing is not required in v1.
- The explanation may be a few sentences to a few paragraphs; no minimum or maximum length is enforced, but brevity is preferred.
