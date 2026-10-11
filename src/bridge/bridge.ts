// Gira nel contesto della pagina (MAIN world). Nessuna logica di business e nessuna
// richiesta propria: inoltra al content script solo ciò che il sito ha già caricato.
export const BRIDGE_SOURCE = 'homeradar-bridge';

export interface BridgeMessage {
  source: typeof BRIDGE_SOURCE;
  kind: 'next-data' | 'api';
  url: string;
  payload: unknown;
}

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  const d = data as Partial<BridgeMessage> | null;
  return !!d && d.source === BRIDGE_SOURCE && (d.kind === 'next-data' || d.kind === 'api') && typeof d.url === 'string';
}

export interface BridgeWindow {
  XMLHttpRequest: typeof XMLHttpRequest;
  fetch: typeof fetch;
  postMessage(message: unknown, targetOrigin: string): void;
  location: { origin: string; href: string };
  document: Document;
}

type TrackedXHR = XMLHttpRequest & { __homeradarUrl?: string };

export function installBridge(win: BridgeWindow, isInterceptedUrl: (url: string) => boolean): void {
  const post = (kind: BridgeMessage['kind'], url: string, payload: unknown) =>
    win.postMessage({ source: BRIDGE_SOURCE, kind, url, payload } satisfies BridgeMessage, win.location.origin);

  const proto = win.XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  proto.open = function (this: TrackedXHR, ...args: unknown[]) {
    this.__homeradarUrl = String(args[1]);
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as unknown as typeof proto.open;
  proto.send = function (this: TrackedXHR, ...args: unknown[]) {
    const url = this.__homeradarUrl;
    if (url && isInterceptedUrl(url)) {
      this.addEventListener('load', () => {
        try {
          post('api', url, this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        } catch {
          // risposta non JSON: ignorata
        }
      });
    }
    return (origSend as (...a: unknown[]) => void).apply(this, args);
  } as unknown as typeof proto.send;

  const origFetch = win.fetch;
  win.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const res = await origFetch.apply(this, args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (isInterceptedUrl(url)) {
        res.clone().json().then((payload) => post('api', url, payload), () => {});
      }
    } catch {
      // il ponte non deve mai rompere la fetch del sito
    }
    return res;
  } as unknown as typeof fetch;

  const sendNextData = () => {
    const text = win.document.getElementById('__NEXT_DATA__')?.textContent;
    if (!text) return;
    try {
      post('next-data', win.location.href, JSON.parse(text));
    } catch {
      // JSON non valido: il content script mostrerà il banner di riserva
    }
  };
  if (win.document.readyState === 'loading') {
    win.document.addEventListener('DOMContentLoaded', sendNextData, { once: true });
  } else {
    sendNextData();
  }
}
