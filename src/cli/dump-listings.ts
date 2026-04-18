/**
 * Dump all listings to stdout.
 * Usage: npm run dump-listings
 * Pass --brief for the original single-line table (no raw_attributes).
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';

const DB_PATH = resolve(process.env.DB_PATH ?? './data/listings.db');
const db = new Database(DB_PATH, { readonly: true });
const brief = process.argv.includes('--brief');

interface Row {
  registration: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  price: string | null;
  location: string | null;
  source_site: string;
  is_new: number;
  score: number | null;
  avionics: string | null;
  engine: string | null;
  ifr: string | null;
  listing_url: string;
  raw_attributes: string | null;
}

const rows = db.prepare<[], Row>(`
  SELECT
    l.registration,
    l.make,
    l.model,
    l.year,
    CASE WHEN l.price IS NOT NULL THEN l.price_currency || CAST(CAST(l.price AS INTEGER) AS TEXT) END AS price,
    l.location,
    l.source_site,
    l.is_new,
    ROUND(COALESCE(
      (SELECT MAX(ls.score) FROM listing_scores ls WHERE ls.listing_id = l.id),
      l.match_score
    ), 1) AS score,
    JSON_EXTRACT(li.indicators, '$.avionics_type.value')        AS avionics,
    JSON_EXTRACT(li.indicators, '$.engine_state.value')         AS engine,
    JSON_EXTRACT(li.indicators, '$.ifr_capability_level.value') AS ifr,
    l.listing_url,
    l.raw_attributes
  FROM listings l
  LEFT JOIN listing_indicators li ON li.listing_id = l.id
  ORDER BY score DESC, l.date_last_seen DESC
`).all();

db.close();

if (rows.length === 0) {
  console.log('No listings in database.');
  process.exit(0);
}

const pad = (s: string | null | number, w: number) =>
  String(s ?? '-').slice(0, w).padEnd(w);

if (brief) {
  const COL = { reg: 12, make: 10, model: 10, year: 6, price: 10, location: 22, site: 12, new: 4, score: 6, avionics: 16, engine: 10, ifr: 12 };
  const header = [
    pad('Reg', COL.reg), pad('Make', COL.make), pad('Model', COL.model),
    pad('Year', COL.year), pad('Price', COL.price), pad('Location', COL.location),
    pad('Site', COL.site), pad('New', COL.new), pad('Score', COL.score),
    pad('Avionics', COL.avionics), pad('Engine', COL.engine), pad('IFR', COL.ifr), 'URL',
  ].join('  ');
  const sep = '-'.repeat(header.length);
  console.log(sep); console.log(header); console.log(sep);
  for (const r of rows) {
    console.log([
      pad(r.registration, COL.reg), pad(r.make, COL.make), pad(r.model, COL.model),
      pad(r.year, COL.year), pad(r.price, COL.price), pad(r.location, COL.location),
      pad(r.source_site, COL.site), pad(r.is_new ? 'YES' : '', COL.new), pad(r.score, COL.score),
      pad(r.avionics, COL.avionics), pad(r.engine, COL.engine), pad(r.ifr, COL.ifr),
      r.listing_url,
    ].join('  '));
  }
  console.log(sep);
  console.log(`${rows.length} listing(s)`);
} else {
  const SEP = '─'.repeat(80);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(SEP);
    console.log(`[${i + 1}/${rows.length}]  ${r.make ?? '-'} ${r.model ?? '-'}  ${r.year ?? ''}  ${r.registration ?? '(no reg)'}  |  score: ${r.score ?? '-'}  |  ${r.source_site}`);
    console.log(`  Price    : ${r.price ?? '-'}`);
    console.log(`  Location : ${r.location ?? '-'}`);
    console.log(`  New      : ${r.is_new ? 'yes' : 'no'}`);
    console.log(`  Avionics : ${r.avionics ?? '-'}  |  Engine: ${r.engine ?? '-'}  |  IFR: ${r.ifr ?? '-'}`);
    console.log(`  URL      : ${r.listing_url}`);
    if (r.raw_attributes) {
      let attrs: Record<string, string>;
      try { attrs = JSON.parse(r.raw_attributes) as Record<string, string>; }
      catch { attrs = { raw: r.raw_attributes }; }
      console.log('  Attributes:');
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'description' || String(v).length > 200) {
          console.log(`    ${k}: ${String(v).slice(0, 200)}…`);
        } else {
          console.log(`    ${k}: ${v}`);
        }
      }
    } else {
      console.log('  Attributes: (none)');
    }
  }
  console.log(SEP);
  console.log(`${rows.length} listing(s)`);
}
