import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { immobiliareAdapter as A } from '@/adapters/immobiliare';

const read = (name: string) => readFileSync(`tests/fixtures/immobiliare/${name}`, 'utf8');
const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/;

describe.each(['search-privati.json', 'api-listings.json', 'detail-private.json', 'search-salerno.json', 'api-salerno.json'])('fixture %s', (name) => {
  it('non contiene dati personali', () => {
    const text = read(name);
    expect(text).not.toContain('"phones"');
    expect(text).not.toContain('"displayName"');
    expect(text).not.toMatch(PHONE);
  });

  it('ha titoli e indirizzi sintetici (nessuna via reale)', () => {
    const text = read(name);
    const titles = [...text.matchAll(/"title": "([^"]*)"/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t).toMatch(/via Esempio \d+/);
    for (const m of text.matchAll(/"address": "([^"]*)"/g)) expect(m[1]).toMatch(/^Via Esempio \d+$/);
  });
});

describe('adattatore sulle fixture reali', () => {
  it('legge la pagina di ricerca senza errori', () => {
    const r = A.parseNextData(JSON.parse(read('search-privati.json')), 'https://www.immobiliare.it/vendita-case/milano/da-privati/?pag=15');
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
    expect(r.observations.some((o) => o.sellerType === 'private')).toBe(true);
    expect(r.observations.some((o) => o.sellerType === 'private' && o.lastDrop)).toBe(true);
    for (const o of r.observations) {
      expect(o.portalId).toBeGreaterThan(0);
      expect(o.url).toMatch(/^https:\/\/www\.immobiliare\.it\/annunci\/\d+\/$/);
    }
  });

  it('legge la risposta XHR', () => {
    const r = A.parseIntercepted('https://www.immobiliare.it/api-next/search-list/listings/?pag=16', JSON.parse(read('api-listings.json')));
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
  });

  it('legge il dettaglio con la data di creazione', () => {
    const json = JSON.parse(read('detail-private.json'));
    const id = json.props.pageProps.detailData.realEstate.id;
    const r = A.parseNextData(json, `https://www.immobiliare.it/annunci/${id}/`);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.sellerType).toBe('private');
    expect(r.observations[0]!.portalCreatedAt).toBeGreaterThan(Date.UTC(2015, 0, 1));
  });
});

// I campi che l'adattatore legge (schemas.ts), più la copertina finta: il sanitizer tiene solo questi.
const REAL_ESTATE = [
  'id', 'title', 'contract', 'createdAt',
  'price.visible', 'price.value',
  'price.loweredPrice.originalPrice', 'price.loweredPrice.currentPrice', 'price.loweredPrice.discountPercentage', 'price.loweredPrice.date',
  'properties[].surface', 'properties[].rooms', 'properties[].typology.name',
  'properties[].location.address', 'properties[].location.city', 'properties[].location.macrozone', 'properties[].location.microzone',
  'properties[].photo.urls.small',
  'advertiser.agency.type', 'advertiser.supervisor.type',
].map((p) => `realEstate.${p}`);
const RESULT = [...REAL_ESTATE, 'seo.url'];
const SEARCH = 'props.pageProps.dehydratedState.queries[].state.data';
const ALLOWED = [
  `${SEARCH}.count`, `${SEARCH}.currentPage`, ...RESULT.map((p) => `${SEARCH}.results[].${p}`),
  'count', 'currentPage', ...RESULT.map((p) => `results[].${p}`),
  ...REAL_ESTATE.map((p) => `props.pageProps.detailData.${p}`),
];

/** Percorsi delle foglie, con gli indici degli array scritti come []. Un valore null o vuoto è una foglia. */
function leafPaths(v: unknown, path = '', out: string[] = []): string[] {
  if (Array.isArray(v)) {
    if (!v.length) out.push(`${path}[]`);
    for (const x of v) leafPaths(x, `${path}[]`, out);
  } else if (v && typeof v === 'object' && Object.keys(v).length) {
    for (const [k, x] of Object.entries(v)) leafPaths(x, path ? `${path}.${k}` : k, out);
  } else out.push(path);
  return out;
}

describe.each(['search-privati.json', 'api-listings.json', 'detail-private.json', 'search-salerno.json', 'api-salerno.json'])('fixture %s: solo campi ammessi', (name) => {
  it("contiene solo i campi che l'adattatore legge", () => {
    const extra = [...new Set(leafPaths(JSON.parse(read(name))))]
      .filter((p) => !ALLOWED.some((a) => a === p || a.startsWith(`${p}.`) || a.startsWith(`${p}[]`)));
    expect(extra).toEqual([]);
  });
});
