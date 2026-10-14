import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '@/core/router';
import { DEFAULT_SETTINGS } from '@/shared/types';
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
    await svc.ingest([obs()]);
    expect(await handleRequest(svc, { type: 'deleteAllListings' }, 'v', h)).toBe(1);
    expect(h.leadsChanged).toHaveBeenCalledTimes(2);
    expect((await svc.getDiagnostics('x')).counters.ingested).toBe(1);
  });

  it("parseStatus gestisce l'avviso per portale e registra gli errori", async () => {
    const { svc } = setup();
    const h = hooks();
    await handleRequest(svc, { type: 'parseStatus', portal: 'immobiliare', ok: false, errors: ['search data not found'], source: 'api' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(true);
    let d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toEqual({ immobiliare: true });
    expect(d.errors.map((e) => e.message)).toEqual(['search data not found']);
    await handleRequest(svc, { type: 'parseStatus', portal: 'idealista', ok: false, errors: [], source: 'dom' }, '0.1.0', h);
    await handleRequest(svc, { type: 'parseStatus', portal: 'immobiliare', ok: true, errors: [], source: 'next-data' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(true); // Idealista ha ancora l'avviso
    d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toEqual({ immobiliare: false, idealista: true });
    expect(d.counters).toMatchObject({ apiPayloads: 1, nextDataPayloads: 1, domScans: 1 });
    await handleRequest(svc, { type: 'parseStatus', portal: 'idealista', ok: true, errors: [], source: 'dom' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(false);
  });

  it("parseStatus aggiorna il pannello solo quando l'avviso del portale cambia", async () => {
    const { svc } = setup();
    const h = hooks();
    const status = (ok: boolean) => handleRequest(svc, { type: 'parseStatus', portal: 'subito', ok, errors: [], source: 'next-data' }, 'v', h);
    await status(true);
    expect(h.leadsChanged).not.toHaveBeenCalled();
    await status(false);
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
    await status(false);
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
    // Avviso spento senza nuovi lead: il pannello deve toglierlo subito.
    await status(true);
    expect(h.leadsChanged).toHaveBeenCalledTimes(2);
  });

  it('un portale spento non salva annunci né avvisi', async () => {
    const { svc } = setup();
    const h = hooks();
    await handleRequest(svc, { type: 'parseStatus', portal: 'subito', ok: false, errors: [], source: 'api' }, 'v', h);
    await handleRequest(svc, { type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, enabledPortals: { ...DEFAULT_SETTINGS.enabledPortals, subito: false } } }, 'v', h);
    // Spegnere il portale toglie il suo avviso, che altrimenti resterebbe acceso per sempre.
    expect(h.setWarning).toHaveBeenLastCalledWith(false);
    expect((await svc.getDiagnostics('v')).adapterWarning.subito).toBe(false);
    const fromSubito = obs({ portal: 'subito', portalId: 5, url: 'https://www.subito.it/x-5.htm' });
    const evs = await handleRequest(svc, { type: 'ingest', observations: [fromSubito, obs()], calibrationHint: { portal: 'subito', portalId: 5 } }, 'v', h);
    expect((evs as unknown[]).length).toBe(1);
    expect((await svc.listLeads()).map((l) => l.listing.key)).toEqual(['immobiliare:128416572']);
    await handleRequest(svc, { type: 'parseStatus', portal: 'subito', ok: false, errors: ['x'], source: 'api' }, 'v', h);
    const d = await svc.getDiagnostics('v');
    expect(d.adapterWarning.subito).toBe(false);
    expect(d.errors).toEqual([]);
  });

  it('inoltra le richieste del pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    await svc.ingest([obs()]);
    expect(((await handleRequest(svc, { type: 'listLeads' }, 'v', h)) as unknown[]).length).toBe(1);
    expect(await handleRequest(svc, { type: 'setLeadState', listingKey: 'immobiliare:128416572', status: 'contacted' }, 'v', h)).toMatchObject({ status: 'contacted' });
    expect(await handleRequest(svc, { type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, minAgeDays: 150 } }, 'v', h)).toMatchObject({ minAgeDays: 150 });
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

  it('exportBackup registra il backup manuale; importBackup aggiorna il pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    await svc.ingest([obs()]);
    const file = await handleRequest(svc, { type: 'exportBackup' }, '0.1.0', h);
    expect(file).toMatchObject({ format: 'homeradar-backup', extensionVersion: '0.1.0' });
    const status = (await handleRequest(svc, { type: 'getBackupStatus' }, 'v', h)) as { lastAt: number | null; nextSlot: number };
    expect(status.lastAt).not.toBeNull();
    expect(status.nextSlot).toBe(1);

    const other = setup();
    h.leadsChanged.mockClear();
    expect(await handleRequest(other.svc, { type: 'importBackup', backup: JSON.parse(JSON.stringify(file)) }, 'v', h)).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
  });

  it('importBackup con un file non valido fallisce senza avvisare il pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    await expect(handleRequest(svc, { type: 'importBackup', backup: { foo: 1 } }, 'v', h)).rejects.toThrow();
    expect(h.leadsChanged).not.toHaveBeenCalled();
  });

  it('rifiuta richieste sconosciute', async () => {
    const { svc } = setup();
    await expect(handleRequest(svc, { type: 'boh' } as never, 'v', hooks())).rejects.toThrow('Richiesta sconosciuta: boh');
  });
});
