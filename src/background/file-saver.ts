import type { AutoBackupDeps, DownloadOutcome } from '@/core/auto-backup';

export const OFFSCREEN_TARGET = 'homeradar-offscreen';

export type OffscreenRequest =
  | { target: typeof OFFSCREEN_TARGET; type: 'createBlobUrl'; json: string }
  | { target: typeof OFFSCREEN_TARGET; type: 'revokeBlobUrl'; url: string };

export function isOffscreenRequest(msg: unknown): msg is OffscreenRequest {
  return (msg as { target?: unknown } | undefined)?.target === OFFSCREEN_TARGET;
}

/** Il download di Chrome come lo restituisce `downloads.search`. */
export interface DownloadItemLike {
  state?: string;
  error?: string;
}

/** Le API di Chrome usate per salvare un file: iniettate, così la logica si testa senza browser. */
export interface SaverPlatform {
  ensureOffscreen(): Promise<void>;
  closeOffscreen(): Promise<void>;
  sendToOffscreen(msg: OffscreenRequest): Promise<unknown>;
  download(opts: { url: string; filename: string }): Promise<number>;
  findDownload(url: string): Promise<DownloadItemLike | undefined>;
}

/**
 * Il service worker non può creare URL blob: lo fa il documento offscreen, che resta aperto fino a
 * `release` anche se nel frattempo il worker viene spento (finestra "Salva con nome" aperta).
 */
export function createFileSaver(p: SaverPlatform): Pick<AutoBackupDeps, 'createUrl' | 'startDownload' | 'downloadOutcome' | 'release'> {
  return {
    async createUrl(json) {
      await p.ensureOffscreen();
      const url = await p.sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json });
      if (typeof url !== 'string') throw new Error('documento offscreen non disponibile');
      return url;
    },
    async startDownload(url, filename) {
      await p.download({ url, filename });
    },
    async downloadOutcome(url): Promise<DownloadOutcome> {
      const item = await p.findDownload(url);
      if (!item) return { state: 'missing' };
      if (item.state === 'complete') return { state: 'complete' };
      if (item.state === 'interrupted') return { state: 'interrupted', error: item.error ?? 'motivo sconosciuto' };
      return { state: 'in_progress' };
    },
    async release(url) {
      await p.sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'revokeBlobUrl', url }).catch(() => {});
      await p.closeOffscreen().catch(() => {});
    },
  };
}
