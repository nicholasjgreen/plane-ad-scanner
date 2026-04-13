# Feature Specification: Full Page Listing Details

**Feature Branch**: `006-full-page-listings`  
**Created**: 2026-04-13  
**Status**: Draft  
**Input**: User description: "005 full page listings. In this feature we can support fetching details of a listing by following the link. It will return a full page of information, which should give us much better scoring details than the small details we got on the search results page. It should also give us one or more images for the listing"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Richer Listing Data After Scan (Priority: P1)

When the scanner runs, it follows each new or updated listing's detail page URL after discovering it on the search results page. The full detail page is parsed to extract the complete aircraft specification — engine type, total airframe time, avionics fit, damage history, seller notes — along with all images. This enriched data is stored and fed into the Matcher scoring pass within the same scan run, producing more accurate match scores than the minimal data from search results.

**Why this priority**: The core value of this feature. Without richer data, scoring is shallow and images are missing. Everything else depends on this.

**Independent Test**: Run a scan against a site with listings. After the scan, inspect stored listings — they should have attributes beyond what appears in search results (e.g. total time, engine details, damage history if present). Confirm `match_score` reflects criteria that previously could not be evaluated. Confirm at least one image URL is stored per listing that has photos on its detail page.

**Acceptance Scenarios**:

1. **Given** a new listing is discovered on a search results page, **When** the scanner processes it, **Then** the scanner fetches the listing's detail page and extracts the full attribute set (make, model, year, price, registration, total time, engine time, avionics, damage history, seller notes, and any other labelled fields present).
2. **Given** a listing detail page contains one or more photos, **When** the scanner processes it, **Then** `thumbnail_url` is set to the first/primary photo and `all_image_urls` contains all photo URLs found on that page.
3. **Given** a listing was already in the database from a previous scan, **When** the same listing appears in new search results, **Then** the detail page is re-fetched to capture any updated information (price change, new photos, updated description).
4. **Given** a listing detail page fetch fails (network error, 404, 403), **When** the scanner encounters this, **Then** the listing is still stored with whatever data was available from the search results page, and the scan continues without aborting.

---

### User Story 2 — Better Match Scores From Full Attributes (Priority: P2)

Because the matcher now has access to the full attribute set from the detail page, criteria that previously could never match (e.g. "total time under 2000 hours", "no damage history") can now be evaluated. The user sees listing scores that reflect these richer criteria and the AI-generated explanation references the actual aircraft specification rather than generic details.

**Why this priority**: Depends on US1. The richer data has no effect on the user experience until scoring and explanation generation consume it.

**Independent Test**: Configure a profile criterion that references an attribute only available on detail pages (e.g. total airframe time). Run a scan. Confirm that the listing score and AI explanation reflect that criterion — the explanation mentions the relevant attribute by name.

**Acceptance Scenarios**:

1. **Given** a profile has a criterion referencing total airframe time, **When** a listing's detail page contains that information, **Then** the stored attributes include airframe time and the match score reflects whether the criterion was met.
2. **Given** a listing has a damage history note on its detail page, **When** the AI explanation is generated, **Then** the explanation mentions this detail rather than omitting it.

---

### User Story 3 — Images Visible in the Listing Card (Priority: P3)

After the scan, listing cards in the web UI show the aircraft thumbnail image. Because detail-page fetching reliably captures images, listings that previously showed a "No photo" placeholder now show an actual photo wherever one is available.

**Why this priority**: Visual improvement that is automatically satisfied once US1 is working — feature 004 already renders thumbnails and galleries. No new UI work is required.

**Independent Test**: After a scan with this feature enabled, view the listings page. Confirm that listing cards for sites whose detail pages contain photos show a thumbnail image rather than the "No photo" placeholder.

**Acceptance Scenarios**:

1. **Given** a listing's detail page has photos, **When** the user views the listings page, **Then** a thumbnail image is displayed in the listing card summary.
2. **Given** a listing's detail page has no photos, **When** the user views the listings page, **Then** the "No photo" placeholder is shown (existing behaviour preserved).

---

### Edge Cases

