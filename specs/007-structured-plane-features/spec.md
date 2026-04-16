# Feature Specification: Structured Plane Features

**Feature Branch**: `007-structured-plane-features`
**Created**: 2026-04-16
**Status**: Draft
**Input**: User description: "Refine raw aircraft attributes into structured, meaningful indicators: avionics type (glass/steam/hybrid), modern integrated autopilot, IFR certification level, redundancy level, engine state, maintenance costs, fuel costs, and overall condition using red/amber/green ratings."
**Primary purpose**: Feed the scoring engine — structured indicators are fitness signals that allow a listing to be evaluated against the user's mission profile and preferences. Display on the listings page is a secondary benefit.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Listings Are Scored Against My Mission Profile Using Structured Indicators (Priority: P1)

As a prospective aircraft buyer, I want match scores to reflect whether a listing fits my actual flying mission and preferences (e.g. IFR capable, low engine hours, economical fuel burn) so that the top-ranked listings are genuinely the most suitable ones for me — not just the closest keyword matches.

**Why this priority**: This is the primary purpose of the feature. Structured indicators are fitness signals for the scoring engine. Without them, the matcher can only work from raw text patterns, which are inconsistent and hard to weight meaningfully against a mission profile.

**Independent Test**: Configure an interest profile with criteria for IFR approval, engine state, and fuel burn band. Seed two listings — one matching all three criteria, one matching none — with otherwise identical attributes. Run a scan. Verify the matching listing scores significantly higher than the non-matching one.

**Acceptance Scenarios**:

1. **Given** a listing has raw attributes describing a G1000-equipped aircraft with a recent engine overhaul, **When** indicators are derived, **Then** the derived indicators include "Glass Cockpit", engine state "Green", and IFR capability level "Advanced" — and these values contribute to the match score against a profile that weights them.
2. **Given** a listing's raw attributes contain no avionics information, **When** indicators are derived, **Then** the avionics indicator is "Unknown" and any profile criterion targeting avionics treats the listing as not satisfying that criterion (conservative scoring).
3. **Given** indicators have been derived, **When** the scoring engine evaluates a listing, **Then** each indicator criterion uses the stored value and its confidence level — a "Low" confidence value contributes less to the score than a "High" confidence value for the same field.
4. **Given** a listing exists with no raw attributes at all, **When** indicator derivation runs, **Then** all indicators are set to "Unknown" and the listing scores as though no indicator criteria are satisfied.

---

### User Story 2 — See Structured Indicators on the Listings Page (Priority: P2)

As a prospective aircraft buyer, I want each listing on the web page to show its derived indicators organised into collapsible category groups (Avionics & IFR, Engine & Airworthiness, Aircraft Profile, Costs, Provenance) so I can understand why a listing ranked where it did and inspect the underlying signals without reading walls of raw scraped attributes.

**Why this priority**: Display is a secondary benefit of the derivation work done for scoring. It adds transparency — the user can see which indicator values drove the match score — but the indicators exist primarily to feed the scoring engine, not to be shown to the user.

**Independent Test**: Seed the database with a listing whose `raw_attributes` contain engine hours, avionics descriptions, and annual inspection dates. Trigger indicator derivation. Open the web page and verify that the listing card shows grouped indicator categories, each expandable, with values and confidence labels visible on expansion.

**Acceptance Scenarios**:

1. **Given** indicators have been derived for a listing, **When** I open the listings page, **Then** each listing card shows collapsible indicator category groups; expanding a group reveals its indicator values and confidence levels.
2. **Given** a listing's raw attributes contain no avionics information, **When** I expand the Avionics & IFR group, **Then** the avionics indicator shows "Unknown" rather than a guess.
3. **Given** a criterion uses a structured indicator, **When** the listing has that indicator as "Unknown", **Then** the criterion is treated as not satisfied (conservative scoring) rather than as a match.
4. **Given** a criterion `ifr_capability_level = Enhanced` is configured, **When** a listing has IFR capability level "Basic", **Then** that criterion is not satisfied even if the listing's IFR approval is "IFR Approved".

---

### User Story 3 — Indicators Refresh When Listing Data Changes (Priority: P3)

As a user, I want structured indicators to be automatically updated when a listing's raw attributes change after a re-scrape, so the indicators always reflect the latest available information.

