import { LEAD_STATUSES, type LeadState, type LeadStatus } from '@/shared/types';

/** Contatori d'uso per la misura del pilota. Solo numeri e giorni: nessun dato degli annunci. */
export interface UsageStats {
  /** Giorni locali 'AAAA-MM-GG' con almeno una lettura di un portale. */
  browsingDays: string[];
  /** Giorni locali con il pannello aperto. */
  panelDays: string[];
  /** Passaggi reali allo stato indicato. */
  statusChanges: Partial<Record<LeadStatus, number>>;
  /** Richiami impostati o spostati (non quelli tolti). */
  recallsSet: number;
  /** Note salvate diverse dalla precedente e non vuote. */
  notesWritten: number;
  exports: { xlsx: number; csv: number };
}

export const MAX_USAGE_DAYS = 400;

export const EMPTY_USAGE: UsageStats = Object.freeze({
  browsingDays: [], panelDays: [], statusChanges: {}, recallsSet: 0, notesWritten: 0, exports: Object.freeze({ xlsx: 0, csv: 0 }),
}) as UsageStats;

export type UsageEvent =
  | { kind: 'browsing' }
  | { kind: 'panel' }
  | { kind: 'export'; format: 'xlsx' | 'csv' }
  | { kind: 'leadChange'; prev: LeadState; next: LeadState };

/** Eventi che il pannello può segnalare al background. */
export type UsageClientEvent = Extract<UsageEvent, { kind: 'panel' } | { kind: 'export' }>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function withDay(days: string[], day: string): string[] {
  if (days.includes(day)) return days;
  return [...days, day].sort().slice(-MAX_USAGE_DAYS);
}

export function applyUsage(u: UsageStats, e: UsageEvent, now: number): UsageStats {
  switch (e.kind) {
    case 'browsing':
      return { ...u, browsingDays: withDay(u.browsingDays, localDay(now)) };
    case 'panel':
      return { ...u, panelDays: withDay(u.panelDays, localDay(now)) };
    case 'export':
      return { ...u, exports: { ...u.exports, [e.format]: u.exports[e.format] + 1 } };
    case 'leadChange': {
      const { prev, next } = e;
      const out = { ...u, statusChanges: { ...u.statusChanges } };
      if (next.status !== prev.status) out.statusChanges[next.status] = (out.statusChanges[next.status] ?? 0) + 1;
      if (next.recallAt != null && next.recallAt !== (prev.recallAt ?? null)) out.recallsSet += 1;
      if (next.notes !== prev.notes && next.notes.trim() !== '') out.notesWritten += 1;
      return out;
    }
  }
}

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const days = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === 'string' && DAY_RE.test(d)))].sort().slice(-MAX_USAGE_DAYS) : [];

/** Lettura tollerante di `meta.usage`: un valore di forma inattesa vale zero. */
export function normalizeUsage(raw: unknown): UsageStats {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sc = (r.statusChanges ?? {}) as Record<string, unknown>;
  const ex = (r.exports ?? {}) as Record<string, unknown>;
  const statusChanges: Partial<Record<LeadStatus, number>> = {};
  for (const s of LEAD_STATUSES) if (count(sc[s]) > 0) statusChanges[s] = count(sc[s]);
  return {
    browsingDays: days(r.browsingDays),
    panelDays: days(r.panelDays),
    statusChanges,
    recallsSet: count(r.recallsSet),
    notesWritten: count(r.notesWritten),
    exports: { xlsx: count(ex.xlsx), csv: count(ex.csv) },
  };
}

export function activeRange(u: UsageStats): { first: string | null; last: string | null } {
  const all = [...u.browsingDays, ...u.panelDays].sort();
  return { first: all[0] ?? null, last: all[all.length - 1] ?? null };
}
