import { describe, expect, it, vi } from 'vitest';
import { createFileSaver, isOffscreenRequest, OFFSCREEN_TARGET, type DownloadItemLike, type SaverPlatform } from '@/background/file-saver';

function platform(item?: DownloadItemLike): SaverPlatform {
  return {
    ensureOffscreen: vi.fn(async () => {}),
    closeOffscreen: vi.fn(async () => {}),
    sendToOffscreen: vi.fn(async (msg) => (msg.type === 'createBlobUrl' ? 'blob:chrome-extension://x/1' : null)),
    download: vi.fn(async () => 7),
    findDownload: vi.fn(async () => item),
  };
}

describe('createFileSaver', () => {
  it("crea il blob nell'offscreen e avvia il download con quell'URL", async () => {
    const p = platform();
    const s = createFileSaver(p);
    const url = await s.createUrl('{"a":1}');
    expect(p.ensureOffscreen).toHaveBeenCalled();
    expect(p.sendToOffscreen).toHaveBeenCalledWith({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json: '{"a":1}' });
    await s.startDownload(url, 'HomeRadar/homeradar-backup-1.json');
    expect(p.download).toHaveBeenCalledWith({ url: 'blob:chrome-extension://x/1', filename: 'HomeRadar/homeradar-backup-1.json' });
    // L'offscreen resta aperto finché il download non è concluso.
    expect(p.closeOffscreen).not.toHaveBeenCalled();
  });

  it('rifiuta se il documento offscreen non risponde', async () => {
    const p = platform();
    p.sendToOffscreen = vi.fn(async () => undefined);
    await expect(createFileSaver(p).createUrl('{}')).rejects.toThrow('documento offscreen non disponibile');
  });

  it.each([
    [undefined, { state: 'missing' }],
    [{ state: 'in_progress' }, { state: 'in_progress' }],
    [{ state: 'complete' }, { state: 'complete' }],
    [{ state: 'interrupted', error: 'USER_CANCELED' }, { state: 'interrupted', error: 'USER_CANCELED' }],
    [{ state: 'interrupted' }, { state: 'interrupted', error: 'motivo sconosciuto' }],
  ])('esito del download %j', async (item, outcome) => {
    const p = platform(item);
    expect(await createFileSaver(p).downloadOutcome('blob:chrome-extension://x/1')).toEqual(outcome);
    expect(p.findDownload).toHaveBeenCalledWith('blob:chrome-extension://x/1');
  });

  it("release revoca l'URL e chiude l'offscreen, anche se l'offscreen non c'è più", async () => {
    const p = platform();
    p.sendToOffscreen = vi.fn(async () => { throw new Error('no receiver'); });
    p.closeOffscreen = vi.fn(async () => { throw new Error('no document'); });
    await expect(createFileSaver(p).release('blob:chrome-extension://x/1')).resolves.toBeUndefined();
    expect(p.sendToOffscreen).toHaveBeenCalledWith({ target: OFFSCREEN_TARGET, type: 'revokeBlobUrl', url: 'blob:chrome-extension://x/1' });
    expect(p.closeOffscreen).toHaveBeenCalled();
  });
});

describe('isOffscreenRequest', () => {
  it("riconosce solo i messaggi per l'offscreen", () => {
    expect(isOffscreenRequest({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json: '' })).toBe(true);
    expect(isOffscreenRequest({ type: 'listLeads' })).toBe(false);
    expect(isOffscreenRequest(undefined)).toBe(false);
  });
});
