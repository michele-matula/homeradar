import { browser } from 'wxt/browser';
import { isOffscreenRequest } from '@/background/file-saver';

// Documento invisibile aperto dal background solo per creare il file del backup automatico.
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isOffscreenRequest(msg)) return false;
  if (msg.type === 'createBlobUrl') sendResponse(URL.createObjectURL(new Blob([msg.json], { type: 'application/json' })));
  else {
    URL.revokeObjectURL(msg.url);
    sendResponse(null);
  }
  return false;
});
