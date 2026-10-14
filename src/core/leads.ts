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

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, verify: 2, none: 3 };

export function sortLeads(leads: LeadView[]): LeadView[] {
  return [...leads].sort((a, b) => {
    const p = PRIORITY_ORDER[a.evaluation.priority] - PRIORITY_ORDER[b.evaluation.priority];
    if (p !== 0) return p;
    return (b.evaluation.ageDays ?? -1) - (a.evaluation.ageDays ?? -1);
  });
}

export function groupByStatus(leads: LeadView[]): Record<LeadStatus, LeadView[]> {
  const groups = Object.fromEntries(LEAD_STATUSES.map((s) => [s, [] as LeadView[]])) as Record<LeadStatus, LeadView[]>;
  for (const l of leads) groups[l.state.status].push(l);
  return groups;
}
