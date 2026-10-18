import { describe, expect, it } from 'vitest';
import {
  beginStep, buildResult, completeScopes, createSweep, finishSweep, MAX_PAGES_PER_PORTAL, MAX_PAGES_PER_SEARCH, markSeen, nextStep,
  onPageRead, onTimeout, pauseMs, progressOf, samePage, skipDisabled, stepUrl, stopSweep, type SweepState,
} from '@/core/sweep';
import type { PageReport, Portal, SearchSpec } from '@/shared/types';
import { obs } from './helpers';

const spec = (portal: Portal, key: string, url: string): SearchSpec => ({
  portal, key, label: key, categories: ['residential'], url,
});
const IMM = spec('immobiliare', 'immobiliare|comune:016219|case', 'https://www.immobiliare.it/vendita-case/treviglio/?criterio=privateFirst');
const IDE = spec('idealista', 'idealista|comune:016219|case', 'https://www.idealista.it/vendita-case/treviglio-bergamo/?ordine=da-privati-asc');
const SUB = spec('subito', 'subito|comune:016219|immobili', 'https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/treviglio/?advt=0');
const report = (portal: Portal, o: Partial<PageReport> = {}): PageReport => ({
  portal, url: 'x', results: 25, privates: 25, lastPage: false, blocked: false, notFound: false, parseErrors: 0, ...o,
});
/** Avanza: sceglie il passo e lo marca in corso. */
const step = (s: SweepState) => beginStep(s, nextStep(s)!);

describe('giro: passi', () => {
  it('alterna i portali e costruisce gli URL di pagina', () => {
    let s = createSweep([IMM, { ...IMM, key: 'immobiliare|b' }, IDE, SUB], 0, 'id');
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('immobiliare');
    expect(stepUrl(s, s.current!)).toBe(IMM.url);
    s = onPageRead(s, report('immobiliare'));
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('idealista');
    s = onPageRead(s, report('idealista', { privates: 3 }));
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('subito');
    s = onPageRead(s, report('subito', { lastPage: true }));
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('immobiliare');
    expect(stepUrl(s, s.current!)).toBe(`${IMM.url}&pag=2`);
  });

  it('fine ricerca: prima pagina con un\'agenzia (Immobiliare, Idealista), ultima pagina o pagina vuota', () => {
    let s = step(createSweep([IMM], 0, 'id'));
    s = onPageRead(s, report('immobiliare', { results: 25, privates: 24 }));
    expect(s.runs[0]!.outcome).toBe('complete');
    s = step(createSweep([SUB], 0, 'id'));
    s = onPageRead(s, report('subito', { results: 30, privates: 20 }));
    expect(s.runs[0]!.outcome).toBe('pending');
    s = step(s);
    s = onPageRead(s, report('subito', { results: 0, privates: 0 }));
    expect(s.runs[0]!.outcome).toBe('complete');
    expect(nextStep(s)).toBeNull();
  });

  it('tetto per ricerca e per portale', () => {
    let s = createSweep([IMM], 0, 'id');
    for (let i = 0; i < MAX_PAGES_PER_SEARCH; i++) s = onPageRead(step(s), report('immobiliare'));
    expect(s.runs[0]!.outcome).toBe('capped');
    const many = Array.from({ length: MAX_PAGES_PER_PORTAL + 1 }, (_, i) => ({ ...IMM, key: `k${i}` }));
    s = createSweep(many, 0, 'id');
    for (let i = 0; i < MAX_PAGES_PER_PORTAL; i++) s = onPageRead(step(s), report('immobiliare', { privates: 1 }));
    expect(s.runs.at(-1)!.outcome).toBe('capped');
    expect(s.halted.immobiliare).toBe('capped');
  });

  it('blocco: ferma il portale, gli altri proseguono', () => {
    let s = createSweep([IDE, { ...IDE, key: 'idealista|b' }, SUB], 0, 'id');
    s = step(s);
    s = onPageRead(s, report('idealista', { blocked: true, results: 0, privates: 0 }));
    expect(s.runs.map((r) => r.outcome)).toEqual(['blocked', 'skipped', 'pending']);
    expect(s.runs[nextStep(s)!]!.spec.portal).toBe('subito');
  });

  it('timeout: ricerca in errore; due di fila fermano il portale', () => {
    let s = createSweep([IMM, { ...IMM, key: 'b' }, { ...IMM, key: 'c' }], 0, 'id');
    s = onTimeout(step(s));
    expect(s.runs[0]!.outcome).toBe('error');
    expect(s.halted.immobiliare).toBeUndefined();
    s = onTimeout(step(s));
    expect(s.runs.map((r) => r.outcome)).toEqual(['error', 'error', 'skipped']);
    expect(s.halted.immobiliare).toBe('error');
  });

  it('pagina inesistente: ricerca chiusa e segnalata', () => {
    let s = onPageRead(step(createSweep([SUB], 0, 'id')), report('subito', { notFound: true, results: 0, privates: 0 }));
    expect(s.runs[0]!.outcome).toBe('notFound');
    s = finishSweep(s, 10);
    expect(buildResult(s, { newCount: 0, missing: 0 }).notFound).toEqual(['subito|comune:016219|immobili (Subito)']);
  });

  it('un pageRead di un altro portale o senza pagina in corso non cambia nulla', () => {
    const s = step(createSweep([IMM], 0, 'id'));
    expect(onPageRead(s, report('subito'))).toBe(s);
    const idle = createSweep([IMM], 0, 'id');
    expect(onPageRead(idle, report('immobiliare'))).toBe(idle);
  });

  it('portale spento: le sue ricerche si saltano', () => {
    const s = skipDisabled(createSweep([IMM, SUB], 0, 'id'), { immobiliare: false, idealista: true, subito: true });
    expect(s.runs.map((r) => r.outcome)).toEqual(['skipped', 'pending']);
  });
});

