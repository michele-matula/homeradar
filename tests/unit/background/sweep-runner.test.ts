import { describe, expect, it, vi } from 'vitest';
import { createSweepRunner, SWEEP_RUNNING, type RunnerState, type SweepRunnerDeps } from '@/background/sweep-runner';
import type { SweepState } from '@/core/sweep';
import type { PageReport, SearchSpec, SweepResult } from '@/shared/types';
import { obs } from '../core/helpers';

const IMM: SearchSpec = {
  portal: 'immobiliare', key: 'immobiliare|comune:015059|negozi', label: "Cassano d'Adda · Negozi", categories: ['commercial'],
  url: 'https://www.immobiliare.it/vendita-negozi/cassano-d-adda/?criterio=privateFirst',
};
const SUB: SearchSpec = {
  portal: 'subito', key: 'subito|comune:015059|immobili', label: "Cassano d'Adda · Immobili", categories: ['residential', 'commercial'],
  url: 'https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0',
};
const page = (portal: PageReport['portal'], o: Partial<PageReport> = {}): PageReport => ({
  portal, url: portal === 'immobiliare' ? IMM.url : SUB.url, results: 3, privates: 1, lastPage: true, blocked: false, notFound: false, parseErrors: 0, ...o,
});

function harness(o: Partial<SweepRunnerDeps> = {}) {
  const timers: { fn: () => void; ms: number }[] = [];
  let stored: RunnerState | null = null;
  const finished: SweepState[] = [];
  const deps: SweepRunnerDeps = {
    now: () => 1000, random: () => 0, uuid: () => 'g1',
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    clearTimer: (h) => { timers[h as number] = { fn: () => {}, ms: -1 }; },
    keepAlive: () => () => {},
    openWindow: vi.fn(async () => ({ windowId: 7, tabId: 70 })),
    navigate: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
    loadState: async () => stored,
    saveState: async (s) => { stored = s; },
    plan: async () => [IMM, SUB],
    blockReason: async () => null,
    enabledPortals: async () => ({ immobiliare: true, idealista: true, subito: true, casadaprivato: true }),
    finish: async (s) => { finished.push(s); return { outcome: s.status } as SweepResult; },
    countNew: async () => 0,
    lastResult: async () => null,
    changed: vi.fn(),
    ...o,
  };
  /** Esegue l'ultimo timer ancora valido (pausa o timeout) e aspetta la coda. */
  const fire = async () => {
    const t = [...timers].reverse().find((x) => x.ms >= 0)!;
    t.ms = -1;
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
    await runner.status();
  };
  const runner = createSweepRunner(deps);
  return { runner, deps, timers, finished, fire, stored: () => stored };
}

describe('sweep runner', () => {
  it('apre la finestra, alterna le ricerche, chiude e salva l\'esito', async () => {
    const h = harness();
    const st = await h.runner.start();
    expect(h.deps.openWindow).toHaveBeenCalledWith(IMM.url);
    expect(st.running).toMatchObject({ total: 2, done: 0, current: IMM.label });
    await h.runner.pageRead(70, page('immobiliare'));
    await h.fire(); // pausa → naviga su Subito
    expect(h.deps.navigate).toHaveBeenCalledWith(70, SUB.url);
    await h.runner.pageRead(70, page('subito'));
    expect(h.deps.closeWindow).toHaveBeenCalledWith(7);
    expect(h.finished[0]!.status).toBe('completed');
    expect(h.stored()).toBeNull();
  });

  it('rifiuta un secondo avvio e gli avvii bloccati', async () => {
    const h = harness();
    await h.runner.start();
    await expect(h.runner.start()).rejects.toThrow(SWEEP_RUNNING);
    const b = harness({ blockReason: async () => 'Imposta prima la tua zona di lavoro' });
    await expect(b.runner.start()).rejects.toThrow('Imposta prima la tua zona di lavoro');
  });

  it('ignora le altre schede; dalla scheda del giro tiene solo le categorie della ricerca', async () => {
    const h = harness();
    await h.runner.start();
    expect(await h.runner.intercept(99, [obs()])).toBeNull();
    await h.runner.pageRead(99, page('immobiliare'));
    expect(h.deps.navigate).not.toHaveBeenCalled();
    const r = await h.runner.intercept(70, [
      obs({ portalId: 1, city: "Cassano d'Adda", category: 'commercial' }),
      obs({ portalId: 2, city: "Cassano d'Adda", category: 'garage' }),
    ]);
    expect(r!.observations.map((o) => o.portalId)).toEqual([1]);
    expect(r!.options).toMatchObject({ sweepScope: IMM.key, searchCategory: 'commercial' });
    // Visti tutti e due: l'annuncio scartato è ancora online, non deve diventare "non più visto".
    expect(h.stored()!.sweep.seen).toEqual(['immobiliare:1', 'immobiliare:2']);
  });

  it('scarta gli annunci della scheda del giro fuori da una pagina in corso', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.pageRead(70, page('immobiliare'));
    expect(await h.runner.intercept(70, [obs()])).toEqual({ observations: [], options: {} });
  });

  it('timeout: ricerca in errore e si prosegue', async () => {
    const h = harness();
    await h.runner.start();
    await h.fire(); // timeout della prima pagina
    expect(h.stored()!.sweep.runs[0]!.outcome).toBe('error');
    await h.fire(); // pausa → Subito
    expect(h.deps.navigate).toHaveBeenCalledWith(70, SUB.url);
  });

  it('Ferma, finestra chiusa dall\'agente e riavvio del worker chiudono il giro', async () => {
    const a = harness();
    await a.runner.start();
    await a.runner.stop();
    expect(a.finished[0]!.status).toBe('stopped');
    expect(a.deps.closeWindow).toHaveBeenCalledWith(7);

    const b = harness();
    await b.runner.start();
    await b.runner.windowRemoved(7);
    expect(b.finished[0]!.status).toBe('interrupted');
    expect(b.deps.closeWindow).not.toHaveBeenCalled();

    const c = harness();
    await c.runner.start();
    const restarted = createSweepRunner({ ...c.deps, loadState: async () => c.stored() });
    await restarted.recover();
    expect(c.finished[0]!.status).toBe('interrupted');
    expect(c.deps.closeWindow).toHaveBeenCalledWith(7);
  });

  it("revisione: un reindirizzamento a un'altra pagina chiude la ricerca come non trovata", async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.pageRead(70, page('immobiliare', { url: 'https://www.immobiliare.it/vendita-negozi/milano-provincia/' }));
    expect(h.stored()!.sweep.runs[0]!.outcome).toBe('notFound');
  });

  it('revisione: un messaggio in ritardo della pagina precedente non vale per la successiva', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.pageRead(70, page('immobiliare'));
    await h.fire(); // pausa → naviga su Subito
    await h.runner.pageRead(70, page('immobiliare'));
    expect(await h.runner.intercept(70, [obs()], IMM.url)).toEqual({ observations: [], options: {} });
    expect(h.stored()!.awaiting).toBe(true);
    expect(h.stored()!.sweep.runs[1]!.outcome).toBe('pending');
    const ok = await h.runner.intercept(70, [obs({ category: 'commercial' })], SUB.url);
    expect(ok!.observations).toHaveLength(1);
  });
});
