import { beforeEach, describe, expect, it, vi } from 'vitest';
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { idealistaAdapter } from '@/adapters/idealista';
import type { PortalAdapter } from '@/adapters/types';
import type { ListingObservation } from '@/shared/types';
import { createController } from '@/content/controller';
import { BADGE_ATTR } from '@/content/badges';
import type { Request } from '@/shared/messages';
import { API_URL, DETAIL_URL, SEARCH_URL, agencyAdvertiser, realEstate, searchNextData, searchResult } from '../adapters/builders';
import { card as idealistaCard, NEWEST_URL, searchBody } from '../adapters/idealista-builders';

beforeEach(() => {
  document.body.innerHTML = `<ul>
    <li><img><a href="/annunci/128416572/">a</a></li>
    <li><img><a href="/annunci/2/">b</a></li></ul>`;
});

function fakeSend() {
  return vi.fn(async (req: Request) => {
    if (req.type === 'ingest') {
      return req.observations.filter((o) => o.sellerType === 'private').map((o) => ({
        listingKey: `${o.portal}:${o.portalId}`, portalId: o.portalId, priority: 'high', badgeText: '● Alta · 173 gg · −5,6%',
      }));
    }
    return null;
  });
}

describe('createController', () => {
  it('su un portale spento non legge nulla e toglie i badge già mostrati', async () => {
    const send = fakeSend();
    let on = true;
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL, portalState: async () => (on ? 'active' : 'off') });
    const payload = searchNextData([searchResult(realEstate())]);
    await c.handle('next-data', SEARCH_URL, payload);
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    on = false;
    send.mockClear();
    await c.handle('next-data', SEARCH_URL, payload);
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
    c.applyAll();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
  });

  it('su Idealista spento non legge le card', async () => {
    document.body.innerHTML = searchBody([idealistaCard({ id: 1 })]);
    const send = fakeSend();
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => NEWEST_URL, portalState: async () => 'off' });
    await c.scan();
    expect(send).not.toHaveBeenCalled();
  });

  it("senza conferma dell'informativa non legge, toglie i badge e chiede l'avviso una volta sola", async () => {
    const send = fakeSend();
    let state: 'active' | 'onboarding' = 'active';
    const onOnboardingNeeded = vi.fn();
    const c = createController({
      adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL, portalState: async () => state, onOnboardingNeeded,
    });
    const payload = searchNextData([searchResult(realEstate())]);
    await c.handle('next-data', SEARCH_URL, payload);
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    state = 'onboarding';
    send.mockClear();
    await c.handle('next-data', SEARCH_URL, payload);
    await c.handle('next-data', SEARCH_URL, payload);
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
    expect(onOnboardingNeeded).toHaveBeenCalledTimes(1);
    expect(await c.isEnabled()).toBe(false);
  });

  it('su Idealista, dopo la conferma, legge alla scansione successiva senza ricaricare', async () => {
    document.body.innerHTML = searchBody([idealistaCard({ id: 1 })]);
    const send = fakeSend();
    let state: 'active' | 'onboarding' = 'onboarding';
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => NEWEST_URL, portalState: async () => state });
    await c.scan();
    expect(send).not.toHaveBeenCalled();
    state = 'active';
    await c.scan();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingest' }));
  });

  it('se lo stato del portale non si legge non legge nulla', async () => {
    const send = fakeSend();
    const c = createController({
      adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL,
      portalState: async () => { throw new Error('Nessuna risposta dal background'); },
    });
    await expect(c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate())]))).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
  });

  it('invia lo stato del parsing, ingerisce e disegna i badge solo per i privati', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('next-data', SEARCH_URL, searchNextData([
      searchResult(realEstate()),
      searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2),
    ]));
    expect(send.mock.calls[0]![0]).toEqual({ type: 'parseStatus', portal: 'immobiliare', ok: true, errors: [], source: 'next-data' });
    expect(send.mock.calls[1]![0]).toMatchObject({ type: 'ingest' });
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
  });

  it('segnala un errore di parsing senza chiamare ingest', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('api', 'https://www.immobiliare.it/api-next/search-list/listings/', { nope: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual({ type: 'parseStatus', portal: 'immobiliare', ok: false, errors: ['search data not found'], source: 'api' });
  });

  it('ridisegna i badge dopo che il sito ha rigenerato le card', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate())]));
    document.body.innerHTML = '<ul><li><img><a href="/annunci/128416572/">a</a></li></ul>';
    c.applyAll();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
  });

  it('ignora i payload api quando la pagina corrente non è una ricerca', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => DETAIL_URL });
    await c.handle('api', API_URL, { results: [searchResult(realEstate())] });
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
  });

  it('segnala ok=false quando tutti i risultati hanno venditore sconosciuto', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate({ advertiser: null }))]));
    expect(send.mock.calls[0]![0]).toMatchObject({ type: 'parseStatus', ok: false });
  });

  it('segnala ok=false quando più del 20% dei risultati fallisce la validazione', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('next-data', SEARCH_URL, searchNextData([
      searchResult(realEstate()),
      searchResult({ title: 'rotto' }),
      searchResult({ title: 'rotto' }),
    ]));
    expect(send.mock.calls[0]![0]).toMatchObject({ type: 'parseStatus', ok: false });
    expect(send.mock.calls[1]![0]).toMatchObject({ type: 'ingest' });
  });

  it('sa se in pagina ci sono annunci mai ricevuti (agenzie comprese)', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    expect(c.hasUnseenListings()).toBe(true);
    await c.handle('next-data', SEARCH_URL, searchNextData([
      searchResult(realEstate()),
      searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2),
    ]));
    expect(c.hasUnseenListings()).toBe(false);
    document.querySelector('ul')!.insertAdjacentHTML('beforeend', '<li><img><a href="/annunci/999/">nuovo</a></li>');
    expect(c.hasUnseenListings()).toBe(true);
  });

  it('nessun annuncio in pagina: niente da segnalare', () => {
    document.body.innerHTML = '<p>caricamento…</p>';
    const c = createController({ adapter: immobiliareAdapter, send: fakeSend(), root: document, getUrl: () => SEARCH_URL });
    expect(c.hasUnseenListings()).toBe(false);
  });

  it('resta ok=true per una pagina senza risultati e senza errori', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('next-data', SEARCH_URL, searchNextData([]));
    expect(send.mock.calls[0]![0]).toMatchObject({ type: 'parseStatus', ok: true });
  });
});

