import { describe, expect, it } from 'vitest';
import { VISIT_GAP_MS } from '@/core/service';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';

describe('LeadService.ingest', () => {
  it('salva il privato, crea lo stato "new" e gli snapshot dichiarati', async () => {
    const { db, svc } = setup();
    const [e] = await svc.ingest([obs()]);
    expect(e!.priority).toBe('high');
    expect(e!.badgeText).toBe('● Alta · ~173 gg · −5,6%');

    const l = await db.listings.get(KEY);
    expect(l).toMatchObject({ currentPrice: 235000, seenCount: 1, portalCreatedAt: null });
    expect(l!.estimatedCreatedAt).toBe(Date.UTC(2026, 3, 20));
    expect(await db.leadStates.get(KEY)).toMatchObject({ status: 'new', notes: '' });
    const snaps = await db.priceSnapshots.where('listingKey').equals(KEY).sortBy('at');
    expect(snaps.map((s) => [s.price, s.source])).toEqual([[249000, 'declared'], [235000, 'declared']]);
  });

  it('ignora agenzie e costruttori', async () => {
    const { db, svc } = setup();
    expect(await svc.ingest([obs({ sellerType: 'agency' }), obs({ portalId: 2, sellerType: 'constructor' })])).toEqual([]);
    expect(await db.listings.count()).toBe(0);
  });

  it('usa e conserva la data reale del dettaglio e la aggiunge alla calibrazione', async () => {
    const { db, svc } = setup();
    const created = Date.UTC(2026, 3, 1);
    const [e] = await svc.ingest([obs({ source: 'detail', portalCreatedAt: created })]);
    expect(e!.ageEstimated).toBe(false);
    expect(await db.idCalibration.get(128416572)).toEqual({ portalId: 128416572, createdAt: created });
    await svc.ingest([obs()]);
    expect((await db.listings.get(KEY))!.portalCreatedAt).toBe(created);
  });

  it('aggiunge uno snapshot osservato solo quando il prezzo cambia', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([obs({ lastDrop: null, price: 300000 })]);
    advance(VISIT_GAP_MS);
    await svc.ingest([obs({ lastDrop: null, price: 300000 })]);
    advance(VISIT_GAP_MS);
    await svc.ingest([obs({ lastDrop: null, price: 290000 })]);
    const snaps = await db.priceSnapshots.where('listingKey').equals(KEY).sortBy('at');
    expect(snaps.map((s) => [s.price, s.source])).toEqual([[300000, 'observed'], [290000, 'observed']]);
    expect((await db.listings.get(KEY))!.currentPrice).toBe(290000);
  });

  it('prezzo nascosto: mantiene l\'ultimo prezzo noto e non crea snapshot', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs({ lastDrop: null, price: 300000 })]);
    await svc.ingest([obs({ lastDrop: null, price: null })]);
    expect((await db.listings.get(KEY))!.currentPrice).toBe(300000);
    expect(await db.priceSnapshots.count()).toBe(1);
  });

  it('stesso annuncio due volte nella stessa visita (anche in parallelo): nessun duplicato', async () => {
    const { db, svc, advance } = setup();
    await Promise.all([svc.ingest([obs()]), svc.ingest([obs()])]);
    expect(await db.leadStates.count()).toBe(1);
    expect(await db.priceSnapshots.count()).toBe(2);
    expect((await db.listings.get(KEY))!.seenCount).toBe(1);
    advance(VISIT_GAP_MS - 1);
    await svc.ingest([obs()]);
    expect((await db.listings.get(KEY))!.seenCount).toBe(1);
    advance(1);
    await svc.ingest([obs()]);
    expect((await db.listings.get(KEY))!.seenCount).toBe(2);
  });

  it('non sovrascrive stato e note dell\'agente', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs()]);
    await db.leadStates.put({ listingKey: KEY, status: 'contacted', notes: 'richiamare', statusChangedAt: 1 });
    await svc.ingest([obs()]);
    expect(await db.leadStates.get(KEY)).toMatchObject({ status: 'contacted', notes: 'richiamare' });
  });
});
