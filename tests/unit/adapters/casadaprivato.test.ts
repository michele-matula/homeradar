import { describe, expect, it } from 'vitest';
import { casadaprivatoAdapter } from '@/adapters/casadaprivato';
import { parseSearch, parseTitle } from '@/adapters/casadaprivato/parse';
import { categoryFromPath, listingIdFromHref, pageKind } from '@/adapters/casadaprivato/urls';
import { card, DESCRIPTION, searchBody, similarHeading, URL } from './casadaprivato-builders';

const doc = (cards: string[], pager?: number[]) => new DOMParser().parseFromString(`<body>${searchBody(cards, pager)}</body>`, 'text/html');
const docWithoutListing = () => new DOMParser().parseFromString('<body><h3>Pagina non trovata!</h3></body>', 'text/html');
const first = (html: string) => parseSearch(doc([html]), URL).observations[0]!;

describe('urls', () => {
  it('riconosce le ricerche', () => {
    expect(pageKind(URL)).toBe('search');
    expect(pageKind(`${URL}/pagina-2`)).toBe('search');
    expect(pageKind('https://www.casadaprivato.it/appartamenti/x-1')).toBe('other');
  });
  it('ID dal numero finale del percorso, con qualsiasi slug', () => {
    expect(listingIdFromHref('/appartamenti/appartamento-in-vendita-salerno-424125')).toBe(424125);
    expect(listingIdFromHref('/appartamenti/annuncio-424125')).toBe(424125);
    expect(listingIdFromHref('/appartamenti/senza-numero')).toBeNull();
  });
  it('categoria dal primo segmento', () => {
    expect(categoryFromPath('/ville-singole-e-a-schiera/x-1')).toBe('residential');
    expect(categoryFromPath('/immobili-attivita-commerciali/x-1')).toBe('commercial');
    expect(categoryFromPath('/terreni/x-1')).toBe('land');
    expect(categoryFromPath('/box-garage-posti-auto/x-1')).toBe('garage');
    expect(categoryFromPath('/altro/x-1')).toBeNull();
  });
  it('titolo', () => {
    expect(parseTitle('Quadrilocale da Privato a Salerno, Via Esempio 1')).toEqual({ typology: 'Quadrilocale', city: 'Salerno', address: 'Via Esempio 1' });
    expect(parseTitle('Villa sul mare')).toEqual({ typology: null, city: null, address: null });
  });
});