- What happens when a detail page returns a non-200 HTTP status (404, 403, 503)? → The listing is stored using search-results data only; the failure is logged but does not abort the scan. Any existing AI explanation is left untouched.
- What happens when a detail page is behind an anti-bot wall (CAPTCHA, JS challenge)? → The fetch returns unusable content; treated the same as a network failure — log and continue with search-results data.
- What happens when a detail page has no parseable attributes at all? → The listing retains whatever data came from the search results. No existing field is overwritten with a blank value.
- What happens when detail-page fetching is slow across many listings? → Fetches run in parallel with bounded concurrency; only listings appearing in the current scan's search results are fetched.
- What happens when the same listing URL appears across multiple sites? → Existing registration-based dedup prevents duplicate rows; only one detail-page fetch occurs per listing per scan run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST fetch the detail page of each listing that appears in search results during a scan, before the scoring pass runs.
- **FR-002**: The detail-page fetch MUST extract all structured attributes present on the page (make, model, year, registration, price, total airframe time, engine time, avionics fit, damage history, seller notes, and any other labelled fields).
- **FR-003**: The detail-page fetch MUST extract all image URLs present on the listing detail page and store them as the listing's image set, overwriting any image data previously captured from search results.
- **FR-004**: Detail-page fetches MUST run with a maximum concurrency of 5 simultaneous requests, so that scanning remains practical in terms of elapsed time without overwhelming target sites.
- **FR-005**: A failure to fetch or parse a detail page MUST NOT prevent the listing from being stored or the scan from completing — the system falls back to search-results data for that listing.
- **FR-006**: Attributes from the detail page MUST be merged with data already captured from search results — existing fields must not be overwritten with blank values.
- **FR-007**: The enriched attribute set MUST be available to the Matcher scoring pass and the Presenter explanation-generation pass within the same scan run.
- **FR-008**: The system MUST NOT fetch detail pages for listings that did not appear in the current scan's search results.
- **FR-009**: After a successful detail-page fetch, the listing's AI explanation MUST be reset to pending so that the Presenter regenerates it using the richer attribute set within the same scan run. A failed fetch MUST leave any existing explanation untouched.

### Key Entities

- **Listing**: Extended with a richer `attributes` map populated from the detail page. Existing fields (`make`, `model`, `year`, `price`, `thumbnail_url`, `all_image_urls`) are updated if the detail page provides better values.
- **Detail fetch result**: The structured output of parsing a listing detail page — attributes map plus image URL list. Transient; fed directly into the listing upsert and not stored separately.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a scan, listings from sites whose detail pages contain structured data have measurably more attributes stored (at minimum: attributes not present in search results appear in the stored record).
- **SC-002**: At least 80% of listings whose detail pages contain photos have a non-null `thumbnail_url` after a scan.
- **SC-003**: A scan covering 50 new listings completes within a reasonable time budget — detail-page fetching (at 5 concurrent requests) adds no more than 60 seconds compared to the same scan without this feature.
- **SC-004**: Zero scan runs abort due to detail-page fetch failures — individual listing failures do not cascade to the overall scan.

## Clarifications

### Session 2026-04-13

- Q: When a detail-page fetch updates a listing's stored attributes, should the AI-generated headline and explanation be automatically regenerated? → A: Always reset to pending on every detail-page fetch, triggering regeneration in the same scan run (Option A).
- Q: What should the maximum concurrency be for parallel detail-page fetches? → A: 5 concurrent requests.
- Q: When a detail-page fetch fails, should the AI explanation be reset to pending anyway? → A: No — leave existing explanation untouched; only regenerate when fetch succeeds (Option B).

## Assumptions

- Listing detail pages are publicly accessible HTML (no login required) — consistent with publicly listed aircraft-for-sale sites.
- The same LLM-based extraction approach used for search results pages is suitable for detail pages; no separate per-site parser is needed.
- Image URLs on detail pages are absolute or can be made absolute by prepending the site origin — the same normalisation used for search results applies.
- Bounded concurrency (fetching several listings in parallel) is sufficient to keep scan time practical; no background job or queue is needed.
- No new database tables are required — the existing `raw_attributes` JSON column and image URL columns are sufficient to store the enriched data.
- Fetching detail pages for all listings seen in the current scan (not only brand-new ones) is acceptable, so that price and photo changes are captured on re-scans.
