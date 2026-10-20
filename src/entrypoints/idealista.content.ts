import { idealistaAdapter } from '@/adapters/idealista';
import { showOnboardingBanner } from '@/content/banner';
import { createController } from '@/content/controller';
import { portalState, send } from '@/shared/messages';

// Idealista è renderizzato lato server: si legge il DOM già mostrato, senza bridge.
// La pagina non viene modificata, se non per aggiungere i badge.
export default defineContentScript({
  matches: ['https://www.idealista.it/*'],
  runAt: 'document_idle',
  main(ctx) {
    const controller = createController({
      adapter: idealistaAdapter, send, root: document, getUrl: () => location.href,
      portalState: () => portalState('idealista'),
      onOnboardingNeeded: () => showOnboardingBanner(document, () => send({ type: 'openOnboarding' })),
    });
    const scan = () => controller.scan().catch((err) => console.warn('[HomeRadar]', err));
    scan();
    // Verifica di DataDome: nessuna card, il giro lo deve sapere subito.
    setTimeout(() => void controller.checkProblem(document).catch(() => {}), 2500);

    // Card caricate dopo (lazy-load) o rigenerate dal sito: nuova lettura con debounce.
    // scan() senza card nuove riapplica solo i badge, quindi i badge inseriti non creano cicli.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(scan, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
