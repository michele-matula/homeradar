import { normalize } from '@/core/lead-filters';
import type { ListingRecord, SplitPair } from '@/shared/types';

/** Scarto ammesso sui m²: il più largo tra la percentuale del minore e i metri assoluti. */
export const SURFACE_TOLERANCE_PERCENT = 5;
export const SURFACE_TOLERANCE_M2 = 3;
/** Scarto ammesso sul prezzo, in percentuale del minore. */
export const PRICE_TOLERANCE_PERCENT = 5;

export function splitPair(x: string, y: string, at: number): SplitPair {
  return x < y ? { a: x, b: y, at } : { a: y, b: x, at };
}

export function splitId(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

interface Candidate {
  listing: ListingRecord;
  m2: number;
  price: number;
}

function candidate(listing: ListingRecord): Candidate | null {
  const { surfaceM2: m2, currentPrice: price } = listing;
  if (m2 == null || m2 <= 0 || price == null || price <= 0) return null;
  return { listing, m2, price };
}

/** Confronto con interi: `5% del minore` senza errori di virgola mobile. */
function close(x: number, y: number, percent: number, abs = 0): boolean {
  const diff = Math.abs(x - y);
  return diff <= abs || diff * 100 <= Math.min(x, y) * percent;
}

function compatible(x: Candidate, y: Candidate): boolean {
  const { rooms: rx, portal: px } = x.listing;
  const { rooms: ry, portal: py } = y.listing;
  return (
    px !== py &&
    close(x.m2, y.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2) &&
    close(x.price, y.price, PRICE_TOLERANCE_PERCENT) &&
    (rx == null || ry == null || rx === ry)
  );
}

/** Prezzo crescente, a parità chiave: l'ordine non cambia i gruppi, rende solo il confronto più rapido. */
const byPrice = (x: Candidate, y: Candidate) => x.price - y.price || (x.listing.key < y.listing.key ? -1 : 1);

/**
 * Gruppi di annunci di portali diversi che descrivono lo stesso immobile: chiavi in ordine, gruppi in ordine.
 * Un gruppo ha al massimo un annuncio per portale e ogni sua coppia è compatibile; nel dubbio non si unisce.
 * Gli annunci che restano soli non compaiono.
 */
export function groupListings(listings: ListingRecord[], splits: SplitPair[]): string[][] {
  const separated = new Set(splits.map((s) => splitId(s.a, s.b)));
  const byCity = new Map<string, Candidate[]>();
  for (const l of listings) {
    const city = normalize(l.city ?? '');
    const c = city ? candidate(l) : null;
    if (!c) continue;
    const list = byCity.get(city);
    if (list) list.push(c);
    else byCity.set(city, [c]);
  }

  const groups: string[][] = [];
  for (const cs of byCity.values()) {
    cs.sort(byPrice);
    const ok = (i: number, j: number) => compatible(cs[i]!, cs[j]!) && !separated.has(splitId(cs[i]!.listing.key, cs[j]!.listing.key));
    const parent = cs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < cs.length; i++) {
      // Oltre lo scarto di prezzo ammesso nessun annuncio successivo può essere compatibile.
      const limit = cs[i]!.price * (100 + PRICE_TOLERANCE_PERCENT);
      for (let j = i + 1; j < cs.length && cs[j]!.price * 100 <= limit; j++) if (ok(i, j)) parent[find(j)] = find(i);
    }
    const components = new Map<number, number[]>();
    cs.forEach((_, i) => {
      const r = find(i);
      const c = components.get(r);
      if (c) c.push(i);
      else components.set(r, [i]);
    });
    for (const members of components.values()) {
      if (members.length < 2) continue;
      const portals = new Set(members.map((i) => cs[i]!.listing.portal));
      if (portals.size !== members.length) continue;
      if (!members.every((i, n) => members.slice(n + 1).every((j) => ok(i, j)))) continue;
      groups.push(members.map((i) => cs[i]!.listing.key).sort());
    }
  }
  return groups.sort((g, h) => (g[0]! < h[0]! ? -1 : 1));
}
