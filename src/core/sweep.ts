import { pageUrl } from '@/core/searches';
import {
  listingKey, PORTAL_TAGS, PORTALS,
  type ListingObservation, type PageReport, type Portal, type PortalSweepOutcome, type SearchSpec, type SweepOutcome, type SweepProgress, type SweepResult,
} from '@/shared/types';

// Valori iniziali dalla fase 0 (2026-10-17); rivisti con la prova di ritmo.
export const MAX_PAGES_PER_SEARCH = 10;
export const MAX_PAGES_PER_PORTAL = 60;
// Build di test (WXT_SWEEP_FAST=1, solo e2e): pause e attese brevi. Mai nella build del pilota.
const FAST = import.meta.env.WXT_SWEEP_FAST === '1';
export const PAGE_TIMEOUT_MS = FAST ? 5_000 : 45_000;
export const PAUSE_MS: Record<Portal, [number, number]> = FAST
  ? { immobiliare: [100, 200], idealista: [100, 200], subito: [100, 200] }
  : { immobiliare: [4_000, 10_000], idealista: [8_000, 14_000], subito: [4_000, 10_000] };

export type SearchOutcome = 'pending' | 'complete' | 'capped' | 'blocked' | 'error' | 'notFound' | 'skipped';

export interface SearchRun {
  spec: SearchSpec;
  /** Pagine lette. */
  pages: number;
  privates: number;
  outcome: SearchOutcome;
}

/** Stato del giro: solo dati, salvato in storage.session a ogni passo. */
export interface SweepState {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | SweepOutcome;
  runs: SearchRun[];
  /** Ricerca la cui pagina è in caricamento; null tra una pagina e l'altra. */
  current: number | null;
  /** Portale dell'ultima pagina avviata, per alternare. */
  lastPortal: Portal | null;
  errorsInRow: Partial<Record<Portal, number>>;
  /** Portali fermati in questo giro e perché. */
  halted: Partial<Record<Portal, 'blocked' | 'error' | 'capped'>>;
  /** Annunci di privati visti nel giro (chiavi). */
  seen: string[];
  /** Annunci già salvati con un ribasso trovato nel giro (chiavi). */
  drops: string[];
}

export function createSweep(specs: SearchSpec[], now: number, id: string): SweepState {
  return {
    id, startedAt: now, finishedAt: null, status: 'running', runs: specs.map((spec) => ({ spec, pages: 0, privates: 0, outcome: 'pending' })),
    current: null, lastPortal: null, errorsInRow: {}, halted: {}, seen: [], drops: [],
  };
}

const withRuns = (s: SweepState, fn: (r: SearchRun) => SearchRun): SweepState => ({ ...s, runs: s.runs.map(fn) });

function halt(s: SweepState, portal: Portal, why: 'blocked' | 'error' | 'capped'): SweepState {
  const outcome: SearchOutcome = why === 'capped' ? 'capped' : 'skipped';
  return { ...withRuns(s, (r) => (r.spec.portal === portal && r.outcome === 'pending' ? { ...r, outcome } : r)), halted: { ...s.halted, [portal]: why } };
}

/** Portali spenti dall'agente a giro in corso: le loro ricerche aperte si saltano. */
export function skipDisabled(s: SweepState, enabled: Record<Portal, boolean>): SweepState {
  return withRuns(s, (r) => (!enabled[r.spec.portal] && r.outcome === 'pending' ? { ...r, outcome: 'skipped' } : r));
}

/** Prossima ricerca: il portale dopo l'ultimo usato che ha ancora ricerche aperte. */
export function nextStep(s: SweepState): number | null {
  const start = s.lastPortal ? PORTALS.indexOf(s.lastPortal) + 1 : 0;
  for (let i = 0; i < PORTALS.length; i++) {
    const p = PORTALS[(start + i) % PORTALS.length]!;
    const idx = s.runs.findIndex((r) => r.spec.portal === p && r.outcome === 'pending');
    if (idx >= 0) return idx;
  }
  return null;
}

export function beginStep(s: SweepState, index: number): SweepState {
  return { ...s, current: index, lastPortal: s.runs[index]!.spec.portal };
}

export function stepUrl(s: SweepState, index: number): string {
  const run = s.runs[index]!;
  return pageUrl(run.spec, run.pages + 1);
}

/** Immobiliare e Idealista mettono i privati prima: la prima agenzia chiude la ricerca. Subito filtra già i privati. */
function isLastPage(portal: Portal, r: PageReport): boolean {
  return r.results === 0 || r.lastPage || (portal !== 'subito' && r.privates < r.results);
}

const portalPages = (s: SweepState, p: Portal) => s.runs.reduce((n, r) => n + (r.spec.portal === p ? r.pages : 0), 0);