describe('createController in modalità DOM', () => {
  const url = 'https://portale.test/vendita/';
  const card = (id: number) => `<article data-id="${id}"><div class="foto"><img></div></article>`;
  const obsFor = (id: number): ListingObservation => ({
    portal: 'idealista', portalId: id, url: `https://portale.test/immobile/${id}/`, title: 't', address: null, city: null, zone: null,
    typology: null, category: null, surfaceM2: null, rooms: null, price: 1, sellerType: 'private', portalCreatedAt: null, lastDrop: null, coverUrl: null, source: 'search',
  });
  // Adattatore minimo: una card = un privato; la pagina "?nuovi" segnala l'ID più recente.
  const domAdapter: PortalAdapter = {
    portal: 'idealista',
    pageKind: () => 'search',
    readDocument(root, u) {
      const ids = [...root.querySelectorAll('article[data-id]')].map((a) => Number(a.getAttribute('data-id')));
      return {
        observations: ids.map((id) => obsFor(id)),
        errors: [],
        ...(u.endsWith('?nuovi') && ids.length ? { newestId: Math.max(...ids) } : {}),
      };
    },
    cardFor: (root, id) => root.querySelector<HTMLElement>(`article[data-id="${id}"]`),
    badgeHost: (c) => c.querySelector<HTMLElement>('.foto') ?? c,
    cardIds: (root) => [...root.querySelectorAll('article[data-id]')].map((a) => Number(a.getAttribute('data-id'))),
  };
  const ingests = (send: ReturnType<typeof fakeSend>) =>
    send.mock.calls.map((c) => c[0]).filter((r): r is Extract<Request, { type: 'ingest' }> => r.type === 'ingest');

  it('legge le card, invia lo stato "dom" e disegna i badge', async () => {
    document.body.innerHTML = card(1) + card(2);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    expect(send.mock.calls[0]![0]).toEqual({ type: 'parseStatus', portal: 'idealista', ok: true, errors: [], source: 'dom' });
    expect(ingests(send)).toHaveLength(1);
    expect(document.querySelectorAll(`.foto > [${BADGE_ATTR}]`)).toHaveLength(2);
  });

  it('scan ripetuto senza card nuove non reinvia nulla (niente cicli col MutationObserver)', async () => {
    document.body.innerHTML = card(1);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    await c.scan();
    await c.scan();
    expect(send).toHaveBeenCalledTimes(2); // un parseStatus + un ingest
  });

  it('invia solo le card aggiunte dopo il primo scan', async () => {
    document.body.innerHTML = card(1);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    document.body.insertAdjacentHTML('beforeend', card(3));
    await c.scan();
    expect(ingests(send).map((r) => r.observations.map((o) => o.portalId))).toEqual([[1], [3]]);
  });

  it("passa l'ID più recente come candidato di calibrazione", async () => {
    document.body.innerHTML = card(5) + card(9);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => `${url}?nuovi` });
    await c.scan();
    expect(ingests(send)[0]).toMatchObject({ calibrationHint: { portal: 'idealista', portalId: 9 } });
  });

  it('un adattatore senza readDocument non fa nulla in scan', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.scan();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("createController con l'adattatore Idealista", () => {
  it('ingerisce le card della pagina "più recenti", disegna i badge solo sui privati e passa il candidato', async () => {
    document.body.innerHTML = searchBody([idealistaCard({ id: 37142258, professional: 'true' }), idealistaCard({ id: 37142311 })]);
    const send = fakeSend();
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => NEWEST_URL });
    await c.scan();
    expect(send.mock.calls[0]![0]).toMatchObject({ type: 'parseStatus', portal: 'idealista', ok: true, source: 'dom' });
    expect(send.mock.calls[1]![0]).toMatchObject({ type: 'ingest', calibrationHint: { portal: 'idealista', portalId: 37142311 } });
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    expect(document.querySelector(`article[data-element-id="37142311"] [${BADGE_ATTR}]`)).not.toBeNull();
  });
});

