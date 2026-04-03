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
