// Scoring service — pure function, no side effects.
// Implements the algorithm from contracts/matcher-agent.md.

import type { ListingForScoring } from '../types.js';
import type { Criterion } from '../config.js';

function isSatisfied(listing: ListingForScoring, criterion: Criterion): boolean {
  switch (criterion.type) {
    case 'type_match': {
      const pat = criterion.pattern.toLowerCase();
      return (
        (listing.aircraftType?.toLowerCase().includes(pat) ?? false) ||
        (listing.make?.toLowerCase().includes(pat) ?? false) ||
        (listing.model?.toLowerCase().includes(pat) ?? false)
      );
    }
    case 'price_max':
      return listing.price !== null && listing.price <= criterion.max;

    case 'price_range':
      return (
        listing.price !== null &&
        criterion.min <= criterion.max &&
        listing.price >= criterion.min &&
        listing.price <= criterion.max
      );

    case 'year_min':
      return listing.year !== null && listing.year >= criterion.yearMin;

    case 'year_range':
      return (
        listing.year !== null &&
        listing.year >= criterion.yearMin &&
        listing.year <= criterion.yearMax
      );

    case 'location_contains': {
      const pat = criterion.locationPattern.toLowerCase();
      return listing.location?.toLowerCase().includes(pat) ?? false;
    }
  }
}

export function scoreListing(listing: ListingForScoring, criteria: Criterion[]): number {
  if (criteria.length === 0) return 0;

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0) return 0;

  const satisfiedWeight = criteria
    .filter((c) => isSatisfied(listing, c))
    .reduce((sum, c) => sum + c.weight, 0);

  return Math.round((satisfiedWeight / totalWeight) * 1000) / 10;
}
