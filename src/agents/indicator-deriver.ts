/**
 * Indicator Deriver Agent
 *
 * Uses three small focused LLM calls instead of one large one:
 *   1. Listing facts  — engine state, condition, ownership, hangar, maintenance program
 *   2. Avionics list  — extract equipment as a JSON array
 *   3. Avionics class — classify the list (type, autopilot, IFR equipped, IFR level)
 *
 * Performance/profile fields (seats, range, speed, fuel burn) are looked up
 * deterministically from aircraft-specs.ts. Never throws; returns { listingId, error }
 * on any failure.
 */
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { IndicatorDeriverInput, IndicatorDeriverOutput, StructuredIndicators, Confidence } from '../types.js';
import { logger } from '../config.js';
import { isCertifiedType } from '../data/certified-types.js';
import {
  lookupAircraftSpecs,
  rangeBand, cruiseBand, fuelBand, seatBand, maintenanceBand, redundancyFromType,
} from '../data/aircraft-specs.js';

// ---------------------------------------------------------------------------
// Registration → country (deterministic)
// ---------------------------------------------------------------------------

const REGISTRATION_COUNTRY: Record<string, string> = {
  'G-': 'United Kingdom',
  'N':  'United States',
  'D-': 'Germany',
  'F-': 'France',
  'I-': 'Italy',
  'EC-': 'Spain',
  'PH-': 'Netherlands',
  'OE-': 'Austria',
  'HB-': 'Switzerland',
  'OY-': 'Denmark',
  'SE-': 'Sweden',
  'OH-': 'Finland',
  'LN-': 'Norway',
  'SP-': 'Poland',
  'OK-': 'Czech Republic',
  'HA-': 'Hungary',
  'YR-': 'Romania',
  'LZ-': 'Bulgaria',
  'SX-': 'Greece',
  'CS-': 'Portugal',
  'EI-': 'Ireland',
  'VH-': 'Australia',
  'ZK-': 'New Zealand',
  'C-':  'Canada',
  'ZS-': 'South Africa',
  'JA':  'Japan',
};

function deriveCountryFromRegistration(registration: string | null | undefined): string | null {
  if (!registration) return null;
  const reg = registration.toUpperCase();
  for (const [prefix, country] of Object.entries(REGISTRATION_COUNTRY)) {
    if (reg.startsWith(prefix)) return country;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Confidence helpers
// ---------------------------------------------------------------------------

function normaliseConfidence(v: unknown): Confidence {
  if (v === null || v === undefined) return 'Low';
  if (typeof v === 'number') {
    if (v >= 0.8) return 'High';
    if (v >= 0.5) return 'Medium';
    return 'Low';
  }
  if (typeof v === 'string') {
    const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
    if (cap === 'High' || cap === 'Medium' || cap === 'Low') return cap as Confidence;
  }
  return 'Low';
}

function normaliseStringValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    if (v.toLowerCase() === 'unknown' || v.toLowerCase() === 'null' || v === '') return null;
    return v;
  }
  return null;
}

function normaliseNumberValue(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function ind(value: string | null, confidence: Confidence = 'High'): { value: string | null; confidence: Confidence } {
  return { value, confidence };
}

function nind(value: number | null, confidence: Confidence = 'High'): { value: number | null; confidence: Confidence } {
  return { value, confidence };
}

function banded(value: number | null, band: string | null, confidence: Confidence = 'High'): { value: number | null; band: string | null; confidence: Confidence } {
  return { value, band, confidence };
}

// ---------------------------------------------------------------------------
// Generic LLM call (Anthropic or Ollama)
// ---------------------------------------------------------------------------

async function callLlm(
  client: Anthropic | OpenAI,
  model: string,
  systemPrompt: string,
  userMessage: string,
  listingId: string,
): Promise<string> {
  if (client instanceof OpenAI) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.chat.completions.create as any)({
      model,
      max_tokens: 800,
      think: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `${userMessage}\n\n/no_think` },
      ],
    }) as OpenAI.Chat.ChatCompletion;
    return response.choices[0]?.message?.content ?? '';
  }

  // Anthropic — retry on 429
  let attempt = 0;
  while (true) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      return response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('');
    } catch (apiErr) {
      const status  = (apiErr as { status?: number }).status;
      const headers = (apiErr as { headers?: Record<string, string> }).headers;
      if (status === 429 && attempt < 4) {
        attempt++;
        const waitMs = Math.max((Number(headers?.['retry-after'] ?? 60)) * 1000, 1000);
        logger.warn({ listingId, attempt, waitMs }, 'Indicator deriver: rate limited, retrying');
        await new Promise(r => setTimeout(r, waitMs));
      } else {
        throw apiErr;
      }
    }
  }
}

