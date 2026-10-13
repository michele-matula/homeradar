import { immobiliareAdapter } from '@/adapters/immobiliare';
import { runPayloadContentScript } from '@/content/payload-script';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  runAt: 'document_start',
  main(ctx) {
    runPayloadContentScript(ctx, immobiliareAdapter);
  },
});
