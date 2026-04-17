/**
 * Part-21 / CS-23 certified aircraft lookup.
 *
 * Used to determine whether an aircraft type can legally fly IFR in the UK.
 * Only type-certificated aircraft can be "IFR Approved" — permit/experimental/LAA
 * aircraft can be IFR equipped but never IFR Approved under UK/EASA rules.
 *
 * Unknown make/model → not certified (safe default).
 * vfrOnly = certified type but VFR-only by design (aerobatic, vintage, etc.).
 */

interface TypeEntry {
  makePatterns: string[];    // lowercase substrings matched against normalised make
  modelPatterns?: string[];  // lowercase substrings matched against normalised model; absent = all models
  vfrOnly?: true;
}

const CERTIFIED_ENTRIES: TypeEntry[] = [
  // --- Cessna / Reims-Cessna ---
  { makePatterns: ['cessna', 'reims'] },

  // --- Piper ---
  { makePatterns: ['piper'], modelPatterns: ['pa-18', 'pa18', 'pa-22', 'pa22', 'pa-24', 'pa24', 'pa-28', 'pa28', 'pa-32', 'pa32', 'pa-34', 'pa34', 'pa-44', 'pa44', 'pa-46', 'pa46', 'seneca', 'saratoga', 'lance', 'arrow', 'warrior', 'archer', 'cherokee', 'comanche', 'aztec', 'navajo', 'seminole'] },
  { makePatterns: ['piper'], modelPatterns: ['j-3', 'j3', 'cub', 'j5'], vfrOnly: true },

  // --- Beechcraft / Raytheon / Textron Aviation ---
  { makePatterns: ['beech', 'raytheon'], modelPatterns: ['33', '35', '36', 'bonanza', '55', '56', '58', 'baron', '76', 'duchess', '95', 'travel air', 'sierra', 'sundowner', 'musketeer', 'skipper', 'sport', 'debonair'] },

  // --- Robin / Avions Robin ---
  { makePatterns: ['robin', 'avions robin'] },

  // --- SOCATA / Aérospatiale / Daher / TBM ---
  { makePatterns: ['socata', 'aerospatiale', 'aérospatiale', 'daher', 'tbm'] },

  // --- Diamond Aircraft ---
  { makePatterns: ['diamond aircraft', 'diamond da'] },
  // "Diamond" alone is too generic; match on make containing "diamond" + known model prefixes
  { makePatterns: ['diamond'], modelPatterns: ['da20', 'da-20', 'da40', 'da-40', 'da42', 'da-42', 'da50', 'da-50', 'da62', 'da-62'] },

  // --- Cirrus ---
  { makePatterns: ['cirrus design', 'cirrus aircraft'] },
  { makePatterns: ['cirrus'], modelPatterns: ['sr20', 'sr-20', 'sr22', 'sr-22', 'sf50', 'vision jet'] },

  // --- Tecnam ---
  { makePatterns: ['tecnam'] },

  // --- Grob ---
  { makePatterns: ['grob'], modelPatterns: ['g115', 'g-115', 'g120', 'g-120', 'g140', 'g-140'] },

  // --- Mooney ---
  { makePatterns: ['mooney'], modelPatterns: ['m20', 'm-20'] },

  // --- Slingsby ---
  { makePatterns: ['slingsby'], modelPatterns: ['t67', 't-67', 'firefly', 't61', 'motor falke'] },

  // --- Partenavia / Vulcanair ---
  { makePatterns: ['partenavia', 'vulcanair'], modelPatterns: ['p68', 'p-68', 'observer', 'v1.'] },

  // --- Zlin ---
  { makePatterns: ['zlin', 'zlín'], modelPatterns: ['z42', 'z43', 'z126', 'z226', 'z326', 'z526', 'z142', 'z143'] },

  // --- Britten-Norman ---
  { makePatterns: ['britten-norman', 'britten norman'], modelPatterns: ['bn-2', 'bn2', 'islander', 'trislander'] },

  // --- Fuji ---
  { makePatterns: ['fuji'], modelPatterns: ['fa200', 'fa-200'] },

  // --- Czech Aircraft Works / CZAW (certified variants only) ---
  // SportCruiser factory-built with EASA TC: match on "czech aircraft" make
  { makePatterns: ['czech aircraft works', 'czech sport aircraft'], modelPatterns: ['sportcruiser', 'sport cruiser', 'ps-28'] },

  // --- Fournier (certified motorgliders) ---
  { makePatterns: ['fournier'], modelPatterns: ['rf-4', 'rf4', 'rf-5', 'rf5', 'rf-6', 'rf6', 'rf-7', 'rf7', 'rf-9', 'rf9', 'rf-10', 'rf10'] },

  // --- Scheibe (certified motorgliders) ---
  { makePatterns: ['scheibe'], modelPatterns: ['sf-25', 'sf25', 'falke'] },

  // --- Aerobatic certified types (VFR only by design) ---
  { makePatterns: ['extra flugzeugbau', 'extra aircraft'], vfrOnly: true },
  { makePatterns: ['extra'], modelPatterns: ['ea-200', 'ea200', 'extra 200', 'extra 300', 'extra 330', 'extra 350', 'ea-300', 'ea300', 'ea-330', 'ea330'], vfrOnly: true },
  { makePatterns: ['pitts'], vfrOnly: true },
  { makePatterns: ['avions mudry', 'mudry'], vfrOnly: true },
  { makePatterns: ['cap'], modelPatterns: ['cap 10', 'cap-10', 'cap 230', 'cap-230', 'cap 231', 'cap-231', 'cap 232', 'cap-232'], vfrOnly: true },

  // --- Vintage certified (VFR only in practice) ---
  { makePatterns: ['de havilland', 'dehavilland'], modelPatterns: ['chipmunk', 'dh82', 'dh-82', 'tiger moth', 'dh60', 'dh-60', 'moth'], vfrOnly: true },
  { makePatterns: ['scottish aviation'], modelPatterns: ['bulldog'], vfrOnly: true },
  { makePatterns: ['auster'], vfrOnly: true },
  { makePatterns: ['miles'], modelPatterns: ['magister', 'messenger', 'gemini', 'hawk', 'student'], vfrOnly: true },
  { makePatterns: ['percival'], modelPatterns: ['proctor', 'prentice', 'pembroke'], vfrOnly: true },
];

function normalise(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

export function isCertifiedType(
  make: string | null | undefined,
  model: string | null | undefined
): { certified: boolean; vfrOnly: boolean } {
  const nm = normalise(make);
  const nmo = normalise(model);
  if (!nm) return { certified: false, vfrOnly: false };

  for (const entry of CERTIFIED_ENTRIES) {
    const makeMatch = entry.makePatterns.some(p => nm.includes(p));
    if (!makeMatch) continue;

    if (!entry.modelPatterns) {
      return { certified: true, vfrOnly: entry.vfrOnly ?? false };
    }

    const modelMatch = entry.modelPatterns.some(p => nmo.includes(p));
    if (modelMatch) {
      return { certified: true, vfrOnly: entry.vfrOnly ?? false };
    }
  }

  return { certified: false, vfrOnly: false };
}
