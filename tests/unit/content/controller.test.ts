import { beforeEach, describe, expect, it, vi } from 'vitest';
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { createController } from '@/content/controller';
import { BADGE_ATTR } from '@/content/badges';
import type { Request } from '@/shared/messages';
import { API_URL, DETAIL_URL, SEARCH_URL, agencyAdvertiser, realEstate, searchNextData, searchResult } from '../adapters/builders';

beforeEach(() => {
  document.body.innerHTML = `<ul>
    <li><img><a href="/annunci/128416572/">a</a></li>
    <li><img><a href="/annunci/2/">b</a></li></ul>`;
});

function fakeSend() {
  return vi.fn(async (req: Request) => {
    if (req.type === 'ingest') {
      return req.observations.filter((o) => o.sellerType === 'private').map((o) => ({
        listingKey: `immobiliare:${o.portalId}`, portalId: o.portalId, priority: 'high', badgeText: '● Alta · 173 gg · −5,6%',
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
