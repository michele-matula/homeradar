import { describe, expect, it } from 'vitest';
import { immobiliareAdapter as A } from '@/adapters/immobiliare';
import { parseSearchData } from '@/adapters/immobiliare';
import {
  API_URL, DETAIL_URL, SEARCH_URL, agencyAdvertiser, detailNextData, realEstate, searchNextData, searchResult,
} from './builders';

describe('immobiliareAdapter.pageKind', () => {
  it('riconosce ricerca, dettaglio e altro', () => {
    expect(A.pageKind(SEARCH_URL)).toBe('search');
    expect(A.pageKind('https://www.immobiliare.it/vendita-appartamenti/roma/?pag=2')).toBe('search');
    expect(A.pageKind(DETAIL_URL)).toBe('detail');
    expect(A.pageKind('https://www.immobiliare.it/')).toBe('other');
    expect(A.pageKind('https://www.immobiliare.it/affitto-case/milano/')).toBe('other');
  });
});

describe('immobiliareAdapter.parseNextData — ricerca', () => {
  it('normalizza un annuncio di privato', () => {
    const r = A.parseNextData(searchNextData([searchResult(realEstate())]), SEARCH_URL);
    expect(r.errors).toEqual([]);
    expect(r.observations).toEqual([
      {
        portal: 'immobiliare',
        portalId: 128416572,
        url: 'https://www.immobiliare.it/annunci/128416572/',
        title: 'Bilocale via Esempio 1, Precotto, Milano',
        address: 'Via Esempio',
        city: 'Milano',
        zone: 'Precotto',
        typology: 'Appartamento', category: 'residential',
        surfaceM2: 62,
        rooms: 2,
        price: 235000,
        sellerType: 'private',
        portalCreatedAt: null,
        lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) },
        coverUrl: null,
        source: 'search',
      },
    ]);
  });

  it('non fa mai uscire telefoni, nomi o descrizioni', () => {
    const r = A.parseNextData(
      searchNextData([searchResult(realEstate()), searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2)]),
      SEARCH_URL,
    );
    const text = JSON.stringify(r);
    expect(text).not.toContain('333 123 4567');
    expect(text).not.toContain('02 1234567');
    expect(text).not.toContain('Agenzia X');
    expect(text).not.toContain('phones');
    expect(text).not.toContain('Testo lungo');
  });

  it('distingue agenzie e costruttori', () => {
    const r = A.parseNextData(
      searchNextData([
        searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2),
        searchResult(realEstate({ id: 3, advertiser: { agency: { type: 'constructor' } } }), 3),
        searchResult(realEstate({ id: 4, advertiser: undefined }), 4),
      ]),
      SEARCH_URL,
    );
    expect(r.observations.map((o) => o.sellerType)).toEqual(['agency', 'constructor', 'unknown']);
  });

  it('gestisce il prezzo nascosto senza ribasso', () => {
    const hidden = realEstate({ price: { visible: false, formattedValue: 'Prezzo su richiesta' } });
    const r = A.parseNextData(searchNextData([searchResult(hidden)]), SEARCH_URL);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.price).toBeNull();
    expect(r.observations[0]!.lastDrop).toBeNull();
  });

  it('scarta un ribasso incoerente', () => {
    const weird = realEstate({
      price: { visible: true, value: 249000, loweredPrice: { originalPrice: '€ 235.000', currentPrice: '€ 249.000', discountPercentage: '0', date: '21/09/2026' } },
    });
    expect(A.parseNextData(searchNextData([searchResult(weird)]), SEARCH_URL).observations[0]!.lastDrop).toBeNull();
  });

  it('registra un errore per il singolo elemento malformato e prosegue', () => {
    const r = A.parseNextData(
      searchNextData([searchResult({ title: 'senza id' }), searchResult(realEstate({ id: 5 }), 5)]),
      SEARCH_URL,
    );
    expect(r.observations.map((o) => o.portalId)).toEqual([5]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^result\[0\]/);
  });

  it('ignora gli annunci in affitto senza errori', () => {
    const r = A.parseNextData(
      searchNextData([searchResult(realEstate({ id: 6, contract: 'rent' }), 6), searchResult(realEstate({ id: 7 }), 7)]),
      SEARCH_URL,
    );
    expect(r.observations.map((o) => o.portalId)).toEqual([7]);
    expect(r.errors).toEqual([]);
  });

  it('segnala quando il contenitore dei risultati manca', () => {
    expect(A.parseNextData({ props: {} }, SEARCH_URL)).toEqual({ observations: [], errors: ['search data not found'] });
  });

  it('non fa nulla sulle pagine non gestite', () => {
    expect(A.parseNextData({}, 'https://www.immobiliare.it/')).toEqual({ observations: [], errors: [] });
  });
});

