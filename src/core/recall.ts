import { DAY_MS } from '@/shared/types';

/** Un richiamo è un giorno: lo si salva come mezzanotte locale in ms epoch. */
export type RecallKind = 'overdue' | 'today' | 'upcoming';
export interface RecallStatus {
  kind: RecallKind;
  /** Giorni di calendario da oggi (sempre positivi; 0 per oggi). */
  days: number;
}

export const RECALL_SHORTCUTS: readonly { label: string; days: number }[] = [
  { label: 'Domani', days: 1 },
  { label: 'Tra 3 giorni', days: 3 },
  { label: 'Tra 1 settimana', days: 7 },
  { label: 'Tra 1 mese', days: 30 },
];

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Giorni di calendario: con l'ora legale un giorno può durare 23 o 25 ore. */
export function addDays(dayMs: number, n: number): number {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Prossimo ricalcolo del segnale sull'icona: subito dopo la mezzanotte locale. */
export function nextRecallCheck(now: number): number {
  return addDays(startOfLocalDay(now), 1) + 60_000;
}

export function recallStatus(recallAt: number | null | undefined, now: number): RecallStatus | null {
  if (recallAt == null) return null;
  // Tra due mezzanotti locali passano N giorni ± un'ora: l'arrotondamento assorbe l'ora legale.
  const diff = Math.round((startOfLocalDay(recallAt) - startOfLocalDay(now)) / DAY_MS);
  if (diff < 0) return { kind: 'overdue', days: -diff };
  if (diff === 0) return { kind: 'today', days: 0 };
  return { kind: 'upcoming', days: diff };
}

/** Da fare: oggi o in ritardo. È ciò che conta il numero sull'icona. */
export function isDue(recallAt: number | null | undefined, now: number): boolean {
  return recallAt != null && recallAt < addDays(startOfLocalDay(now), 1);
}

export function recallLabel(s: RecallStatus): string {
  if (s.kind === 'today') return 'oggi';
  if (s.kind === 'overdue') return s.days === 1 ? 'scaduto ieri' : `scaduto da ${s.days} giorni`;
  return s.days === 1 ? 'domani' : `tra ${s.days} giorni`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const pad = (n: number) => String(n).padStart(2, '0');

export function formatRecallDate(dayMs: number): string {
  const d = new Date(dayMs);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatLocalDate(dayMs: number): string {
  const d = new Date(dayMs);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function toDateInput(dayMs: number): string {
  const d = new Date(dayMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Valore di `<input type="date">` → mezzanotte locale; null se vuoto o non è un giorno esistente. */
export function fromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : null;
}
