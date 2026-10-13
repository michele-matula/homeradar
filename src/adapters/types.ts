import type { PageKind, ParseResult, Portal } from '@/shared/types';

export type PayloadKind = 'next-data' | 'api';

export interface PortalAdapter {
  portal: Portal;
  pageKind(url: string): PageKind;
  /** Modalità "payload": JSON inoltrato dal bridge (Immobiliare). */
  parsePayload?(kind: PayloadKind, url: string, json: unknown): ParseResult;
  /** Modalità "DOM": legge le card già mostrate dalla pagina (Idealista). */
  readDocument?(root: ParentNode, url: string): ParseResult;
  /** Card dell'annuncio in pagina, se presente. */
  cardFor(root: ParentNode, portalId: number): HTMLElement | null;
  /** Elemento della card in cui appendere il badge (di solito il contenitore della foto). */
  badgeHost(card: HTMLElement): HTMLElement;
  /** ID di tutte le card presenti in pagina, agenzie comprese. */
  cardIds(root: ParentNode): number[];
}
