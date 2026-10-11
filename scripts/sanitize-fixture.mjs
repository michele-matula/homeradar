// Uso: node scripts/sanitize-fixture.mjs <search|detail|api> <input.json> <output.json>
// Tiene solo la parte di JSON che serve all'adattatore ed elimina dati personali e testi lunghi.
import { readFileSync, writeFileSync } from 'node:fs';

const [kind, input, output] = process.argv.slice(2);
if (!['search', 'detail', 'api'].includes(kind) || !input || !output) {
  console.error('Uso: node scripts/sanitize-fixture.mjs <search|detail|api> <input.json> <output.json>');
  process.exit(1);
}

const DROP = new Set([
  'phones', 'phone', 'displayName', 'label', 'agencyUrl', 'imageUrls', 'image', 'imageGender', 'imageType',
  'description', 'defaultDescription', 'caption', 'multimedia', 'photo', 'photos',
  'featureList', 'features', 'ga4features', 'mainFeatures', 'primaryFeatures', 'costs', 'cadastrals', 'energy',
]);

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

// Titolo e indirizzo contengono via e civico di privati: li sostituiamo con valori sintetici.
// Restano solo la tipologia (prima parola del titolo originale) e la zona.
function anonymize(re, n) {
  const loc = re.properties?.[0]?.location;
  const typology = String(re.title ?? 'Appartamento').split(' ')[0];
  const zone = loc?.microzone ?? loc?.macrozone ?? 'Centro';
  const city = loc?.city ?? 'Milano';
  const properties = re.properties?.map((p, i) => (i === 0 && p.location ? { ...p, location: { ...p.location, address: `Via Esempio ${n}` } } : p));
  return { ...re, title: `${typology} via Esempio ${n}, ${zone}, ${city}`, ...(properties ? { properties } : {}) };
}
const anonymizeResults = (results) => results.map((r, i) => ({ ...r, realEstate: anonymize(r.realEstate, i + 1) }));

const raw = JSON.parse(readFileSync(input, 'utf8'));
let out;
if (kind === 'search') {
  const q = raw.props.pageProps.dehydratedState.queries.find((x) => Array.isArray(x?.state?.data?.results));
  const d = q.state.data;
  out = { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { count: d.count, currentPage: d.currentPage, results: anonymizeResults(scrub(d.results)) } } }] } } } };
} else if (kind === 'detail') {
  out = { props: { pageProps: { detailData: { realEstate: anonymize(scrub(raw.props.pageProps.detailData.realEstate), 1) } } } };
} else {
  out = { count: raw.count, currentPage: raw.currentPage, results: anonymizeResults(scrub(raw.results)) };
}

const text = JSON.stringify(out, null, 1);
const suspicious = text.match(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/g);
if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
writeFileSync(output, `${text}\n`);
console.log(`OK: ${output}`);
