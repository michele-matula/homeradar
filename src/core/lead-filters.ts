import type { ComuneRef, LeadView } from '@/shared/types';

/** Ricerca e fascia di prezzo del pannello. Prezzi in euro; `null` = nessun limite. */
export interface LeadQuery {
  text: string;
  minPrice: number | null;
  maxPrice: number | null;
  /** Solo i lead senza prezzo («Trattativa riservata»). Esclude la fascia di prezzo. */
  reservedOnly?: boolean;
}

export const EMPTY_QUERY: LeadQuery = { text: '', minPrice: null, maxPrice: null };

/** Minuscole, senza accenti; ogni carattere che non è lettera o cifra diventa spazio: "Sant'Ambrogio" → "sant ambrogio". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const words = (text: string): string[] => {
  const n = normalize(text);
  return n ? n.split(' ') : [];
};

/** Ogni parola della ricerca deve comparire in almeno uno dei campi testuali di una fonte del lead. */
export function matchesText(lead: LeadView, text: string): boolean {
  const ws = words(text);
  if (!ws.length) return true;
  const fields = [lead.listing, ...lead.others.map((o) => o.listing)]
    .flatMap(({ title, address, city, zone, typology }) => [title, address, city, zone, typology])
    .filter((f): f is string => f != null)
    .map(normalize);
  return ws.every((w) => fields.some((f) => f.includes(w)));
}

/**
 * Migliaia di euro scritte dall'agente ("150", "150,5") in euro. Vuoto = nessun limite.
 * "150," vale 150: è il passaggio intermedio mentre si scrive un decimale e non deve segnare errore.
 */
export function parseThousands(input: string): number | null | 'invalid' {
  const s = input.trim();
  if (!s) return null;
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s)) return 'invalid';
  return Math.round(Number(s.replace(',', '.')) * 1000);
}

/** Estremi in ordine crescente: se l'agente scrive "da 250 a 150" vale come 150–250. */
function ordered(min: number | null, max: number | null): [number | null, number | null] {
  return min != null && max != null && min > max ? [max, min] : [min, max];
}

/** Estremi inclusi. Con almeno un estremo impostato, i lead senza prezzo restano fuori. */
export function inPriceRange(lead: LeadView, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  const price = lead.listing.currentPrice;
  if (price == null) return false;
  const [lo, hi] = ordered(min, max);
  return (lo == null || price >= lo) && (hi == null || price <= hi);
}

export function applyQuery(leads: LeadView[], q: LeadQuery): LeadView[] {
  return leads.filter((l) => matchesText(l, q.text) && (q.reservedOnly ? l.listing.currentPrice == null : inPriceRange(l, q.minPrice, q.maxPrice)));
}

export function isEmptyQuery(q: LeadQuery): boolean {
  return words(q.text).length === 0 && q.minPrice == null && q.maxPrice == null && !q.reservedOnly;
}

const thousands = (euro: number) => String(euro / 1000).replace('.', ',');

/** Parti del tag dei filtri: `"navile"`, `150–250 k€`, `da 150 k€`, `fino a 250 k€`. */
export function describeQuery(q: LeadQuery): string[] {
  const parts: string[] = [];
  if (words(q.text).length) parts.push(`"${q.text.trim()}"`);
  const [lo, hi] = ordered(q.minPrice, q.maxPrice);
  if (lo != null && hi != null) parts.push(`${thousands(lo)}–${thousands(hi)} k€`);
  else if (lo != null) parts.push(`da ${thousands(lo)} k€`);
  else if (hi != null) parts.push(`fino a ${thousands(hi)} k€`);
  if (q.reservedOnly) parts.push('trattativa riservata');
  return parts;
}

/** Scelta «Altri comuni» del filtro per comune: lead fuori dalla zona di «Cerca» o senza comune. */
export const OTHER_COMUNI = 'other';

const SCOPE_ISTAT = /\|comune:(\d{6})\|/;

/**
 * Codici ISTAT dei comuni della zona in cui sta il lead (basta una fonte). Vale la città scritta dal portale;
 * se manca o non è un comune della zona, il comune della ricerca del giro che ha trovato l'annuncio.
 */
export function leadComuni(lead: LeadView, comuni: ComuneRef[]): string[] {
  const byName = new Map(comuni.map((c) => [normalize(c.name), c.istat]));
  const inZone = new Set(comuni.map((c) => c.istat));
  const found = new Set<string>();
  for (const { city, sweepScope } of [lead.listing, ...lead.others.map((o) => o.listing)]) {
    const named = city != null ? byName.get(normalize(city)) : undefined;
    const scoped = sweepScope?.match(SCOPE_ISTAT)?.[1];
    const istat = named ?? (scoped != null && inZone.has(scoped) ? scoped : undefined);
    if (istat) found.add(istat);
  }
  return comuni.map((c) => c.istat).filter((i) => found.has(i));
}

/** Filtro per comune: lista vuota = tutti. Contiene codici ISTAT della zona e/o `OTHER_COMUNI`. */
export function inComuni(lead: LeadView, comuni: ComuneRef[], chosen: string[]): boolean {
  if (!chosen.length) return true;
  const own = leadComuni(lead, comuni);
  return own.length ? own.some((i) => chosen.includes(i)) : chosen.includes(OTHER_COMUNI);
}
