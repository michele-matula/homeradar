import { describe, expect, it } from 'vitest';
import { addDays, startOfLocalDay } from '@/core/recall';
import { RECALL_ON_DISCARDED } from '@/core/service';
import { DAY_MS } from '@/shared/types';
import { START, obs, setup } from './helpers';

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

  it('confronta il €/m² con tutto l\'archivio, anche con gli annunci non mostrati', async () => {
    const { svc } = setup();
    // Lead Alta: 235.000 € su 62 m² ≈ 3.790 €/m². Altri 5 privati della zona a 3.000 €/m², senza segnali.
    await svc.ingest([obs(), ...[1, 2, 3, 4, 5].map((i) => obs({ portalId: 131597836 + i, lastDrop: null, price: 186000 }))]);
    const leads = await svc.listLeads();
    expect(leads.map((l) => l.listing.portalId)).toEqual([128416572]);
    expect(leads[0]!.market).toMatchObject({ scope: 'zone', label: 'Precotto', medianPerM2: 3000, sampleSize: 5 });
    expect(leads[0]!.market!.deltaPercent).toBeCloseTo(26.34, 1);
  });

  it('senza abbastanza annunci il confronto è null', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    expect((await svc.listLeads())[0]!.market).toBeNull();
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

  it('aggiorna updatedAt a ogni cambio di stato o di note, non se nulla cambia', async () => {
    const { db, svc, advance, now } = setup();
    await svc.ingest([obs()]);
    expect((await db.leadStates.get(KEY))!.updatedAt).toBe(START);
    advance(1000);
    expect((await svc.setLeadState(KEY, { status: 'to_contact' })).updatedAt).toBe(now());
    advance(1000);
    expect((await svc.setLeadState(KEY, { notes: 'chiamare sera' })).updatedAt).toBe(now());
    advance(1000);
    expect((await svc.setLeadState(KEY, { notes: 'chiamare sera', status: 'to_contact' })).updatedAt).toBe(now() - 1000);
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

describe('LeadService: richiami', () => {
  const today = startOfLocalDay(START);

  it('un richiamo su un lead "Nuovo" lo porta a "Da contattare" e viene salvato come mezzanotte locale', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    advance(1000);
    const s = await svc.setLeadState(KEY, { recallAt: addDays(today, 3) + 5 * 3600_000 });
    expect(s).toMatchObject({ status: 'to_contact', statusChangedAt: now(), updatedAt: now(), recallAt: addDays(today, 3) });
  });

  it('su "Contattato" lo stato non cambia; "Fatto" toglie la data e aggiorna updatedAt', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    await svc.setLeadState(KEY, { status: 'contacted' });
    advance(1000);
    const set = await svc.setLeadState(KEY, { recallAt: addDays(today, 7) });
    expect(set).toMatchObject({ status: 'contacted', statusChangedAt: now() - 1000, updatedAt: now(), recallAt: addDays(today, 7) });
    advance(1000);
    expect(await svc.setLeadState(KEY, { recallAt: null })).toMatchObject({ recallAt: null, updatedAt: now() });
    advance(1000);
    expect((await svc.setLeadState(KEY, { recallAt: null })).updatedAt).toBe(now() - 1000);
  });

  it('passare a "Scartato" toglie il richiamo; impostarlo su uno scartato è un errore', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, 1) });
    expect(await svc.setLeadState(KEY, { status: 'discarded' })).toMatchObject({ status: 'discarded', recallAt: null });
    await expect(svc.setLeadState(KEY, { recallAt: addDays(today, 1) })).rejects.toThrow(RECALL_ON_DISCARDED);
    await expect(svc.setLeadState(KEY, { status: 'discarded', recallAt: addDays(today, 1) })).rejects.toThrow(RECALL_ON_DISCARDED);
  });

  it('rimesso a mano su "Nuovo", il lead tiene il richiamo', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, 1) });
    expect(await svc.setLeadState(KEY, { status: 'new' })).toMatchObject({ status: 'new', recallAt: addDays(today, 1) });
  });

  it('dueRecallCount conta oggi e i giorni passati, non domani né gli scartati', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs(), obs({ portalId: 2 }), obs({ portalId: 3 }), obs({ portalId: 4 })]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, -2) });
    await svc.setLeadState('immobiliare:2', { recallAt: today });
    await svc.setLeadState('immobiliare:3', { recallAt: addDays(today, 1) });
    // Un dato incoerente (es. da un vecchio backup) non va contato.
    await db.leadStates.put({ listingKey: 'immobiliare:4', status: 'discarded', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: today });
    expect(await svc.dueRecallCount(START)).toBe(2);
    expect(await svc.dueRecallCount(addDays(today, 1) + 1)).toBe(3);
  });

  it('la pulizia non cancella un lead "Nuovo" con un richiamo', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([obs(), obs({ portalId: 2 })]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, 200) });
    await svc.setLeadState(KEY, { status: 'new' });
    advance(400 * DAY_MS);
    expect(await svc.purge()).toBe(1);
    expect(await db.listings.toCollection().primaryKeys()).toEqual([KEY]);
  });
});

describe('LeadService.listLeads: richiami', () => {
  it('mostra un lead "Nuovo" senza segnali se ha un richiamo, così il pannello lo vede come l\'icona', async () => {
    const { svc } = setup();
    await svc.ingest([obs({ portalId: 131597836, lastDrop: null, price: 410000 })]); // nessun segnale
    const key = 'immobiliare:131597836';
    await svc.setLeadState(key, { recallAt: startOfLocalDay(START) });
    await svc.setLeadState(key, { status: 'new' });
    const leads = await svc.listLeads();
    expect(leads.map((l) => [l.listing.key, l.evaluation.priority, l.state.status])).toEqual([[key, 'none', 'new']]);
    expect(await svc.dueRecallCount(START)).toBe(1);
  });
});
