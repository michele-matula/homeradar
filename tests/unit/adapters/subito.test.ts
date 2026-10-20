import { describe, expect, it } from 'vitest';
import { romeDay, subitoAdapter as A } from '@/adapters/subito';
import { API_URL, NOW, SEARCH_URL, apiAd, apiResponse, cardHtml, nextAd, nextData } from './subito-builders';

describe('parseNextData', () => {
  it("mappa i campi dell'annuncio", () => {
    const r = A.parseNextData(nextData([nextAd()]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations).toEqual([{
      portal: 'subito', portalId: 664390119, url: 'https://www.subito.it/appartamenti/annuncio-664390119.htm',
      title: 'Bilocale in Via Esempio 1', address: null, city: 'Milano', zone: 'Città Studi', typology: 'Appartamenti', category: 'residential',
      surfaceM2: 65, rooms: 2, price: 250000, sellerType: 'private', portalCreatedAt: null, lastDrop: null, coverUrl: null, source: 'search',
    }]);
  });

  it('riconosce privati, agenzie e negozi', () => {
    const r = A.parseNextData(nextData([
      nextAd(1),
      nextAd(2, { advertiser: { name: 'Agenzia', type: 1, userId: '2', company: true } }),
      nextAd(3, { advertiser: { name: 'Shop', type: 2, userId: '3', company: true } }),
      nextAd(4, { advertiser: { name: '', type: 5, userId: '4', company: false } }),
    ]), SEARCH_URL, NOW);
    expect(r.observations.map((o) => o.sellerType)).toEqual(['private', 'agency', 'agency', 'unknown']);
  });

  it('ignora affitti e annunci non immobiliari senza errori', () => {
    const r = A.parseNextData(nextData([
      nextAd(1, { type: { key: 'u', value: 'In affitto' } }),
      { kind: 'AdItem', urn: 'id:ad:x:list:2', type: { key: 's' }, category: { id: '2', label: 'Auto', parentId: '1' } },
      nextAd(3),
    ]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.portalId)).toEqual([3]);
  });

  it('prezzo mancante, zero o non numerico diventa null', () => {
    const noPrice = (id: number, key?: string) =>
      nextAd(id, { features: key == null ? {} : { '/price': { uri: '/price', values: [{ key, value: key }] } } });
    const r = A.parseNextData(nextData([noPrice(1), noPrice(2, '0'), noPrice(3, 'Trattativa riservata')]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.price)).toEqual([null, null, null]);
  });

  it('locali "5+" diventano 5, valori non numerici null', () => {
    const rooms = (id: number, key: string) => nextAd(id, { features: { '/room': { uri: '/room', values: [{ key, value: key }] } } });
    const r = A.parseNextData(nextData([rooms(1, '5+'), rooms(2, 'n.d.')]), SEARCH_URL, NOW);
    expect(r.observations.map((o) => o.rooms)).toEqual([5, null]);
  });

  it('un annuncio malformato è un errore, gli altri vengono letti', () => {
    const r = A.parseNextData(nextData([{ ...nextAd(1), urn: 'senza-id' }, nextAd(2)]), SEARCH_URL, NOW);
    expect(r.errors).toHaveLength(1);
    expect(r.observations.map((o) => o.portalId)).toEqual([2]);
  });

  it('legge anche gli annunci in evidenza, senza doppioni', () => {
    const r = A.parseNextData(nextData([nextAd(1)], { galleryList: [nextAd(1), nextAd(2)], boostedItems: { 0: nextAd(3) } }), SEARCH_URL, NOW);
    expect(r.observations.map((o) => o.portalId)).toEqual([1, 2, 3]);
  });

  it('fuori dalle ricerche non legge nulla', () => {
    const r = A.parseNextData(nextData([nextAd()]), 'https://www.subito.it/appartamenti/annuncio-1.htm', NOW);
    expect(r).toEqual({ observations: [], errors: [] });
  });

  it('senza la lista degli annunci restituisce un errore', () => {
    expect(A.parseNextData({ props: {} }, SEARCH_URL, NOW).errors).toHaveLength(1);
  });
});

describe('parseApi', () => {
  it('legge la risposta di hades con features in array', () => {
    const r = A.parseApi(API_URL, apiResponse([apiAd()]), NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]).toMatchObject({ portalId: 664304986, price: 250000, surfaceM2: 65, rooms: 2, sellerType: 'private', typology: 'Appartamenti' });
  });

  it('ignora gli annunci di altre macrocategorie e gli affitti', () => {
    const r = A.parseApi(API_URL, apiResponse([
      apiAd(1, { category: { key: '2', value: 'Auto', macrocategory_id: '1' } }),
      apiAd(2, { type: { key: 'u', value: 'In affitto' } }),
      apiAd(3),
    ]), NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.portalId)).toEqual([3]);
  });

  it('ignora le altre risposte', () => {
    expect(A.parseApi('https://hades.subito.it/v1/vouchers/banners', apiResponse([apiAd()]), NOW).observations).toEqual([]);
  });
});

