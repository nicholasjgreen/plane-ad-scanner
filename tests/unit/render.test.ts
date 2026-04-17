/**
 * Unit tests for src/web/render.ts
 *
 * Tests renderListing headline fallback and renderIndicatorRow/renderIndicatorGroups
 * behaviour by exercising them through the public renderListingsPage function.
 */
import { describe, it, expect } from 'vitest';
import { renderListingsPage } from '../../src/web/render.js';
import type { ListingRow, ListingsPageData } from '../../src/web/render.js';
import type { StructuredIndicators } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<ListingRow> = {}): ListingRow {
  return {
    id: 'test-id',
    registration: null,
    aircraftType: null,
    make: null,
    model: null,
    year: null,
    price: null,
    priceCurrency: 'GBP',
    location: null,
    listingUrl: 'https://example.com/listing',
    sourceSite: 'TestSite',
    matchScore: 42,
    isNew: false,
    dateFirstFound: '2026-01-01T00:00:00.000Z',
    dateLastSeen:   '2026-01-01T00:00:00.000Z',
    evidence: [],
    headline: null,
    explanation: null,
    aiStatus: null,
    thumbnailUrl: null,
    allImageUrls: [],
    indicators: null,
    ...overrides,
  };
}

function makePage(row: ListingRow): ListingsPageData {
  return {
    listings: [row],
    lastScan: null,
    scanErrors: [],
    totalCount: 1,
    filters: { type: null, maxPrice: null, newOnly: false },
  };
}

function render(row: ListingRow): string {
  return renderListingsPage(makePage(row));
}

// Minimal valid StructuredIndicators
const INDICATORS: StructuredIndicators = {
  avionics_type:          { value: 'Glass Cockpit', confidence: 'High' },
  autopilot_capability:   { value: 'Modern Integrated', confidence: 'Medium' },
  ifr_approval:           { value: 'IFR Approved', confidence: 'High' },
  ifr_capability_level:   { value: 'Advanced', confidence: 'Low' },
  engine_state:           { value: 'Green', confidence: 'High' },
  smoh_hours:             { value: 250, confidence: 'Medium' },
  condition_band:         { value: 'Green', confidence: 'High' },
  airworthiness_basis:    { value: 'Type Certificated', confidence: 'High' },
  aircraft_type_category: { value: 'Single Piston', confidence: 'High' },
  passenger_capacity:     { value: 4, band: '3–4 seats', confidence: 'High' },
  typical_range:          { value: 700, band: 'Green', confidence: 'High' },
  typical_cruise_speed:   { value: 122, band: 'Amber', confidence: 'High' },
  typical_fuel_burn:      { value: 8, band: 'Green', confidence: 'High' },
  maintenance_cost_band:  { value: 'Green', confidence: 'Medium' },
  fuel_cost_band:         { value: 'Green', confidence: 'High' },
  maintenance_program:    { value: null, confidence: 'Low' },
  registration_country:   { value: 'United Kingdom', confidence: 'High' },
  ownership_structure:    { value: 'Full Ownership', confidence: 'High' },
  hangar_situation:       { value: 'Hangared', confidence: 'High' },
  redundancy_level:       { value: 'Low', confidence: 'High' },
};

// ---------------------------------------------------------------------------
// renderListing — headline fallback
// ---------------------------------------------------------------------------

describe('renderListing — headline fallback', () => {
  it('uses AI headline when present', () => {
    // headline and aircraftType are different strings — headline wins
    const html = render(makeRow({ headline: 'Pristine SR22', aircraftType: 'Cirrus SR-22' }));
    expect(html).toContain('Pristine SR22');
    expect(html).not.toContain('Cirrus SR-22');
  });

  it('falls back to aircraftType when headline is null', () => {
    const html = render(makeRow({ headline: null, aircraftType: 'Piper PA-28', make: 'Piper', model: 'PA-28' }));
    expect(html).toContain('Piper PA-28');
  });

  it('falls back to make+model when both headline and aircraftType are null', () => {
    const html = render(makeRow({ headline: null, aircraftType: null, make: 'Diamond', model: 'DA40' }));
    expect(html).toContain('Diamond DA40');
  });

  it('falls back to "Listing on <site>" when headline, aircraftType, make, and model are all null', () => {
    const html = render(makeRow({ headline: null, aircraftType: null, make: null, model: null, sourceSite: 'GlobalAir' }));
    expect(html).toContain('Listing on GlobalAir');
  });

  it('falls back to "Listing on <site>" when make and model are both empty strings', () => {
    const html = render(makeRow({ headline: null, aircraftType: null, make: '', model: '', sourceSite: 'Controller' }));
    expect(html).toContain('Listing on Controller');
  });

  it('escapes HTML in the headline', () => {
    const html = render(makeRow({ headline: '<script>alert(1)</script>' }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

// ---------------------------------------------------------------------------
// renderIndicatorGroups — via renderListing
// ---------------------------------------------------------------------------

describe('renderIndicatorGroups', () => {
  it('renders all 5 groups with "Not derived" rows when indicators is null', () => {
    const html = render(makeRow({ indicators: null }));
    expect(html).toContain('ind-groups');
    expect(html).toContain('Avionics');
    expect(html).toContain('Engine');
    expect(html).toContain('Aircraft Profile');
    expect(html).toContain('Costs');
    expect(html).toContain('Provenance');
    expect(html).toContain('ind-val--not-derived');
    expect(html).toContain('Not derived');
  });

  it('renders all 5 group headings when indicators are present', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    expect(html).toContain('Avionics');
    expect(html).toContain('Engine');
    expect(html).toContain('Aircraft Profile');
    expect(html).toContain('Costs');
    expect(html).toContain('Provenance');
  });

  it('renders categorical indicator value', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    expect(html).toContain('Glass Cockpit');
  });

  it('renders banded indicator with band and raw value', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    // passenger_capacity: value=4, band="3–4 seats"
    expect(html).toContain('3–4 seats');
    expect(html).toContain('(4)');
  });

  it('renders High confidence badge with correct CSS class', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    expect(html).toContain('conf--high');
  });

  it('renders Medium confidence badge with correct CSS class', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    // autopilot_capability has Medium confidence
    expect(html).toContain('conf--medium');
  });

  it('renders Low confidence badge with correct CSS class', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    // ifr_capability_level has Low confidence
    expect(html).toContain('conf--low');
  });

  it('renders "—" with ind-val--unknown class for an indicator with null value', () => {
    const html = render(makeRow({ indicators: INDICATORS }));
    // maintenance_program has null value
    expect(html).toContain('ind-val--unknown');
  });

  it('renders "Not derived" when an indicator field is missing from the object', () => {
    // Simulate a partial indicators object missing one field
    const partial = { ...INDICATORS } as unknown as Record<string, unknown>;
    delete partial['hangar_situation'];
    const html = render(makeRow({ indicators: partial as unknown as StructuredIndicators }));
    expect(html).toContain('ind-val--not-derived');
    expect(html).toContain('Not derived');
  });

  it('does not render confidence badge for null-value indicators', () => {
    // maintenance_program has null value — badge slot is an empty <span>, not a conf-badge
    const html = render(makeRow({ indicators: INDICATORS }));
    expect(html).toMatch(/ind-val--unknown[^<]*<\/span>\s*<span><\/span>/);
  });
});