describe('immobiliareAdapter.parseNextData — dettaglio', () => {
  it('legge la data di creazione in millisecondi', () => {
    const r = A.parseNextData(detailNextData(realEstate({ createdAt: 1776643200 })), DETAIL_URL);
    expect(r.errors).toEqual([]);
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]!.portalCreatedAt).toBe(1776643200000);
    expect(r.observations[0]!.source).toBe('detail');
    expect(r.observations[0]!.url).toBe(DETAIL_URL);
  });

  it('ignora il dettaglio di un annuncio in affitto', () => {
    const r = A.parseNextData(detailNextData(realEstate({ contract: 'rent' })), DETAIL_URL);
    expect(r).toEqual({ observations: [], errors: [] });
  });

  it('segnala quando il dettaglio manca', () => {
    expect(A.parseNextData({ props: { pageProps: {} } }, DETAIL_URL).errors).toEqual(['detail data not found']);
  });
});

describe('immobiliareAdapter — risposte intercettate', () => {
  it('riconosce solo la chiamata dei risultati', () => {
    expect(A.isInterceptedUrl(API_URL)).toBe(true);
    expect(A.isInterceptedUrl('/api-next/search-list/listings/?pag=3')).toBe(true);
    expect(A.isInterceptedUrl('https://www.immobiliare.it/api-next/listing/banners/')).toBe(false);
  });

  it('legge la risposta con la stessa forma dei dati di ricerca', () => {
    const r = A.parseIntercepted(API_URL, { count: 1, currentPage: 2, results: [searchResult(realEstate())] });
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.portalId).toBe(128416572);
  });

  it('ignora gli affitti anche nelle risposte intercettate', () => {
    const r = A.parseIntercepted(API_URL, { results: [searchResult(realEstate({ contract: 'rent' }))] });
    expect(r).toMatchObject({ observations: [], errors: [] });
  });

  it('segnala una risposta senza results', () => {
    expect(A.parseIntercepted(API_URL, { foo: 1 }).errors).toEqual(['search data not found']);
  });
});

describe('immobiliareAdapter.listingIdFromHref', () => {
  it('estrae l\'ID dai link degli annunci', () => {
    expect(A.listingIdFromHref('https://www.immobiliare.it/annunci/128416572/')).toBe(128416572);
    expect(A.listingIdFromHref('/annunci/133428292/?foo=1')).toBe(133428292);
    expect(A.listingIdFromHref('/agenzie-immobiliari/51157/')).toBeNull();
  });
});

describe('riassunto della pagina', () => {
  it('annunci, privati e ultima pagina', () => {
    const results = [searchResult(realEstate()), searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2)];
    expect(parseSearchData({ results, currentPage: 2, maxPages: 2 }).page).toEqual({ results: 2, privates: 1, lastPage: true });
    expect(parseSearchData({ results, currentPage: 1, maxPages: 2 }).page).toMatchObject({ lastPage: false });
    expect(parseSearchData({ results: [] }).page).toEqual({ results: 0, privates: 0, lastPage: true });
  });
});

describe('copertina', () => {
  const photo = { id: 1, caption: 'Soggiorno', urls: { small: 'https://pwm.im-cdn.it/image/1/xxs-c.jpg', medium: 'https://pwm.im-cdn.it/image/1/m-c.jpg' } };
  const withPhoto = (p: unknown) => realEstate({ properties: [{ ...realEstate().properties[0], photo: p }] });
  const parse = (re: unknown) => A.parseNextData(searchNextData([searchResult(re)]), SEARCH_URL);

  it('prende la foto piccola della prima proprietà', () => {
    expect(parse(withPhoto(photo)).observations[0]!.coverUrl).toBe('https://pwm.im-cdn.it/image/1/xxs-c.jpg');
  });

  it('anche dalla risposta XHR', () => {
    const r = A.parseIntercepted(API_URL, { results: [searchResult(withPhoto(photo))] });
    expect(r.observations[0]!.coverUrl).toBe('https://pwm.im-cdn.it/image/1/xxs-c.jpg');
  });

  it('senza foto: null', () => {
    expect(parse(realEstate()).observations[0]!.coverUrl).toBeNull();
  });

  it('foto di forma inattesa o su un altro server: annuncio letto, copertina null', () => {
    for (const p of [{ urls: 'x' }, 42, { urls: { small: 'https://evil.example/x.jpg' } }]) {
      const r = parse(withPhoto(p));
      expect(r.errors).toEqual([]);
      expect(r.observations).toHaveLength(1);
      expect(r.observations[0]!.coverUrl).toBeNull();
    }
  });

  it('la didascalia della foto non esce', () => {
    expect(JSON.stringify(parse(withPhoto(photo)).observations)).not.toContain('Soggiorno');
  });
});
