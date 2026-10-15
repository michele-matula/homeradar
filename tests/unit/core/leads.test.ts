import { describe, expect, it } from 'vitest';
import { groupByStatus, SORT_KEYS, sortLeads, sortLeadsBy } from '@/core/leads';
import type { LeadStatus, LeadView, Priority } from '@/shared/types';

function lead(key: string, priority: Priority, ageDays: number | null, status: LeadStatus = 'new'): LeadView {
  return {
    listing: { key } as LeadView['listing'],
    evaluation: { listingKey: key, priority, ageDays } as LeadView['evaluation'],
    state: { listingKey: key, status, notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null },
    prices: [],
  };
}

describe('sortLeads', () => {
  it('ordina per priorità e poi per età decrescente, età sconosciute in fondo', () => {
    const sorted = sortLeads([lead('a', 'medium', 130), lead('b', 'high', 125), lead('c', 'medium', 200), lead('d', 'verify', 110), lead('e', 'medium', null)]);
    expect(sorted.map((l) => l.listing.key)).toEqual(['b', 'c', 'a', 'e', 'd']);
  });
});

interface Fields { priority?: Priority; age?: number | null; drop?: number; price?: number | null; m2?: number | null; first?: number; last?: number; changed?: number }

function item(key: string, f: Fields): LeadView {
  const base = lead(key, f.priority ?? 'high', f.age === undefined ? 100 : f.age);
  return {
    ...base,
    listing: { key, currentPrice: f.price ?? null, surfaceM2: f.m2 ?? null, firstSeenAt: f.first ?? 0, lastSeenAt: f.last ?? 0 } as LeadView['listing'],
    evaluation: { ...base.evaluation, dropPercent: f.drop ?? 0 },
    state: { ...base.state, statusChangedAt: f.changed ?? 0 },
  };
}
const keys = (ls: LeadView[]) => ls.map((l) => l.listing.key);

describe('sortLeadsBy', () => {
  it('"priority" coincide con l\'ordine predefinito', () => {
    const ls = [item('a', { priority: 'medium', age: 130 }), item('b', { priority: 'high', age: 125 }), item('c', { priority: 'medium', age: 200 })];
    expect(keys(sortLeadsBy(ls, 'priority'))).toEqual(keys(sortLeads(ls)));
  });

  it('ordina per età nei due versi, età sconosciute sempre in fondo', () => {
    const ls = [item('a', { age: 130 }), item('b', { age: null }), item('c', { age: 400 }), item('d', { age: 10 })];
    expect(keys(sortLeadsBy(ls, 'oldest'))).toEqual(['c', 'a', 'd', 'b']);
    expect(keys(sortLeadsBy(ls, 'newest'))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('ordina per ribasso maggiore', () => {
    const ls = [item('a', { drop: 2 }), item('b', { drop: 0 }), item('c', { drop: 12.5 })];
    expect(keys(sortLeadsBy(ls, 'drop'))).toEqual(['c', 'a', 'b']);
  });

  it('ordina per prezzo nei due versi, prezzi mancanti sempre in fondo', () => {
    const ls = [item('a', { price: 200000 }), item('b', { price: null }), item('c', { price: 90000 }), item('d', { price: 350000 })];
    expect(keys(sortLeadsBy(ls, 'price_asc'))).toEqual(['c', 'a', 'd', 'b']);
    expect(keys(sortLeadsBy(ls, 'price_desc'))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('ordina per €/m² crescente, senza prezzo o superficie in fondo', () => {
    const ls = [
      item('a', { price: 300000, m2: 100 }),
      item('b', { price: 200000, m2: null }),
      item('c', { price: 200000, m2: 100 }),
      item('d', { price: null, m2: 80 }),
      item('e', { price: 100000, m2: 0 }),
    ];
    expect(keys(sortLeadsBy(ls, 'price_m2'))).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('ordina per date mettendo prima le più recenti', () => {
    const ls = [item('a', { first: 1, last: 30, changed: 200 }), item('b', { first: 3, last: 10, changed: 100 }), item('c', { first: 2, last: 20, changed: 300 })];
    expect(keys(sortLeadsBy(ls, 'first_seen'))).toEqual(['b', 'c', 'a']);
    expect(keys(sortLeadsBy(ls, 'last_seen'))).toEqual(['a', 'c', 'b']);
    expect(keys(sortLeadsBy(ls, 'status_changed'))).toEqual(['c', 'a', 'b']);
  });

  it('a parità di valore usa l\'ordine per priorità', () => {
    const ls = [item('a', { priority: 'verify', price: 100 }), item('b', { priority: 'high', price: 100 }), item('c', { priority: 'medium', price: null })];
    expect(keys(sortLeadsBy(ls, 'price_asc'))).toEqual(['b', 'a', 'c']);
  });

  it('non modifica la lista ricevuta, per nessun criterio', () => {
    const ls = [item('a', { age: 1 }), item('b', { age: 2 })];
    for (const k of SORT_KEYS) sortLeadsBy(ls, k);
    expect(keys(ls)).toEqual(['a', 'b']);
  });
});

describe('groupByStatus', () => {
  it('raggruppa mantenendo l\'ordine', () => {
    const g = groupByStatus([lead('a', 'high', 1), lead('b', 'high', 1, 'contacted'), lead('c', 'medium', 1)]);
    expect(g.new.map((l) => l.listing.key)).toEqual(['a', 'c']);
    expect(g.contacted.map((l) => l.listing.key)).toEqual(['b']);
    expect(g.to_contact).toEqual([]);
    expect(g.discarded).toEqual([]);
  });
});