export function onPageRead(s: SweepState, r: PageReport): SweepState {
  if (s.current == null) return s;
  const index = s.current;
  const portal = s.runs[index]!.spec.portal;
  if (portal !== r.portal) return s;
  const set = (patch: Partial<SearchRun>): SweepState => ({
    ...s, current: null, errorsInRow: { ...s.errorsInRow, [portal]: 0 }, runs: s.runs.map((x, i) => (i === index ? { ...x, ...patch } : x)),
  });
  if (r.blocked) return halt(set({ outcome: 'blocked' }), portal, 'blocked');
  if (r.notFound) return set({ outcome: 'notFound' });
  const run = s.runs[index]!;
  const pages = run.pages + 1;
  const outcome: SearchOutcome = isLastPage(portal, r) ? 'complete' : pages >= MAX_PAGES_PER_SEARCH ? 'capped' : 'pending';
  const next = set({ pages, privates: run.privates + r.privates, outcome });
  return portalPages(next, portal) >= MAX_PAGES_PER_PORTAL ? halt(next, portal, 'capped') : next;
}

export function onTimeout(s: SweepState): SweepState {
  if (s.current == null) return s;
  const index = s.current;
  const portal = s.runs[index]!.spec.portal;
  const errors = (s.errorsInRow[portal] ?? 0) + 1;
  const next: SweepState = {
    ...s, current: null, errorsInRow: { ...s.errorsInRow, [portal]: errors },
    runs: s.runs.map((x, i) => (i === index ? { ...x, outcome: 'error' } : x)),
  };
  return errors >= 2 ? halt(next, portal, 'error') : next;
}

/** Annunci di privati visti nel giro: servono a "non più visto". */
export function markSeen(s: SweepState, observations: ListingObservation[]): SweepState {
  const keys = observations.filter((o) => o.sellerType === 'private').map((o) => listingKey(o.portal, o.portalId));
  const fresh = keys.filter((k) => !s.seen.includes(k));
  return fresh.length ? { ...s, seen: [...s.seen, ...new Set(fresh)] } : s;
}

export function finishSweep(s: SweepState, now: number): SweepState {
  const ok = s.runs.every((r) => r.outcome === 'complete' || r.outcome === 'notFound');
  return { ...s, current: null, finishedAt: now, status: ok ? 'completed' : 'partial' };
}

export function stopSweep(s: SweepState, how: 'stopped' | 'interrupted', now: number): SweepState {
  return { ...withRuns(s, (r) => (r.outcome === 'pending' ? { ...r, outcome: 'skipped' } : r)), current: null, finishedAt: now, status: how };
}

/** Ricerche complete: solo i loro annunci mancanti contano per "non più visto". */
export function completeScopes(s: SweepState): string[] {
  return s.runs.filter((r) => r.outcome === 'complete').map((r) => r.spec.key);
}

export function pauseMs(portal: Portal, random: () => number): number {
  const [min, max] = PAUSE_MS[portal];
  return Math.floor(min + random() * (max - min));
}

function portalOutcome(s: SweepState, p: Portal): PortalSweepOutcome {
  if (s.halted[p] === 'blocked') return 'blocked';
  const outcomes = s.runs.filter((r) => r.spec.portal === p).map((r) => r.outcome);
  if (outcomes.includes('error')) return 'error';
  if (outcomes.includes('capped')) return 'capped';
  if (outcomes.includes('skipped') || outcomes.includes('pending')) return 'skipped';
  return 'complete';
}

const portalsOf = (s: SweepState) => PORTALS.filter((p) => s.runs.some((r) => r.spec.portal === p));

function totals(s: SweepState, p: Portal): { pages: number; privates: number } {
  return s.runs.filter((r) => r.spec.portal === p).reduce((t, r) => ({ pages: t.pages + r.pages, privates: t.privates + r.privates }), { pages: 0, privates: 0 });
}

export function buildResult(s: SweepState, counts: { newCount: number; missing: number }): SweepResult {
  return {
    startedAt: s.startedAt,
    finishedAt: s.finishedAt ?? s.startedAt,
    outcome: s.status === 'running' ? 'interrupted' : s.status,
    portals: Object.fromEntries(portalsOf(s).map((p) => [p, { ...totals(s, p), outcome: portalOutcome(s, p) }])),
    notFound: s.runs.filter((r) => r.outcome === 'notFound').map((r) => `${r.spec.label} (${PORTAL_TAGS[r.spec.portal]})`),
    newCount: counts.newCount,
    drops: s.drops.length,
    missing: counts.missing,
  };
}

export function progressOf(s: SweepState, newCount: number): SweepProgress {
  return {
    startedAt: s.startedAt,
    total: s.runs.length,
    done: s.runs.filter((r) => r.outcome !== 'pending').length,
    current: s.current != null ? s.runs[s.current]!.spec.label : null,
    portals: Object.fromEntries(portalsOf(s).map((p) => [p, totals(s, p)])),
    newCount,
    drops: s.drops.length,
  };
}
