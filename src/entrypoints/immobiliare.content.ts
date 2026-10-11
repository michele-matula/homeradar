import { immobiliareAdapter } from '@/adapters/immobiliare';
import { isBridgeMessage } from '@/bridge/bridge';
import { FALLBACK_TEXT, showBanner } from '@/content/banner';
import { createController } from '@/content/controller';
import { RouteWatcher } from '@/content/route-watcher';
import { send } from '@/shared/messages';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  runAt: 'document_start',
  main(ctx) {
    const controller = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => location.href });
    const watcher = new RouteWatcher({
      getUrl: () => location.href,
      isRelevant: (url) => immobiliareAdapter.pageKind(url) !== 'other',
      timeoutMs: 5000,
      graceMs: 3000,
      onMissing: () => {
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
  },
});
