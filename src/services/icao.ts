// ICAO airport lookup, haversine distance, and proximity scoring.
// Loads data/airports.csv once at module load into a Map for O(1) lookups.
// Resolved entries can be cached to airfield_locations via cacheAirfield().

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

interface AirportEntry {
  name: string;
  lat: number;
  lon: number;
}

// Lazy-loaded airport map: ICAO code (upper) → AirportEntry
let airportMap: Map<string, AirportEntry> | null = null;

function loadAirports(): Map<string, AirportEntry> {
  if (airportMap) return airportMap;

  const csvPath = join(process.cwd(), 'data', 'airports.csv');
  const raw = readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n');

  // Parse header to find column indices
  const header = lines[0].split(',');
  const colIndex = (name: string) => header.findIndex((h) => h.trim().replace(/^"|"$/g, '') === name);
  const icaoIdx = colIndex('gps_code');
  const nameIdx = colIndex('name');
  const latIdx = colIndex('latitude_deg');
  const lonIdx = colIndex('longitude_deg');

  const map = new Map<string, AirportEntry>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvRow(line);
    const icao = cols[icaoIdx]?.trim().toUpperCase();
    if (!icao || icao.length < 3) continue;

    const lat = parseFloat(cols[latIdx] ?? '');
    const lon = parseFloat(cols[lonIdx] ?? '');
    if (isNaN(lat) || isNaN(lon)) continue;

    const name = cols[nameIdx]?.trim() ?? icao;
    map.set(icao, { name, lat, lon });
  }

  airportMap = map;
  return map;
}

/** Minimal CSV row parser that handles double-quoted fields */
function parseCsvRow(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

/**
 * Haversine great-circle distance in km between two lat/lon points.
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Resolve an ICAO code to its airport entry.
 * Returns null if code is unknown or empty.
 */
export function resolveIcao(code: string | null): AirportEntry | null {
  if (!code) return null;
  const map = loadAirports();
  return map.get(code.toUpperCase()) ?? null;
}

/**
 * Compute a 0–100 proximity score for a listing at `icaoCode`.
 * - Returns 0 with explanatory note when listing is full_ownership, icao unknown, or home is NaN.
 * - Linear decay from 100 (at 0 km) to 0 (at maxDistanceKm). Beyond max = 0.
 * - When `db` is provided, resolved airports are upserted into airfield_locations cache.
 */
export function proximityScore(
  icaoCode: string | null,
  listingType: string,
  homeLat: number,
  homeLon: number,
  maxDistanceKm: number,
  db?: Database.Database
): { score: number; note: string } {
  if (listingType === 'full_ownership') {
    return { score: 0, note: 'proximity only applies to share listings (full_ownership excluded)' };
  }

  if (isNaN(homeLat) || isNaN(homeLon)) {
    return { score: 0, note: 'home_location not configured' };
  }

  const airport = resolveIcao(icaoCode);
  if (!airport) {
    return { score: 0, note: `ICAO code ${icaoCode ?? '(none)'} unknown — cannot compute distance` };
  }

  // Cache resolved airport in DB if provided
  if (db && icaoCode) {
    cacheAirfield(db, icaoCode, airport.name, airport.lat, airport.lon);
  }

  const distKm = haversineKm(homeLat, homeLon, airport.lat, airport.lon);

  if (distKm >= maxDistanceKm) {
    return {
      score: 0,
      note: `${airport.name} (${icaoCode}) is ${distKm.toFixed(0)} km away — beyond ${maxDistanceKm} km limit`,
    };
  }

  const score = Math.round(100 * (1 - distKm / maxDistanceKm));
  return {
    score,
    note: `${airport.name} (${icaoCode}) is ${distKm.toFixed(0)} km from home`,
  };
}

/**
 * Upsert an airport entry into the airfield_locations DB cache.
 * No-op if icaoCode is null/empty.
 */
export function cacheAirfield(
  db: Database.Database,
  icaoCode: string,
  name: string,
  lat: number,
  lon: number
): void {
  if (!icaoCode) return;
  db.prepare(
    `INSERT INTO airfield_locations (icao_code, name, lat, lon)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(icao_code) DO UPDATE SET name = excluded.name, lat = excluded.lat, lon = excluded.lon`
  ).run(icaoCode.toUpperCase(), name, lat, lon);
}
