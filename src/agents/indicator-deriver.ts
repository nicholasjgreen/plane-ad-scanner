/**
 * Indicator Deriver Agent
 *
 * Single LLM call per listing — derives all 20 structured indicators from raw_attributes.
 * Never throws; returns { listingId, error } on any failure.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { IndicatorDeriverInput, IndicatorDeriverOutput, StructuredIndicators, Confidence } from '../types.js';
import { logger } from '../config.js';

// Registration prefix → country name mapping (deterministic; AI only for ambiguous/absent)
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

const BANDED_FIELDS = new Set(['typical_range', 'typical_cruise_speed', 'typical_fuel_burn', 'passenger_capacity']);

const ALL_FIELDS: Array<keyof StructuredIndicators> = [
  'avionics_type', 'autopilot_capability', 'ifr_approval', 'ifr_capability_level',
  'engine_state', 'smoh_hours', 'condition_band', 'airworthiness_basis',
  'aircraft_type_category', 'passenger_capacity', 'typical_range', 'typical_cruise_speed',
  'typical_fuel_burn', 'maintenance_cost_band', 'fuel_cost_band', 'maintenance_program',
  'registration_country', 'ownership_structure', 'hangar_situation', 'redundancy_level',
];

function isValidConfidence(v: unknown): v is Confidence {
  return v === 'High' || v === 'Medium' || v === 'Low';
}

// Normalise confidence: accept any capitalisation ("high" → "High"), numeric 0–1 (0.8 → "High"),
// or null/missing (→ "Low" as a safe default)
function normaliseConfidence(v: unknown): Confidence | unknown {
  if (v === null || v === undefined) return 'Low';
  if (typeof v === 'number') {
    if (v >= 0.8) return 'High';
    if (v >= 0.5) return 'Medium';
    return 'Low';
  }
  if (typeof v !== 'string') return v;
  const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  if (cap === 'High' || cap === 'Medium' || cap === 'Low') return cap as Confidence;
  return v;
}

// Normalise a value field: treat the string "Unknown" (any case) as null
function normaliseValue(v: unknown): unknown {
  if (typeof v === 'string' && v.toLowerCase() === 'unknown') return null;
  return v;
}

// Mutates parsed LLM output in-place to fix common model quirks before strict validation
function normaliseLlmResponse(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  for (const field of ALL_FIELDS) {
    const ind = obj[field];
    if (typeof ind !== 'object' || ind === null) {
      // Field entirely absent (or scalar) — insert a null placeholder with Low confidence
      obj[field] = BANDED_FIELDS.has(field)
        ? { value: null, band: null, confidence: 'Low' }
        : { value: null, confidence: 'Low' };
      continue;
    }
    const indObj = ind as Record<string, unknown>;
    indObj.confidence = normaliseConfidence(indObj.confidence);
    indObj.value = normaliseValue(indObj.value);
    if (BANDED_FIELDS.has(field) && !('band' in indObj)) {
      indObj.band = null;
    }
  }
  return raw;
}

function validateIndicators(raw: unknown, listingId: string): StructuredIndicators | null {
  if (typeof raw !== 'object' || raw === null) {
    logger.warn({ listingId, rawType: typeof raw }, 'Indicator deriver: response is not an object');
    return null;
  }
  const obj = raw as Record<string, unknown>;

  for (const field of ALL_FIELDS) {
    const ind = obj[field];
    if (typeof ind !== 'object' || ind === null) {
      logger.warn({ listingId, field, ind }, 'Indicator deriver: field missing or non-object');
      return null;
    }
    const indObj = ind as Record<string, unknown>;
    if (!isValidConfidence(indObj.confidence)) {
      logger.warn({ listingId, field, confidence: indObj.confidence }, 'Indicator deriver: invalid confidence value');
      return null;
    }
    if (indObj.value !== null && typeof indObj.value !== 'string' && typeof indObj.value !== 'number') {
      logger.warn({ listingId, field, valueType: typeof indObj.value, value: indObj.value }, 'Indicator deriver: invalid value type');
      return null;
    }
    if (BANDED_FIELDS.has(field)) {
      if (indObj.band !== null && typeof indObj.band !== 'string') {
        logger.warn({ listingId, field, band: indObj.band }, 'Indicator deriver: invalid band value');
        return null;
      }
    }
  }
  return raw as StructuredIndicators;
}

const SYSTEM_PROMPT = `You are an aviation expert who classifies aircraft listings into structured indicators.
Given an aircraft listing's details and raw attributes, return a single JSON object with exactly 20 fields.
Each field is an indicator value object. Unknown values use null (not the string "Unknown").

=== INDICATOR DEFINITIONS ===

aircraft_type_category: { value: "Single Piston"|"Twin Piston"|"Turboprop"|"Jet"|null, confidence }
avionics_type: { value: "Glass Cockpit"|"Hybrid"|"Steam Gauges"|null, confidence }
autopilot_capability: { value: "Modern Integrated"|"Basic"|"None"|null, confidence }
ifr_approval: { value: "VFR Only"|"IFR Equipped (Not Approved)"|"IFR Approved"|null, confidence }
  - IFR Approved: Standard type-cert aircraft WITH minimum IFR instruments (AI/AHRS + DG/HSI + altimeter + turn coordinator + IFR nav source)
  - IFR Equipped (Not Approved): Permit/Experimental aircraft with IFR instruments; OR standard-cat aircraft falling short of minimum IFR set
  - VFR Only: VFR-only equipment; microlight/ultralight; or explicitly stated VFR only
  - null: Equipment too sparse to determine

ifr_capability_level: { value: "Basic"|"Enhanced"|"Advanced"|"High-End"|null, confidence }
  - Basic: Steam gauges, single analogue VOR/ILS, no GPS or VFR-only GPS, no autopilot or wing-leveller
  - Enhanced: WAAS GPS (GNS 430W/530W, GTN 650/750, Avidyne IFD), moving map, 2-axis autopilot (KAP-140, S-TEC, GFC 500)
  - Advanced: Full glass (G1000, G3X Touch, Avidyne Entegra, Dynon SkyView certified), integrated autopilot with approach coupling (GFC 700, Avidyne DFC90), TAWS, ADS-B
  - High-End: Low workload design, VNAV, autothrottle, ESP, yaw damper (Garmin Perspective/G3000/G5000, Cirrus SR series with Perspective+)

engine_state: { value: "Green"|"Amber"|"Red"|null, confidence }
  - Green: Recently overhauled, plenty of life remaining (e.g. <200 hours since overhaul, or fresh engine)
  - Amber: Serviceable but overhaul due within a few years (e.g. mid-life, approaching TBO)
  - Red: Urgently needs overhaul (e.g. at or beyond TBO, known issues)

smoh_hours: { value: <number>|null, confidence }  -- numeric hours since major overhaul; display only, not scored

condition_band: { value: "Green"|"Amber"|"Red"|null, confidence }
  - Green: Excellent condition, recently refurbished
  - Amber: Good/acceptable condition, showing age
  - Red: Poor condition, requires significant work

airworthiness_basis: { value: "Type Certificated"|"Permit to Fly"|"Experimental"|null, confidence }

passenger_capacity: { value: <number>|null, band: "2 seats"|"3–4 seats"|"5–6 seats"|"7+ seats"|null, confidence }
  -- value: approximate seat count; band: derived category
  -- 2→"2 seats", 3-4→"3–4 seats", 5-6→"5–6 seats", 7+→"7+ seats"

typical_range: { value: <nm>|null, band: "Green"|"Amber"|"Red"|null, confidence }
  -- Infer from aircraft type knowledge. Green≥600nm, Amber 300-599nm, Red<300nm

typical_cruise_speed: { value: <kts>|null, band: "Green"|"Amber"|"Red"|null, confidence }
  -- Infer from aircraft type. Green≥140kts, Amber 90-139kts, Red<90kts

typical_fuel_burn: { value: <GPH>|null, band: "Green"|"Amber"|"Red"|null, confidence }
  -- Infer from aircraft type. Green≤10GPH, Amber 11-20GPH, Red>20GPH

maintenance_cost_band: { value: "Green"|"Amber"|"Red"|null, confidence }
  -- Overall maintenance cost estimate (Green=low, Red=high)

fuel_cost_band: { value: "Green"|"Amber"|"Red"|null, confidence }
  -- Running fuel cost (same banding as typical_fuel_burn)

maintenance_program: { value: <program name>|"None"|null, confidence }
  -- Named manufacturer programme only (e.g. "Cessna Care", "Cirrus SMP", "Diamond Care"); generic "maintained" = null

registration_country: { value: <country name>|null, confidence }
  -- Derive from registration prefix if present; otherwise infer from listing text

ownership_structure: { value: "Full Ownership"|"Partnership"|"Flying Club Share"|null, confidence }

hangar_situation: { value: "Hangared"|"T-Hangar"|"Tie-down"|null, confidence }

redundancy_level: { value: "High"|"Medium"|"Low"|null, confidence }
  -- High: twin-engine or extensive backup systems; Low: basic VFR single; Medium: otherwise

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object with all 20 fields. No markdown, no explanation.
Unknown = null (not the string "Unknown").
`;

export async function runIndicatorDeriver(
  input: IndicatorDeriverInput,
  anthropic: Anthropic,
  model: string
): Promise<IndicatorDeriverOutput> {
  const { listingId } = input;

  try {
    // Deterministic country derivation from registration prefix
    const derivedCountry = deriveCountryFromRegistration(input.registration);

    const userMessage = [
      `Aircraft: ${input.aircraftType ?? 'Unknown'} | Make: ${input.make ?? 'Unknown'} | Model: ${input.model ?? 'Unknown'}`,
      input.registration ? `Registration: ${input.registration}` : '',
      derivedCountry ? `(Registration country derived: ${derivedCountry})` : '',
      '',
      'Raw attributes:',
      JSON.stringify(input.rawAttributes, null, 2),
    ].filter(Boolean).join('\n');

    // Retry on 429 rate-limit errors using the retry-after header
    let response: Awaited<ReturnType<typeof anthropic.messages.create>>;
    {
      let attempt = 0;
      const maxRetries = 4;
      while (true) {
        try {
          response = await anthropic.messages.create({
            model,
            max_tokens: 3000,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
          });
          break;
        } catch (apiErr) {
          const status = (apiErr as { status?: number }).status;
          const headers = (apiErr as { headers?: Record<string, string> }).headers;
          if (status === 429 && attempt < maxRetries) {
            attempt++;
            const waitMs = Math.max((Number(headers?.['retry-after'] ?? 60)) * 1000, 1000);
            logger.warn({ listingId, attempt, waitMs }, 'Indicator deriver: rate limited, retrying');
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          } else {
            throw apiErr;
          }
        }
      }
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    // Extract JSON object from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { listingId, error: 'No JSON object found in LLM response' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { listingId, error: 'Failed to parse JSON from LLM response' };
    }

    const normalised = normaliseLlmResponse(parsed);
    const indicators = validateIndicators(normalised, listingId);
    if (!indicators) {
      return { listingId, error: 'LLM response failed schema validation (missing or invalid fields)' };
    }

    // Override registration_country with deterministic value if we derived it
    if (derivedCountry && (indicators.registration_country.value === null || indicators.registration_country.confidence !== 'High')) {
      indicators.registration_country = { value: derivedCountry, confidence: 'High' };
    }

    const populated = ALL_FIELDS.filter((f) => {
      const ind = indicators[f] as Record<string, unknown>;
      return ind.value !== null;
    }).length;

    logger.debug({ listingId, populated }, 'Indicator deriver: done');

    return { listingId, indicators };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ listingId, err: msg }, 'Indicator deriver: failed');
    return { listingId, error: msg };
  }
}
