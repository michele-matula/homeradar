import { isInterceptedUrl } from '@/adapters/subito/urls';
import { installBridge } from '@/bridge/bridge';

// La fetch verso hades.subito.it è del sito: il bridge ne legge solo la risposta.
export default defineContentScript({
  matches: ['https://www.subito.it/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installBridge(window, isInterceptedUrl);
  },
});
