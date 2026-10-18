import { acceptObservation, searchCategory } from '@/core/searches';
import {
  beginStep, createSweep, finishSweep, markSeen, nextStep, onPageRead, onTimeout, PAGE_TIMEOUT_MS, pauseMs, progressOf, skipDisabled, stepUrl,
  stopSweep, type SweepState,
} from '@/core/sweep';
import type { IngestOptions, ListingObservation, PageReport, Portal, SearchSpec, SweepResult, SweepStatus } from '@/shared/types';

export const SWEEP_RUNNING = 'Giro già in corso';
export const NO_SEARCHES = 'Nessuna ricerca da fare: controlla la zona e i portali attivi';

/** Stato salvato in storage.session: sopravvive al riavvio del service worker, non a quello del browser. */
export interface RunnerState {
  sweep: SweepState;
  windowId: number;
  tabId: number;
  /** Una pagina è in caricamento e si aspetta il suo pageRead. */
  awaiting: boolean;
}

export interface SweepRunnerDeps {
  now(): number;
  random(): number;
  uuid(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Tiene sveglio il service worker durante il giro; restituisce la funzione che smette. */
  keepAlive(): () => void;
  openWindow(url: string): Promise<{ windowId: number; tabId: number }>;
  navigate(tabId: number, url: string): Promise<void>;
  closeWindow(windowId: number): Promise<void>;
  loadState(): Promise<RunnerState | null>;
  saveState(s: RunnerState | null): Promise<void>;
  plan(): Promise<SearchSpec[]>;
  /** Motivo per non partire (informativa, zona), o null. */
  blockReason(): Promise<string | null>;
  enabledPortals(): Promise<Record<Portal, boolean>>;
  finish(s: SweepState): Promise<SweepResult>;
  countNew(since: number): Promise<number>;
  lastResult(): Promise<SweepResult | null>;
  /** Avvisa il pannello: avanzamento o fine del giro. */
  changed(): void;
}

export function createSweepRunner(d: SweepRunnerDeps) {
  let st: RunnerState | null = null;
  let loaded = false;
  let timer: unknown = null;
  let stopKeepAlive: (() => void) | null = null;
  // Un passo alla volta: messaggi dei content script, timer e pulsanti non si accavallano.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  async function load(): Promise<RunnerState | null> {
    if (!loaded) {
      st = await d.loadState();
      loaded = true;
    }
    return st;
  }
  async function save(): Promise<void> {
    await d.saveState(st);
    d.changed();
  }
  function clearTimer(): void {
    if (timer != null) d.clearTimer(timer);
    timer = null;
  }
  function armTimeout(): void {
    timer = d.setTimer(() => void serial(timeoutTick), PAGE_TIMEOUT_MS);
  }

  async function go(index: number): Promise<void> {
    timer = null;
    if (!st) return;
    st.sweep = beginStep(st.sweep, index);
    st.awaiting = true;
    await save();
    armTimeout();
    try {
      await d.navigate(st.tabId, stepUrl(st.sweep, index));
    } catch {
      // Scheda chiusa o non navigabile: il timeout chiude la ricerca.
    }
  }

  async function advance(): Promise<void> {
    if (!st) return;
    st.sweep = skipDisabled(st.sweep, await d.enabledPortals());
    const index = nextStep(st.sweep);
    if (index == null) return end(null, true);
    timer = d.setTimer(() => void serial(() => go(index)), pauseMs(st.sweep.runs[index]!.spec.portal, d.random));
  }

  async function timeoutTick(): Promise<void> {
    timer = null;
    if (!st?.awaiting) return;
    st.awaiting = false;
    st.sweep = onTimeout(st.sweep);
    await save();
    await advance();
  }

  /** Chiude il giro: `how` null = finito da solo. */
  async function end(how: 'stopped' | 'interrupted' | null, closeWindow: boolean): Promise<void> {
    clearTimer();
    stopKeepAlive?.();
    stopKeepAlive = null;
    const cur = st!;
    st = null;
    await d.saveState(null);
    if (closeWindow) await d.closeWindow(cur.windowId).catch(() => {});
    await d.finish(how ? stopSweep(cur.sweep, how, d.now()) : finishSweep(cur.sweep, d.now()));
    d.changed();
  }

  async function statusNow(): Promise<SweepStatus> {
    const running = st ? progressOf(st.sweep, await d.countNew(st.sweep.startedAt)) : null;
    return { running, last: await d.lastResult() };
  }

  return {
    start: () => serial(async () => {
      if (await load()) throw new Error(SWEEP_RUNNING);
      const reason = await d.blockReason();
      if (reason) throw new Error(reason);
      const specs = await d.plan();
      if (!specs.length) throw new Error(NO_SEARCHES);
      let sweep = createSweep(specs, d.now(), d.uuid());
      const index = nextStep(sweep)!;
      sweep = beginStep(sweep, index);
      const { windowId, tabId } = await d.openWindow(stepUrl(sweep, index));
      st = { sweep, windowId, tabId, awaiting: true };
      stopKeepAlive = d.keepAlive();
      await save();
      armTimeout();
      return statusNow();
    }),

    stop: () => serial(async () => {
      if (await load()) await end('stopped', true);
      return statusNow();
    }),

    status: () => serial(async () => {
      await load();
      return statusNow();
    }),

    pageRead: (tabId: number | undefined, report: PageReport) => serial(async () => {
      const s = await load();
      if (!s || tabId !== s.tabId || !s.awaiting) return;
      clearTimer();
      s.awaiting = false;
      s.sweep = onPageRead(s.sweep, report);
      await save();
      await advance();
    }),

    intercept: (tabId: number | undefined, observations: ListingObservation[]) =>
      serial(async (): Promise<{ observations: ListingObservation[]; options: IngestOptions } | null> => {
        const s = await load();
        if (!s || tabId !== s.tabId) return null;
        // Dalla scheda del giro, fuori da una pagina attesa, non si salva nulla: potrebbe essere di un comune non scelto.
        if (s.sweep.current == null || !s.awaiting) return { observations: [], options: {} };
        const spec = s.sweep.runs[s.sweep.current]!.spec;
        const accepted = observations.filter((o) => acceptObservation(spec, o));
        s.sweep = markSeen(s.sweep, accepted);
        await d.saveState(s);
        const onDrop = (key: string) => {
          if (st && !st.sweep.drops.includes(key)) st.sweep = { ...st.sweep, drops: [...st.sweep.drops, key] };
        };
        return { observations: accepted, options: { sweepScope: spec.key, searchCategory: searchCategory(spec), onDrop } };
      }),

    windowRemoved: (windowId: number) => serial(async () => {
      const s = await load();
      if (s && s.windowId === windowId) await end('interrupted', false);
    }),

    recover: () => serial(async () => {
      if (await load()) await end('interrupted', true);
    }),
  };
}