**Why this priority**: Listings can be updated by sellers (price changes, new photos, added descriptions). Stale indicators would mislead ranking decisions.

**Independent Test**: Seed a listing with sparse raw attributes (all indicators "Unknown"). Update the raw attributes to include detailed avionics and engine information. Trigger re-derivation. Verify that indicators now reflect the enriched data.

**Acceptance Scenarios**:

1. **Given** a listing's raw attributes are updated with new engine data, **When** the next enrichment pass runs, **Then** the engine state indicator is updated to reflect the new information.
2. **Given** a listing's indicators were previously derived, **When** raw attributes change in any way, **Then** indicators are immediately marked stale and re-queued for derivation.
3. **Given** indicator derivation fails for one listing (e.g., the AI API is unavailable), **When** the failure occurs, **Then** the existing indicators are retained unchanged and the listing is re-queued for retry.

---

### Edge Cases

- What happens when raw attributes are extremely sparse (only aircraft type and price)? → Type-derived indicators (type category, range, cruise speed, fuel burn, capacity) may still resolve from type knowledge; listing-specific indicators (SMOH, hangar situation, maintenance program) default to "Unknown" with confidence "Low".
- What if the listing is a flying club share rather than full ownership? → Indicators still apply but maintenance cost and fuel cost bands should reflect share economics where distinguishable.
- What if the engine has been replaced with a non-standard engine? → The AI assesses engine state from available information; confidence will typically be "Low" or "Medium".
- What if two raw attribute values give conflicting signals about the same indicator? → The AI resolves the conflict from context; confidence is reduced accordingly.
- What if TBO hours or engine hours are absent from raw attributes? → Engine state defaults to "Unknown" rather than assuming "Green".
- What happens to existing indicator values if re-derivation fails? → Existing values are preserved unchanged; the listing is re-queued for retry on the next enrichment pass.
- What if a listing states "IFR equipped" but gives no indication of whether it holds an IFR approval? → IFR approval is `IFR Equipped (Not Approved)`; IFR capability level is derived from the described equipment.
- What if a listing describes glass avionics but gives no explicit IFR approval status? → IFR approval is `Unknown`; IFR capability level is derived from the avionics description (likely `Advanced` or `High-End`). The two fields are independent.
- What if the aircraft type is a homebuilt or obscure experimental? → Aircraft type category defaults to the closest matching category with confidence "Low"; type-derived performance indicators will be "Unknown".
- What if a listing describes a partnership with no ownership percentage detail? → Ownership structure is `Partnership`; no further breakdown is attempted.
- What if SMOH appears in multiple forms (e.g. "500 SMOH", "engine mid-life")? → The AI extracts the most specific numeric value; narrative descriptions without numbers result in "Unknown".

---

## Clarifications

### Session 2026-04-16

