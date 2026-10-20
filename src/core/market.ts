import { normalize } from '@/core/lead-filters';
import { formatEuro } from '@/shared/format';
import type { ListingRecord, MarketComparison } from '@/shared/types';

/** Annunci minimi, escluso il lead, per confrontarlo con la zona o con la città. */
export const MIN_ZONE_SAMPLE = 5;
export const MIN_CITY_SAMPLE = 8;
/** Scarto dal quale il lead si mostra "sopra mercato". */
export const ABOVE_MARKET_PERCENT = 10;
/** Sotto questi limiti il dato è quasi certamente sbagliato (box, superficie o prezzo scritti male). */
const MIN_SURFACE_M2 = 20;
const MIN_PER_M2 = 300;
const MAX_PER_M2 = 30_000;

/** €/m² dell'annuncio, se è plausibile; altrimenti null. */
export function validPerM2({ currentPrice: price, surfaceM2: m2 }: ListingRecord): number | null {
  if (price == null || m2 == null || m2 < MIN_SURFACE_M2) return null;
  const v = price / m2;
  return v >= MIN_PER_M2 && v <= MAX_PER_M2 ? v : null;
}

interface Entry {
  listing: ListingRecord;
  perM2: number;
  cityKey: string;
  zoneKey: string | null;
}

/** Il €/m² dice qualcosa solo per case e immobili commerciali; box e terreni non hanno confronto. */
const MARKET_CATEGORIES = new Set(['residential', 'commercial']);

function entryOf(listing: ListingRecord): Entry | null {
  if (!MARKET_CATEGORIES.has(listing.category)) return null;
  const perM2 = validPerM2(listing);
  const city = normalize(listing.city ?? '');
  if (perM2 == null || !city) return null;
  // La categoria entra nella chiave: un negozio non fa mediana con le case della stessa via.
  const cityKey = `${listing.category}|${city}`;
  const zone = normalize(listing.zone ?? '');
  return { listing, perM2, cityKey, zoneKey: zone ? `${cityKey}|${zone}` : null };
}

/** Valori €/m² per chiave, ordinati in modo crescente. */
function sortedGroups(entries: Entry[], keyOf: (e: Entry) => string | null): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const e of entries) {
    const k = keyOf(e);
    if (k == null) continue;
    const g = groups.get(k);
    if (g) g.push(e.perM2);
    else groups.set(k, [e.perM2]);
  }
  for (const g of groups.values()) g.sort((a, b) => a - b);
  return groups;
}

/** Mediana di `sorted` (che contiene `own`) senza una occorrenza di `own`; null se restano meno di `min` valori. */
function medianWithout(sorted: number[], own: number, min: number): number | null {
  const n = sorted.length - 1;
  if (n < min) return null;
  const skip = sorted.indexOf(own);
  const at = (k: number) => sorted[k < skip ? k : k + 1]!;
  return n % 2 ? at((n - 1) / 2) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

/**
 * Confronto di ogni lead con la mediana €/m² dei privati salvati nella sua zona (stessa città), o della città se in
 * zona sono pochi. Il campione è l'archivio intero, indipendente dai filtri del pannello. Chiave: `listing.key`.
 */
export function compareToMarket(listings: ListingRecord[]): Map<string, MarketComparison> {
  const entries = listings.map(entryOf).filter((e): e is Entry => e != null);
  const byZone = sortedGroups(entries, (e) => e.zoneKey);
  const byCity = sortedGroups(entries, (e) => e.cityKey);
  const out = new Map<string, MarketComparison>();
  for (const { listing, perM2, cityKey, zoneKey } of entries) {
    const city = listing.city!.trim();
    const zone = zoneKey != null ? byZone.get(zoneKey)! : null;
    const zoneMedian = zone ? medianWithout(zone, perM2, MIN_ZONE_SAMPLE) : null;
    const cityValues = byCity.get(cityKey)!;
    const [scope, label, median, sampleSize] =
      zoneMedian != null
        ? (['zone', listing.zone!.trim(), zoneMedian, zone!.length - 1] as const)
        : (['city', city, medianWithout(cityValues, perM2, MIN_CITY_SAMPLE), cityValues.length - 1] as const);
    if (median == null) continue;
    out.set(listing.key, { scope, label, city, medianPerM2: median, sampleSize, deltaPercent: (perM2 / median - 1) * 100 });
  }
  return out;
}

export function isAboveMarket(m: MarketComparison | null): m is MarketComparison {
  return m != null && m.deltaPercent >= ABOVE_MARKET_PERCENT;
}

/** "+18% su Navigli" */
export function aboveMarketText(m: MarketComparison): string {
  return `+${Math.round(m.deltaPercent)}% su ${m.label}`;
}

const place = (m: MarketComparison) => (m.scope === 'zone' ? `${m.label} (${m.city})` : m.label);

export function marketExplanation(m: MarketComparison): string {
  const where = m.scope === 'zone' ? `in zona ${place(m)}` : `a ${place(m)}`;
  return `Mediana dei privati visti ${where}: ${formatEuro(m.medianPerM2)} €/m² su ${m.sampleSize} annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto.`;
}

/** Riepilogo per l'export: "Navigli (Milano), 7 annunci, 4.200 €/m²". */
export function marketSummary(m: MarketComparison): string {
  return `${place(m)}, ${m.sampleSize} annunci, ${formatEuro(m.medianPerM2)} €/m²`;
}
