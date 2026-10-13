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
    typology: null, surfaceM2: null, rooms: null, price: 1, sellerType: 'private', portalCreatedAt: null, lastDrop: null, source: 'search',
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