- Q: How should the 20 indicators be displayed on a listing card? → A: Grouped into collapsible categories (e.g. Avionics, Engine, Costs, Aircraft Info)
- Q: How should scoring criteria work for numeric indicators (SMOH, range, speed, fuel burn, capacity)? → A: Banded — numeric indicators are converted to Red/Amber/Green (or equivalent categories) before scoring, consistent with cost/condition fields; raw numeric values are retained for display only
- Q: What triggers indicator re-derivation — any raw_attributes change, or only substantial changes? → A: Any change to raw_attributes immediately marks indicators stale and queues re-derivation
- Q: What is the acceptable wall-clock budget for deriving indicators for a batch of 20 listings? → A: 60 seconds
- Q: What triggers the indicator derivation background pass? → A: Triggered at the end of each scan run, same as the existing Presenter agent
- Q: What is the primary purpose of structured indicators — display or scoring? → A: Scoring is primary; indicators are fitness signals evaluated against the user's mission profile. Display on the listings page is a secondary transparency benefit.
- Q: Should FR-004 and FR-004a include normative equipment signals so the AI has a clear decision framework? → A: Yes — add normative equipment markers for each IFR approval value and each capability level

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST derive the following twenty structured indicators from each listing's raw attributes using AI inference: aircraft type category, avionics type, autopilot capability, IFR approval, IFR capability level, redundancy level, engine state, time since major overhaul (SMOH), maintenance cost band, fuel cost band, condition band, maintenance program enrollment, hangar situation, ownership structure, airworthiness basis, registration country, typical range, typical cruise speed, typical fuel burn, and passenger capacity.
- **FR-002**: Avionics type MUST be one of: `Glass Cockpit`, `Hybrid`, `Steam Gauges`, `Unknown`.
- **FR-003**: Autopilot capability MUST be one of: `Modern Integrated`, `Basic`, `None`, `Unknown`.
- **FR-004**: IFR approval MUST be one of: `VFR Only`, `IFR Equipped (Not Approved)`, `IFR Approved`, `Unknown` — reflecting the regulatory and equipment status of the aircraft. Signal indicators for AI inference:
  - `VFR Only`: Listing explicitly states VFR only; or only basic VFR instruments described with no mention of VOR/ILS/IFR GPS; or aircraft is microlight/ultralight category.
  - `IFR Equipped (Not Approved)`: Listing mentions IFR-capable instruments (VOR, ILS, attitude indicator, altimeter) but does not state IFR approval or certification; or states "IFR equipped" without "approved" or "certified".
  - `IFR Approved`: Listing explicitly states "IFR certified", "IFR approved", "IFR legal", "instrument certified", "CAA IFR approval", or equivalent regulatory language. For US standard-category aircraft, a C of A with the appropriate avionics implies IFR approval unless the listing states otherwise. Presence of an approved IFR GPS (WAAS, LPV-capable, with STC if applicable) and explicit mention of IFR approaches flown is strong supporting evidence.
  - `Unknown`: Avionics described but approval status cannot be determined from listing text.
- **FR-004a**: IFR capability level MUST be one of: `Basic`, `Enhanced`, `Advanced`, `High-End`, `Unknown` — reflecting the practical workload and capability of the avionics fit, independent of approval status. Signal indicators for AI inference:
  - `Basic`: Single analogue VOR/ILS receiver; steam gauges throughout; no GPS or a VFR-only GPS; no autopilot or wing-leveller only; high pilot workload implied. Typical markers: ADF, KI-525, "steam gauges with IFR", single COM/NAV.
  - `Enhanced`: WAAS GPS navigator (e.g. Garmin GNS 430W / 530W, GTN 650 / 750, Avidyne IFD 440 / 540); moving map display; 2-axis autopilot (e.g. KAP-140, S-TEC 30 / 55X, Garmin GFC 500); multiple COM/NAV sources. Can fly GPS approaches (LPV / LNAV+V). May have steam gauges or partial glass. Sweet spot for most GA pilots.
  - `Advanced`: Full glass cockpit (e.g. Garmin G1000, G3X Touch, Avidyne Entegra, Dynon Skyview certified); integrated autopilot with approach coupling (e.g. GFC 700, Avidyne DFC90, King KFC 325); TAWS / terrain awareness; ADS-B in and out; weather datalink (FIS-B, XM). Good redundancy with backup instruments. Typical markers: "G1000", "GFC700", "coupled approaches", "TAWS", "glass panel".
  - `High-End`: Avionics suite designed explicitly for low single-pilot workload; sophisticated autopilot with VNAV and vertical approach coupling; electronic stability protection (ESP); yaw damper; autothrottle where applicable. Typical markers: Garmin Perspective / Perspective+ (Cirrus SR series), G3000 / G5000 (Piper M-series, turbines), "VNAV", "autothrottle", "ESP", "yaw damper", "Autoland".
  - `Unknown`: Avionics information too sparse to determine capability level.