describe('dati personali', () => {
  it('nessuna osservazione contiene nome, telefono o descrizione', () => {
    const r1 = A.parseNextData(nextData([nextAd()]), SEARCH_URL, NOW);
    const r2 = A.parseApi(API_URL, apiResponse([apiAd()]), NOW);
    const text = JSON.stringify([r1, r2]);
    expect(text).not.toContain('Mario');
    expect(text).not.toContain('3331234567');
    expect(text).not.toContain('Descrizione');
    expect(text).not.toContain('7029983');
  });
});

describe('newestId', () => {
  it("è l'ID più alto tra gli annunci rinnovati oggi, agenzie comprese", () => {
    const r = A.parseNextData(nextData([
      nextAd(664_000_001, { date: '2026-10-13 09:00:00' }),
      nextAd(664_000_009, { date: '2026-10-13 08:00:00', advertiser: { name: 'A', type: 1, userId: '1', company: true } }),
      nextAd(664_000_050, { date: '2026-10-12 23:00:00' }),
    ]), SEARCH_URL, NOW);
    expect(r.newestId).toBe(664_000_009);
  });

  it('manca se nessun annuncio è di oggi', () => {
    expect(A.parseNextData(nextData([nextAd(1, { date: '2026-10-01 10:00:00' })]), SEARCH_URL, NOW).newestId).toBeUndefined();
  });

  it('un annuncio vecchio rinnovato oggi diventa candidato (lo scarta poi acceptLearnedPoint)', () => {
    expect(A.parseNextData(nextData([nextAd(650_000_000, { date: '2026-10-13 07:00:00' })]), SEARCH_URL, NOW).newestId).toBe(650_000_000);
  });

  it('a mezzanotte vale il giorno di Roma, non quello UTC', () => {
    const lateUtc = Date.UTC(2026, 9, 12, 22, 45); // 00:45 del 13/10 a Roma
    expect(romeDay(lateUtc)).toBe('2026-10-13');
    const r = A.parseNextData(nextData([nextAd(7, { date: '2026-10-13 00:30:00' })]), SEARCH_URL, lateUtc);
    expect(r.newestId).toBe(7);
  });

  it("vale anche per l'API con dates.display", () => {
    expect(A.parseApi(API_URL, apiResponse([apiAd(9, { dates: { display: '2026-10-13 11:00:00' } })]), NOW).newestId).toBe(9);
  });
});

describe('card nel DOM', () => {
  it('trova card, ID e contenitore della foto', () => {
    document.body.innerHTML = `<div>${cardHtml(11)}${cardHtml(12)}<a href="/annunci-lombardia/vendita/appartamenti/">x</a></div>`;
    expect(A.cardIds(document)).toEqual([11, 12]);
    const card = A.cardFor(document, 12)!;
    expect(card.tagName).toBe('ARTICLE');
    // Il badge va nel contenitore della foto, non nella figure interna.
    expect(A.badgeHost(card)).toBe(card.querySelector('figure')!.parentElement);
    expect(A.cardFor(document, 99)).toBeNull();
  });
});

describe('riassunto della pagina', () => {
  it('ultima pagina dal numero di pagine e dal parametro o', () => {
    const json = nextData([nextAd(1), nextAd(2)], { totalPages: 3 });
    expect(A.parseNextData(json, SEARCH_URL, NOW).page).toEqual({ results: 2, privates: 2, lastPage: false });
    expect(A.parseNextData(json, `${SEARCH_URL}?o=3`, NOW).page).toMatchObject({ lastPage: true });
    expect(A.parseNextData(nextData([]), SEARCH_URL, NOW).page).toMatchObject({ results: 0, lastPage: true });
  });
});

describe('copertina', () => {
  const BASE = 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f48389a-ec1a-4435-b055-4b21a05401a8';
  const COVER = `${BASE}?rule=vertical-mini-card-1x-auto`;

  it('__NEXT_DATA__: cdnBaseUrl della prima immagine con la regola della miniatura', () => {
    const r = A.parseNextData(nextData([nextAd(1, { images: [{ cdnBaseUrl: BASE }, { cdnBaseUrl: `${BASE}2` }] })]), SEARCH_URL, NOW);
    expect(r.observations[0]!.coverUrl).toBe(COVER);
  });

  it('API: cdn_base_url', () => {
    const r = A.parseApi(API_URL, apiResponse([apiAd(1, { images: [{ uri: 'imgid:x', base_url: 'https://s.sbito.it/img/x', cdn_base_url: BASE }] })]), NOW);
    expect(r.observations[0]!.coverUrl).toBe(COVER);
  });

  it('senza immagini, forma inattesa o altro server: null, annuncio letto', () => {
    const r = A.parseNextData(nextData([
      nextAd(1, { images: [] }),
      nextAd(2, { images: undefined }),
      nextAd(3, { images: 'x' }),
      nextAd(4, { images: [{ cdnBaseUrl: 'https://images.example/1' }] }),
    ]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.coverUrl)).toEqual([null, null, null, null]);
  });
});
