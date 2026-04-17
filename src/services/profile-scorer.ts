// Profile-based listing scorer.
// Pure function — no I/O, no side effects.

import type Database from 'better-sqlite3';
import type { ListingForScoring, InterestProfile, ProfileCriterion, ProfileScore, EvidenceItem, StructuredIndicators } from '../types.js';
import type { MissionTypeResult } from './mission-type-evaluator.js';
import { proximityScore } from './icao.js';

// ---------------------------------------------------------------------------
// Criterion evaluation
// ---------------------------------------------------------------------------

interface CriterionResult {
  matched: boolean;
  note: string;
  /** For proximity: 0–100 fractional contribution within the criterion */
  partialScore?: number;
  confidence: 'high' | 'medium' | 'low' | null;
}

interface EvalContext {
  homeLat?: number;
  homeLon?: number;
  db?: Database.Database;
  /** Pre-evaluated mission_type results keyed by criterion intent string */
  missionTypeOverrides?: Map<string, MissionTypeResult>;
  /** Structured indicators for this listing (from listing_indicators table) */
  indicators?: StructuredIndicators | null;
}

function evalCriterion(listing: ListingForScoring, crit: ProfileCriterion, ctx: EvalContext = {}): CriterionResult {
  switch (crit.type) {
    case 'make_model': {
      const make = crit.make ?? null;
      const model = crit.model ?? null;
      const makeOk =
        make === null ||
        listing.make?.toLowerCase() === make.toLowerCase() ||
        (listing.aircraftType?.toLowerCase().includes(make.toLowerCase()) ?? false);
      const modelOk =
        model === null ||
        model === '*' ||
        listing.model?.toLowerCase() === model.toLowerCase();
      const matched = makeOk && modelOk;
      return {
        matched,
        note: matched
          ? `Make/model matches ${make ?? '(any)'}/${model ?? '(any)'}`
          : `Make/model does not match ${make ?? '(any)'}/${model ?? '(any)'}`,
        confidence: null,
      };
    }

    case 'price_range': {
      if (listing.price === null) {
        return { matched: false, note: 'Price not listed', confidence: null };
      }
      const min = crit.min ?? 0;
      const max = crit.max ?? Infinity;
      const matched = listing.price >= min && listing.price <= max;
      return {
        matched,
        note: matched
          ? `Price ${listing.price} is within ${min}–${max}`
          : `Price ${listing.price} is outside ${min}–${max}`,
        confidence: null,
      };
    }

    case 'year_range': {
      if (listing.year === null) {
        return { matched: false, note: 'Year not listed', confidence: null };
      }
      const yearMin = crit.yearMin ?? 0;
      const yearMax = crit.yearMax ?? 9999;
      const matched = listing.year >= yearMin && listing.year <= yearMax;
      return {
        matched,
        note: matched
          ? `Year ${listing.year} is within ${yearMin}–${yearMax}`
          : `Year ${listing.year} is outside ${yearMin}–${yearMax}`,
        confidence: null,
      };
    }

    case 'listing_type': {
      if (crit.listingType === 'any') {
        return { matched: true, note: 'Any listing type accepted', confidence: null };
      }
      const lt = listing.listingType ?? 'full_ownership'; // default: full ownership
      const matched = lt === crit.listingType;
      return {
        matched,
        note: matched
          ? `Listing type is ${crit.listingType}`
          : `Listing type is ${lt}, criterion requires ${crit.listingType}`,
        confidence: null,
      };
    }

    case 'proximity': {
      const homeLat = ctx.homeLat ?? NaN;
      const homeLon = ctx.homeLon ?? NaN;
      const result = proximityScore(
        listing.icaoCode ?? null,
        listing.listingType ?? 'full_ownership',
        homeLat,
        homeLon,
        crit.maxDistanceKm ?? 100,
        ctx.db
      );
      // Treat as matched if score > 0
      return {
        matched: result.score > 0,
        partialScore: result.score,
        note: result.note,
        confidence: null,
      };
    }

    case 'mission_type': {
      const override = crit.intent ? ctx.missionTypeOverrides?.get(crit.intent) : undefined;
      if (override) {
        return {
          matched: override.matched,
          note: override.note ?? '',
          confidence: override.confidence,
        };
      }
      return {
        matched: false,
        note: `Mission type "${crit.intent}" requires AI evaluation — not yet implemented`,
        confidence: null,
      };
    }

    case 'indicator': {
      // smoh_hours is display-only — not valid as a scoring criterion
      if (crit.indicatorField === 'smoh_hours') {
        return { matched: false, note: 'Indicator criterion misconfigured: smoh_hours is display-only', confidence: null };
      }
      if (!ctx.indicators || !crit.indicatorField || !crit.indicatorValue) {
        return { matched: false, note: 'Indicator criterion misconfigured or no indicators available', confidence: null };
      }
      const ind = (ctx.indicators as unknown as Record<string, { value: unknown; band?: unknown; confidence: string } | undefined>)[crit.indicatorField];
      if (!ind) {
        return { matched: false, note: `Indicator '${crit.indicatorField}' not derived`, confidence: 'low' };
      }
      // Banded numeric fields: match against band; all others: match against value
      const BANDED = new Set(['typical_range', 'typical_cruise_speed', 'typical_fuel_burn', 'passenger_capacity']);
      const actual = BANDED.has(crit.indicatorField) ? ind.band : ind.value;
      if (actual === null || actual === undefined) {
        return { matched: false, note: `${crit.indicatorField} is Unknown`, confidence: 'low' };
      }
      const matched = String(actual) === crit.indicatorValue;
      // Confidence multiplier: High=1.0, Medium=0.75, Low=0.5
      const multiplier = ind.confidence === 'High' ? 1.0 : ind.confidence === 'Medium' ? 0.75 : 0.5;
      const confKey = ind.confidence.toLowerCase() as 'high' | 'medium' | 'low';
      return {
        matched,
        note: matched
          ? `${crit.indicatorField} is ${String(actual)} (confidence: ${ind.confidence})`
          : `${crit.indicatorField} is ${String(actual)}, expected ${crit.indicatorValue}`,
        confidence: confKey,
        partialScore: matched ? multiplier * 100 : 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Profile scorer
// ---------------------------------------------------------------------------

function scoreAgainstProfile(
  listing: ListingForScoring,
  profile: InterestProfile,
  ctx: EvalContext = {}
): ProfileScore {
  const totalWeight = profile.criteria.reduce((s, c) => s + c.weight, 0);

  const evidence: EvidenceItem[] = profile.criteria.map((crit, i) => {
    const result = evalCriterion(listing, crit, ctx);
    // Contribution = (effectiveFraction) * (crit.weight / totalWeight) * 100
    // Binary criteria: fraction is 1 if matched, 0 if not.
    // Proximity: fraction is partialScore / 100.
    const fraction =
      result.partialScore !== undefined ? result.partialScore / 100 : result.matched ? 1 : 0;
    const contribution =
      totalWeight === 0 ? 0 : Math.round((fraction * crit.weight / totalWeight) * 1000) / 10;
    return {
      criterionName: criterionName(crit, i),
      matched: result.matched,
      contribution,
      note: result.note,
      confidence: result.confidence,
    };
  });

  // Score = sum of contributions (each already scaled to 0–100 range)
  const score =
    totalWeight === 0 ? 0 : Math.round(evidence.reduce((s, e) => s + e.contribution, 0) * 10) / 10;

  return { profileName: profile.name, score, evidence };
}

function criterionName(crit: ProfileCriterion, index: number): string {
  switch (crit.type) {
    case 'make_model': return `Make/Model: ${crit.make ?? '*'}/${crit.model ?? '*'}`;
    case 'price_range': return `Price range ${crit.min ?? 0}–${crit.max}`;
    case 'year_range':  return `Year range ${crit.yearMin}–${crit.yearMax}`;
    case 'listing_type': return `Listing type: ${crit.listingType}`;
    case 'proximity': return `Within ${crit.maxDistanceKm} km of home`;
    case 'mission_type': return crit.intent ?? `Mission type #${index + 1}`;
    case 'indicator': return `Indicator: ${crit.indicatorField ?? '?'} = ${crit.indicatorValue ?? '?'}`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProfileScoringResult {
  overallScore: number;        // Weighted average across active profiles; 0–100
  profileScores: ProfileScore[]; // One entry per active profile
}

/**
 * Score a listing against all active (weight > 0) profiles.
 * Returns overallScore = 0 if all profiles fail their min_score threshold.
 * Pass homeLocation when proximity criteria are present.
 */
export function scoreListingAgainstProfiles(
  listing: ListingForScoring,
  profiles: InterestProfile[],
  homeLocation?: { lat: number; lon: number } | null,
  db?: Database.Database,
  missionTypeOverrides?: Map<string, MissionTypeResult>,
  indicators?: StructuredIndicators | null
): ProfileScoringResult {
  const activeProfiles = profiles.filter((p) => p.weight > 0);
  if (activeProfiles.length === 0) {
    return { overallScore: 0, profileScores: [] };
  }

  const ctx: EvalContext = {
    ...(homeLocation ? { homeLat: homeLocation.lat, homeLon: homeLocation.lon } : {}),
    db,
    missionTypeOverrides,
    indicators,
  };

  const profileScores = activeProfiles.map((p) => scoreAgainstProfile(listing, p, ctx));

  // Check min_score: exclude listing from overall score only if it fails ALL profiles' floors
  const anyMeetsFloor = activeProfiles.some(
    (p, i) => profileScores[i].score >= p.min_score
  );
  if (!anyMeetsFloor) {
    return { overallScore: 0, profileScores };
  }

  // Weighted average of profile scores (by profile-level weight)
  const totalProfileWeight = activeProfiles.reduce((s, p) => s + p.weight, 0);
  const weightedSum = activeProfiles.reduce(
    (s, p, i) => s + profileScores[i].score * p.weight,
    0
  );

  const overallScore = Math.round((weightedSum / totalProfileWeight) * 10) / 10;
  return { overallScore, profileScores };
}
