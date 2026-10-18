import type { ListingRecord } from '@/shared/types';

export const NOW = Date.UTC(2026, 9, 14, 8);

export function listing(o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: 'immobiliare:128416572', portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/',
    title: 'Bilocale via Esempio 1', address: 'Via Esempio', city: 'Milano', zone: 'Precotto', typology: 'Appartamento',
    surfaceM2: 62, rooms: 2, currentPrice: 235000, portalCreatedAt: null, estimatedCreatedAt: Date.UTC(2026, 3, 20),
    lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) },
    firstSeenAt: NOW - 1000, lastSeenAt: NOW, seenCount: 2, category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null, ...o,
  };
}
