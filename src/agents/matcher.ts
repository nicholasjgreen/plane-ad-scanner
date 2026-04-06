import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ListingForScoring, MatcherOutput, InterestProfile } from '../types.js';
import type { Criterion } from '../config.js';
import { scoreListing } from '../services/scoring.js';
import { scoreListingAgainstProfiles } from '../services/profile-scorer.js';
import { logger } from '../config.js';

/**
 * Persist per-listing, per-profile scores to listing_scores table.
 * Called after scoreListingAgainstProfiles returns profileScores.
 */
export function persistProfileScores(
  db: Database.Database,
  listingId: string,
  profileScores: Array<{ profileName: string; score: number; evidence: unknown[] }>,
  scoredAt: string
): void {
  const insert = db.prepare(
    `INSERT OR REPLACE INTO listing_scores (id, listing_id, profile_name, score, evidence, scored_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction(() => {
    for (const ps of profileScores) {
      insert.run(randomUUID(), listingId, ps.profileName, ps.score, JSON.stringify(ps.evidence), scoredAt);
    }
  });
  insertAll();
}

export async function runMatcher(
  listings: ListingForScoring[],
  criteria: Criterion[],
  profiles: InterestProfile[] = [],
  db?: Database.Database,
  homeLocation?: { lat: number; lon: number } | null
): Promise<MatcherOutput> {
  try {
    const scoredAt = new Date().toISOString();
    const scores = listings.map((listing) => {
      if (profiles.length > 0) {
        const { overallScore, profileScores } = scoreListingAgainstProfiles(
          listing,
          profiles,
          homeLocation,
          db
        );
        if (db) {
          persistProfileScores(db, listing.id, profileScores, scoredAt);
        }
        return { listingId: listing.id, score: overallScore };
      }
      // Fallback: legacy criteria-based scoring (feature 001 compatibility)
      return { listingId: listing.id, score: scoreListing(listing, criteria) };
    });
    logger.debug({ count: scores.length, usingProfiles: profiles.length > 0 }, 'Matcher scored listings');
    return { scores };
  } catch (err) {
    logger.error({ err }, 'Matcher error — retaining existing scores');
    return { scores: [] };
  }
}
