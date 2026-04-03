// Phase 3 stub — returns empty scores so existing DB scores are retained.
// Phase 4 replaces this with the real scoring engine (src/services/scoring.ts).
import type { ListingForScoring, MatcherOutput } from '../types.js';
import type { Criterion } from '../config.js';

export async function runMatcher(
  _listings: ListingForScoring[],
  _criteria: Criterion[]
): Promise<MatcherOutput> {
  return { scores: [] };
}
