import { SORT_KEYS, type SortKey } from '@/core/leads';
import { LEAD_STATUSES, type LeadStatus } from '@/shared/types';

export type SortByTab = Record<LeadStatus, SortKey>;

const STORAGE_KEY = 'homeradar.sortByTab';
export const DEFAULT_SORT_BY_TAB: SortByTab = { new: 'priority', to_contact: 'priority', contacted: 'priority', discarded: 'priority' };

/**
 * Ordinamento scelto per ogni scheda. È una comodità della vista: sta nel localStorage del pannello e,
 * se manca, non è leggibile o contiene valori sconosciuti, si torna all'ordine per priorità.
 */
export function loadSortByTab(): SortByTab {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    const record = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
    const valid = (v: unknown): v is SortKey => SORT_KEYS.includes(v as SortKey);
    return Object.fromEntries(LEAD_STATUSES.map((s) => [s, valid(record[s]) ? record[s] : DEFAULT_SORT_BY_TAB[s]])) as SortByTab;
  } catch {
    return { ...DEFAULT_SORT_BY_TAB };
  }
}

export function saveSortByTab(sortByTab: SortByTab): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sortByTab));
  } catch {
    // Archivio non disponibile: la scelta vale solo finché il pannello resta aperto.
  }
}
