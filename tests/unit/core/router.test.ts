import { describe, expect, it, vi } from 'vitest';
import { ONBOARDING_VERSION } from '@/core/onboarding';
import { handleRequest } from '@/core/router';
import { DEFAULT_SETTINGS } from '@/shared/types';
import { obs, setup } from './helpers';

function hooks() {
  return {
    setWarning: vi.fn(), leadsChanged: vi.fn(), onboardingChanged: vi.fn(), recallsChanged: vi.fn(), openOnboarding: vi.fn(async () => {}),
    reporter: {
      info: vi.fn(async () => ({ configured: true, status: { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false }, queued: 0 })),
      preview: vi.fn(),
      sendReport: vi.fn(async () => ({ configured: true, status: { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false }, queued: 0 })),
      sendFeedback: vi.fn(async () => 'sent' as const),
      flushFeedback: vi.fn(async () => {}),
    },
  };
}

/** Servizio con l'informativa già confermata: i test esistenti lavorano su un'estensione attiva. */
async function ready() {
  const s = setup();
  await s.svc.acceptOnboarding();
  return s;
}

describe('handleRequest', () => {
  it('ingest restituisce le valutazioni e notifica il pannello', async () => {
    const { svc } = await ready();
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
    const { svc } = await ready();
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
    const { svc } = await ready();
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
    const { svc } = await ready();
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
    const { svc } = await ready();
    const h = hooks();
    await svc.ingest([obs()]);
    expect(((await handleRequest(svc, { type: 'listLeads' }, 'v', h)) as unknown[]).length).toBe(1);
    expect(await handleRequest(svc, { type: 'setLeadState', listingKeys: ['immobiliare:128416572'], status: 'contacted' }, 'v', h)).toMatchObject({ status: 'contacted' });
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

  it("setLeadState inoltra il richiamo e aggiorna il segnale sull'icona", async () => {
    const { svc } = await ready();
    const h = hooks();
    await svc.ingest([obs()]);
    const day = new Date(2026, 9, 20).getTime();
    expect(await handleRequest(svc, { type: 'setLeadState', listingKeys: ['immobiliare:128416572'], recallAt: day }, 'v', h)).toMatchObject({ recallAt: day, status: 'to_contact' });
    expect(h.recallsChanged).toHaveBeenCalledTimes(1);
  });

  it('exportBackup registra il backup manuale; importBackup aggiorna il pannello', async () => {
    const { svc } = await ready();
    const h = hooks();
    await svc.ingest([obs()]);
    const file = await handleRequest(svc, { type: 'exportBackup' }, '0.1.0', h);
    expect(file).toMatchObject({ format: 'homeradar-backup', extensionVersion: '0.1.0' });
    const status = (await handleRequest(svc, { type: 'getBackupStatus' }, 'v', h)) as { lastAt: number | null; nextSlot: number };
    expect(status.lastAt).not.toBeNull();
    expect(status.nextSlot).toBe(1);

    const other = await ready();
    h.leadsChanged.mockClear();
    expect(await handleRequest(other.svc, { type: 'importBackup', backup: JSON.parse(JSON.stringify(file)) }, 'v', h)).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
  });

  it('importBackup con un file non valido fallisce senza avvisare il pannello', async () => {
    const { svc } = await ready();
    const h = hooks();
    await expect(handleRequest(svc, { type: 'importBackup', backup: { foo: 1 } }, 'v', h)).rejects.toThrow();
    expect(h.leadsChanged).not.toHaveBeenCalled();
  });

  it("senza conferma dell'informativa non salva annunci né avvisi", async () => {
    const { svc } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', h)).toEqual([]);
    expect(await handleRequest(svc, { type: 'parseStatus', portal: 'immobiliare', ok: false, errors: ['x'], source: 'api' }, 'v', h)).toBeNull();
    expect(await svc.listLeads()).toEqual([]);
    const d = await svc.getDiagnostics('v');
    expect(d.errors).toEqual([]);
    expect(d.adapterWarning).toEqual({});
    expect(h.leadsChanged).not.toHaveBeenCalled();
    expect(h.setWarning).not.toHaveBeenCalled();
    // Le richieste del pannello passano comunque.
    expect(await handleRequest(svc, { type: 'getSettings' }, 'v', h)).toEqual(DEFAULT_SETTINGS);
  });

  it('getPortalState: in attesa della conferma, poi acceso o spento', async () => {
    const { svc } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'subito' }, 'v', h)).toBe('onboarding');
    await svc.saveSettings({ ...DEFAULT_SETTINGS, enabledPortals: { ...DEFAULT_SETTINGS.enabledPortals, subito: false } });
    // Finché manca la conferma vince l'informativa, anche su un portale spento.
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'subito' }, 'v', h)).toBe('onboarding');
    await handleRequest(svc, { type: 'acceptOnboarding' }, 'v', h);
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'subito' }, 'v', h)).toBe('off');
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'immobiliare' }, 'v', h)).toBe('active');
  });

  it("acceptOnboarding salva, avvisa le pagine e sblocca la lettura", async () => {
    const { svc, now } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'getOnboardingStatus' }, 'v', h)).toMatchObject({ acceptedVersion: null });
    expect(await handleRequest(svc, { type: 'acceptOnboarding' }, 'v', h)).toMatchObject({ acceptedVersion: ONBOARDING_VERSION, acceptedAt: now() });
    expect(h.onboardingChanged).toHaveBeenCalledTimes(1);
    const evs = (await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', h)) as unknown[];
    expect(evs).toHaveLength(1);
  });

  it("openOnboarding apre la scheda; un errore finisce nel diagnostico", async () => {
    const { svc } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'openOnboarding' }, 'v', h)).toBeNull();
    expect(h.openOnboarding).toHaveBeenCalledTimes(1);
    h.openOnboarding.mockRejectedValueOnce(new Error('No current window'));
    expect(await handleRequest(svc, { type: 'openOnboarding' }, 'v', h)).toBeNull();
    expect((await svc.getDiagnostics('v')).errors.at(-1)!.message).toBe("Apertura dell'informativa: No current window");
  });

  it('rifiuta richieste sconosciute', async () => {
    const { svc } = await ready();
    await expect(handleRequest(svc, { type: 'boh' } as never, 'v', hooks())).rejects.toThrow('Richiesta sconosciuta: boh');
  });
});

