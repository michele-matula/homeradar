import { LEAD_STATUSES, type LeadStatus, type LeadView, type Priority } from '@/shared/types';

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Alta', medium: 'Media', verify: 'Da verificare', none: '' };
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
