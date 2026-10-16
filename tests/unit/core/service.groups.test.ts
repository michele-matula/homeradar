import { describe, expect, it } from 'vitest';
import { startOfLocalDay } from '@/core/recall';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';
const TWIN = 'idealista:33000001';
/** Lo stesso bilocale di `obs()` pubblicato su Idealista, a un prezzo poco diverso. */
const twin = (o = {}) => obs({ portal: 'idealista', portalId: 33000001, url: 'https://www.idealista.it/immobile/33000001/', lastDrop: null, price: 239000, ...o });

describe('stesso immobile su più portali', () => {
  it('listLeads: un solo lead con le due fonti', async () => {
    const { svc } = setup();
    await svc.ingest([obs(), twin()]);
    const leads = await svc.listLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0]!.listing.key).toBe(KEY);
    expect(leads[0]!.others.map((o) => o.listing.key)).toEqual([TWIN]);
    expect(leads[0]!.evaluation.badgeText).toMatch(/· 2 portali$/);
  });

  it('ingest: il badge della card è quello del gruppo, con la chiave della card', async () => {
    const { svc } = setup();
    const evs = await svc.ingest([obs(), twin()]);
    const card = evs.find((e) => e.listingKey === TWIN)!;
    expect(card).toMatchObject({ portalId: 33000001, priority: 'high' });
    expect(card.badgeText).toMatch(/^● Alta · .* · 2 portali$/);
  });

  it('lo stato scritto sul gruppo vale per tutte le fonti', async () => {
    const { svc, db } = setup();
    await svc.ingest([obs(), twin()]);
    await svc.setLeadState([KEY, TWIN], { status: 'contacted', notes: 'sera' });
    expect(await db.leadStates.get(TWIN)).toMatchObject({ status: 'contacted', notes: 'sera' });
    expect(await db.leadStates.get(KEY)).toMatchObject({ status: 'contacted', notes: 'sera' });
  });

  it('note scritte prima su annunci diversi: il lead le mostra tutte', async () => {
    const { svc } = setup();
    await svc.ingest([obs(), twin()]);
    await svc.setLeadState(KEY, { notes: 'sera' });
    await svc.setLeadState(TWIN, { notes: 'ha un agente' });
    expect((await svc.listLeads())[0]!.state.notes).toBe('Immobiliare: sera · Idealista: ha un agente');
  });

  it('un prezzo che diverge scioglie il gruppo; ogni fonte resta con lo stato del gruppo', async () => {
    const { svc } = setup();
    await svc.ingest([obs(), twin()]);
    await svc.setLeadState([KEY, TWIN], { status: 'contacted' });
    await svc.ingest([twin({ price: 280000 })]);
    const leads = await svc.listLeads();
    expect(leads.map((l) => [l.listing.key, l.others.length, l.state.status]).sort()).toEqual([
      [TWIN, 0, 'contacted'],
      [KEY, 0, 'contacted'],
    ].sort());
  });

  it('separa: copia lo stato del gruppo anche su chi non era stato toccato e non riunisce più', async () => {
    const { svc, db, advance } = setup();
    await svc.ingest([obs(), twin()]);
    // Senza avanzare l'orologio i due stati avrebbero lo stesso updatedAt dell'ingest.
    advance(1000);
    await svc.setLeadState(KEY, { status: 'contacted', notes: 'sera' }); // solo il principale
    await svc.splitListing(TWIN, [KEY]);
    expect(await db.leadStates.get(TWIN)).toMatchObject({ status: 'contacted', notes: 'sera' });
    await svc.ingest([obs(), twin()]);
    const leads = await svc.listLeads();
    expect(leads.map((l) => l.listing.key).sort()).toEqual([TWIN, KEY].sort());
    expect(leads.every((l) => l.others.length === 0)).toBe(true);
  });

  it('separa: annuncio inesistente', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await expect(svc.splitListing(TWIN, [KEY])).rejects.toThrow('Annuncio non trovato');
  });

  it("richiami: un gruppo conta una volta sull'icona", async () => {
    const { svc, now } = setup();
    await svc.ingest([obs(), twin(), obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/', city: 'Roma' })]);
    const today = startOfLocalDay(now());
    await svc.setLeadState([KEY, TWIN], { recallAt: today });
    await svc.setLeadState('immobiliare:2', { recallAt: today });
    expect(await svc.dueRecallCount(now())).toBe(2);
  });

  it('mediana di zona senza doppioni', async () => {
    const { svc } = setup();
    // Come in service.leads.test: 5 privati della zona a 3.000 €/m², più il gemello Idealista del lead.
    await svc.ingest([obs(), twin(), ...[1, 2, 3, 4, 5].map((i) => obs({ portalId: 131597836 + i, lastDrop: null, price: 186000 }))]);
    const lead = (await svc.listLeads()).find((l) => l.listing.key === KEY)!;
    expect(lead.market).toMatchObject({ scope: 'zone', sampleSize: 5, medianPerM2: 3000 });
  });
});