describe('handleRequest splitListing', () => {
  it("separa e aggiorna il segnale sull'icona", async () => {
    const { svc, db } = await ready();
    await svc.ingest([obs(), obs({ portal: 'idealista', portalId: 33000001, url: 'https://www.idealista.it/immobile/33000001/', lastDrop: null, price: 239000 })]);
    const h = hooks();
    expect(await handleRequest(svc, { type: 'splitListing', listingKey: 'idealista:33000001', fromKeys: ['immobiliare:128416572'] }, 'v', h)).toBeNull();
    expect(await db.splits.count()).toBe(1);
    expect(h.recallsChanged).toHaveBeenCalled();
  });
  it('ingest accettato segna il giorno di navigazione, trackUsage il pannello e gli export', async () => {
    const { svc } = await ready();
    const h = hooks();
    await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', h);
    await handleRequest(svc, { type: 'trackUsage', event: { kind: 'panel' } }, 'v', h);
    await handleRequest(svc, { type: 'trackUsage', event: { kind: 'export', format: 'xlsx' } }, 'v', h);
    const u = await svc.pilot.usage();
    expect(u.browsingDays).toHaveLength(1);
    expect(u.panelDays).toHaveLength(1);
    expect(u.exports.xlsx).toBe(1);
  });

  it('ingest scartato (informativa da confermare) non segna il giorno', async () => {
    const { svc } = setup();
    await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', hooks());
    expect((await svc.pilot.usage()).browsingDays).toEqual([]);
  });
  it('inoltra le richieste del pilota al reporter', async () => {
    const { svc } = await ready();
    const h = hooks();
    await handleRequest(svc, { type: 'sendReportNow' }, 'v', h);
    expect(h.reporter.sendReport).toHaveBeenCalledWith('manual');
    expect(await handleRequest(svc, { type: 'sendFeedback', text: 'ciao' }, 'v', h)).toBe('sent');
    expect(h.reporter.sendFeedback).toHaveBeenCalledWith('ciao');
    const d = (await handleRequest(svc, { type: 'getDiagnostics' }, 'v', h)) as { usage: unknown; reporting: unknown };
    expect(d.usage).toBeDefined();
    expect(d.reporting).toMatchObject({ configured: true });
  });

  it('cambiare il codice pilota azzera il rifiuto', async () => {
    const { svc } = await ready();
    await svc.pilot.updateReporting((s) => { s.codeRejected = true; s.lastError = 'rejected'; });
    await handleRequest(svc, { type: 'saveSettings', settings: { ...DEFAULT_SETTINGS } }, 'v', hooks());
    expect((await svc.pilot.reportingStatus()).codeRejected).toBe(true);
    await handleRequest(svc, { type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, pilotCode: 'NUOVO-1234' } }, 'v', hooks());
    expect(await svc.pilot.reportingStatus()).toMatchObject({ codeRejected: false, lastError: null });
  });
});
