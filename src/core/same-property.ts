import { normalize } from '@/core/lead-filters';
import { DAY_MS, VISIT_GAP_MS, type ListingRecord, type SplitPair } from '@/shared/types';

/** Scarto ammesso sui m²: il più largo tra la percentuale del minore e i metri assoluti. */
export const SURFACE_TOLERANCE_PERCENT = 5;
export const SURFACE_TOLERANCE_M2 = 3;
/** Scarto ammesso sul prezzo, in percentuale del minore. */
export const PRICE_TOLERANCE_PERCENT = 5;
/** Ripubblicazione sullo stesso portale: il prezzo nuovo può scendere fino al 20% o salire fino al 5% rispetto al vecchio. */
export const REPOST_MAX_DROP_PERCENT = 20;
export const REPOST_MAX_RISE_PERCENT = 5;
/**
 * Margine sulla data di creazione dell'annuncio nuovo, che non può essere anteriore all'ultima volta che si è visto il
 * vecchio: un giorno sulla data del portale, 15 giorni su quella stimata dall'ID.
 */
export const REPOST_CREATED_MARGIN_MS = DAY_MS;
export const REPOST_ESTIMATED_MARGIN_MS = 15 * DAY_MS;

/** Un immobile: le chiavi di tutti i suoi annunci e, per ogni annuncio vivo (testa), la sua catena di ripubblicazioni. */
export interface ListingGroup {
  /** Tutte le chiavi, in ordine. */
  keys: string[];
  /** Una catena per testa, in ordine di prima chiave; ogni catena va dall'annuncio più vecchio alla testa. */
  chains: string[][];
}

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
  /** Tipologia, zona e indirizzo normalizzati, calcolati al primo confronto che li usa. */
  text?: [string, string, string];
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

const sameRooms = (x: number | null, y: number | null) => x == null || y == null || x === y;

function textOf(c: Candidate): [string, string, string] {
  const { typology, zone, address } = c.listing;
  return (c.text ??= [normalize(typology ?? ''), normalize(zone ?? ''), normalize(address ?? '')]);
}

/** Tipologia, zona e indirizzo uguali, oppure mancanti su almeno uno dei due. */
function sameTexts(x: Candidate, y: Candidate): boolean {
  const a = textOf(x);
  const b = textOf(y);
  return a.every((t, i) => !t || !b[i] || t === b[i]);
}

function compatible(x: Candidate, y: Candidate): boolean {
  return (
    x.listing.portal !== y.listing.portal &&
    close(x.m2, y.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2) &&
    close(x.price, y.price, PRICE_TOLERANCE_PERCENT) &&
    sameRooms(x.listing.rooms, y.listing.rooms)
  );
}

/**
 * Il nuovo è comparso dopo che il vecchio è sparito: visto per la prima volta più di una visita dopo l'ultima del
 * vecchio (una visita entro `VISIT_GAP_MS` non aggiorna `lastSeenAt`) e creato non prima di allora. Senza il controllo
 * sulla data, un annuncio online da mesi trovato solo dopo sembrerebbe una ripubblicazione.
 */
function appearedAfter(a: ListingRecord, b: ListingRecord): boolean {
  if (b.firstSeenAt - a.lastSeenAt <= VISIT_GAP_MS) return false;
  if (b.portalCreatedAt != null) return b.portalCreatedAt >= a.lastSeenAt - REPOST_CREATED_MARGIN_MS;
  if (b.estimatedCreatedAt != null) return b.estimatedCreatedAt >= a.lastSeenAt - REPOST_ESTIMATED_MARGIN_MS;
  return true;
}

/** `n` ripubblica `o`: stesso portale, ID più alto, comparso dopo che `o` è sparito, stessi dati, prezzo tra −20% e +5%. */
function isRepost(o: Candidate, n: Candidate): boolean {
  const a = o.listing;
  const b = n.listing;
  return (
    a.portal === b.portal &&
    b.portalId > a.portalId &&
    appearedAfter(a, b) &&
    n.price * 100 >= o.price * (100 - REPOST_MAX_DROP_PERCENT) &&
    n.price * 100 <= o.price * (100 + REPOST_MAX_RISE_PERCENT) &&
    close(o.m2, n.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2) &&
    sameRooms(a.rooms, b.rooms) &&
    sameTexts(o, n)
  );
}

const byKey = (x: Candidate, y: Candidate) => (x.listing.key < y.listing.key ? -1 : 1);
/** Prezzo crescente, a parità chiave: l'ordine non cambia i gruppi, rende solo il confronto più rapido. */
const byPrice = (x: Candidate, y: Candidate) => x.price - y.price || byKey(x, y);