- **FR-005**: Redundancy level MUST be one of: `High`, `Medium`, `Low`, `Unknown` — reflecting the presence of backup systems (dual radios, backup instruments, multi-engine, etc.) inferred from listing data.
- **FR-006**: Engine state MUST be one of: `Green` (recently overhauled, plenty of life remaining), `Amber` (serviceable but overhaul due in the next few years), `Red` (urgently needs overhaul), `Unknown`.
- **FR-007**: Maintenance cost band, fuel cost band, and condition band MUST each be one of: `Green` (low / excellent), `Amber` (moderate / acceptable), `Red` (high / poor), `Unknown`.
- **FR-008**: Each of the twenty indicators MUST be accompanied by a confidence level: `High`, `Medium`, or `Low`, communicating how certain the AI inference was.
- **FR-009**: Structured indicators MUST be displayed on the listings web page within each listing card, grouped into logical categories (e.g. Avionics & IFR, Engine & Airworthiness, Aircraft Profile, Costs, Provenance). Each category group MUST be independently collapsible so the user can expand only the categories relevant to their decision.
- **FR-010**: Structured indicators MUST be stored persistently and survive application restarts — they MUST NOT be re-derived on every page load.
- **FR-011**: Structured indicators MUST be marked stale and re-queued for derivation whenever a listing's raw attributes are updated, regardless of the nature or extent of the change.
- **FR-012**: Structured indicators MUST be available as criteria in interest profiles so a user can express preferences such as "IFR Approval = IFR Approved", "IFR Capability Level = Enhanced", or "Engine State = Green".
- **FR-013**: If indicator derivation fails for a listing (e.g., API error), the system MUST retain the existing indicator values unchanged and re-queue the listing for retry.
- **FR-014**: Indicator derivation MUST run as a background enrichment pass triggered at the end of each scan run, after scraping and scoring complete — the same pattern as the Presenter agent. It MUST NOT block scanning, scoring, or web page responses.
- **FR-015**: The system MUST be able to derive indicators for all listings that have never been assessed, as well as re-derive stale ones.
- **FR-016**: Aircraft type category MUST be one of: `Single Piston`, `Twin Piston`, `Turboprop`, `Jet`, `Unknown`.
- **FR-017**: Typical range, cruise speed, and fuel burn MUST each be stored as both a raw approximate value (nm, kts, GPH respectively) for display and a derived band (`Green` / `Amber` / `Red` / `Unknown`) for scoring criteria. All three values are inferred from aircraft type knowledge rather than listing-specific data; confidence will often be `Medium`. Range band reflects mission suitability (Green = long range, Red = short range). Speed band reflects cruise performance. Fuel burn band reflects running economy (Green = economical, Red = thirsty).
- **FR-018**: Passenger capacity MUST be stored as both a raw approximate seat count (integer) for display and a derived capacity category (`2 seats`, `3–4 seats`, `5–6 seats`, `7+ seats`, `Unknown`) for scoring criteria, inferred from aircraft type and any capacity information present in the listing.
- **FR-019**: Time since major overhaul (SMOH) MUST be extracted from raw attributes as a numeric hour value for display or `Unknown` when not stated. SMOH is a listing-specific value distinct from the engine state band (FR-006); for scoring criteria the engine state band (FR-006) is used — SMOH is display-only and not a scoring criterion field.
- **FR-020**: Maintenance program enrollment MUST be one of: a recognised named manufacturer programme (e.g. Cessna Care, Cirrus SMP), `None`, `Unknown`.
- **FR-021**: Hangar situation MUST be one of: `Hangared`, `T-Hangar`, `Tie-down`, `Unknown`.
- **FR-022**: Ownership structure MUST be one of: `Full Ownership`, `Partnership`, `Flying Club Share`, `Unknown`.
- **FR-023**: Airworthiness basis MUST be one of: `Type Certificated`, `Permit to Fly`, `Experimental`, `Unknown` — reflecting whether the aircraft holds a standard type certificate or flies under a permit or experimental category.
- **FR-024**: Registration country MUST be the full country name (e.g. `United Kingdom`, `United States`, `Germany`) derived from the registration prefix (G- → United Kingdom, N- → United States, etc.), or `Unknown` when no registration is present. Where the registration prefix is ambiguous or unrecognised, the value MUST be `Unknown`.

### Key Entities

