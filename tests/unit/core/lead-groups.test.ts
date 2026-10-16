import { describe, expect, it } from 'vitest';
import { buildLeadViews, isListed, mergeGroupState } from '@/core/lead-groups';
import { DAY_MS, DEFAULT_SETTINGS, type LeadState, type ListingRecord, type Portal } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 16, 12);

function rec(portal: Portal, id: number, o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: `${portal}:${id}`, portal, portalId: id, url: '', title: `${portal} ${id}`, address: null,
    city: 'Milano', zone: 'Navigli', typology: null, surfaceM2: 80, rooms: 3, currentPrice: 300000,
    portalCreatedAt: null, estimatedCreatedAt: NOW - 200 * DAY_MS, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 1, ...o,
  };
}
const state = (listingKey: string, o: Partial<LeadState> = {}): LeadState => ({
  listingKey, status: 'new', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null, ...o,
});
const archive = (listings: ListingRecord[], states: LeadState[] = []) => ({ listings, states, snapshots: [], splits: [] });

describe('mergeGroupState', () => {
  const immo = rec('immobiliare', 1);
  const idea = rec('idealista', 2);

  it('stato e richiamo del membro modificato più di recente, chiave del principale', () => {
    const s = mergeGroupState([
      { listing: immo, state: state(immo.key, { status: 'to_contact', updatedAt: 5 }) },
      { listing: idea, state: state(idea.key, { status: 'contacted', updatedAt: 9, recallAt: 100 }) },
    ]);
    expect(s).toMatchObject({ listingKey: immo.key, status: 'contacted', recallAt: 100, updatedAt: 9 });
  });

  it('note uguali o una sola nota: quel testo', () => {
    expect(mergeGroupState([{ listing: immo, state: state(immo.key, { notes: 'sera' }) }, { listing: idea, state: state(idea.key, { notes: ' sera ' }) }]).notes).toBe('sera');
    expect(mergeGroupState([{ listing: immo, state: state(immo.key) }, { listing: idea, state: state(idea.key, { notes: 'mattina' }) }]).notes).toBe('mattina');
  });

  it('note diverse: tutte, con il portale davanti', () => {
    const s = mergeGroupState([
      { listing: immo, state: state(immo.key, { notes: 'sera', updatedAt: 9 }) },
      { listing: idea, state: state(idea.key, { notes: 'ha già un agente', updatedAt: 1 }) },
    ]);
    expect(s.notes).toBe('Immobiliare: sera · Idealista: ha già un agente');
  });
});

describe('buildLeadViews', () => {
  it('un lead per immobile: principale con la priorità più alta, altre fonti in `others`', () => {
    const immo = rec('immobiliare', 1, { estimatedCreatedAt: NOW - 10 * DAY_MS });
    const idea = rec('idealista', 2); // ~200 gg → Media
    const alone = rec('subito', 3, { city: 'Roma' });
    const views = buildLeadViews(archive([immo, idea, alone]), DEFAULT_SETTINGS, NOW);
    expect(views).toHaveLength(2);
    const group = views.find((v) => v.others.length)!;
    expect(group.listing.key).toBe('idealista:2');
    expect(group.others.map((o) => o.listing.key)).toEqual(['immobiliare:1']);
    expect(group.evaluation).toMatchObject({ listingKey: 'idealista:2', priority: 'medium' });
    expect(group.evaluation.badgeText).toMatch(/· 2 portali$/);
    expect(group.state).toMatchObject({ listingKey: 'idealista:2', status: 'new' });
    expect(views.find((v) => !v.others.length)!.listing.key).toBe('subito:3');
  });

  it('la mediana di zona conta il gruppo una volta', () => {
    // Il gruppo (2 annunci) + 4 da soli di Immobiliare: senza doppioni il principale ha 4 annunci di confronto, sotto il minimo di 5.
    const others = [10, 11, 12, 13].map((id) => rec('immobiliare', id, { surfaceM2: 100, rooms: null }));
    const views = buildLeadViews(archive([rec('immobiliare', 1), rec('idealista', 2), ...others]), DEFAULT_SETTINGS, NOW);
    const group = views.find((v) => v.others.length)!;
    expect(group.market).toBeNull();
  });

  it('isListed: regola di oggi su valutazione e stato del gruppo', () => {
    const fresh = rec('immobiliare', 1, { estimatedCreatedAt: NOW - 10 * DAY_MS });
    const twin = rec('idealista', 2, { estimatedCreatedAt: NOW - 10 * DAY_MS });
    const [v] = buildLeadViews(archive([fresh, twin], [state('idealista:2', { status: 'contacted', updatedAt: 3 })]), DEFAULT_SETTINGS, NOW);
    expect(v!.evaluation.priority).toBe('none');
    expect(v!.state.status).toBe('contacted');
    expect(isListed(v!)).toBe(true);
  });
});

