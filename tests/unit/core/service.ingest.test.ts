import { describe, expect, it } from 'vitest';
import { VISIT_GAP_MS } from '@/core/service';
import type { ListingObservation } from '@/shared/types';
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
    expect(await db.calibration.get(['immobiliare', 128416572])).toEqual({ portal: 'immobiliare', portalId: 128416572, createdAt: created });
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

  const idealista = (o: Partial<ListingObservation> = {}) => obs({
    portal: 'idealista', portalId: 37200000, url: 'https://www.idealista.it/immobile/37200000/', lastDrop: null, ...o,
  });

  it('impara un punto di calibrazione Idealista dalla pagina "più recenti"', async () => {
    const { db, svc } = setup(Date.UTC(2026, 9, 20, 12));
    await svc.ingest([idealista({ sellerType: 'agency' })], { portal: 'idealista', portalId: 37200000 });
    expect(await db.calibration.get(['idealista', 37200000])).toEqual({ portal: 'idealista', portalId: 37200000, createdAt: Date.UTC(2026, 9, 20) });
  });

  it('scarta un punto Idealista con ritmo anomalo', async () => {
    const { db, svc } = setup(Date.UTC(2026, 9, 20, 12));
    await svc.ingest([idealista({ portalId: 37150000 })], { portal: 'idealista', portalId: 37150000 });
    expect(await db.calibration.count()).toBe(0);
  });

  it("stima l'età Idealista solo con i punti Idealista", async () => {
    const { db, svc } = setup(Date.UTC(2026, 9, 13, 12));
    await svc.ingest([idealista({ portalId: 36000000 })]);
    expect((await db.listings.get('idealista:36000000'))!.estimatedCreatedAt).toBe(Date.UTC(2026, 5, 13));
  });
});