describe('createController DOM: errori e card caricate dopo', () => {
  const BROKEN = '<article class="item"><a class="item-link"></a></article>';
  it('non rimanda gli errori già segnalati quando arrivano card nuove (niente falso avviso)', async () => {
    const goods = Array.from({ length: 9 }, (_, i) => idealistaCard({ id: 100 + i }));
    document.body.innerHTML = searchBody([...goods, BROKEN]);
    const send = fakeSend();
    const url = 'https://www.idealista.it/vendita-case/milano-milano/';
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    document.querySelector('section')!.insertAdjacentHTML('beforeend', idealistaCard({ id: 200 }));
    await c.scan();
    const statuses = send.mock.calls.map((x) => x[0]).filter((r) => r.type === 'parseStatus');
    expect(statuses).toHaveLength(2);
    expect(statuses[0]).toMatchObject({ ok: true, errors: ['card[9]: id o titolo mancanti'] });
    expect(statuses[1]).toMatchObject({ ok: true, errors: [] });
  });
});

describe('pageRead per il giro', () => {
  it('dopo ingest invia il riassunto della pagina, anche senza annunci', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate()), searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2)]));
    const types = send.mock.calls.map(([r]) => r.type);
    expect(types.indexOf('pageRead')).toBeGreaterThan(types.indexOf('ingest'));
    expect(send.mock.calls.at(-1)![0]).toEqual({
      type: 'pageRead', report: { portal: 'immobiliare', url: SEARCH_URL, results: 2, privates: 1, lastPage: false, blocked: false, notFound: false, parseErrors: 0 },
    });
    send.mockClear();
    await c.handle('next-data', SEARCH_URL, searchNextData([]));
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'pageRead', report: { results: 0, lastPage: true } });
  });

  it('checkProblem segnala la verifica e la pagina inesistente solo sulle pagine di ricerca', async () => {
    const send = fakeSend();
    let url = SEARCH_URL;
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => url });
    const captcha = new DOMParser().parseFromString('<body><iframe src="https://geo.captcha-delivery.com/x"></iframe></body>', 'text/html');
    await c.checkProblem(captcha);
    expect(send).toHaveBeenLastCalledWith({
      type: 'pageRead', report: { portal: 'immobiliare', url: SEARCH_URL, results: 0, privates: 0, lastPage: true, blocked: true, notFound: false, parseErrors: 0 },
    });
    const missing = new DOMParser().parseFromString('<body>La pagina che stai cercando non è presente</body>', 'text/html');
    await c.checkProblem(missing);
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ report: { blocked: false, notFound: true } });
    send.mockClear();
    url = DETAIL_URL;
    await c.checkProblem(captcha);
    await c.checkProblem(new DOMParser().parseFromString('<body><ul></ul></body>', 'text/html'));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('revisione: pagina di verifica su Idealista', () => {
  it('una pagina di verifica non chiude la ricerca come completa: manda solo il blocco', async () => {
    document.body.innerHTML = '<h1>Ops! Al momento non siamo disponibili</h1>';
    const send = fakeSend();
    const url = 'https://www.idealista.it/vendita-case/treviglio-bergamo/?ordine=da-privati-asc';
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    const reads = send.mock.calls.map(([r]) => r).filter((r) => r.type === 'pageRead');
    expect(reads).toEqual([{ type: 'pageRead', report: expect.objectContaining({ blocked: true, notFound: false }) }]);
  });
});

describe('revisione: errori di lettura nel riassunto', () => {
  it('conta gli annunci non letti e i venditori non riconosciuti', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    const broken = { realEstate: { id: 'x' } };
    const unknownSeller = searchResult(realEstate({ id: 3, advertiser: {} }), 3);
    await c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate()), broken, unknownSeller]));
    expect(send.mock.calls.at(-1)![0]).toMatchObject({ type: 'pageRead', report: { parseErrors: 2 } });
  });
});