- **StructuredIndicators**: Per-listing AI-inferred assessment record containing all twenty indicator fields (each with its categorical value and confidence level), a derivation timestamp, and a status (`pending` / `ready` / `failed` / `stale`). The twenty fields are: aircraft type category, avionics type, autopilot capability, IFR approval, IFR capability level, redundancy level, engine state, SMOH (hours), maintenance cost band, fuel cost band, condition band, maintenance program enrollment, hangar situation, ownership structure, airworthiness basis, registration country, typical range (nm), typical cruise speed (kts), typical fuel burn (GPH), and passenger capacity (seats).
- **IndicatorCriterion**: A scoring criterion type that targets a specific indicator field and expected value; used within an interest profile to bias match scores toward desired indicator values. All scoreable fields use categorical or banded values — equality matching is used throughout. Numeric indicators (range, cruise speed, fuel burn, capacity) are pre-banded before scoring; SMOH is display-only and not a scoreable criterion field. Examples: `ifr_approval = IFR Approved`, `engine_state = Green`, `range_band = Green`, `capacity_category = 3–4 seats`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Structured indicators are derived and available for scoring within one enrichment cycle of a listing being scraped — no manual steps required.
- **SC-002**: For listings with reasonably detailed raw attributes (description, equipment list, engine hours), at least 12 of the 20 indicators are populated with a non-"Unknown" value. Type-derived indicators (type category, range, cruise speed, fuel burn, capacity) and registration-derived indicators (registration country) should resolve reliably for standard aircraft, contributing a dependable floor to this threshold.
- **SC-003**: When an interest profile criterion targets a structured indicator, the match score correctly separates listings that meet the criterion from those that do not, producing a measurable score difference. This is the primary success measure of the feature.
- **SC-004**: The listings page load time is not measurably increased by indicator data — indicators are pre-computed and stored, not derived on demand.
- **SC-005**: Deriving indicators for a batch of 20 listings completes within 60 seconds as a background task, without blocking the web page or the scan cycle.
- **SC-006**: When a listing's raw attributes are updated by a re-scrape, refreshed indicators appear on the page within one subsequent enrichment cycle.

---

## Assumptions

- Structured indicators are derived by an AI agent reading the `raw_attributes` JSON for each listing — no additional structured input from the scraper is required.
- The derivation AI uses the same Anthropic API already in use by the project; no new AI provider or model is introduced.
- Indicator derivation is an asynchronous background task triggered at the end of each scan run (after scraping and scoring), in the same position as the Presenter agent introduced in feature 004. No separate timer or manual trigger is required.
- "Fuel running costs" are assessed from aircraft type characteristics (typical fuel burn for the type) since per-listing fuel cost data is rarely published; confidence will often be "Medium".
- "Maintenance costs" are assessed from engine state, airframe condition, annual inspection notes, and aircraft type; no external maintenance cost database is consulted.
- The four type-derived performance indicators (typical range, cruise speed, fuel burn, passenger capacity) are inferred from aircraft type knowledge rather than listing-specific text. For well-known types (Cessna 172, Piper PA-28, etc.) confidence will be "High"; for obscure or homebuilt types it will be "Low". Each is stored as both a raw value (for display) and a derived band or category (for scoring criteria).
- SMOH is a listing-specific value extracted verbatim from raw attributes when present (e.g. "100 SMOH", "fresh annual"). When absent, SMOH is "Unknown" — the engine state band (FR-006) remains the summary judgment.
- Maintenance program enrollment identifies recognised manufacturer programmes (e.g. Cessna Care, Cirrus SMP, Diamond Care) where mentioned in the listing. Generic "maintained" statements do not constitute program enrollment.
- Ownership structure overlaps with the existing `listing_type` field but provides finer-grained categorisation (Partnership vs Flying Club Share) from the listing text; the two fields coexist without conflict.
- Registration country is derived deterministically from the registration prefix when the registration field is populated (e.g. G-ABCD → United Kingdom, N12345 → United States); AI inference is used only when the registration prefix is ambiguous or absent.
- Airworthiness basis (Certified vs Permit) is typically stated explicitly in UK listings ("Permit to Fly" / "C of A") and some US listings ("Experimental"); when absent, the indicator defaults to "Unknown" rather than assuming Type Certificated.
- The twenty indicators listed represent the complete scope of this feature. Additional indicator types are out of scope.
- The primary purpose of structured indicators is to feed the scoring engine — they are machine-readable fitness signals evaluated against the user's mission profile and preferences. Display on the listings page is a secondary benefit that provides transparency into why a listing ranked where it did.
- Buyers understand that AI-inferred indicators may occasionally be imprecise; the confidence label communicates this uncertainty and is factored into scoring (lower confidence = lower contribution).
- Structured indicator criteria in interest profiles supplement (not replace) existing criterion types.
- The single-user, local-only deployment from feature 001 is unchanged; no multi-user or access control considerations apply.
