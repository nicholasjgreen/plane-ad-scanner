// Shared types across agents and services.
// DB row types (snake_case) are kept local to their files.

export interface RawListing {
  listingUrl: string;
  aircraftType?: string;
  make?: string;
  model?: string;
  registration?: string;
  year?: number;
  price?: number;
  priceCurrency?: string;
  location?: string;
  attributes: Record<string, string>;
  imageUrls?: string[];  // All image URLs scraped from the listing page; first element is the thumbnail candidate
}

// ---------------------------------------------------------------------------
// Feature 004: Presenter agent types
// ---------------------------------------------------------------------------

export interface PresenterInput {
  listing: {
    id: string;
    make: string | null;
    model: string | null;
    year: number | null;
    price: number | null;
    priceCurrency: string;
    location: string | null;
    sourceSite: string;
    attributes: Record<string, string>;
  };
  profiles: InterestProfile[];  // empty array if no profiles defined
}

export interface PresenterOutput {
  listingId: string;
  headline: string;       // max 60 chars, never empty — fallback to site+price if blank
  explanation: string;    // never empty — fallback to "No summary available." if blank
  status: 'ok' | 'partial';  // 'partial' when no profiles or sparse data
}

export interface ScraperOutput {
  siteName: string;
  listings: RawListing[];
  error?: string;
}

export interface ListingForScoring {
  id: string;
  registration: string | null;
  aircraftType: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price: number | null;
  priceCurrency: string;
  location: string | null;
  listingType?: 'full_ownership' | 'share' | null;
  icaoCode?: string | null;  // Airfield ICAO code for proximity criterion (share listings)
}

export interface ListingScore {
  listingId: string;
  score: number;
}

export interface MatcherOutput {
  scores: ListingScore[];
}

export interface ScanError {
  site: string;
  error: string;
}

export interface ScanRunResult {
  id: string;
  sitesAttempted: number;
  sitesSucceeded: number;
  sitesFailed: number;
  listingsFound: number;
  listingsNew: number;
  errors: ScanError[];
}

export interface HistorianResult {
  newCount: number;
  updatedCount: number;
  listingIds: string[];
}

export interface VerifierOutput {
  siteName: string;
  sampleListings: RawListing[];
  canFetchListings: boolean;
  failureReason?: string;
  turnsUsed: number;
}

export interface DiscoveryCandidate {
  url: string;
  name: string;
  description: string;
}

export interface DiscovererInput {
  existingUrls: string[];
}

export interface DiscovererOutput {
  candidates: DiscoveryCandidate[];
}

// ---------------------------------------------------------------------------
// Feature 002: Profile-based interest scoring
// ---------------------------------------------------------------------------

export interface ProfileCriterion {
  type: 'mission_type' | 'make_model' | 'price_range' | 'year_range' | 'listing_type' | 'proximity';
  weight: number;
  // type-specific fields:
  intent?: string;             // mission_type
  sub_criteria?: string[];     // mission_type
  make?: string | null;        // make_model
  model?: string | null;       // make_model (wildcard * supported)
  min?: number;                // price_range
  max?: number;                // price_range
  yearMin?: number;            // year_range
  yearMax?: number;            // year_range
  listingType?: 'full_ownership' | 'share' | 'any';  // listing_type
  maxDistanceKm?: number;      // proximity
}

export interface InterestProfile {
  name: string;
  weight: number;              // 0 = inactive
  description?: string;
  min_score: number;           // 0–100
  intent?: string;
  criteria: ProfileCriterion[];
}

export interface EvidenceItem {
  criterionName: string;
  matched: boolean;
  contribution: number;        // 0–100 contribution to profile score
  note: string;
  confidence: 'high' | 'medium' | 'low' | null;  // null for deterministic criteria
}

export interface ProfileScore {
  profileName: string;
  score: number;               // 0–100
  evidence: EvidenceItem[];
}

export interface ProfileMatcherOutput {
  scores: Array<{
    listingId: string;
    overallScore: number;      // weighted average written to listings.match_score
    profileScores: ProfileScore[];
  }>;
}

export type FeedbackRating = 'more_interesting' | 'as_expected' | 'less_interesting';

export interface FeedbackRecord {
  id: string;
  listingId: string;
  rating: FeedbackRating;
  weightsSnapshot: Record<string, number>;  // profileName → weight
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Feature 006: Detail Fetcher agent types
// ---------------------------------------------------------------------------

export interface DetailFetcherInput {
  listingId: string;    // DB primary key — for correlation only, not sent to LLM
  listingUrl: string;   // Full URL of the listing detail page
  sourceSite: string;   // Site name — used for logging
}

export interface DetailFetchResult {
  listingId: string;
  attributes: Record<string, string>;  // All labelled fields extracted from detail page
  imageUrls: string[];                 // All image URLs found (absolute)
  error?: string;                      // Present if fetch or LLM extraction failed
}

export interface WeightSuggestion {
  id: string;
  profileName: string;
  currentWeight: number;
  proposedWeight: number;
  rationale: string;
  feedbackCount: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}
