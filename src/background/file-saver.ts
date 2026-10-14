export const OFFSCREEN_TARGET = 'homeradar-offscreen';

export type OffscreenRequest =
  | { target: typeof OFFSCREEN_TARGET; type: 'createBlobUrl'; json: string }
  | { target: typeof OFFSCREEN_TARGET; type: 'revokeBlobUrl'; url: string };

export function isOffscreenRequest(msg: unknown): msg is OffscreenRequest {
  return (msg as { target?: unknown } | undefined)?.target === OFFSCREEN_TARGET;
}

export interface DownloadDelta {
  id: number;
  state?: { current?: string };
  error?: { current?: string };
}

/** Le API di Chrome usate per salvare un file: iniettate, così la logica si testa senza browser. */
export interface SaverPlatform {
  ensureOffscreen(): Promise<void>;
  closeOffscreen(): Promise<void>;
  sendToOffscreen(msg: OffscreenRequest): Promise<unknown>;
  download(opts: { url: string; filename: string }): Promise<number>;
  onDownloadChanged(listener: (d: DownloadDelta) => void): () => void;
}

/**
 * Il service worker non può creare URL blob: lo fa il documento offscreen. Il salvataggio
 * si risolve solo a download completato.
 */
export function createFileSaver(p: SaverPlatform, timeoutMs = 60_000) {
  return async function saveFile(json: string, filename: string): Promise<void> {
    // In ascolto prima di avviare il download: l'evento di completamento può arrivare prima dell'id.
    const deltas: DownloadDelta[] = [];
    let check: (() => void) | null = null;
    const off = p.onDownloadChanged((d) => {
      deltas.push(d);
      check?.();
    });
    let url: string | null = null;
    try {
      await p.ensureOffscreen();
      const res = await p.sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json });
      if (typeof res !== 'string') throw new Error('documento offscreen non disponibile');
      url = res;
      const id = await p.download({ url, filename });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('download non completato in tempo')), timeoutMs);
        check = () => {
          const d = deltas.find((x) => x.id === id && (x.state?.current === 'complete' || x.state?.current === 'interrupted'));
          if (!d) return;
          clearTimeout(timer);
          if (d.state?.current === 'complete') resolve();
          else reject(new Error(`download interrotto (${d.error?.current ?? 'motivo sconosciuto'})`));
        };
        check();
      });
    } finally {
      off();
      if (url) await p.sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'revokeBlobUrl', url }).catch(() => {});
      await p.closeOffscreen().catch(() => {});
    }
  };
}
