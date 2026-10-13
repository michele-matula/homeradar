import type { PortalAdapter } from '@/adapters/types';
import { isBridgeMessage } from '@/bridge/bridge';
import { FALLBACK_TEXT, showBanner } from '@/content/banner';
import { createController } from '@/content/controller';
import { RouteWatcher } from '@/content/route-watcher';
import { send } from '@/shared/messages';

/** La parte del contesto WXT che serve qui. */
export interface ScriptContext {
  setInterval(handler: () => void, timeout?: number): number;
  onInvalidated(cb: () => void): () => void;
}

/**
 * Content script dei portali con bridge (Immobiliare, Subito): riceve i payload inoltrati dal
 * contesto della pagina, applica i badge e mostra il banner "ricarica" se dopo un cambio di rotta
 * non arrivano dati.
 */
export function runPayloadContentScript(ctx: ScriptContext, adapter: PortalAdapter): void {
  const controller = createController({ adapter, send, root: document, getUrl: () => location.href });
  const watcher = new RouteWatcher({
    getUrl: () => location.href,
    isRelevant: (url) => adapter.pageKind(url) !== 'other',
    timeoutMs: 5000,
    graceMs: 3000,
    onMissing: () => {
      // Il sito riusa i risultati già in cache (es. tornando indietro): se tutti gli annunci
      // in pagina sono già noti non manca nulla e il banner sarebbe un falso allarme.
      if (!controller.hasUnseenListings()) return;
      showBanner(document, FALLBACK_TEXT);
      send({ type: 'fallbackShown' }).catch(() => {});
    },
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || !isBridgeMessage(event.data)) return;
    watcher.notifyPayload();
    controller.handle(event.data.kind, event.data.url, event.data.payload).catch((err) => console.warn('[HomeRadar]', err));
  });

  watcher.check();
  ctx.setInterval(() => watcher.check(), 1000);

  let pending: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => controller.applyAll(), 300);
  });
  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  ctx.onInvalidated(() => observer.disconnect());
}
