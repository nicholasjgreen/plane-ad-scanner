/**
 * Aircraft performance and profile lookup.
 *
 * Deterministic alternative to asking an LLM for well-known aircraft specs.
 * Values are typical/representative — not worst-case or best-case.
 *
 * Banding applied downstream:
 *   range: Green ≥600nm, Amber 300-599nm, Red <300nm
 *   cruise: Green ≥140kts, Amber 90-139kts, Red <90kts
 *   fuel:   Green ≤10gph,  Amber 11-20gph,  Red >20gph
 *   seats:  2→"2 seats", 3-4→"3–4 seats", 5-6→"5–6 seats", 7+→"7+ seats"
 */

export type TypeCategory = 'Single Piston' | 'Twin Piston' | 'Turboprop' | 'Jet';

export interface AircraftSpecs {
  typeCategory: TypeCategory;
  seats: number;
  rangeNm: number;
  cruiseKts: number;
  fuelBurnGph: number;   // US gallons per hour
}

interface SpecsEntry {
  makePatterns: string[];
  modelPatterns?: string[];
  specs: AircraftSpecs;
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const SPECS_TABLE: SpecsEntry[] = [
  // --- Cessna singles ---
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['150', '152', 'aerobat'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 400,  cruiseKts: 100, fuelBurnGph: 6  } },
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['172', 'skyhawk', 'f172', 'fr172'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 700,  cruiseKts: 122, fuelBurnGph: 8  } },
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['177', 'cardinal'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 750,  cruiseKts: 128, fuelBurnGph: 9  } },
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['182', 'skylane'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 950,  cruiseKts: 145, fuelBurnGph: 12 } },
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['185', '180'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 800,  cruiseKts: 140, fuelBurnGph: 12 } },
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['206', 'stationair', 'super skymaster'],
    specs: { typeCategory: 'Single Piston', seats: 6, rangeNm: 850,  cruiseKts: 145, fuelBurnGph: 15 } },
  { makePatterns: ['cessna', 'reims'], modelPatterns: ['210', 'centurion'],
    specs: { typeCategory: 'Single Piston', seats: 6, rangeNm: 1100, cruiseKts: 180, fuelBurnGph: 16 } },
  { makePatterns: ['cessna'], modelPatterns: ['208', 'caravan'],
    specs: { typeCategory: 'Turboprop',     seats: 9, rangeNm: 1200, cruiseKts: 185, fuelBurnGph: 53 } },

  // --- Cessna twins ---
  { makePatterns: ['cessna'], modelPatterns: ['310', '320', '340', '402', '404', '421', '337', 'skymaster'],
    specs: { typeCategory: 'Twin Piston',   seats: 6, rangeNm: 1100, cruiseKts: 195, fuelBurnGph: 25 } },

  // --- Piper singles ---
  { makePatterns: ['piper'], modelPatterns: ['j3', 'j-3', 'cub'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 200,  cruiseKts: 75,  fuelBurnGph: 4  } },
  { makePatterns: ['piper'], modelPatterns: ['pa18', 'pa-18', 'super cub'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 400,  cruiseKts: 95,  fuelBurnGph: 7  } },
  { makePatterns: ['piper'], modelPatterns: ['pa28', 'pa-28', 'cherokee', 'warrior', 'archer', 'arrow'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 700,  cruiseKts: 130, fuelBurnGph: 9  } },
  { makePatterns: ['piper'], modelPatterns: ['pa32', 'pa-32', 'saratoga', 'lance', 'six', 'cherokee six'],
    specs: { typeCategory: 'Single Piston', seats: 6, rangeNm: 900,  cruiseKts: 155, fuelBurnGph: 14 } },
  { makePatterns: ['piper'], modelPatterns: ['pa46', 'pa-46', 'malibu', 'mirage', 'matrix'],
    specs: { typeCategory: 'Single Piston', seats: 6, rangeNm: 1300, cruiseKts: 215, fuelBurnGph: 18 } },

  // --- Piper twins ---
  { makePatterns: ['piper'], modelPatterns: ['pa34', 'pa-34', 'seneca'],
    specs: { typeCategory: 'Twin Piston',   seats: 6, rangeNm: 850,  cruiseKts: 175, fuelBurnGph: 22 } },
  { makePatterns: ['piper'], modelPatterns: ['pa44', 'pa-44', 'seminole'],
    specs: { typeCategory: 'Twin Piston',   seats: 4, rangeNm: 900,  cruiseKts: 160, fuelBurnGph: 18 } },
  { makePatterns: ['piper'], modelPatterns: ['pa23', 'pa-23', 'aztec', 'apache'],
    specs: { typeCategory: 'Twin Piston',   seats: 6, rangeNm: 900,  cruiseKts: 175, fuelBurnGph: 22 } },

  // --- Beechcraft ---
  { makePatterns: ['beech', 'beechcraft', 'raytheon'], modelPatterns: ['35', 'bonanza', 'debonair'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 1000, cruiseKts: 175, fuelBurnGph: 14 } },
  { makePatterns: ['beech', 'beechcraft', 'raytheon'], modelPatterns: ['36', 'bonanza 36'],
    specs: { typeCategory: 'Single Piston', seats: 6, rangeNm: 950,  cruiseKts: 174, fuelBurnGph: 15 } },
  { makePatterns: ['beech', 'beechcraft', 'raytheon'], modelPatterns: ['33', 'debonair'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 850,  cruiseKts: 165, fuelBurnGph: 13 } },
  { makePatterns: ['beech', 'beechcraft', 'raytheon'], modelPatterns: ['55', '56', '58', 'baron'],
    specs: { typeCategory: 'Twin Piston',   seats: 5, rangeNm: 1100, cruiseKts: 190, fuelBurnGph: 24 } },
  { makePatterns: ['beech', 'beechcraft', 'raytheon'], modelPatterns: ['76', 'duchess'],
    specs: { typeCategory: 'Twin Piston',   seats: 4, rangeNm: 800,  cruiseKts: 160, fuelBurnGph: 18 } },
  { makePatterns: ['beech', 'beechcraft', 'raytheon'], modelPatterns: ['c90', 'b200', 'king air', '1900'],
    specs: { typeCategory: 'Turboprop',     seats: 9, rangeNm: 1700, cruiseKts: 285, fuelBurnGph: 80 } },

  // --- Robin ---
  { makePatterns: ['robin', 'avions robin'], modelPatterns: ['dr400', 'dr-400', 'dr 400', 'dr401', 'dr500', 'regent', 'dauphin', 'remorqueur'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 750,  cruiseKts: 130, fuelBurnGph: 9  } },
  { makePatterns: ['robin', 'avions robin'], modelPatterns: ['hr200', 'hr-200', 'r2160'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 500,  cruiseKts: 115, fuelBurnGph: 7  } },

  // --- SOCATA / TBM ---
  { makePatterns: ['socata', 'aerospatiale', 'aérospatiale'], modelPatterns: ['tb9', 'tb-9', 'tampico'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 700,  cruiseKts: 125, fuelBurnGph: 8  } },
  { makePatterns: ['socata', 'aerospatiale', 'aérospatiale'], modelPatterns: ['tb10', 'tb-10', 'tobago'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 800,  cruiseKts: 135, fuelBurnGph: 10 } },
  { makePatterns: ['socata', 'aerospatiale', 'aérospatiale'], modelPatterns: ['tb20', 'tb-20', 'trinidad'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 1100, cruiseKts: 170, fuelBurnGph: 13 } },
  { makePatterns: ['socata', 'aerospatiale', 'aérospatiale'], modelPatterns: ['tb21', 'tb-21'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 1200, cruiseKts: 190, fuelBurnGph: 14 } },
  { makePatterns: ['daher', 'socata', 'tbm'], modelPatterns: ['tbm700', 'tbm850', 'tbm900', 'tbm930', 'tbm960', 'tbm 700', 'tbm 850', 'tbm 900', 'tbm 930', 'tbm 960'],
    specs: { typeCategory: 'Turboprop',     seats: 6, rangeNm: 1700, cruiseKts: 330, fuelBurnGph: 66 } },

  // --- Diamond ---
  { makePatterns: ['diamond'], modelPatterns: ['da20', 'da-20', 'katana'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 550,  cruiseKts: 108, fuelBurnGph: 5  } },
  { makePatterns: ['diamond'], modelPatterns: ['da40', 'da-40', 'star'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 900,  cruiseKts: 147, fuelBurnGph: 9  } },
  { makePatterns: ['diamond'], modelPatterns: ['da42', 'da-42', 'twin star'],
    specs: { typeCategory: 'Twin Piston',   seats: 4, rangeNm: 1200, cruiseKts: 175, fuelBurnGph: 13 } },
  { makePatterns: ['diamond'], modelPatterns: ['da62', 'da-62'],
    specs: { typeCategory: 'Twin Piston',   seats: 7, rangeNm: 1500, cruiseKts: 180, fuelBurnGph: 14 } },

  // --- Cirrus ---
  { makePatterns: ['cirrus'], modelPatterns: ['sr20', 'sr-20'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 700,  cruiseKts: 155, fuelBurnGph: 10 } },
  { makePatterns: ['cirrus'], modelPatterns: ['sr22', 'sr-22'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 1000, cruiseKts: 183, fuelBurnGph: 17 } },
  { makePatterns: ['cirrus'], modelPatterns: ['sf50', 'vision jet'],
    specs: { typeCategory: 'Jet',           seats: 5, rangeNm: 1200, cruiseKts: 300, fuelBurnGph: 60 } },

  // --- Mooney ---
  { makePatterns: ['mooney'], modelPatterns: ['m20', 'm-20'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 1100, cruiseKts: 175, fuelBurnGph: 11 } },

  // --- Tecnam ---
  { makePatterns: ['tecnam'], modelPatterns: ['p2002'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 500,  cruiseKts: 110, fuelBurnGph: 5  } },
  { makePatterns: ['tecnam'], modelPatterns: ['p2004', 'p2006', 'p2008', 'p2010'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 700,  cruiseKts: 125, fuelBurnGph: 7  } },
  { makePatterns: ['tecnam'], modelPatterns: ['p2012', 'traveller'],
    specs: { typeCategory: 'Twin Piston',   seats: 9, rangeNm: 1000, cruiseKts: 175, fuelBurnGph: 25 } },

  // --- Grob ---
  { makePatterns: ['grob'], modelPatterns: ['g115', 'g-115'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 500,  cruiseKts: 115, fuelBurnGph: 6  } },
  { makePatterns: ['grob'], modelPatterns: ['g120', 'g-120'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 600,  cruiseKts: 140, fuelBurnGph: 8  } },

  // --- Van's RV (experimental/LAA, not certified) ---
  { makePatterns: ['vans', "van's", 'van\'s aircraft'], modelPatterns: ['rv-3', 'rv3', 'rv-4', 'rv4', 'rv-6', 'rv6', 'rv-7', 'rv7', 'rv-8', 'rv8'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 700,  cruiseKts: 170, fuelBurnGph: 8  } },
  { makePatterns: ['vans', "van's", 'van\'s aircraft'], modelPatterns: ['rv-9', 'rv9', 'rv-12', 'rv12'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 700,  cruiseKts: 140, fuelBurnGph: 7  } },
  { makePatterns: ['vans', "van's", 'van\'s aircraft'], modelPatterns: ['rv-10', 'rv10', 'rv-14', 'rv14'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 900,  cruiseKts: 170, fuelBurnGph: 10 } },

  // --- Microlights / LSA ---
  { makePatterns: ['comco', 'ikarus', 'comco ikarus'], modelPatterns: ['c42'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 300,  cruiseKts: 90,  fuelBurnGph: 3  } },
  { makePatterns: ['rans'], modelPatterns: ['s-6', 's6', 's-7', 's7'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 300,  cruiseKts: 85,  fuelBurnGph: 4  } },

  // --- Slingsby ---
  { makePatterns: ['slingsby'], modelPatterns: ['t67', 't-67', 'firefly'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 500,  cruiseKts: 130, fuelBurnGph: 7  } },

  // --- Partenavia / Vulcanair ---
  { makePatterns: ['partenavia', 'vulcanair'], modelPatterns: ['p68', 'p-68'],
    specs: { typeCategory: 'Twin Piston',   seats: 6, rangeNm: 800,  cruiseKts: 165, fuelBurnGph: 19 } },

  // --- Zlin ---
  { makePatterns: ['zlin', 'zlín'], modelPatterns: ['z42', 'z126', 'z226', 'z326', 'z526'],
    specs: { typeCategory: 'Single Piston', seats: 2, rangeNm: 500,  cruiseKts: 120, fuelBurnGph: 7  } },
  { makePatterns: ['zlin', 'zlín'], modelPatterns: ['z43', 'z142', 'z143'],
    specs: { typeCategory: 'Single Piston', seats: 4, rangeNm: 600,  cruiseKts: 130, fuelBurnGph: 8  } },
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

