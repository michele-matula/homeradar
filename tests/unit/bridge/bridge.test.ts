import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_SOURCE, installBridge, isBridgeMessage, type BridgeWindow } from '@/bridge/bridge';

interface FakeXHR extends EventTarget {
  responseType: string;
  responseText: string;
  response: unknown;
  open(method: string, url: string): void;
  send(): void;
}

function fakeWindow(nextData?: string) {
  // Classe nuova a ogni test: installBridge modifica il prototype.
  const FakeXHR = class extends EventTarget {
    responseType = '';
    responseText = '';
    response: unknown = null;
    open(_method: string, _url: string) {}
    send() {}
  };
  document.body.innerHTML = nextData ? `<script id="__NEXT_DATA__" type="application/json">${nextData}</script>` : '';
  const postMessage = vi.fn();
  const win = {
    XMLHttpRequest: FakeXHR as unknown as typeof XMLHttpRequest,
    fetch: vi.fn(async () => new Response('{"results":[1]}')) as unknown as typeof fetch,
    postMessage,
    location: { origin: 'https://www.immobiliare.it', href: 'https://www.immobiliare.it/vendita-case/milano/' },
    document,
  } satisfies BridgeWindow;
  return { win, postMessage };
}

const isApi = (url: string) => url.includes('/api-next/search-list/listings/');

describe('installBridge', () => {
  it('inoltra __NEXT_DATA__ quando il documento è pronto', () => {
    const { win, postMessage } = fakeWindow('{"props":{"a":1}}');
    installBridge(win, isApi);
    expect(postMessage).toHaveBeenCalledWith(
      { source: BRIDGE_SOURCE, kind: 'next-data', url: win.location.href, payload: { props: { a: 1 } } },
      'https://www.immobiliare.it',
    );
  });

  it('inoltra le risposte XHR della chiamata dei risultati e ignora le altre', () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isApi);
    const ok = new win.XMLHttpRequest() as unknown as FakeXHR;
    ok.open('GET', '/api-next/search-list/listings/?pag=2');
    ok.send();
    ok.responseText = '{"results":[]}';
    ok.dispatchEvent(new Event('load'));
    const other = new win.XMLHttpRequest() as unknown as FakeXHR;
    other.open('GET', '/api-next/listing/banners/');
    other.send();
    other.responseText = '{"x":1}';
    other.dispatchEvent(new Event('load'));
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]![0]).toEqual({ source: BRIDGE_SOURCE, kind: 'api', url: '/api-next/search-list/listings/?pag=2', payload: { results: [] } });
  });

  it('ignora risposte XHR non JSON', () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isApi);
    const x = new win.XMLHttpRequest() as unknown as FakeXHR;
    x.open('GET', '/api-next/search-list/listings/');
    x.send();
    x.responseText = '<html>';
    expect(() => x.dispatchEvent(new Event('load'))).not.toThrow();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('inoltra le risposte fetch della chiamata dei risultati senza consumarle', async () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isApi);
    const res = await win.fetch('https://www.immobiliare.it/api-next/search-list/listings/?pag=3');
    await expect(res.json()).resolves.toEqual({ results: [1] });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls[0]![0]).toMatchObject({ kind: 'api', payload: { results: [1] } });
  });

  it('restituisce sempre la risposta originale anche se il ponte va in errore', async () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, () => {
      throw new Error('boom');
    });
    const res = await win.fetch('https://www.immobiliare.it/api-next/search-list/listings/?pag=3');
    await expect(res.json()).resolves.toEqual({ results: [1] });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe('isBridgeMessage', () => {
  it('accetta solo messaggi del ponte ben formati', () => {
    expect(isBridgeMessage({ source: BRIDGE_SOURCE, kind: 'api', url: '/x', payload: {} })).toBe(true);
    expect(isBridgeMessage({ source: 'altro', kind: 'api', url: '/x', payload: {} })).toBe(false);
    expect(isBridgeMessage({ source: BRIDGE_SOURCE, kind: 'boh', url: '/x' })).toBe(false);
    expect(isBridgeMessage(null)).toBe(false);
  });
});
