import type { PayloadKind, PortalAdapter } from '@/adapters/types';
import { renderBadge } from '@/content/badges';
import type { ParseSource, Request } from '@/shared/messages';
import type { Evaluation, ParseResult } from '@/shared/types';

export interface ControllerDeps {
  adapter: PortalAdapter;
  send: (req: Request) => Promise<unknown>;
  root: ParentNode;
  /** URL della pagina corrente (iniettato per testabilità). */
  getUrl: () => string;
}

export function createController({ adapter, send, root, getUrl }: ControllerDeps) {
  const evaluations = new Map<number, Evaluation>();
  /** ID di tutti gli annunci ricevuti, agenzie comprese. */
  const seen = new Set<number>();
  /** Modalità DOM: ID ed errori già inviati per l'URL corrente. */
  const sent = new Set<number>();
  const sentErrors = new Set<string>();
  let scannedUrl: string | null = null;

  function applyAll(): void {
    for (const ev of evaluations.values()) renderBadge(root, ev, adapter);
  }

  /** true se nelle card in pagina c'è un annuncio mai arrivato in un payload (dati persi). */
  function hasUnseenListings(): boolean {
    return adapter.cardIds(root).some((id) => !seen.has(id));
  }

  async function process(result: ParseResult, source: ParseSource): Promise<void> {
    const total = result.errors.length + result.observations.length;
    const hasUnknownSeller = result.observations.some((o) => o.sellerType === 'unknown');
    const ok = !hasUnknownSeller && (total === 0 || result.errors.length <= total * 0.2);
    for (const o of result.observations) seen.add(o.portalId);
    await send({ type: 'parseStatus', portal: adapter.portal, ok, errors: result.errors, source });
    if (!result.observations.length) return;
    const calibrationHint = result.newestId != null ? { portal: adapter.portal, portalId: result.newestId } : undefined;
    const evs = (await send({ type: 'ingest', observations: result.observations, ...(calibrationHint ? { calibrationHint } : {}) })) as Evaluation[];
    for (const ev of evs) evaluations.set(ev.portalId, ev);
    applyAll();
  }

  async function handle(kind: PayloadKind, url: string, payload: unknown): Promise<void> {
    if (!adapter.parsePayload) return;
    // Le risposte api valgono solo sulle pagine di ricerca: /annunci/{id}/ serve anche gli affitti.
    if (kind === 'api' && adapter.pageKind(getUrl()) !== 'search') return;
    await process(adapter.parsePayload(kind, url, payload), kind);
  }

  /** Modalità DOM: invia le card nuove; se non ce ne sono si limita a riapplicare i badge. */
  async function scan(): Promise<void> {
    if (!adapter.readDocument) return;
    const url = getUrl();
    const isNewUrl = url !== scannedUrl;
    if (isNewUrl) {
      scannedUrl = url;
      sent.clear();
      sentErrors.clear();
    }
    const result = adapter.readDocument(root, url);
    const fresh = result.observations.filter((o) => !sent.has(o.portalId));
    if (!isNewUrl && !fresh.length) {
      applyAll();
      return;
    }
    // Solo le card e gli errori nuovi: rimandare gli errori già noti insieme a poche card nuove
    // ne gonfierebbe la quota e accenderebbe un falso avviso.
    const freshErrors = result.errors.filter((e) => !sentErrors.has(e));
    for (const o of fresh) sent.add(o.portalId);
    for (const e of freshErrors) sentErrors.add(e);
    await process({ ...result, observations: fresh, errors: freshErrors }, 'dom');
  }

  return { handle, scan, applyAll, hasUnseenListings };
}
