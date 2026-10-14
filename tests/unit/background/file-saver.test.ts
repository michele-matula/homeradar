import { describe, expect, it, vi } from 'vitest';
import { createFileSaver, isOffscreenRequest, OFFSCREEN_TARGET, type DownloadDelta, type SaverPlatform } from '@/background/file-saver';

function platform(onDownload: (emit: (d: DownloadDelta) => void) => void = (emit) => setTimeout(() => emit({ id: 7, state: { current: 'complete' } }))) {
  let listener: ((d: DownloadDelta) => void) | null = null;
  const emit = (d: DownloadDelta) => listener?.(d);
  const p: SaverPlatform = {
    ensureOffscreen: vi.fn(async () => {}),
    closeOffscreen: vi.fn(async () => {}),
    sendToOffscreen: vi.fn(async (msg) => (msg.type === 'createBlobUrl' ? 'blob:chrome-extension://x/1' : null)),
    download: vi.fn(async () => {
      onDownload(emit);
      return 7;
    }),
    onDownloadChanged: vi.fn((l) => {
      listener = l;
      return () => { listener = null; };
    }),
  };
  return p;
}

describe('createFileSaver', () => {
  it('crea il blob nell\'offscreen, scarica e attende il completamento, poi pulisce', async () => {
    const p = platform();
    await createFileSaver(p)('{"a":1}', 'HomeRadar/homeradar-backup-1.json');
    expect(p.sendToOffscreen).toHaveBeenNthCalledWith(1, { target: OFFSCREEN_TARGET, type: 'createBlobUrl', json: '{"a":1}' });
    expect(p.download).toHaveBeenCalledWith({ url: 'blob:chrome-extension://x/1', filename: 'HomeRadar/homeradar-backup-1.json' });
    expect(p.sendToOffscreen).toHaveBeenLastCalledWith({ target: OFFSCREEN_TARGET, type: 'revokeBlobUrl', url: 'blob:chrome-extension://x/1' });
    expect(p.closeOffscreen).toHaveBeenCalled();
  });

  it('non resta appeso se il completamento arriva prima che download() restituisca l\'id', async () => {
    const p = platform((emit) => emit({ id: 7, state: { current: 'complete' } }));
    await expect(createFileSaver(p, 50)('{}', 'f.json')).resolves.toBeUndefined();
  });

  it('ignora i download di altri id', async () => {
    const p = platform((emit) => {
      emit({ id: 3, state: { current: 'interrupted' } });
      setTimeout(() => emit({ id: 7, state: { current: 'complete' } }));
    });
    await expect(createFileSaver(p)('{}', 'f.json')).resolves.toBeUndefined();
  });

  it('rifiuta con il motivo se il download si interrompe, e pulisce comunque', async () => {
    const p = platform((emit) => setTimeout(() => emit({ id: 7, state: { current: 'interrupted' }, error: { current: 'FILE_FAILED' } })));
    await expect(createFileSaver(p)('{}', 'f.json')).rejects.toThrow('download interrotto (FILE_FAILED)');
    expect(p.closeOffscreen).toHaveBeenCalled();
  });

  it('rifiuta allo scadere del tempo', async () => {
    const p = platform(() => {});
    await expect(createFileSaver(p, 20)('{}', 'f.json')).rejects.toThrow('download non completato in tempo');
  });

  it('rifiuta se il documento offscreen non risponde', async () => {
    const p = platform();
    p.sendToOffscreen = vi.fn(async () => undefined);
    await expect(createFileSaver(p)('{}', 'f.json')).rejects.toThrow('documento offscreen non disponibile');
    expect(p.download).not.toHaveBeenCalled();
  });
});

describe('isOffscreenRequest', () => {
  it('riconosce solo i messaggi per l\'offscreen', () => {
    expect(isOffscreenRequest({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json: '' })).toBe(true);
    expect(isOffscreenRequest({ type: 'listLeads' })).toBe(false);
    expect(isOffscreenRequest(undefined)).toBe(false);
  });
});
