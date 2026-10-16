import { describe, expect, it } from 'vitest';
import { startOfLocalDay } from '@/core/recall';
import { DAY_MS } from '@/shared/types';
import { obs, setup, START } from './helpers';

const KEY = 'immobiliare:133500000';
const OLD = 'immobiliare:128000000';
/** Lo stesso bilocale di `obs()`, pubblicato prima con un ID più basso e a un prezzo più alto. */
const before = (o = {}) => obs({ portalId: 128000000, url: 'https://www.immobiliare.it/annunci/128000000/', price: 260000, lastDrop: null, ...o });
/** La ripubblicazione, creata dieci giorni dopo: la data è del portale, come su Immobiliare. */
const repost = (o = {}) => obs({ portalId: 133500000, url: 'https://www.immobiliare.it/annunci/133500000/', lastDrop: null, portalCreatedAt: START + 10 * DAY_MS, ...o });

async function reposted() {
  const s = setup();
  await s.svc.ingest([before()]);
  s.advance(10 * DAY_MS);
  const evs = await s.svc.ingest([repost()]);
  return { ...s, evs };
}

describe('ripubblicazioni', () => {
  it('listLeads: un lead, principale la ripubblicazione, ribasso dal prezzo vecchio', async () => {
    const { svc } = await reposted();
    const leads = await svc.listLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0]!.listing.key).toBe(KEY);
    expect(leads[0]!.reposted).toBe(true);
    expect(leads[0]!.others.map((o) => [o.listing.key, o.previous])).toEqual([[OLD, true]]);
    expect(leads[0]!.evaluation.dropPercent).toBe(9.6);
  });

  it('ingest: il badge della card dice "ripubblicato"', async () => {
    const { evs } = await reposted();
    expect(evs[0]).toMatchObject({ listingKey: KEY });
    expect(evs[0]!.badgeText).toMatch(/· ripubblicato$/);
  });

  it("lo stato dato all'annuncio vecchio vale per la ripubblicazione", async () => {
    const { svc, advance } = setup();
    await svc.ingest([before()]);
    await svc.setLeadState(OLD, { status: 'contacted', notes: 'sera' });
    advance(10 * DAY_MS);
    await svc.ingest([repost()]);
    expect((await svc.listLeads())[0]!.state).toMatchObject({ status: 'contacted', notes: 'sera' });
  });

  it('visti insieme, o il vecchio rivisto dopo il nuovo: due lead', async () => {
    const together = setup();
    await together.svc.ingest([before(), repost()]);
    expect((await together.svc.listLeads()).filter((l) => l.reposted)).toEqual([]);

    const { svc, advance } = await reposted();
    advance(DAY_MS);
    await svc.ingest([before()]);
    const leads = await svc.listLeads();
    // Il vecchio torna un lead a sé; la ripubblicazione, appena creata e senza segnali, non è in elenco.
    expect(leads.map((l) => [l.listing.key, l.others.length, l.reposted])).toEqual([[OLD, 0, false]]);
  });

  it("pulizia: l'annuncio precedente resta finché la ripubblicazione è viva", async () => {
    const { svc, db, advance } = await reposted();
    advance(85 * DAY_MS);
    expect(await svc.purge()).toBe(0);
    expect((await db.listings.toCollection().primaryKeys()).sort()).toEqual([OLD, KEY].sort());
    advance(100 * DAY_MS);
    expect(await svc.purge()).toBe(2);
    expect(await db.listings.count()).toBe(0);
  });

  it('pulizia: un gruppo lavorato resta anche se tutto vecchio', async () => {
    const { svc, db, advance } = await reposted();
    await svc.setLeadState([KEY, OLD], { status: 'contacted' });
    advance(200 * DAY_MS);
    expect(await svc.purge()).toBe(0);
    expect(await db.listings.count()).toBe(2);
  });

  it('il richiamo di una catena si conta una volta', async () => {
    const { svc, now } = await reposted();
    await svc.setLeadState([KEY, OLD], { recallAt: startOfLocalDay(now()) });
    expect(await svc.dueRecallCount(now())).toBe(1);
  });

  it('"Separa" sulla ripubblicazione in un gruppo con un altro portale: si stacca con il suo annuncio precedente', async () => {
    const TWIN = 'idealista:33000001';
    const s = setup();
    await s.svc.ingest([before()]);
    s.advance(10 * DAY_MS);
    await s.svc.ingest([repost(), obs({ portal: 'idealista', portalId: 33000001, url: 'https://www.idealista.it/immobile/33000001/', lastDrop: null, price: 236000 })]);
    const [group] = await s.svc.listLeads();
    expect([group!.listing.key, ...group!.others.map((o) => o.listing.key)].sort()).toEqual([TWIN, OLD, KEY].sort());
    // L'agente dice "Immobiliare non è Idealista" sulla riga della ripubblicazione: il pannello passa le altre chiavi del lead.
    await s.svc.splitListing(KEY, [TWIN, OLD]);
    const chain = (await s.svc.listLeads()).find((l) => l.listing.key === KEY)!;
    expect(chain.reposted).toBe(true);
    expect(chain.others.map((o) => [o.listing.key, o.previous])).toEqual([[OLD, true]]);
  });

  it('"Separa" sull\'annuncio precedente: due lead che non si riuniscono', async () => {
    const { svc, advance } = await reposted();
    await svc.splitListing(OLD, [KEY]);
    advance(DAY_MS);
    await svc.ingest([repost()]);
    expect((await svc.listLeads()).some((l) => l.reposted)).toBe(false);
  });
});
