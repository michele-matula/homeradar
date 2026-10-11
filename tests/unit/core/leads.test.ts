import { describe, expect, it } from 'vitest';
import { groupByStatus, sortLeads } from '@/core/leads';
import type { LeadStatus, LeadView, Priority } from '@/shared/types';

function lead(key: string, priority: Priority, ageDays: number | null, status: LeadStatus = 'new'): LeadView {
  return {
    listing: { key } as LeadView['listing'],
    evaluation: { listingKey: key, priority, ageDays } as LeadView['evaluation'],
    state: { listingKey: key, status, notes: '', statusChangedAt: 0 },
    prices: [],
  };
}

describe('sortLeads', () => {
  it('ordina per priorità e poi per età decrescente, età sconosciute in fondo', () => {
    const sorted = sortLeads([lead('a', 'medium', 130), lead('b', 'high', 125), lead('c', 'medium', 200), lead('d', 'verify', 110), lead('e', 'medium', null)]);
    expect(sorted.map((l) => l.listing.key)).toEqual(['b', 'c', 'a', 'e', 'd']);
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
