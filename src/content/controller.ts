import type { PortalAdapter } from '@/adapters/types';
import { renderBadge } from '@/content/badges';
import type { Request } from '@/shared/messages';
import type { Evaluation } from '@/shared/types';

export interface ControllerDeps {
  adapter: PortalAdapter;
  send: (req: Request) => Promise<unknown>;
  root: ParentNode;
  /** URL della pagina corrente (iniettato per testabilità). */
  getUrl: () => string;
}

export function createController({ adapter, send, root, getUrl }: ControllerDeps) {
  const evaluations = new Map<number, Evaluation>();
  /** ID di tutti gli annunci ricevuti in un payload, agenzie comprese. */
  const seen = new Set<number>();

  function applyAll(): void {
    for (const ev of evaluations.values()) renderBadge(root, ev);
  }

  /** true se nelle card in pagina c'è un annuncio mai arrivato in un payload (dati persi). */
  function hasUnseenListings(): boolean {
    for (const a of root.querySelectorAll<HTMLAnchorElement>('li a[href*="/annunci/"]')) {
      const id = adapter.listingIdFromHref(a.getAttribute('href') ?? '');
      if (id != null && !seen.has(id)) return true;
    }
    return false;
  }

  async function handle(kind: 'next-data' | 'api', url: string, payload: unknown): Promise<void> {
    // Le risposte api valgono solo sulle pagine di ricerca: /annunci/{id}/ serve anche gli affitti.
    if (kind === 'api' && adapter.pageKind(getUrl()) !== 'search') return;
    const result = kind === 'next-data' ? adapter.parseNextData(payload, url) : adapter.parseIntercepted(url, payload);
    const total = result.errors.length + result.observations.length;
    const hasUnknownSeller = result.observations.some((o) => o.sellerType === 'unknown');
    const ok = !hasUnknownSeller && (total === 0 || result.errors.length <= total * 0.2);
    for (const o of result.observations) seen.add(o.portalId);
    await send({ type: 'parseStatus', ok, errors: result.errors, source: kind });
    if (!result.observations.length) return;
    const evs = (await send({ type: 'ingest', observations: result.observations })) as Evaluation[];
    for (const ev of evs) evaluations.set(ev.portalId, ev);
    applyAll();
  }

  return { handle, applyAll, hasUnseenListings };
}
