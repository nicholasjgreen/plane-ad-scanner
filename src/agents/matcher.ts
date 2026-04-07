import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { ListingForScoring, MatcherOutput, InterestProfile } from '../types.js';
import type { Criterion } from '../config.js';
import { scoreListing } from '../services/scoring.js';
import { scoreListingAgainstProfiles } from '../services/profile-scorer.js';
import { evaluateMissionType, type MissionTypeResult } from '../services/mission-type-evaluator.js';
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
  const del = db.prepare(`DELETE FROM listing_scores WHERE listing_id = ?`);
  const insert = db.prepare(
    `INSERT INTO listing_scores (id, listing_id, profile_name, score, evidence, scored_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction(() => {
    del.run(listingId);
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
  homeLocation?: { lat: number; lon: number } | null,
  scoringClient?: Anthropic | OpenAI | null,
  scoringModel?: string | null
): Promise<MatcherOutput> {
  try {
    const scoredAt = new Date().toISOString();

    // Collect all unique mission_type criterion intents across all active profiles
    const missionIntents = profiles.length > 0
      ? [...new Set(
          profiles
            .filter((p) => p.weight > 0)
            .flatMap((p) => p.criteria)
            .filter((c) => c.type === 'mission_type')
            .map((c) => (c as { intent: string }).intent)
        )]
      : [];

    if (missionIntents.length > 0) {
      logger.debug({ intents: missionIntents, hasClient: !!scoringClient }, 'mission_type criteria found');
    }

    const scores: Array<{ listingId: string; score: number }> = [];

    for (const listing of listings) {
      if (profiles.length > 0) {
        // Pre-evaluate mission_type criteria for this listing
        let missionTypeOverrides: Map<string, MissionTypeResult> | undefined;
        if (missionIntents.length > 0 && scoringClient && scoringModel) {
          missionTypeOverrides = new Map();
          for (const intent of missionIntents) {
            const criterion = profiles
              .flatMap((p) => p.criteria)
              .find((c) => c.type === 'mission_type' && (c as { intent: string }).intent === intent);
            if (criterion) {
              const result = await evaluateMissionType(listing, criterion as { intent: string; sub_criteria?: string[] }, scoringClient, scoringModel);
              missionTypeOverrides.set(intent, result);
            }
          }
        }

        const { overallScore, profileScores } = scoreListingAgainstProfiles(
          listing,
          profiles,
          homeLocation,
          db,
          missionTypeOverrides
        );
        if (db) {
          persistProfileScores(db, listing.id, profileScores, scoredAt);
        }
        scores.push({ listingId: listing.id, score: overallScore });
      } else {
        // Fallback: legacy criteria-based scoring (feature 001 compatibility)
        scores.push({ listingId: listing.id, score: scoreListing(listing, criteria) });
      }
    }

    logger.debug({ count: scores.length, usingProfiles: profiles.length > 0 }, 'Matcher scored listings');
    return { scores };
  } catch (err) {
    logger.error({ err }, 'Matcher error — retaining existing scores');
    return { scores: [] };
  }
}
