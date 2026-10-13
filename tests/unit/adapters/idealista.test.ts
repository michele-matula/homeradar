import { beforeEach, describe, expect, it } from 'vitest';
import { idealistaAdapter as A } from '@/adapters/idealista';
import { parseTitle } from '@/adapters/idealista/parse';
import { isNewestFirst, listingIdFromHref, pageKind } from '@/adapters/idealista/urls';
import { AD_SLOT, GEO_REACH_CARD, card, DESCRIPTION, DETAIL_URL, NEWEST_URL, renderDetail, SEARCH_URL, searchBody, SELLER_NAME } from './idealista-builders';

const read = (url = SEARCH_URL) => A.readDocument!(document, url);

beforeEach(() => {
  document.title = '';
  document.body.innerHTML = '';
});

describe('urls', () => {
  it('riconosce ricerca, pagine successive, scheda e affitti', () => {
    expect(pageKind(SEARCH_URL)).toBe('search');
    expect(pageKind('https://www.idealista.it/vendita-case/milano-milano/lista-2.htm')).toBe('search');
    expect(pageKind(DETAIL_URL)).toBe('detail');
    expect(pageKind('https://www.idealista.it/affitto-case/milano-milano/')).toBe('other');
    expect(pageKind('https://www.idealista.it/')).toBe('other');
  });
  it("estrae l'ID dai link", () => {
    expect(listingIdFromHref('/immobile/37118651/')).toBe(37118651);
    expect(listingIdFromHref('/agenzie-immobiliari/1/')).toBeNull();
  });
  it('"più recenti" vale solo sulla prima pagina', () => {
    expect(isNewestFirst(NEWEST_URL)).toBe(true);
    expect(isNewestFirst('https://www.idealista.it/vendita-case/milano-milano/lista-2.htm?ordine=pubblicazione-desc')).toBe(false);
    expect(isNewestFirst(SEARCH_URL)).toBe(false);
  });
});

describe('parseTitle', () => {
  it('separa tipologia, indirizzo con civico, zona e città', () => {
    expect(parseTitle('Trilocale in Via Rogoredo, 27, Rogoredo - Santa Giulia, Milano')).toEqual({
      typology: 'Trilocale', address: 'Via Rogoredo, 27', zone: 'Rogoredo - Santa Giulia', city: 'Milano',
    });
  });
  it('accetta il titolo della scheda ("in vendita in")', () => {
    expect(parseTitle('Bilocale in vendita in Via Esempio, 2, Mercalli - Quadronno, Milano')).toMatchObject({ typology: 'Bilocale', address: 'Via Esempio, 2' });
  });
  it('senza via: zona e città, indirizzo nullo', () => {
    expect(parseTitle('Bilocale in Lorenteggio, Milano')).toEqual({ typology: 'Bilocale', address: null, zone: 'Lorenteggio', city: 'Milano' });
  });
  it('via senza zona: la riconosce come indirizzo', () => {
    expect(parseTitle('Villa in Via Esempio, Milano')).toEqual({ typology: 'Villa', address: 'Via Esempio', zone: null, city: 'Milano' });
  });
  it('civico senza zona: resta nell\'indirizzo, non diventa la zona', () => {
    expect(parseTitle('Trilocale in Via Roma, 27, Milano')).toEqual({ typology: 'Trilocale', address: 'Via Roma, 27', zone: null, city: 'Milano' });
  });
  it('titolo non riconosciuto: tutto nullo', () => {
    expect(parseTitle('???')).toEqual({ typology: null, address: null, zone: null, city: null });
  });
});