export function lookupAircraftSpecs(
  make: string | null | undefined,
  model: string | null | undefined
): AircraftSpecs | null {
  const nm = norm(make);
  const nmo = norm(model);
  if (!nm && !nmo) return null;

  for (const entry of SPECS_TABLE) {
    const makeMatch = !nm || entry.makePatterns.some(p => nm.includes(p));
    if (!makeMatch) continue;

    if (!entry.modelPatterns) {
      return entry.specs;
    }
    if (nmo && entry.modelPatterns.some(p => nmo.includes(p))) {
      return entry.specs;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Band helpers
// ---------------------------------------------------------------------------

export function rangeBand(nm: number): string {
  if (nm >= 600) return 'Green';
  if (nm >= 300) return 'Amber';
  return 'Red';
}

export function cruiseBand(kts: number): string {
  if (kts >= 140) return 'Green';
  if (kts >= 90)  return 'Amber';
  return 'Red';
}

export function fuelBand(gph: number): string {
  if (gph <= 10) return 'Green';
  if (gph <= 20) return 'Amber';
  return 'Red';
}

export function seatBand(seats: number): string {
  if (seats <= 2) return '2 seats';
  if (seats <= 4) return '3–4 seats';
  if (seats <= 6) return '5–6 seats';
  return '7+ seats';
}

export function maintenanceBand(cat: TypeCategory): string {
  if (cat === 'Jet' || cat === 'Turboprop') return 'Red';
  if (cat === 'Twin Piston') return 'Red';
  return 'Amber';  // Single Piston — varies, but Amber is a fair default
}

export function redundancyFromType(cat: TypeCategory): string {
  if (cat === 'Jet' || cat === 'Turboprop' || cat === 'Twin Piston') return 'High';
  return 'Low';
}
