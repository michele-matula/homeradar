import { describe, expect, it } from 'vitest';
import { beginStep, createSweep, markSeen, nextStep, onPageRead } from '@/core/sweep';
import type { SearchSpec } from '@/shared/types';
import { obs, setup } from './helpers';

const IMM: SearchSpec = {
  portal: 'immobiliare', key: 'immobiliare|comune:016219|case', label: 'Treviglio · Case', categories: ['residential'],
  url: 'https://www.immobiliare.it/vendita-case/treviglio/?criterio=privateFirst',
};

describe('LeadService: giro', () => {
  it('a fine giro conta nuovi, ribassi e non più visti e salva l\'esito', async () => {
    const { db, svc, advance, now } = setup();
    await svc.ingest([obs({ portalId: 1, url: 'https://www.immobiliare.it/annunci/1/' })], undefined, { sweepScope: IMM.key });
    await db.listings.update('immobiliare:1', { missedSweeps: 2, missingSince: 10 });
    advance(60_000);
    const started = now();
    let s = createSweep([IMM], started, 'g1');
    s = beginStep(s, nextStep(s)!);
    await svc.ingest([obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/' })], undefined, { sweepScope: IMM.key });
    s = markSeen(s, [obs({ portalId: 2 })]);
    s = onPageRead(s, { portal: 'immobiliare', url: IMM.url, results: 2, privates: 1, lastPage: false, blocked: false, notFound: false, parseErrors: 0 });
    advance(1000);
    const result = await svc.finishSweep({ ...s, status: 'completed', finishedAt: now(), drops: ['immobiliare:2'] });
    expect(result).toMatchObject({ outcome: 'completed', newCount: 1, drops: 1, missing: 1 });
    expect(await db.listings.get('immobiliare:1')).toMatchObject({ missedSweeps: 3, missingSince: 10 });
    expect(await svc.lastSweep()).toEqual(result);
    expect((await svc.getDiagnostics('x')).counters).toMatchObject({ sweep_completed: 1, sweepPages_immobiliare: 1 });
  });

  it('nessun esito salvato: lastSweep è null', async () => {
    const { svc } = setup();
    expect(await svc.lastSweep()).toBeNull();
  });
});