describe('mergeGroupState con un annuncio mai lavorato', () => {
  it('lo stato di un annuncio appena visto non copre quello di un annuncio già lavorato', () => {
    const immo = rec('immobiliare', 1);
    const idea = rec('idealista', 2);
    const s = mergeGroupState([
      { listing: immo, state: state(immo.key, { status: 'contacted', recallAt: 100, updatedAt: 5 }) },
      { listing: idea, state: state(idea.key, { updatedAt: 9 }) },
    ]);
    expect(s).toMatchObject({ status: 'contacted', recallAt: 100, updatedAt: 5 });
  });
});

describe('buildLeadViews: ripubblicazioni', () => {
  const before = rec('immobiliare', 1, { portalCreatedAt: NOW - 300 * DAY_MS, currentPrice: 300000, firstSeenAt: NOW - 300 * DAY_MS, lastSeenAt: NOW - 30 * DAY_MS });
  const head = rec('immobiliare', 2, { portalCreatedAt: NOW - 5 * DAY_MS, currentPrice: 270000, firstSeenAt: NOW - 5 * DAY_MS, lastSeenAt: NOW });
  const snapshots = [
    { listingKey: before.key, price: 300000, at: NOW - 300 * DAY_MS, source: 'observed' as const },
    { listingKey: head.key, price: 270000, at: NOW - 5 * DAY_MS, source: 'observed' as const },
  ];

  it('un lead: principale la ripubblicazione, età e storico della catena, precedente in others', () => {
    const views = buildLeadViews({ listings: [before, head], states: [], snapshots, splits: [] }, DEFAULT_SETTINGS, NOW);
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.listing.key).toBe('immobiliare:2');
    expect(v.reposted).toBe(true);
    expect(v.others.map((o) => [o.listing.key, o.previous])).toEqual([['immobiliare:1', true]]);
    expect(v.prices.map((p) => p.price)).toEqual([300000, 270000]);
    expect(v.evaluation).toMatchObject({ listingKey: 'immobiliare:2', priority: 'high', ageDays: 300, ageEstimated: false, dropPercent: 10 });
    expect(v.evaluation.badgeText).toBe('● Alta · 300 gg · −10% · ripubblicato');
  });

  it("lo stato lavorato sull'annuncio precedente passa al lead", () => {
    const states = [state(before.key, { status: 'contacted', notes: 'sera', updatedAt: 5 })];
    const [v] = buildLeadViews({ listings: [before, head], states, snapshots, splits: [] }, DEFAULT_SETTINGS, NOW);
    expect(v!.state).toMatchObject({ listingKey: 'immobiliare:2', status: 'contacted', notes: 'sera' });
  });

  it('con un gemello su un altro portale il principale è sempre un annuncio vivo', () => {
    const twin = rec('idealista', 9, { currentPrice: 272000, firstSeenAt: NOW - 5 * DAY_MS, lastSeenAt: NOW });
    const [v] = buildLeadViews({ listings: [before, head, twin], states: [], snapshots, splits: [] }, DEFAULT_SETTINGS, NOW);
    expect(['immobiliare:2', 'idealista:9']).toContain(v!.listing.key);
    expect([v!.listing.key, ...v!.others.map((o) => o.listing.key)].sort()).toEqual(['idealista:9', 'immobiliare:1', 'immobiliare:2']);
    // Prima le altre teste, poi gli annunci precedenti.
    expect(v!.others.map((o) => o.previous)).toEqual([false, true]);
    expect(v!.evaluation.badgeText).toMatch(/· 2 portali · ripubblicato$/);
  });

  it('un lead da solo o tra portali non è ripubblicato', () => {
    const views = buildLeadViews(archive([rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3, { city: 'Roma' })]), DEFAULT_SETTINGS, NOW);
    expect(views.every((v) => !v.reposted && v.others.every((o) => !o.previous))).toBe(true);
  });
});