function extractJson(text: string): unknown | null {
  // Strip qwen3-style thinking blocks and markdown code fences
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  // Find the outermost JSON array or object
  const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Call 1 — Listing facts
// ---------------------------------------------------------------------------

const LISTING_FACTS_SYSTEM = `You are an aviation listing parser. Extract structured facts from the listing.
Return ONLY a JSON object with these fields (unknown = null):

engine_state: "Green"|"Amber"|"Red"|null
  Green=recently overhauled/plenty of life; Amber=mid-life; Red=at/beyond TBO or known issues
smoh_hours: <number>|null  -- hours since last major overhaul (numeric only)
condition_band: "Green"|"Amber"|"Red"|null
  Green=excellent/recently refurbished; Amber=good/showing age; Red=poor/needs work
airworthiness_basis: "Type Certificated"|"Permit to Fly"|"Experimental"|null
  Type Certificated=standard CofA aircraft; Permit to Fly=LAA/BMAA/microlight permit; Experimental=amateur-built
ownership_structure: "Full Ownership"|"Partnership"|"Flying Club Share"|null
  Full=sole owner; Partnership=2–4 person syndicate/share; Flying Club Share=group/club with 5+ members or structured club
hangar_situation: "Hangared"|"T-Hangar"|"Tie-down"|null
  Hangared=enclosed hangar; T-Hangar=individual T-shaped hangar bay; Tie-down=outside/apron
maintenance_program: <named program>|"None"|null
  Named manufacturer programme only (e.g. "Cessna Care", "Cirrus SMP"); generic "well maintained" = null`;

interface ListingFacts {
  engine_state: string | null;
  smoh_hours: number | null;
  condition_band: string | null;
  airworthiness_basis: string | null;
  ownership_structure: string | null;
  hangar_situation: string | null;
  maintenance_program: string | null;
}

function parseListingFacts(raw: unknown): ListingFacts {
  const def: ListingFacts = {
    engine_state: null, smoh_hours: null, condition_band: null,
    airworthiness_basis: null, ownership_structure: null,
    hangar_situation: null, maintenance_program: null,
  };
  if (typeof raw !== 'object' || raw === null) return def;
  const obj = raw as Record<string, unknown>;
  return {
    engine_state:       normaliseStringValue(obj['engine_state']),
    smoh_hours:         normaliseNumberValue(obj['smoh_hours']),
    condition_band:     normaliseStringValue(obj['condition_band']),
    airworthiness_basis: normaliseStringValue(obj['airworthiness_basis']),
    ownership_structure: normaliseStringValue(obj['ownership_structure']),
    hangar_situation:   normaliseStringValue(obj['hangar_situation']),
    maintenance_program: normaliseStringValue(obj['maintenance_program']),
  };
}

// ---------------------------------------------------------------------------
// Call 2 — Avionics list extraction
// ---------------------------------------------------------------------------

const AVIONICS_LIST_SYSTEM = `Extract all avionics and instrument equipment from the aircraft listing.
Return ONLY a JSON array of strings, one item per piece of equipment.
Include: GPS/nav units, autopilot, EFIS/glass panel displays, transponder, ADS-B, comm radios, flight instruments (AI, HSI, etc.), weather, TAWS.
Exclude: physical airframe items, engine parts, seats, paint.
If nothing is mentioned, return an empty array [].
Example: ["Garmin GNS 430W", "KAP 140 autopilot", "Garmin GTX 345 ADS-B", "Avidyne MFD"]`;

function parseAvionicsList(raw: unknown): string[] {
  // Handle wrapped object: {"avionics": [...]} or {"equipment": [...]}
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const arr = obj['avionics'] ?? obj['equipment'] ?? obj['items'] ?? Object.values(obj)[0];
    if (Array.isArray(arr)) return parseAvionicsList(arr);
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(x => typeof x === 'string' && x.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Call 3 — Avionics classification
// ---------------------------------------------------------------------------

const AVIONICS_CLASS_SYSTEM = `You are an avionics expert. Classify this equipment list.
Return ONLY a JSON object with exactly these fields:

avionics_type: "Glass Cockpit"|"Hybrid"|"Steam Gauges"|null
  Glass Cockpit: fully integrated PFD+MFD replacing ALL primary instruments (G1000, Avidyne Entegra, Dynon SkyView HDX, Cirrus Perspective, G3X Touch).
  Hybrid: steam/analog primary instruments PLUS one or more digital nav/GPS boxes (GNS 430/530, GTN 650/750, IFD440). The AI and altimeter are still analog.
  Steam Gauges: all-analog instruments. VOR/ILS, ADF, transponder, or comms do NOT change this classification.

autopilot_capability: "Modern Integrated"|"Basic"|"None"|null
  Modern Integrated: full-featured with approach coupling (GFC 700, GFC 500, Avidyne DFC90, S-TEC 55X, KFC 150/225).
  Basic: simple wing-leveller or altitude hold only (S-Tec Thirty, KAP 100, Brittain).
  None: no autopilot.

ifr_avionics_equipped: "Equipped"|"Not Equipped"|null
  Equipped: full IFR panel (AI/AHRS + DI/HSI + altimeter + turn coordinator) AND at least one fixed nav source (VOR/ILS receiver or fixed GPS — not a handheld/portable).
  Not Equipped: missing required instruments OR nav source is portable only.

ifr_capability_level: "Basic"|"Enhanced"|"Advanced"|"High-End"|null
  Basic: steam gauges, analogue VOR/ILS, no WAAS GPS, no autopilot or wing-leveller only.
  Enhanced: WAAS GPS (GNS 430W/530W, GTN 650/750, IFD440/540) + moving map + 2-axis autopilot.
  Advanced: full glass cockpit + approach-coupled autopilot + ADS-B + TAWS (G1000/GFC700, Entegra/DFC90, SkyView).
  High-End: VNAV, ESP, yaw damper, autothrottle, low-workload design (Perspective+, G3000, G5000).

Confidence should reflect how clearly the equipment list supports the classification.`;

interface AvionicsClass {
  avionics_type: string | null;
  autopilot_capability: string | null;
  ifr_avionics_equipped: string | null;
  ifr_capability_level: string | null;
  confidence: Record<string, Confidence>;
}

function parseAvionicsClass(raw: unknown): AvionicsClass {
  const def: AvionicsClass = {
    avionics_type: null, autopilot_capability: null,
    ifr_avionics_equipped: null, ifr_capability_level: null,
    confidence: {},
  };
  if (typeof raw !== 'object' || raw === null) return def;
  const obj = raw as Record<string, unknown>;

  const fields = ['avionics_type', 'autopilot_capability', 'ifr_avionics_equipped', 'ifr_capability_level'] as const;
  const result: AvionicsClass = { ...def };
  for (const f of fields) {
    const entry = obj[f];
    if (typeof entry === 'object' && entry !== null) {
      const e = entry as Record<string, unknown>;
      result[f] = normaliseStringValue(e['value']);
      result.confidence[f] = normaliseConfidence(e['confidence']);
    } else {
      // Model returned raw string value directly
      result[f] = normaliseStringValue(entry);
      result.confidence[f] = 'Medium';
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// IFR approval post-processing
// ---------------------------------------------------------------------------

function computeIfrApproval(
  ifrEquipped: string | null,
  ifrEquippedConf: Confidence,
  certified: boolean,
  vfrOnly: boolean,
): { value: string | null; confidence: Confidence } {
  if (vfrOnly) return ind('VFR Only', 'High');
  if (ifrEquipped === 'Equipped') {
    return ind(certified ? 'IFR Approved' : 'IFR Equipped (Not Approved)', ifrEquippedConf);
  }
  if (ifrEquipped === 'Not Equipped') return ind('VFR Only', ifrEquippedConf);
  return ind(null, 'Low');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function runIndicatorDeriver(
  input: IndicatorDeriverInput,
  client: Anthropic | OpenAI,
  model: string,
): Promise<IndicatorDeriverOutput> {
  const { listingId } = input;

  try {
    // --- Deterministic phase ---
    const derivedCountry = deriveCountryFromRegistration(input.registration);
    const { certified, vfrOnly } = isCertifiedType(input.make, input.model);
    const specs = lookupAircraftSpecs(input.make, input.model);

    const listingContext = [
      `Aircraft: ${input.aircraftType ?? 'Unknown'} | Make: ${input.make ?? 'Unknown'} | Model: ${input.model ?? 'Unknown'}`,
      input.registration ? `Registration: ${input.registration}` : '',
      derivedCountry ? `(Country derived from registration: ${derivedCountry})` : '',
      '',
      'Raw attributes:',
      JSON.stringify(input.rawAttributes, null, 2),
    ].filter(Boolean).join('\n');

    // --- LLM Call 1: listing facts ---
    const factsText = await callLlm(client, model, LISTING_FACTS_SYSTEM, listingContext, listingId);
    const factsJson = extractJson(factsText);
    const facts = parseListingFacts(factsJson);

    // --- LLM Call 2: avionics list ---
    // Always include the full listingContext (key:value JSON of all attributes) so the LLM
    // never misses avionics details due to a non-standard attribute key name.
    // Prepend any long free-text attribute values (>100 chars) as readable prose first —
    // handles description/seller_notes/notes/avionics regardless of how the site labels them.
    const longTextValues = Object.values(input.rawAttributes)
      .filter((v): v is string => typeof v === 'string' && v.length > 100)
      .join('\n\n');
    const avionicsInput = longTextValues
      ? `${longTextValues}\n\n${listingContext}`
      : listingContext;
    const avListText = await callLlm(client, model, AVIONICS_LIST_SYSTEM, avionicsInput, listingId);
    const avListJson = extractJson(avListText);
    const avionicsList = parseAvionicsList(avListJson);

    // --- LLM Call 3: avionics classification (skip if list is empty) ---
    let avClass: AvionicsClass = {
      avionics_type: null, autopilot_capability: null,
      ifr_avionics_equipped: null, ifr_capability_level: null,
      confidence: {},
    };
    if (avionicsList.length > 0) {
      const avClassText = await callLlm(
        client, model, AVIONICS_CLASS_SYSTEM,
        `Equipment list:\n${JSON.stringify(avionicsList, null, 2)}`,
        listingId,
      );
      const avClassJson = extractJson(avClassText);
      avClass = parseAvionicsClass(avClassJson);
    }

    const ifrEquippedConf = avClass.confidence['ifr_avionics_equipped'] ?? 'Low';

    // --- Assemble indicators ---
    const indicators: StructuredIndicators = {
      // Avionics (from LLM Call 3)
      avionics_type:       ind(avClass.avionics_type,       avClass.confidence['avionics_type'] ?? 'Low'),
      autopilot_capability: ind(avClass.autopilot_capability, avClass.confidence['autopilot_capability'] ?? 'Low'),
      ifr_approval:        computeIfrApproval(avClass.ifr_avionics_equipped, ifrEquippedConf, certified, vfrOnly),
      ifr_capability_level: ind(avClass.ifr_capability_level, avClass.confidence['ifr_capability_level'] ?? 'Low'),

      // Engine & airworthiness (from LLM Call 1)
      engine_state:        ind(facts.engine_state,        facts.engine_state        ? 'High' : 'Low'),
      smoh_hours:          nind(facts.smoh_hours, facts.smoh_hours !== null ? 'High' : 'Low'),
      condition_band:      ind(facts.condition_band,      facts.condition_band      ? 'High' : 'Low'),
      airworthiness_basis: ind(facts.airworthiness_basis, facts.airworthiness_basis ? 'High' : 'Low'),

      // Aircraft profile (deterministic from specs table)
      aircraft_type_category: specs
        ? ind(specs.typeCategory, 'High')
        : ind(null, 'Low'),
      passenger_capacity: specs
        ? banded(specs.seats, seatBand(specs.seats), 'High')
        : banded(null, null, 'Low'),
      typical_range: specs
        ? banded(specs.rangeNm, rangeBand(specs.rangeNm), 'High')
        : banded(null, null, 'Low'),
      typical_cruise_speed: specs
        ? banded(specs.cruiseKts, cruiseBand(specs.cruiseKts), 'High')
        : banded(null, null, 'Low'),
      typical_fuel_burn: specs
        ? banded(specs.fuelBurnGph, fuelBand(specs.fuelBurnGph), 'High')
        : banded(null, null, 'Low'),

      // Costs (deterministic from specs)
      maintenance_cost_band: specs
        ? ind(maintenanceBand(specs.typeCategory), 'High')
        : ind(null, 'Low'),
      fuel_cost_band: specs
        ? ind(fuelBand(specs.fuelBurnGph), 'High')
        : ind(null, 'Low'),

      // Provenance (from LLM Call 1)
      maintenance_program: ind(facts.maintenance_program, facts.maintenance_program ? 'High' : 'Low'),
      registration_country: ind(
        derivedCountry ?? null,
        derivedCountry ? 'High' : 'Low',
      ),
      ownership_structure: ind(facts.ownership_structure, facts.ownership_structure ? 'High' : 'Low'),
      hangar_situation:    ind(facts.hangar_situation,    facts.hangar_situation    ? 'High' : 'Low'),

      // Redundancy (deterministic from specs)
      redundancy_level: specs
        ? ind(redundancyFromType(specs.typeCategory), 'High')
        : ind(null, 'Low'),
    };

    // Override registration_country with any LLM-derived country if prefix lookup was empty
    // (already handled above — derivedCountry takes priority)

    const populated = Object.values(indicators)
      .filter(v => typeof v === 'object' && v !== null && (v as Record<string, unknown>).value !== null)
      .length;

    logger.debug({ listingId, populated, certified, avionics: avionicsList.length, ifrApproval: indicators.ifr_approval.value }, 'Indicator deriver: done');

    return { listingId, indicators };

  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ listingId, err: msg }, 'Indicator deriver: failed');
    return { listingId, error: msg };
  }
}
