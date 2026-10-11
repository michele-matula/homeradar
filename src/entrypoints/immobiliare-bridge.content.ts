import { isListingsApiUrl } from '@/adapters/immobiliare/urls';
import { installBridge } from '@/bridge/bridge';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installBridge(window, isListingsApiUrl);
  },
});
