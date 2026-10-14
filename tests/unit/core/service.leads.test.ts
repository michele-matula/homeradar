import { describe, expect, it } from 'vitest';
import { DAY_MS } from '@/shared/types';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';

describe('LeadService.listLeads', () => {
  it('restituisce solo lead o annunci già lavorati, ordinati', async () => {
    const { svc } = setup();
    await svc.ingest([
      obs(), // Alta
      obs({ portalId: 131597836, lastDrop: null, price: 410000 }), // ~65 gg, nessun segnale
      obs({ portalId: 120000000, lastDrop: null, price: 500000 }), // molto vecchio → Media
    ]);
    let leads = await svc.listLeads();
    expect(leads.map((l) => [l.listing.portalId, l.evaluation.priority])).toEqual([
      [128416572, 'high'],
      [120000000, 'medium'],
    ]);
    await svc.setLeadState('immobiliare:131597836', { status: 'discarded' });
    leads = await svc.listLeads();
    expect(leads.map((l) => l.listing.portalId)).toContain(131597836);
    expect(leads[0]!.prices.map((p) => p.price)).toEqual([249000, 235000]);
  });
});

describe('LeadService.setLeadState', () => {
  it('aggiorna stato e data solo quando lo stato cambia', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    advance(1000);
    const s1 = await svc.setLeadState(KEY, { status: 'to_contact' });
    expect(s1).toMatchObject({ status: 'to_contact', statusChangedAt: now() });
    advance(1000);
    const s2 = await svc.setLeadState(KEY, { notes: 'chiamare sera' });
    expect(s2).toMatchObject({ status: 'to_contact', notes: 'chiamare sera', statusChangedAt: now() - 1000 });
  });

  it('rifiuta un annuncio sconosciuto', async () => {
    const { svc } = setup();
    await expect(svc.setLeadState('immobiliare:1', { status: 'contacted' })).rejects.toThrow('Annuncio non trovato');
  });
});

describe('LeadService.deleteListing', () => {
  it('elimina annuncio, snapshot e stato', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs()]);
    await svc.deleteListing(KEY);
    expect(await db.listings.count()).toBe(0);
    expect(await db.priceSnapshots.count()).toBe(0);
    expect(await db.leadStates.count()).toBe(0);
  });
});

describe('LeadService.deleteListings', () => {
  it('elimina solo gli annunci indicati, con snapshot e stato', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs(), obs({ portalId: 2, lastDrop: null }), obs({ portalId: 3, lastDrop: null })]);
    await svc.setLeadState(KEY, { status: 'contacted' });
    await svc.deleteListings([KEY, 'immobiliare:2']);
    expect(await db.listings.toCollection().primaryKeys()).toEqual(['immobiliare:3']);
    expect(await db.priceSnapshots.where('listingKey').anyOf([KEY, 'immobiliare:2']).count()).toBe(0);
    expect(await db.leadStates.get(KEY)).toBeUndefined();
    await svc.deleteListings([]);
    expect(await db.listings.count()).toBe(1);
  });
});

describe('LeadService.deleteAllListings', () => {
  it('svuota annunci, snapshot e stati ma conserva le impostazioni', async () => {
    const { db, svc } = setup();
    await svc.saveSettings({ minAgeDays: 150 });
    await svc.ingest([obs(), obs({ portalId: 2, lastDrop: null })]);
    await svc.setLeadState(KEY, { status: 'contacted', notes: 'x' });
    expect(await svc.deleteAllListings()).toBe(2);
    expect(await db.listings.count()).toBe(0);
    expect(await db.priceSnapshots.count()).toBe(0);
    expect(await db.leadStates.count()).toBe(0);
    expect((await svc.getSettings()).minAgeDays).toBe(150);
  });
});

describe('LeadService impostazioni', () => {
  it('salva, valida e influenza la valutazione', async () => {
    const { svc } = setup();
    await svc.ingest([obs({ portalId: 120000000, lastDrop: null, price: 500000 })]);
    expect((await svc.listLeads())).toHaveLength(1);
    expect(await svc.saveSettings({ minAgeDays: 3000 })).toMatchObject({ minAgeDays: 3000 });
    expect(await svc.listLeads()).toHaveLength(0);
    await expect(svc.saveSettings({ minAgeDays: -1 })).rejects.toThrow('Soglia giorni non valida');
    expect((await svc.getSettings()).minAgeDays).toBe(3000);
  });

  it('salva i portali attivi senza toccare gli altri', async () => {
    const { svc } = setup();
    expect((await svc.getSettings()).enabledPortals).toEqual({ immobiliare: true, idealista: true, subito: true });
    await svc.saveSettings({ enabledPortals: { subito: false } as never });
    await svc.saveSettings({ enabledPortals: { idealista: false } as never });
    expect((await svc.getSettings()).enabledPortals).toEqual({ immobiliare: true, idealista: false, subito: false });
  });
});

describe('LeadService.purge', () => {
  it('elimina solo annunci vecchi rimasti "new"', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([obs(), obs({ portalId: 2, lastDrop: null }), obs({ portalId: 3, lastDrop: null })]);
    await svc.setLeadState('immobiliare:2', { status: 'contacted' });
    advance(91 * DAY_MS);
    await svc.ingest([obs({ portalId: 3, lastDrop: null })]);
    expect(await svc.purge()).toBe(1);
    expect((await db.listings.toCollection().primaryKeys()).sort()).toEqual(['immobiliare:2', 'immobiliare:3']);
    expect(await db.priceSnapshots.where('listingKey').equals(KEY).count()).toBe(0);
    expect(await db.leadStates.get(KEY)).toBeUndefined();
  });
});

describe('LeadService diagnostica', () => {
  it('tiene contatori, ultimi 20 errori e avviso adattatore', async () => {
    const { svc } = setup();
    await svc.bumpCounter('apiPayloads');
    await svc.bumpCounter('apiPayloads', 2);
    for (let i = 0; i < 25; i++) await svc.recordError(`errore ${i}`);
    expect(await svc.setAdapterWarning('immobiliare', true)).toEqual({ any: true, changed: true });
    expect(await svc.setAdapterWarning('immobiliare', true)).toEqual({ any: true, changed: false });
    const d = await svc.getDiagnostics('0.1.0');
    expect(d.version).toBe('0.1.0');
    expect(d.counters.apiPayloads).toBe(3);
    expect(d.errors).toHaveLength(20);
    expect(d.errors[19]!.message).toBe('errore 24');
    expect(d.adapterWarning).toEqual({ immobiliare: true });
  });

  it('legge come avviso di Immobiliare il booleano salvato dalle versioni precedenti', async () => {
    const { db, svc } = setup();
    await db.meta.put({ key: 'diagnostics', value: { counters: {}, errors: [], adapterWarning: true } });
    expect((await svc.getDiagnostics('v')).adapterWarning).toEqual({ immobiliare: true });
  });
});