/**
 * Catene di ripubblicazione tra i candidati di una città, dall'annuncio più vecchio alla testa; ogni candidato sta in
 * una catena, anche da solo. Si tolgono le coppie transitive (o → n se esiste m con o → m e m → n); se poi un annuncio
 * ha due successori o due predecessori, le sue coppie cadono: nel dubbio non si unisce.
 */
function repostChains(cs: Candidate[], separated: Set<string>): Candidate[][] {
  const succ = new Map<Candidate, Set<Candidate>>();
  const link = (o: Candidate, n: Candidate) => {
    if (separated.has(splitId(o.listing.key, n.listing.key))) return;
    const set = succ.get(o);
    if (set) set.add(n);
    else succ.set(o, new Set([n]));
  };
  const byPortal = new Map<string, Candidate[]>();
  for (const c of cs) {
    const list = byPortal.get(c.listing.portal);
    if (list) list.push(c);
    else byPortal.set(c.listing.portal, [c]);
  }
  for (const list of byPortal.values()) {
    // m² crescenti: oltre lo scarto ammesso dal minore nessun annuncio successivo può essere compatibile.
    const byM2 = list.sort((x, y) => x.m2 - y.m2 || byKey(x, y));
    for (let i = 0; i < byM2.length; i++) {
      const x = byM2[i]!;
      for (let j = i + 1; j < byM2.length && close(x.m2, byM2[j]!.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2); j++) {
        const y = byM2[j]!;
        if (x.listing.portalId < y.listing.portalId) {
          if (isRepost(x, y)) link(x, y);
        } else if (isRepost(y, x)) link(y, x);
      }
    }
  }
  const reduced = new Map<Candidate, Candidate[]>();
  for (const [o, ns] of succ) reduced.set(o, [...ns].filter((n) => ![...ns].some((m) => succ.get(m)?.has(n))));
  const incoming = new Map<Candidate, number>();
  for (const ns of reduced.values()) for (const n of ns) incoming.set(n, (incoming.get(n) ?? 0) + 1);
  const ambiguous = (c: Candidate) => (reduced.get(c)?.length ?? 0) > 1 || (incoming.get(c) ?? 0) > 1;
  const next = new Map<Candidate, Candidate>();
  for (const [o, ns] of reduced) for (const n of ns) if (!ambiguous(o) && !ambiguous(n)) next.set(o, n);
  const hasPrevious = new Set(next.values());
  return cs.filter((c) => !hasPrevious.has(c)).map((start) => {
    const chain = [start];
    for (let c = next.get(start); c; c = next.get(c)) chain.push(c);
    return chain;
  });
}

/** Gruppi tra portali diversi: al massimo un annuncio per portale e ogni coppia compatibile. */
function crossPortalGroups(candidates: Candidate[], separated: Set<string>): Candidate[][] {
  const cs = [...candidates].sort(byPrice);
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
  const out: Candidate[][] = [];
  for (const members of components.values()) {
    if (members.length < 2) continue;
    const portals = new Set(members.map((i) => cs[i]!.listing.portal));
    if (portals.size !== members.length) continue;
    if (!members.every((i, n) => members.slice(n + 1).every((j) => ok(i, j)))) continue;
    out.push(members.map((i) => cs[i]!));
  }
  return out;
}

function toGroup(chains: Candidate[][]): ListingGroup {
  const ks = chains.map((c) => c.map((x) => x.listing.key)).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  return { keys: ks.flat().sort(), chains: ks };
}

/**
 * Annunci che descrivono lo stesso immobile: ripubblicazioni sullo stesso portale (catene) e, tra le loro teste,
 * annunci di portali diversi. Un gruppo ha al massimo una testa per portale e ogni coppia di teste è compatibile; nel
 * dubbio non si unisce. Gli annunci che restano soli non compaiono. Gruppi in ordine di prima chiave.
 */
export function groupListings(listings: ListingRecord[], splits: SplitPair[]): ListingGroup[] {
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

  const groups: ListingGroup[] = [];
  for (const cs of byCity.values()) {
    const chains = repostChains(cs, separated);
    const chainOf = new Map(chains.map((c) => [c[c.length - 1]!, c]));
    const crossed = new Set<Candidate>();
    for (const heads of crossPortalGroups([...chainOf.keys()], separated)) {
      for (const h of heads) crossed.add(h);
      groups.push(toGroup(heads.map((h) => chainOf.get(h)!)));
    }
    for (const c of chains) if (c.length > 1 && !crossed.has(c[c.length - 1]!)) groups.push(toGroup([c]));
  }
  return groups.sort((g, h) => (g.keys[0]! < h.keys[0]! ? -1 : 1));
}
