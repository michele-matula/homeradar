import { HomeRadarDB } from '@/core/db';
import { LeadService } from '@/core/service';
import type { ListingObservation } from '@/shared/types';

let n = 0;
export const START = Date.UTC(2026, 9, 10, 12);

export function setup(start = START) {
  let now = start;
  const db = new HomeRadarDB(`test-${++n}-${Math.random()}`);
  const svc = new LeadService(db, () => now);
  return { db, svc, advance: (ms: number) => { now += ms; }, now: () => now };
}

export function obs(o: Partial<ListingObservation> = {}): ListingObservation {
  return {
    portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/',
    title: 'Bilocale via Esempio 1, Precotto, Milano', address: 'Via Esempio', city: 'Milano', zone: 'Precotto',
    typology: 'Appartamento', category: 'residential', surfaceM2: 62, rooms: 2, price: 235000, sellerType: 'private', portalCreatedAt: null,
    lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) }, coverUrl: null, source: 'search',
    ...o,
  };
}
