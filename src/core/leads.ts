import { recallStatus, type RecallKind } from '@/core/recall';
import { LEAD_STATUSES, type LeadStatus, type LeadView, type Portal, type Priority } from '@/shared/types';

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Alta', medium: 'Media', verify: 'Da verificare', none: '' };
/**
 * Etichetta della priorità per un annuncio del portale. Su Idealista e Subito l'età è sempre stimata e la scheda
 * non ha la data: "Da verificare" inviterebbe ad aprirla per nulla, quindi diventa "Età incerta".
 */
export function priorityLabel(priority: Priority, portal: Portal): string {
  return priority === 'verify' && portal !== 'immobiliare' ? 'Età incerta' : PRIORITY_LABELS[priority];
}

export const STATUS_LABELS: Record<LeadStatus, string> = { new: 'Nuovo', to_contact: 'Da contattare', contacted: 'Contattato', discarded: 'Scartato' };

/** Chiavi di tutti gli annunci del lead: il principale per primo. */
export function leadKeys(l: LeadView): string[] {
  return [l.listing.key, ...l.others.map((o) => o.listing.key)];
}

/** Portali distinti del lead, quello del principale per primo. */
export function leadPortals(l: LeadView): Portal[] {
  return [...new Set([l.listing.portal, ...l.others.map((o) => o.listing.portal)])];
}

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, verify: 2, none: 3 };

function byPriority(a: LeadView, b: LeadView): number {
  const p = PRIORITY_ORDER[a.evaluation.priority] - PRIORITY_ORDER[b.evaluation.priority];
  if (p !== 0) return p;
  return (b.evaluation.ageDays ?? -1) - (a.evaluation.ageDays ?? -1);
}

export function sortLeads(leads: LeadView[]): LeadView[] {
  return [...leads].sort(byPriority);
}

export type SortKey = 'priority' | 'recall' | 'oldest' | 'newest' | 'drop' | 'price_asc' | 'price_desc' | 'price_m2' | 'above_market' | 'first_seen' | 'last_seen' | 'status_changed';
export const SORT_KEYS: SortKey[] = ['priority', 'recall', 'oldest', 'newest', 'drop', 'price_asc', 'price_desc', 'price_m2', 'above_market', 'first_seen', 'last_seen', 'status_changed'];
export const SORT_LABELS: Record<SortKey, string> = {
  priority: 'Priorità',
  recall: 'Richiamo più vicino',
  oldest: 'Più vecchi online',
  newest: 'Più recenti online',
  drop: 'Ribasso maggiore',
  price_asc: 'Prezzo crescente',
  price_desc: 'Prezzo decrescente',
  price_m2: '€/m² più basso',
  above_market: 'Sopra mercato',
  first_seen: 'Scoperti di recente',
  last_seen: 'Visti di recente',
  status_changed: 'Stato cambiato di recente',
};

const pricePerM2 = ({ listing: { currentPrice: p, surfaceM2: m2 } }: LeadView) => (p != null && m2 ? p / m2 : null);

/** Valore da confrontare e verso (1 crescente, -1 decrescente) per ogni criterio diverso dalla priorità. */
const SORT_VALUES: Record<Exclude<SortKey, 'priority'>, [(l: LeadView) => number | null, 1 | -1]> = {
  recall: [(l) => l.state.recallAt, 1],
  oldest: [(l) => l.evaluation.ageDays, -1],
  newest: [(l) => l.evaluation.ageDays, 1],
  drop: [(l) => l.evaluation.dropPercent, -1],
  price_asc: [(l) => l.listing.currentPrice, 1],
  price_desc: [(l) => l.listing.currentPrice, -1],
  price_m2: [pricePerM2, 1],
  above_market: [(l) => l.market?.deltaPercent ?? null, -1],
  first_seen: [(l) => l.listing.firstSeenAt, -1],
  last_seen: [(l) => l.listing.lastSeenAt, -1],
  status_changed: [(l) => l.state.statusChangedAt, -1],
};

/** Ordina per il criterio scelto: i valori mancanti vanno sempre in fondo, a parità vale l'ordine per priorità. */
export function sortLeadsBy(leads: LeadView[], key: SortKey): LeadView[] {
  if (key === 'priority') return sortLeads(leads);
  const [value, dir] = SORT_VALUES[key];
  return [...leads].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va !== vb) {
      if (va == null) return 1;
      if (vb == null) return -1;
      return dir * (va - vb);
    }
    return byPriority(a, b);
  });
}

export function groupByStatus(leads: LeadView[]): Record<LeadStatus, LeadView[]> {
  const groups = Object.fromEntries(LEAD_STATUSES.map((s) => [s, [] as LeadView[]])) as Record<LeadStatus, LeadView[]>;
  for (const l of leads) groups[l.state.status].push(l);
  return groups;
}

export const RECALL_GROUP_LABELS: Record<RecallKind, string> = { overdue: 'Scaduti', today: 'Oggi', upcoming: 'Prossimi' };
const RECALL_KINDS: RecallKind[] = ['overdue', 'today', 'upcoming'];

/** Lead con un richiamo, per la scheda "Richiami": scaduti, di oggi, futuri; ciascun gruppo in ordine di data. */
export function groupByRecall(leads: LeadView[], now: number): { kind: RecallKind; leads: LeadView[] }[] {
  const byKind = new Map<RecallKind, LeadView[]>(RECALL_KINDS.map((k) => [k, []]));
  for (const l of leads) {
    const s = recallStatus(l.state.recallAt, now);
    if (s) byKind.get(s.kind)!.push(l);
  }
  return RECALL_KINDS.filter((k) => byKind.get(k)!.length).map((kind) => ({ kind, leads: sortLeadsBy(byKind.get(kind)!, 'recall') }));
}
