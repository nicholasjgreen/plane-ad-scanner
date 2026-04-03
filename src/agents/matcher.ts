import type { ListingForScoring, MatcherOutput } from '../types.js';
import type { Criterion } from '../config.js';
import { scoreListing } from '../services/scoring.js';
import { logger } from '../config.js';

export async function runMatcher(
  listings: ListingForScoring[],
  criteria: Criterion[]
): Promise<MatcherOutput> {
  try {
    const scores = listings.map((listing) => ({
      listingId: listing.id,
      score: scoreListing(listing, criteria),
    }));
    logger.debug({ count: scores.length }, 'Matcher scored listings');
    return { scores };
  } catch (err) {
    logger.error({ err }, 'Matcher error — retaining existing scores');
    return { scores: [] };
  }
}