describe('giro: esito', () => {
  it('completato solo se tutte le ricerche sono complete o inesistenti; le complete danno le chiavi', () => {
    let s = createSweep([IMM, SUB], 0, 'id');
    s = onPageRead(step(s), report('immobiliare', { privates: 3 }));
    s = onPageRead(step(s), report('subito', { lastPage: true }));
    s = finishSweep(s, 60_000);
    expect(s.status).toBe('completed');
    expect(completeScopes(s)).toEqual([IMM.key, SUB.key]);
    const r = buildResult(s, { newCount: 4, missing: 1 });
    expect(r).toMatchObject({ outcome: 'completed', finishedAt: 60_000, newCount: 4, drops: 0, missing: 1 });
    expect(r.portals.immobiliare).toEqual({ pages: 1, privates: 3, outcome: 'complete' });
  });

  it('fermato o interrotto: le ricerche aperte risultano saltate', () => {
    const s = stopSweep(step(createSweep([IMM, SUB], 0, 'id')), 'stopped', 5);
    expect(s.status).toBe('stopped');
    expect(s.runs.every((r) => r.outcome === 'skipped')).toBe(true);
    expect(buildResult(s, { newCount: 0, missing: 0 }).portals.immobiliare!.outcome).toBe('skipped');
  });

  it('esito per portale: blocco, errore, tetto', () => {
    let s = createSweep([IDE, SUB], 0, 'id');
    s = onPageRead(step(s), report('idealista', { blocked: true }));
    s = onTimeout(step(s));
    s = finishSweep(s, 1);
    const r = buildResult(s, { newCount: 0, missing: 0 });
    expect(r.outcome).toBe('partial');
    expect(r.portals.idealista!.outcome).toBe('blocked');
    expect(r.portals.subito!.outcome).toBe('error');
  });

  it('annunci visti e avanzamento', () => {
    let s = step(createSweep([IMM, SUB], 100, 'id'));
    s = markSeen(s, [obs(), obs({ portalId: 2, sellerType: 'agency' })]);
    expect(s.seen).toEqual(['immobiliare:128416572']);
    s = { ...s, drops: ['immobiliare:128416572'] };
    expect(progressOf(s, 2)).toEqual({ startedAt: 100, total: 2, done: 0, current: IMM.key, portals: { immobiliare: { pages: 0, privates: 0 }, subito: { pages: 0, privates: 0 } }, newCount: 2, drops: 1 });
  });

  it('pause nell\'intervallo del portale', () => {
    expect(pauseMs('immobiliare', () => 0)).toBe(4000);
    expect(pauseMs('immobiliare', () => 0.999)).toBeLessThan(10_000);
    expect(pauseMs('idealista', () => 0)).toBe(8000);
  });
});

describe('revisione: pagine lette con errori', () => {
  it('una pagina con errori di lettura non chiude la ricerca come completa; due di fila fermano il portale', () => {
    let s = createSweep([IMM, { ...IMM, key: 'b' }, { ...IMM, key: 'c' }], 0, 'id');
    s = onPageRead(step(s), report('immobiliare', { results: 0, privates: 0, parseErrors: 25 }));
    expect(s.runs[0]!.outcome).toBe('error');
    expect(completeScopes(finishSweep(s, 1))).toEqual([]);
    s = onPageRead(step(s), report('immobiliare', { results: 25, privates: 3, parseErrors: 1 }));
    expect(s.runs.map((r) => r.outcome)).toEqual(['error', 'error', 'skipped']);
    expect(s.halted.immobiliare).toBe('error');
  });
});

describe('revisione: samePage', () => {
  it('stesso percorso e i parametri chiesti; parametri in più ammessi', () => {
    expect(samePage(IMM.url, IMM.url)).toBe(true);
    expect(samePage(`${IMM.url}&pag=2`, `${IMM.url}&pag=2&utm=x`)).toBe(true);
    expect(samePage(`${IMM.url}&pag=2`, IMM.url)).toBe(false);
    expect(samePage(IMM.url, 'https://www.immobiliare.it/vendita-case/treviglio?criterio=privateFirst')).toBe(true);
    expect(samePage(IMM.url, 'https://www.immobiliare.it/vendita-case/bergamo-provincia/?criterio=privateFirst')).toBe(false);
    expect(samePage(IMM.url, 'non è un url')).toBe(false);
  });
});