describe('ricerca', () => {
  it('legge un privato con tutti i campi', () => {
    document.body.innerHTML = searchBody([card()]);
    expect(read()).toEqual({
      errors: [],
      observations: [{
        portal: 'idealista', portalId: 37118651, url: 'https://www.idealista.it/immobile/37118651/',
        title: 'Quadrilocale in Via Esempio, 1, Precotto, Milano', address: 'Via Esempio, 1', city: 'Milano', zone: 'Precotto',
        typology: 'Quadrilocale', surfaceM2: 101, rooms: 4, price: 245000, sellerType: 'private', portalCreatedAt: null,
        lastDrop: null, source: 'search',
      }],
    });
  });

  it('distingue agenzia, privato e flag assente; ignora le pubblicità', () => {
    document.body.innerHTML = searchBody([card({ id: 1, professional: 'true' }), AD_SLOT, card({ id: 2 }), card({ id: 3, professional: null })]);
    expect(read().observations.map((o) => [o.portalId, o.sellerType])).toEqual([[1, 'agency'], [2, 'private'], [3, 'unknown']]);
  });

  it('legge il ribasso senza data e ricalcola la percentuale', () => {
    document.body.innerHTML = searchBody([card({ price: '625.000€', drop: { from: '645.000 €', pct: '3%' } })]);
    expect(read().observations[0]!.lastDrop).toEqual({ fromPrice: 645000, toPrice: 625000, percent: 3.1, date: null });
  });

  it('prezzo su richiesta: prezzo e ribasso nulli', () => {
    document.body.innerHTML = searchBody([card({ price: 'Prezzo su richiesta', drop: { from: '645.000 €', pct: '3%' } })]);
    expect(read().observations[0]).toMatchObject({ price: null, lastDrop: null });
  });

  it('non scambia importi o piani per m² e locali', () => {
    document.body.innerHTML = searchBody([card({ details: ['Box opz. 30.000 €', '1 locale', '45 m²', '2º piano'] })]);
    expect(read().observations[0]).toMatchObject({ rooms: 1, surfaceM2: 45 });
    document.body.innerHTML = searchBody([card({ details: ['Box compreso', 'Piano terra'] })]);
    expect(read().observations[0]).toMatchObject({ rooms: null, surfaceM2: null });
  });

  it('segnala le card senza ID o titolo', () => {
    document.body.innerHTML = searchBody([card(), '<article class="item"><a class="item-link"></a></article>']);
    const r = read();
    expect(r.observations).toHaveLength(1);
    expect(r.errors).toEqual(['card[1]: id o titolo mancanti']);
  });

  it('salta gli annunci suggeriti delle zone vicine senza segnalare errori', () => {
    document.body.innerHTML = searchBody([card({ id: 1 }), GEO_REACH_CARD, card({ id: 2 })]);
    expect(read()).toMatchObject({ errors: [], observations: [{ portalId: 1 }, { portalId: 2 }] });
    expect(A.cardIds(document)).toEqual([1, 2]);
    expect(A.cardFor(document, 30490345)).toBeNull();
  });

  it('pagina senza card (es. blocco anti-bot): nessun errore', () => {
    document.body.innerHTML = '<p>Ops! Al momento non siamo disponibili</p>';
    expect(read()).toEqual({ observations: [], errors: [] });
  });

  it('sulla pagina "più recenti" indica l\'ID più alto', () => {
    document.body.innerHTML = searchBody([card({ id: 37142258, professional: 'true' }), card({ id: 37142311 }), card({ id: 37072729 })]);
    expect(read(NEWEST_URL).newestId).toBe(37142311);
    expect(read().newestId).toBeUndefined();
  });

  it('non salva mai la descrizione', () => {
    document.body.innerHTML = searchBody([card()]);
    expect(JSON.stringify(read())).not.toContain(DESCRIPTION);
  });
});

describe('scheda', () => {
  it('legge il privato dal titolo, dal prezzo e dalle caratteristiche', () => {
    renderDetail(document, { drop: { from: '450.000 €', pct: '1%' } });
    expect(read(DETAIL_URL)).toEqual({
      errors: [],
      observations: [{
        portal: 'idealista', portalId: 37118651, url: DETAIL_URL,
        title: 'Bilocale in Via Esempio, 2, Mercalli - Quadronno, Milano', address: 'Via Esempio, 2', city: 'Milano',
        zone: 'Mercalli - Quadronno', typology: 'Bilocale', surfaceM2: 52, rooms: 2, price: 445000, sellerType: 'private',
        portalCreatedAt: null, lastDrop: { fromPrice: 450000, toPrice: 445000, percent: 1.1, date: null }, source: 'detail',
      }],
    });
  });

  it('agenzia e venditore non riconoscibile', () => {
    renderDetail(document, { seller: 'agency' });
    expect(read(DETAIL_URL).observations[0]!.sellerType).toBe('agency');
    renderDetail(document, { seller: 'none' });
    expect(read(DETAIL_URL).observations[0]!.sellerType).toBe('unknown');
  });

  it('ignora gli annunci correlati in fondo alla scheda', () => {
    renderDetail(document, { related: [card({ id: 1 }), card({ id: 2 })] });
    expect(read(DETAIL_URL).observations.map((o) => o.portalId)).toEqual([37118651]);
  });

  it('ignora gli affitti', () => {
    renderDetail(document, { title: 'Bilocale in affitto in Via Esempio, 2, Brera, Milano' });
    expect(read(DETAIL_URL)).toEqual({ observations: [], errors: [] });
  });

  it('non salva mai il nome del venditore né la descrizione', () => {
    renderDetail(document);
    const text = JSON.stringify(read(DETAIL_URL));
    expect(text).not.toContain(SELLER_NAME);
    expect(text).not.toContain(DESCRIPTION);
  });

  it('senza blocco prezzo segnala un errore', () => {
    renderDetail(document);
    document.querySelectorAll('.info-data').forEach((e) => e.remove());
    expect(read(DETAIL_URL).errors).toEqual(['detail: prezzo non trovato']);
  });
});

describe('card in pagina', () => {
  it('trova la card, il contenitore della foto e gli ID', () => {
    document.body.innerHTML = searchBody([card({ id: 1 }), AD_SLOT, card({ id: 2, professional: 'true' })]);
    const c = A.cardFor(document, 1)!;
    expect(c.getAttribute('data-element-id')).toBe('1');
    expect(A.badgeHost(c).className).toBe('item-multimedia');
    expect(A.cardFor(document, 99)).toBeNull();
    expect(A.cardIds(document)).toEqual([1, 2]);
  });
});
