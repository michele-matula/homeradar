import { describe, expect, it } from 'vitest';
import { VISIT_GAP_MS } from '@/core/service';
import { DAY_MS, type ListingObservation } from '@/shared/types';
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
    await db.leadStates.put({ listingKey: KEY, status: 'contacted', notes: 'richiamare', statusChangedAt: 1, updatedAt: 1, recallAt: null });
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

  it('dà al ribasso senza data il giorno in cui è stato visto e lo conserva alle visite successive', async () => {
    const { db, svc, advance } = setup();
    const lastDrop = { fromPrice: 645000, toPrice: 625000, percent: 3.1, date: null };
    await svc.ingest([idealista({ portalId: 37011951, price: 625000, lastDrop })]);
    const key = 'idealista:37011951';
    expect((await db.listings.get(key))!.lastDrop).toEqual({ ...lastDrop, date: Date.UTC(2026, 9, 10), dateEstimated: true });
    advance(3 * DAY_MS);
    await svc.ingest([idealista({ portalId: 37011951, price: 625000, lastDrop })]);
    expect((await db.listings.get(key))!.lastDrop!.date).toBe(Date.UTC(2026, 9, 10));
    const declared = (await db.priceSnapshots.where('listingKey').equals(key).toArray()).filter((s) => s.source === 'declared');
    expect(declared).toHaveLength(2);
  });

  it('un nuovo ribasso senza data prende il giorno in cui compare', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([idealista({ portalId: 37011951, price: 625000, lastDrop: { fromPrice: 645000, toPrice: 625000, percent: 3.1, date: null } })]);
    advance(3 * DAY_MS);
    await svc.ingest([idealista({ portalId: 37011951, price: 600000, lastDrop: { fromPrice: 625000, toPrice: 600000, percent: 4, date: null } })]);
    expect((await db.listings.get('idealista:37011951'))!.lastDrop).toMatchObject({ toPrice: 600000, date: Date.UTC(2026, 9, 13), dateEstimated: true });
  });
});

describe('ingest: categoria e giro', () => {
  it('categoria dalla tipologia, poi dalla ricerca, poi dal valore salvato', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs({ category: 'garage' })]);
    expect((await db.listings.get('immobiliare:128416572'))!.category).toBe('garage');
    await svc.ingest([obs({ category: null })]);
    expect((await db.listings.get('immobiliare:128416572'))!.category).toBe('garage');
    await svc.ingest([obs({ portalId: 7, url: 'https://www.immobiliare.it/annunci/7/', category: null })], undefined, { searchCategory: 'land' });
    expect((await db.listings.get('immobiliare:7'))!.category).toBe('land');
    await svc.ingest([obs({ portalId: 8, url: 'https://www.immobiliare.it/annunci/8/', category: null })]);
    expect((await db.listings.get('immobiliare:8'))!.category).toBe('residential');
  });

  it('il giro salva la ricerca e azzera "non più visto"; la navigazione a mano tiene la ricerca', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs()], undefined, { sweepScope: 'immobiliare|comune:015059|case' });
    await db.listings.update('immobiliare:128416572', { missedSweeps: 3, missingSince: 123 });
    await svc.ingest([obs()]);
    expect(await db.listings.get('immobiliare:128416572')).toMatchObject({ sweepScope: 'immobiliare|comune:015059|case', missedSweeps: 0, missingSince: null });
  });

  it('segnala i ribassi degli annunci già salvati, non quelli nuovi', async () => {
    const { svc } = setup();
    const drops: string[] = [];
    const onDrop = (k: string) => drops.push(k);
    await svc.ingest([obs({ price: 235000 })], undefined, { onDrop });
    expect(drops).toEqual([]);
    await svc.ingest([obs({ price: 235000 })], undefined, { onDrop });
    expect(drops).toEqual([]);
    await svc.ingest([obs({ price: 225000, lastDrop: null })], undefined, { onDrop });
    expect(drops).toEqual(['immobiliare:128416572']);
    await svc.ingest([obs({ price: 225000, lastDrop: { fromPrice: 235000, toPrice: 225000, percent: 4.3, date: Date.UTC(2026, 9, 11) } })], undefined, { onDrop });
    expect(drops).toEqual(['immobiliare:128416572', 'immobiliare:128416572']);
  });
});
