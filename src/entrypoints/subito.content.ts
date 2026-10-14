import { subitoAdapter } from '@/adapters/subito';
import { runPayloadContentScript } from '@/content/payload-script';

export default defineContentScript({
  matches: ['https://www.subito.it/*'],
  runAt: 'document_start',
  main(ctx) {
    runPayloadContentScript(ctx, subitoAdapter);
  },
});