describe('parseSearch', () => {
  it('legge una card di privato', () => {
    const o = parseSearch(doc([card({ id: 424125, path: 'appartamenti', title: 'Quadrilocale da Privato a Salerno, Via Esempio 1', price: '€ 190.000', amenities: ['4 locali', '95 mq'] })]), URL).observations[0]!;
    expect(o).toMatchObject({ portal: 'casadaprivato', portalId: 424125, url: 'https://www.casadaprivato.it/appartamenti/annuncio-424125', typology: 'Quadrilocale', city: 'Salerno', address: 'Via Esempio 1', zone: null, category: 'residential', rooms: 4, surfaceM2: 95, price: 190000, sellerType: 'private', portalCreatedAt: null, lastDrop: null, source: 'search' });
    expect(o.priceReserved).toBeUndefined();
    expect(JSON.stringify(o)).not.toContain('333');
    expect(JSON.stringify(o)).not.toContain(DESCRIPTION);
  });
  it('link con slug libero come sul sito reale: ID finale, url com\'è sulla card', () => {
    const o = first(card({ id: 424125, slug: 'appartamento-in-vendita-salerno' }));
    expect(o.portalId).toBe(424125);
    expect(o.url).toBe('https://www.casadaprivato.it/appartamenti/appartamento-in-vendita-salerno-424125');
    expect(casadaprivatoAdapter.cardFor(doc([card({ id: 424125, slug: 'appartamento-in-vendita-salerno' })]), 424125)).not.toBeNull();
  });
  it('href assoluto: url senza doppio dominio', () => {
    const o = first(card({ id: 424125, path: 'appartamenti' }).replaceAll('href="/appartamenti', 'href="https://www.casadaprivato.it/appartamenti'));
    expect(o.portalId).toBe(424125);
    expect(o.url).toBe('https://www.casadaprivato.it/appartamenti/annuncio-424125');
  });
  it('superficie con virgola decimale: parte intera', () => {
    expect(first(card({ amenities: ['3 locali', '85,5 mq'] })).surfaceM2).toBe(85);
    expect(first(card({ amenities: ['3 locali', '1.250 mq'] })).surfaceM2).toBe(1250);
  });
  it('trattativa riservata: prezzo null e priceReserved', () => {
    for (const p of ['Trattativa Riservata', 'trattativa riservata']) expect(first(card({ price: p }))).toMatchObject({ price: null, priceReserved: true });
  });
  it('€ 0 e prezzi grandi', () => {
    expect(first(card({ price: '€ 0' }))).toMatchObject({ price: null });
    expect(first(card({ price: '€ 0' })).priceReserved).toBeUndefined();
    expect(first(card({ price: '€ 1.200.000' })).price).toBe(1_200_000);
  });
  it('5+ locali, nessuna superficie, nessun indirizzo', () => {
    expect(first(card({ path: 'terreni', title: 'Terreno Agricolo/Coltura da Privato a Aquara', amenities: ['5+ locali'] }))).toMatchObject({ rooms: 5, surfaceM2: null, address: null, city: 'Aquara', category: 'land' });
  });
  it('titolo fuori schema: city null, nessun errore', () => {
    const r = parseSearch(doc([card({ title: 'Villa sul mare' })]), URL);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.city).toBeNull();
  });
  it('copertina da data-src, poi da src, solo dal server ammesso', () => {
    const cdn = 'https://static.casadaprivato.it/images/properties/mediumthumbs/1/a.jpg';
    expect(first(card({ dataSrc: cdn })).coverUrl).toBe(cdn);
    expect(first(card({ dataSrc: null, src: cdn })).coverUrl).toBe(cdn);
    expect(first(card({ dataSrc: '' })).coverUrl).toBeNull();
  });
  it('ignora i comuni vicini dopo h2.similar-properties', () => {
    const r = parseSearch(doc([card({ id: 1 }), similarHeading('Acerno'), card({ id: 2 })]), URL);
    expect(r.observations.map((o) => o.portalId)).toEqual([1]);
    expect(casadaprivatoAdapter.cardIds(doc([card({ id: 1 }), similarHeading('Acerno'), card({ id: 2 })]))).toEqual([1]);
    expect(casadaprivatoAdapter.cardFor(doc([similarHeading('X'), card({ id: 2 })]), 2)).toBeNull();
  });
  it('badge sull\'immagine della card', () => {
    const c = casadaprivatoAdapter.cardFor(doc([card({ id: 1 })]), 1)!;
    expect(casadaprivatoAdapter.badgeHost(c).classList.contains('image')).toBe(true);
  });
});

describe('readDocument', () => {
  it('pagina e fine ricerca', () => {
    expect(casadaprivatoAdapter.readDocument!(doc([card()], [2, 3]), URL).page).toEqual({ results: 1, privates: 1, lastPage: false });
    expect(casadaprivatoAdapter.readDocument!(doc([card()], []), `${URL}/pagina-6`).page!.lastPage).toBe(true);
    expect(casadaprivatoAdapter.readDocument!(doc([card()], [3, 4]), `${URL}/pagina-2`).page!.lastPage).toBe(false);
    expect(casadaprivatoAdapter.readDocument!(docWithoutListing(), URL).page).toBeUndefined();
    expect(casadaprivatoAdapter.pageKind('https://www.casadaprivato.it/appartamenti/x-1')).toBe('other');
  });
});
