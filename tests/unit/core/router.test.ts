import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '@/core/router';
import { obs, setup } from './helpers';

function hooks() {
  return { setWarning: vi.fn(), leadsChanged: vi.fn() };
}

describe('handleRequest', () => {
  it('ingest restituisce le valutazioni e notifica il pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    const evs = (await handleRequest(svc, { type: 'ingest', observations: [obs()] }, '0.1.0', h)) as { priority: string }[];
    expect(evs[0]!.priority).toBe('high');
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
    expect((await svc.getDiagnostics('x')).counters.ingested).toBe(1);
  });

  it('parseStatus accende e spegne l\'avviso e registra gli errori', async () => {
    const { svc } = setup();
    const h = hooks();
    await handleRequest(svc, { type: 'parseStatus', ok: false, errors: ['search data not found'], source: 'api' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(true);
    let d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toBe(true);
    expect(d.errors.map((e) => e.message)).toEqual(['search data not found']);
    await handleRequest(svc, { type: 'parseStatus', ok: true, errors: [], source: 'next-data' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(false);
    d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toBe(false);
    expect(d.counters).toMatchObject({ apiPayloads: 1, nextDataPayloads: 1 });
  });

  it('inoltra le richieste del pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    await svc.ingest([obs()]);
    expect(((await handleRequest(svc, { type: 'listLeads' }, 'v', h)) as unknown[]).length).toBe(1);
    expect(await handleRequest(svc, { type: 'setLeadState', listingKey: 'immobiliare:128416572', status: 'contacted' }, 'v', h)).toMatchObject({ status: 'contacted' });
    expect(await handleRequest(svc, { type: 'saveSettings', settings: { minAgeDays: 150, minDropPercent: 0, retentionDays: 90 } }, 'v', h)).toMatchObject({ minAgeDays: 150 });
    expect(await handleRequest(svc, { type: 'getSettings' }, 'v', h)).toMatchObject({ minAgeDays: 150 });
    await handleRequest(svc, { type: 'fallbackShown' }, 'v', h);
    expect(await handleRequest(svc, { type: 'getDiagnostics' }, 'v', h)).toMatchObject({ version: 'v', counters: { fallbackShown: 1 } });
    await handleRequest(svc, { type: 'deleteListing', listingKey: 'immobiliare:128416572' }, 'v', h);
    expect(await handleRequest(svc, { type: 'listLeads' }, 'v', h)).toEqual([]);
    await svc.ingest([obs()]);
    h.leadsChanged.mockClear();
    await handleRequest(svc, { type: 'deleteListings', listingKeys: ['immobiliare:128416572'] }, 'v', h);
    expect(await handleRequest(svc, { type: 'listLeads' }, 'v', h)).toEqual([]);
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
  });

  it('rifiuta richieste sconosciute', async () => {
    const { svc } = setup();
    await expect(handleRequest(svc, { type: 'boh' } as never, 'v', hooks())).rejects.toThrow('Richiesta sconosciuta: boh');
  });
});
