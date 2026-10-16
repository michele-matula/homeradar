# Ripubblicazioni — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** riconoscere un annuncio tolto e ripubblicato sullo stesso portale con un nuovo ID e unirlo alla ripubblicazione nello stesso lead del punto 6, con età, storico prezzi, stato e note ereditati.

**Architecture:** `same-property.ts` costruisce, città per città e portale per portale, le catene di ripubblicazione (coppie → riduzione transitiva → scarto dei casi ambigui), poi applica il confronto tra portali del punto 6 alle sole teste; `groupListings` restituisce `{ keys, chains }`. `lead-groups.ts` dà a ogni testa lo storico della sua catena, sceglie il principale tra le teste e marca gli annunci precedenti; `evaluateGroup` prende l'età da tutti i membri e il ribasso solo dalle teste. Tutto in memoria a ogni lettura: niente nuove tabelle, niente `version(7)`.

**Tech Stack:** TypeScript, WXT (Chrome MV3), React, Dexie, Vitest (jsdom + fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-ripubblicazioni-design.md`

## Global Constraints

- Nessuna richiesta HTTP verso i portali; nessun dato nuovo letto dai portali.
- Nessuna nuova tabella Dexie, nessuna `version(7)`; formato dei record e del backup invariato, `BACKUP_FORMAT_VERSION` invariato.
- Costanti: `REPOST_MAX_DROP_PERCENT = 20`, `REPOST_MAX_RISE_PERCENT = 5`; m² con `SURFACE_TOLERANCE_PERCENT = 5` / `SURFACE_TOLERANCE_M2 = 3` del punto 6.
- Coppia di ripubblicazione: stesso portale, `n.portalId > o.portalId`, `o.lastSeenAt < n.firstSeenAt`, stessa città normalizzata, m² compatibili, locali uguali o mancanti, tipologia/zona/indirizzo uguali (normalizzati) se presenti su entrambi, `n ≥ o × 0,80` e `n ≤ o × 1,05`, coppia non in `splits`.
- "Ripubblicato" è un'etichetta: le regole di priorità non cambiano.
- Badge: `· N portali` conta i portali distinti; `· ripubblicato` in fondo se il gruppo contiene annunci precedenti.
- Testi dell'interfaccia in italiano. Timestamp in ms epoch UTC.
- Informativa: `ONBOARDING_VERSION = 4` con voce in `ONBOARDING_CHANGES[4]`.
- File con fine riga CRLF: usare lo strumento Edit, non `sed`.

## Review Focus

1. **Annuncio vecchio che ricompare dopo il nuovo** (l'agente riapre una ricerca e lo rivede): l'unione deve sciogliersi da sola alla lettura successiva. Test in Task 1 (`o.lastSeenAt` ≥ `n.firstSeenAt` → nessuna coppia) e in Task 4 (servizio: il vecchio rivisto dopo il nuovo dà due lead).
2. **Due appartamenti identici nello stesso stabile** (due annunci vecchi spariti e uno nuovo, o uno vecchio e due nuovi): mai unire. Test in Task 1 (due predecessori, due successori).
3. **Pulizia automatica dell'annuncio precedente**: non deve sparire mentre la ripubblicazione è viva, né restare per sempre quando tutto il gruppo è vecchio. Test in Task 4.
4. **Test esistenti che ingeriscono annunci identici di `obs()` in momenti diversi** ora possono formare una catena: va riconosciuto e sistemato cambiando i dati del test, non la logica. Passo dedicato in Task 4.
5. **Lead di un solo portale con una catena**: non deve contare come "Su più portali" né nella pillola, né nel filtro, né nel badge. Test in Task 2 (badge), Task 3 (`leadPortals`), Task 5 (pillola e filtro).

---

### Task 1: catene di ripubblicazione in `same-property.ts`

**Files:**
- Modify: `src/core/same-property.ts`
- Modify: `src/core/lead-groups.ts:77` (solo adattamento al nuovo tipo di ritorno)
- Modify: `src/core/service.ts:224` (solo adattamento al nuovo tipo di ritorno)
- Test: `tests/unit/core/same-property.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REPOST_MAX_DROP_PERCENT = 20;
  export const REPOST_MAX_RISE_PERCENT = 5;
  export interface ListingGroup { keys: string[]; chains: string[][] }
  export function groupListings(listings: ListingRecord[], splits: SplitPair[]): ListingGroup[];
  ```
  `keys`: tutte le chiavi del gruppo in ordine alfabetico. `chains`: una catena per testa, catene in ordine di prima chiave; ogni catena dall'ID più basso alla testa (ultimo elemento). Un annuncio senza ripubblicazioni è una catena di un elemento. I gruppi hanno almeno 2 chiavi e sono in ordine di `keys[0]`.

- [ ] **Step 1: adattare i test esistenti al nuovo tipo di ritorno**

In `tests/unit/core/same-property.test.ts`, sotto `rec`, aggiungi:

```ts
const keys = (listings: ListingRecord[], splits: SplitPair[] = []) => groupListings(listings, splits).map((g) => g.keys);
```

e aggiorna l'import dei tipi: `import type { ListingRecord, Portal, SplitPair } from '@/shared/types';`. Nei test esistenti del `describe('groupListings', …)` sostituisci ogni chiamata `groupListings(` con `keys(` (il test di prestazioni nel `describe('groupListings su un archivio grande', …)` resta con `groupListings`). Le aspettative (`toEqual([['idealista:2', 'immobiliare:1']])`, `toHaveLength(1)`, `toEqual([])`) restano identiche.

- [ ] **Step 2: scrivere i test nuovi**

Aggiungi in fondo al file:

```ts
/** Annuncio visto fino al giorno 10 e poi non più. */
const old = (id: number, o: Partial<ListingRecord> = {}) => rec('immobiliare', id, { firstSeenAt: 0, lastSeenAt: 10, ...o });
/** Annuncio comparso dal giorno 20. */
const fresh = (id: number, o: Partial<ListingRecord> = {}) => rec('immobiliare', id, { firstSeenAt: 20, lastSeenAt: 30, ...o });

describe('groupListings: ripubblicazioni', () => {
  it('unisce un annuncio sparito e ricomparso con un ID più alto', () => {
    expect(groupListings([old(1), fresh(2, { currentPrice: 270000 })], [])).toEqual([
      { keys: ['immobiliare:1', 'immobiliare:2'], chains: [['immobiliare:1', 'immobiliare:2']] },
    ]);
  });

  it('visti insieme, o vecchio rivisto dopo il nuovo: nessuna unione', () => {
    expect(keys([old(1, { lastSeenAt: 25 }), fresh(2)])).toEqual([]);
    expect(keys([old(1, { lastSeenAt: 20 }), fresh(2)])).toEqual([]);
  });

  it("l'annuncio nuovo deve avere l'ID più alto", () => {
    expect(keys([old(2), fresh(1)])).toEqual([]);
  });

  it('prezzo: fino al −20% e al +5%', () => {
    expect(keys([old(1), fresh(2, { currentPrice: 240000 })])).toHaveLength(1);
    expect(keys([old(1), fresh(2, { currentPrice: 239999 })])).toEqual([]);
    expect(keys([old(1), fresh(2, { currentPrice: 315000 })])).toHaveLength(1);
    expect(keys([old(1), fresh(2, { currentPrice: 315001 })])).toEqual([]);
  });

  it('tipologia, zona e indirizzo: uguali se presenti su entrambi, senza maiuscole e punteggiatura', () => {
    expect(keys([old(1, { zone: 'Navigli' }), fresh(2, { zone: 'Isola' })])).toEqual([]);
    expect(keys([old(1, { typology: 'Appartamento' }), fresh(2, { typology: 'Attico' })])).toEqual([]);
    expect(keys([old(1, { address: 'Via Roma 1' }), fresh(2, { address: 'Via Po 3' })])).toEqual([]);
    expect(keys([old(1, { zone: 'Navigli' }), fresh(2)])).toHaveLength(1);
    expect(keys([old(1, { address: 'Via Roma, 1' }), fresh(2, { address: 'via roma 1' })])).toHaveLength(1);
  });

  it('m², locali e città come nel confronto tra portali', () => {
    expect(keys([old(1, { surfaceM2: 80 }), fresh(2, { surfaceM2: 84 })])).toHaveLength(1);
    expect(keys([old(1, { surfaceM2: 80 }), fresh(2, { surfaceM2: 85 })])).toEqual([]);
    expect(keys([old(1, { rooms: 3 }), fresh(2, { rooms: 4 })])).toEqual([]);
    expect(keys([old(1, { rooms: 3 }), fresh(2, { rooms: null })])).toHaveLength(1);
    expect(keys([old(1), fresh(2, { city: 'Monza' })])).toEqual([]);
  });

  it('portali diversi non fanno una ripubblicazione', () => {
    expect(keys([rec('idealista', 1, { lastSeenAt: 10 }), fresh(2, { currentPrice: 270000 })])).toEqual([]);
  });

  it('catena di tre: il collegamento diretto tra primo e ultimo non conta', () => {
    const list = [old(1), fresh(2, { currentPrice: 270000 }), rec('immobiliare', 3, { firstSeenAt: 40, lastSeenAt: 50, currentPrice: 260000 })];
    expect(groupListings(list, [])).toEqual([
      { keys: ['immobiliare:1', 'immobiliare:2', 'immobiliare:3'], chains: [['immobiliare:1', 'immobiliare:2', 'immobiliare:3']] },
    ]);
  });

  it('due ribassi del 15% in due ripubblicazioni: il prezzo si controlla passo per passo', () => {
    const list = [old(1), fresh(2, { currentPrice: 255000 }), rec('immobiliare', 3, { firstSeenAt: 40, lastSeenAt: 50, currentPrice: 216750 })];
    expect(keys(list)).toEqual([['immobiliare:1', 'immobiliare:2', 'immobiliare:3']]);
  });

  it('caso ambiguo: due successori o due predecessori, nessuna unione', () => {
    expect(keys([old(1), fresh(2), fresh(3)])).toEqual([]);
    expect(keys([old(1), old(2), fresh(3)])).toEqual([]);
  });

  it('una coppia separata non si unisce; separare un anello in mezzo unisce primo e ultimo', () => {
    expect(keys([old(1), fresh(2)], [splitPair('immobiliare:1', 'immobiliare:2', 0)])).toEqual([]);
    const list = [old(1), fresh(2, { currentPrice: 270000 }), rec('immobiliare', 3, { firstSeenAt: 40, lastSeenAt: 50, currentPrice: 260000 })];
    const splits = [splitPair('immobiliare:2', 'immobiliare:1', 0), splitPair('immobiliare:2', 'immobiliare:3', 0)];
    expect(groupListings(list, splits)).toEqual([{ keys: ['immobiliare:1', 'immobiliare:3'], chains: [['immobiliare:1', 'immobiliare:3']] }]);
  });

  it('catena e gemello su un altro portale: il confronto usa la testa', () => {
    const twin = rec('idealista', 9, { firstSeenAt: 20, lastSeenAt: 30, currentPrice: 262000 });
    expect(groupListings([old(1), fresh(2, { currentPrice: 260000 }), twin], [])).toEqual([
      { keys: ['idealista:9', 'immobiliare:1', 'immobiliare:2'], chains: [['idealista:9'], ['immobiliare:1', 'immobiliare:2']] },
    ]);
  });

  it("un gemello compatibile solo con l'annuncio precedente non entra nel gruppo", () => {
    const twin = rec('idealista', 9, { firstSeenAt: 0, lastSeenAt: 10, currentPrice: 300000 });
    expect(keys([old(1), fresh(2, { currentPrice: 260000 }), twin])).toEqual([['immobiliare:1', 'immobiliare:2']]);
  });

  it("il risultato non dipende dall'ordine degli annunci", () => {
    const list = [
      old(1), fresh(2, { currentPrice: 260000 }), rec('idealista', 9, { firstSeenAt: 20, lastSeenAt: 30, currentPrice: 262000 }),
      old(5, { city: 'Roma' }), fresh(6, { city: 'Roma' }),
    ];
    expect(groupListings([...list].reverse(), [])).toEqual(groupListings(list, []));
  });
});
```

Aggiungi anche, nel `describe('groupListings su un archivio grande', …)`, un secondo test:

```ts
  it('10.000 annunci dello stesso portale visti in giorni diversi, in 40 zone: entro i tempi', () => {
    const list = Array.from({ length: 10_000 }, (_, i) =>
      rec('immobiliare', i, {
        currentPrice: 100_000 + ((i * 7919) % 900_000), surfaceM2: 40 + (i % 120), rooms: 1 + (i % 5), zone: `Zona ${i % 40}`,
        firstSeenAt: i, lastSeenAt: i,
      }),
    );
    const t = performance.now();
    groupListings(list, []);
    expect(performance.now() - t).toBeLessThan(500);
  });
```

- [ ] **Step 3: verificare che falliscano**

Run: `npx vitest run tests/unit/core/same-property.test.ts`
Expected: FAIL (`g.keys` undefined sui test adattati, nuovi test falliti).

- [ ] **Step 4: implementare**

In `src/core/same-property.ts`:

1. Sotto `PRICE_TOLERANCE_PERCENT` aggiungi:

```ts
/** Ripubblicazione sullo stesso portale: il prezzo nuovo può scendere fino al 20% o salire fino al 5% rispetto al vecchio. */
export const REPOST_MAX_DROP_PERCENT = 20;
export const REPOST_MAX_RISE_PERCENT = 5;

/** Un immobile: le chiavi di tutti i suoi annunci e, per ogni annuncio vivo (testa), la sua catena di ripubblicazioni. */
export interface ListingGroup {
  /** Tutte le chiavi, in ordine. */
  keys: string[];
  /** Una catena per testa, in ordine di prima chiave; ogni catena va dall'annuncio più vecchio alla testa. */
  chains: string[][];
}
```

2. Sostituisci `compatible` con:

```ts
const sameRooms = (x: number | null, y: number | null) => x == null || y == null || x === y;

/** Campo di testo uguale, oppure mancante su almeno uno dei due. */
function sameText(x: string | null, y: string | null): boolean {
  const a = normalize(x ?? '');
  const b = normalize(y ?? '');
  return !a || !b || a === b;
}

function compatible(x: Candidate, y: Candidate): boolean {
  return (
    x.listing.portal !== y.listing.portal &&
    close(x.m2, y.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2) &&
    close(x.price, y.price, PRICE_TOLERANCE_PERCENT) &&
    sameRooms(x.listing.rooms, y.listing.rooms)
  );
}

/** `n` ripubblica `o`: stesso portale, ID più alto, mai visti insieme, stessi dati, prezzo tra −20% e +5%. */
function isRepost(o: Candidate, n: Candidate): boolean {
  const a = o.listing;
  const b = n.listing;
  return (
    a.portal === b.portal &&
    b.portalId > a.portalId &&
    a.lastSeenAt < b.firstSeenAt &&
    close(o.m2, n.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2) &&
    sameRooms(a.rooms, b.rooms) &&
    sameText(a.typology, b.typology) &&
    sameText(a.zone, b.zone) &&
    sameText(a.address, b.address) &&
    n.price * 100 >= o.price * (100 - REPOST_MAX_DROP_PERCENT) &&
    n.price * 100 <= o.price * (100 + REPOST_MAX_RISE_PERCENT)
  );
}

const byKey = (x: Candidate, y: Candidate) => (x.listing.key < y.listing.key ? -1 : 1);
```

3. Aggiungi la costruzione delle catene:

```ts
/**
 * Catene di ripubblicazione tra i candidati di una città, dall'annuncio più vecchio alla testa; ogni candidato sta in
 * una catena, anche da solo. Si tolgono le coppie transitive (o → n se esiste m con o → m e m → n); se poi un annuncio
 * ha due successori o due predecessori, le sue coppie cadono: nel dubbio non si unisce.
 */
function repostChains(cs: Candidate[], separated: Set<string>): Candidate[][] {
  // m² crescenti: oltre lo scarto ammesso dal minore nessun annuncio successivo può essere compatibile.
  const byM2 = [...cs].sort((x, y) => x.m2 - y.m2 || byKey(x, y));
  const succ = new Map<Candidate, Set<Candidate>>();
  const link = (o: Candidate, n: Candidate) => {
    if (separated.has(splitId(o.listing.key, n.listing.key))) return;
    const set = succ.get(o);
    if (set) set.add(n);
    else succ.set(o, new Set([n]));
  };
  for (let i = 0; i < byM2.length; i++) {
    const x = byM2[i]!;
    for (let j = i + 1; j < byM2.length && close(x.m2, byM2[j]!.m2, SURFACE_TOLERANCE_PERCENT, SURFACE_TOLERANCE_M2); j++) {
      const y = byM2[j]!;
      if (isRepost(x, y)) link(x, y);
      else if (isRepost(y, x)) link(y, x);
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
```

4. Estrai il corpo attuale del ciclo per città di `groupListings` in una funzione che restituisce i candidati di ogni gruppo tra portali (stessa logica, ordinata su una copia):

```ts
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
```

5. Riscrivi `groupListings` (aggiorna anche il commento):

```ts
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
```

6. Adatta i due chiamanti senza cambiarne il comportamento:
   - `src/core/lead-groups.ts`, nel ciclo `for (const keys of groupListings(listings, splits))`: `for (const { keys } of groupListings(listings, splits))`.
   - `src/core/service.ts`, in `dueRecallCount`: `for (const g of groupListings(listings, splits)) for (const k of g.keys) groupOf.set(k, g.keys[0]!);`

- [ ] **Step 5: verificare**

Run: `npx vitest run tests/unit/core/same-property.test.ts` → PASS.
Run: `npm test` → PASS (se fallisce un test di servizio per una catena non voluta, vedi Task 4, Step 1, e sistemalo qui con lo stesso criterio).
Run: `npm run typecheck` → nessun errore.

- [ ] **Step 6: commit**

```bash
git add src/core/same-property.ts src/core/lead-groups.ts src/core/service.ts tests/unit/core/same-property.test.ts
git commit -m "feat(same-property): catene di ripubblicazione sullo stesso portale"
```

---

### Task 2: valutazione del gruppo con annunci precedenti (`rules.ts`)

**Files:**
- Modify: `src/core/rules.ts` (`compose`, `GroupMember`, `evaluateGroup`)
- Test: `tests/unit/core/rules.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GroupMember { listing: ListingRecord; prices: PriceSnapshot[]; previous?: boolean }
  export function evaluateGroup(target: ListingRecord, members: GroupMember[], settings: Settings, now: number): Evaluation;
  ```
  `previous: true`: conta per l'età, non per il ribasso. Badge: `· N portali` con N portali distinti (se > 1), poi `· ripubblicato` se un membro ha `previous`.

- [ ] **Step 1: test**

In fondo al `describe('evaluateGroup', …)` di `tests/unit/core/rules.test.ts`:

```ts
  it('ripubblicazione: età dal precedente, ribasso dallo storico della testa, badge "ripubblicato"', () => {
    const before = listing({ portalCreatedAt: daysAgo(300), currentPrice: 300000 });
    const head = listing({ key: 'immobiliare:2', portalId: 2, portalCreatedAt: daysAgo(5), currentPrice: 270000 });
    const chain = [snap(300000, daysAgo(300)), snap(270000, daysAgo(5))];
    const e = evaluateGroup(head, [{ listing: head, prices: chain }, { listing: before, prices: [snap(300000, daysAgo(300))], previous: true }], DEFAULT_SETTINGS, NOW);
    expect(e).toMatchObject({ listingKey: 'immobiliare:2', priority: 'high', ageDays: 300, ageEstimated: false, dropPercent: 10 });
    expect(e.badgeText).toBe('● Alta · 300 gg · −10% · ripubblicato');
  });

  it("un ribasso vecchio dell'annuncio precedente non conta", () => {
    const before = listing({ portalCreatedAt: daysAgo(300), currentPrice: 270000 });
    const head = listing({ key: 'immobiliare:2', portalId: 2, portalCreatedAt: daysAgo(5), currentPrice: 283000 });
    const beforePrices = [snap(300000, daysAgo(300)), snap(270000, daysAgo(100))];
    const chain = [...beforePrices, snap(283000, daysAgo(5))];
    const e = evaluateGroup(head, [{ listing: head, prices: chain }, { listing: before, prices: beforePrices, previous: true }], DEFAULT_SETTINGS, NOW);
    expect(e.dropPercent).toBe(5.7);
  });

  it('due annunci dello stesso portale e uno di un altro: "2 portali · ripubblicato"', () => {
    const before = listing({ portalCreatedAt: daysAgo(10) });
    const head = listing({ key: 'immobiliare:2', portalId: 2, portalCreatedAt: daysAgo(5) });
    const idea = listing({ key: 'idealista:3', portal: 'idealista', portalId: 3, estimatedCreatedAt: daysAgo(30) });
    const e = evaluateGroup(head, [{ listing: head, prices: [] }, { listing: idea, prices: [] }, { listing: before, prices: [], previous: true }], DEFAULT_SETTINGS, NOW);
    expect(e.badgeText).toBe('Privato · ~30 gg · 2 portali · ripubblicato');
  });

  it('una catena sullo stesso portale non dice "portali"', () => {
    const before = listing({ portalCreatedAt: daysAgo(10) });
    const head = listing({ key: 'immobiliare:2', portalId: 2, portalCreatedAt: daysAgo(5) });
    const e = evaluateGroup(head, [{ listing: head, prices: [] }, { listing: before, prices: [], previous: true }], DEFAULT_SETTINGS, NOW);
    expect(e.badgeText).toBe('Privato · 10 gg · ripubblicato');
  });
```

(`dropPercent` del secondo test: (300000 − 283000) / 300000 = 5,67% → 5,7; con il ribasso del precedente sarebbe 10.)

- [ ] **Step 2: verificare che falliscano**

Run: `npx vitest run tests/unit/core/rules.test.ts`
Expected: FAIL (badge senza "ripubblicato", "3 portali" al posto di "2 portali", `dropPercent` 10 nel secondo test).

- [ ] **Step 3: implementare**

In `src/core/rules.ts`:

```ts
/** Cosa aggiunge il gruppo al badge: portali distinti e ripubblicazione. */
interface GroupFacts {
  portals: number;
  reposted: boolean;
}

const SINGLE: GroupFacts = { portals: 1, reposted: false };
```

Firma di `compose`: `function compose(target: ListingRecord, age: AgeFacts, drop: DropFacts, group: GroupFacts = SINGLE): Evaluation`, commento: `/** Priorità, motivi e badge da età e ribasso; il gruppo aggiunge "· N portali" e "· ripubblicato" al badge. */`. Sostituisci `if (portals > 1) parts.push(\`${portals} portali\`);` con:

```ts
  if (group.portals > 1) parts.push(`${group.portals} portali`);
  if (group.reposted) parts.push('ripubblicato');
```

`GroupMember`:

```ts
export interface GroupMember {
  listing: ListingRecord;
  prices: PriceSnapshot[];
  /** Annuncio sostituito da una ripubblicazione: conta per l'età, non per il ribasso (il suo storico è già nella testa). */
  previous?: boolean;
}
```

In `evaluateGroup` aggiorna il commento ("Età del membro più vecchio tra quelli con il segnale A (altrimenti del più vecchio), ribasso maggiore tra gli annunci vivi.") e sostituisci il calcolo del ribasso e il `return`:

```ts
  const drop = members
    .filter((m) => !m.previous)
    .map((m) => dropFacts(m.listing, m.prices, settings))
    .reduce((best, d) => ((d.signal && !best.signal) || (d.signal === best.signal && d.dropPercent > best.dropPercent) ? d : best));
  return compose(target, age, drop, { portals: new Set(members.map((m) => m.listing.portal)).size, reposted: members.some((m) => m.previous) });
```

- [ ] **Step 4: verificare**

Run: `npx vitest run tests/unit/core/rules.test.ts` → PASS (anche i test del punto 6: due portali distinti danno ancora "2 portali").

- [ ] **Step 5: commit**

```bash
git add src/core/rules.ts tests/unit/core/rules.test.ts
git commit -m "feat(rules): età dagli annunci precedenti, portali distinti e \"ripubblicato\" nel badge"
```

---

### Task 3: lead con annunci precedenti (`types.ts`, `lead-groups.ts`, `leads.ts`)

**Files:**
- Modify: `src/shared/types.ts` (`LeadSource`, `LeadView`)
- Modify: `src/core/lead-groups.ts` (`buildLeadViews`)
- Modify: `src/core/leads.ts` (`leadPortals`)
- Test: `tests/unit/core/lead-groups.test.ts`, `tests/unit/core/leads.test.ts`
- Modify (fixture): `tests/unit/ui/sidepanel.test.tsx`, `tests/unit/core/export.test.ts` e ogni altro file segnalato da `npm run typecheck`

**Interfaces:**
- Consumes: `groupListings(...): ListingGroup[]` (Task 1); `evaluateGroup` con `GroupMember.previous` (Task 2).
- Produces:
  ```ts
  export interface LeadSource { listing: ListingRecord; evaluation: Evaluation; prices: PriceSnapshot[]; previous: boolean }
  export interface LeadView { /* … */ prices: PriceSnapshot[]; reposted: boolean }
  export function leadPortals(l: LeadView): Portal[]; // portali distinti, quello del principale per primo
  ```
  `LeadView.listing` è sempre una testa; `others` contiene prima le altre teste (ordine del principale), poi gli annunci precedenti (visti più di recente per primi). `LeadView.prices` è lo storico della catena del principale.

- [ ] **Step 1: test**

In `tests/unit/core/lead-groups.test.ts`, in fondo:

```ts
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
```

In `tests/unit/core/leads.test.ts`: aggiungi `leadPortals` all'import da `@/core/leads` e `Portal` all'import dei tipi (`import type { LeadStatus, LeadView, Portal, Priority } from '@/shared/types';`); nella fabbrica `lead()` aggiungi `reposted: false,` dopo `others: [],`. In fondo al file:

```ts
describe('leadPortals', () => {
  it('portali distinti, il principale per primo', () => {
    const base = lead('immobiliare:1', 'high', 100);
    const source = (portal: Portal, id: number) => ({
      listing: { key: `${portal}:${id}`, portal } as LeadView['listing'], evaluation: base.evaluation, prices: [], previous: false,
    });
    const view: LeadView = {
      ...base,
      listing: { key: 'immobiliare:1', portal: 'immobiliare' } as LeadView['listing'],
      others: [source('immobiliare', 0), source('idealista', 2), source('idealista', 3)],
    };
    expect(leadPortals(view)).toEqual(['immobiliare', 'idealista']);
  });
});
```

- [ ] **Step 2: verificare che falliscano**

Run: `npx vitest run tests/unit/core/lead-groups.test.ts tests/unit/core/leads.test.ts`
Expected: FAIL (`reposted` undefined, principale `immobiliare:1`, `leadPortals` con doppioni).

- [ ] **Step 3: implementare i tipi**

In `src/shared/types.ts`:

```ts
/** Un annuncio del lead, con la sua valutazione e il suo storico prezzi. */
export interface LeadSource {
  listing: ListingRecord;
  evaluation: Evaluation;
  prices: PriceSnapshot[];
  /** Vero per un annuncio sostituito da una ripubblicazione sullo stesso portale. */
  previous: boolean;
}
```

In `LeadView`, cambia il commento di `prices` in `/** Storico prezzi del principale e degli annunci che ha sostituito, in ordine di tempo. */`, quello di `others` in `/** Altre fonti dello stesso immobile (altri portali e annunci precedenti), senza il principale (`listing`); vuoto se il lead è da solo. */` e aggiungi in fondo:

```ts
  /** Vero se il lead contiene almeno un annuncio sostituito da una ripubblicazione. */
  reposted: boolean;
```

- [ ] **Step 4: implementare `buildLeadViews`**

In `src/core/lead-groups.ts`:

- nella costruzione di `sources`: `sources.set(listing.key, { listing, prices, evaluation: evaluate(listing, prices, settings, now), previous: false });`
- sostituisci il ciclo dei gruppi con:

```ts
  const units: LeadSource[][] = [];
  const grouped = new Set<string>();
  for (const { keys, chains } of groupListings(listings, splits)) {
    const heads: LeadSource[] = [];
    const previous: LeadSource[] = [];
    for (const chain of chains) {
      const own = chain.map((k) => sources.get(k)!);
      const head = own[own.length - 1]!;
      if (own.length === 1) {
        heads.push(head);
        continue;
      }
      // La testa porta lo storico di tutta la catena: il prezzo prima della ripubblicazione è un prezzo noto.
      const prices = own.flatMap((s) => s.prices).sort((a, b) => a.at - b.at);
      heads.push({ ...head, prices, evaluation: evaluate(head.listing, prices, settings, now) });
      for (const s of own.slice(0, -1)) previous.push({ ...s, previous: true });
    }
    previous.sort((a, b) => b.listing.lastSeenAt - a.listing.lastSeenAt || (a.listing.key < b.listing.key ? -1 : 1));
    // Il principale è sempre un annuncio vivo: titolo e "Apri" non portano a un annuncio tolto.
    units.push([...heads.sort(byPrimary), ...previous]);
    for (const k of keys) grouped.add(k);
  }
```

- nel `return units.map(...)`:

```ts
    return {
      listing: primary.listing,
      evaluation: others.length ? evaluateGroup(primary.listing, members, settings, now) : primary.evaluation,
      state: others.length ? mergeGroupState(members.map((m) => ({ listing: m.listing, state: stateOf(m.listing) }))) : stateOf(primary.listing),
      prices: primary.prices,
      market: market.get(primary.listing.key) ?? null,
      others,
      reposted: others.some((o) => o.previous),
    };
```

(`members` è già un array di `LeadSource`, che ha `listing`, `prices` e `previous`: è un `GroupMember[]` valido.)

- [ ] **Step 5: `leadPortals` con portali distinti**

In `src/core/leads.ts`:

```ts
/** Portali distinti del lead, quello del principale per primo. */
export function leadPortals(l: LeadView): Portal[] {
  return [...new Set([l.listing.portal, ...l.others.map((o) => o.listing.portal)])];
}
```

- [ ] **Step 6: fixture dei test**

Run: `npm run typecheck`. Per ogni errore su `previous` o `reposted` mancanti nelle fixture dei test, aggiungi `previous: false` alle fonti in `others` e `reposted: false` ai `LeadView`. Di sicuro:
- `tests/unit/ui/sidepanel.test.tsx`: in `lead()` aggiungi `reposted: false` dopo `others: []`; in `merged()` aggiungi `previous: false` all'oggetto in `others`.
- `tests/unit/core/export.test.ts`: `reposted: false` nel `lead` di esempio; `previous: false` nella fonte del test "tutti i portali e gli altri URL".

- [ ] **Step 7: verificare**

Run: `npm run typecheck` → nessun errore. Run: `npm test` → PASS.

- [ ] **Step 8: commit**

```bash
git add src/shared/types.ts src/core/lead-groups.ts src/core/leads.ts tests/unit
git commit -m "feat(lead-groups): annunci precedenti nel lead, principale vivo, storico della catena"
```

---

### Task 4: servizio — pulizia per gruppo e test d'integrazione

**Files:**
- Modify: `src/core/service.ts` (`purge`)
- Create: `tests/unit/core/service.reposts.test.ts`
- Modify (se serve): test di servizio esistenti con catene non volute

**Interfaces:**
- Consumes: `groupListings(...).keys` (Task 1); `LeadView.reposted`, `LeadSource.previous` (Task 3).
- Produces: `purge(): Promise<number>` con lo stesso contratto (numero di annunci cancellati), ora per gruppo.

- [ ] **Step 1: controllare i test esistenti**

Run: `npm test`. Se un test di servizio esistente fallisce perché due `obs()` con gli stessi dati, ingeriti in momenti diversi, ora formano una catena (lead in meno, `others` inattesi), cambia i dati di quel test in modo che non siano più lo stesso immobile (per esempio `surfaceM2: 90` sul secondo annuncio) e annota il file nel messaggio di commit. Non cambiare la logica.

- [ ] **Step 2: test**

Crea `tests/unit/core/service.reposts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { startOfLocalDay } from '@/core/recall';
import { DAY_MS } from '@/shared/types';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';
const OLD = 'immobiliare:128000000';
/** Lo stesso bilocale di `obs()`, pubblicato prima con un ID più basso e a un prezzo più alto. */
const before = (o = {}) => obs({ portalId: 128000000, url: 'https://www.immobiliare.it/annunci/128000000/', price: 260000, lastDrop: null, ...o });
const repost = (o = {}) => obs({ lastDrop: null, ...o });

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

  it("visti insieme, o il vecchio rivisto dopo il nuovo: due lead", async () => {
    const together = setup();
    await together.svc.ingest([before(), repost()]);
    expect((await together.svc.listLeads()).filter((l) => l.reposted)).toEqual([]);

    const { svc, advance } = await reposted();
    advance(DAY_MS);
    await svc.ingest([before()]);
    const leads = await svc.listLeads();
    expect(leads.some((l) => l.reposted)).toBe(false);
    expect(leads.map((l) => l.listing.key).sort()).toEqual([OLD, KEY].sort());
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

  it('"Separa" sull\'annuncio precedente: due lead che non si riuniscono', async () => {
    const { svc, advance } = await reposted();
    await svc.splitListing(OLD, [KEY]);
    advance(DAY_MS);
    await svc.ingest([repost()]);
    expect((await svc.listLeads()).some((l) => l.reposted)).toBe(false);
  });
});
```

(9,6: (260000 − 235000) / 260000 = 9,62%. Nel primo test di "pulizia": dopo 95 giorni dall'inizio la soglia è START + 5 giorni; il vecchio, visto a START, è sotto, la ripubblicazione, vista a START + 10 giorni, no.)

- [ ] **Step 3: verificare che falliscano**

Run: `npx vitest run tests/unit/core/service.reposts.test.ts`
Expected: FAIL solo i test di pulizia (`purge` restituisce 1 e cancella `OLD`); gli altri passano già grazie ai Task 1–3.

- [ ] **Step 4: implementare `purge` per gruppo**

In `src/core/service.ts` sostituisci `purge`:

```ts
  /**
   * Cancella gli annunci non visti da `retentionDays` e non lavorati. Decide per immobile: un gruppo si cancella solo se
   * tutti i suoi annunci sono vecchi e nessuno è lavorato, così l'annuncio sostituito da una ripubblicazione viva resta.
   */
  async purge(): Promise<number> {
    const settings = await this.getSettings();
    const cutoff = this.clock() - settings.retentionDays * DAY_MS;
    const [listings, states, splits] = await Promise.all([this.db.listings.toArray(), this.db.leadStates.toArray(), this.db.splits.toArray()]);
    const stateOf = new Map(states.map((s) => [s.listingKey, s]));
    const seenAt = new Map(listings.map((l) => [l.key, l.lastSeenAt]));
    // Un lead lavorato o con un richiamo resta, anche se rimesso a mano su "Nuovo".
    const keep = (k: string) => {
      const s = stateOf.get(k);
      return seenAt.get(k)! >= cutoff || (s != null && (s.status !== 'new' || s.recallAt != null));
    };
    const units = groupListings(listings, splits).map((g) => g.keys);
    const grouped = new Set(units.flat());
    for (const l of listings) if (!grouped.has(l.key)) units.push([l.key]);
    const stale = units.filter((u) => !u.some(keep)).flat();
    await this.deleteListings(stale);
    return stale.length;
  }
```

- [ ] **Step 5: verificare**

Run: `npx vitest run tests/unit/core/service.reposts.test.ts tests/unit/core/service.leads.test.ts` → PASS (i test di pulizia esistenti restano verdi).
Run: `npm test` → PASS.

- [ ] **Step 6: commit**

```bash
git add src/core/service.ts tests/unit/core
git commit -m "feat(service): pulizia per immobile, l'annuncio precedente resta con la ripubblicazione viva"
```

---

### Task 5: pannello ed export

**Files:**
- Modify: `src/ui/sidepanel/LeadItem.tsx`
- Modify: `src/ui/sidepanel/App.tsx:26` e `:309` (filtro "Su più portali")
- Modify: `src/ui/sidepanel/styles.css` (accanto a `.sources__facts`, riga 216)
- Modify: `src/core/export.ts`
- Modify: `tests/e2e/extension.spec.ts:76`
- Test: `tests/unit/ui/sidepanel.test.tsx`, `tests/unit/core/export.test.ts`

**Interfaces:**
- Consumes: `LeadView.reposted`, `LeadSource.previous`, `leadPortals` distinti (Task 3).
- Produces: colonna export `'Ripubblicato'` (valore `'sì'` o `''`) tra `'Età stimata'` e `'Prima visita'`.

- [ ] **Step 1: test del pannello**

In `tests/unit/ui/sidepanel.test.tsx`, dopo `merged()`:

```tsx
/** Lead ripubblicato: la ripubblicazione su Immobiliare e l'annuncio precedente, tolto a settembre. */
function republished(id: number): LeadView {
  const main = lead(id, 'high');
  const before = lead(id - 500, 'medium');
  const previous = { listing: { ...before.listing, currentPrice: 260000, lastSeenAt: Date.UTC(2026, 8, 12, 10) }, evaluation: before.evaluation, prices: [], previous: true };
  return { ...main, reposted: true, others: [previous] };
}

describe('lead ripubblicato', () => {
  it('pillola "Ripubblicato", un solo portale, riga "Annuncio precedente" con "Separa"', () => {
    const onSplit = vi.fn();
    render(<ul><LeadItem lead={republished(1000)} now={Date.now()} onChange={() => {}} onDelete={() => {}} onSplit={onSplit} /></ul>);
    expect(screen.getByText('Ripubblicato')).toBeTruthy();
    expect(screen.queryByText(/Su \d portali/)).toBeNull();
    expect(screen.getAllByText('Immobiliare')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fonti (2)' }));
    expect(screen.getByText('Annuncio precedente · visto fino al 12/09')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Separa annuncio precedente Immobiliare' }));
    expect(onSplit).toHaveBeenCalledWith('immobiliare:500');
  });

  it('"Su più portali" non conta una catena sullo stesso portale', async () => {
    render(<App api={fakeApi([republished(1000), merged(1)])} />);
    await screen.findByText('Bilocale 1');
    expect(screen.getByRole('button', { name: 'Su più portali (1)' })).toBeTruthy();
  });
});
```

(`getAllByText('Immobiliare')` con le Fonti chiuse: solo l'etichetta del lead, una volta.)

- [ ] **Step 2: test dell'export**

In `tests/unit/core/export.test.ts`, nel `describe('toExportRows lead unito', …)`:

```ts
  it('ripubblicato: colonna "Ripubblicato", URL del precedente tra gli altri, un solo portale', () => {
    const previous = { ...lead.listing, key: 'immobiliare:1', portalId: 1, url: 'https://www.immobiliare.it/annunci/1/' };
    const row = toExportRows([{ ...lead, reposted: true, others: [{ listing: previous, evaluation: lead.evaluation, prices: [], previous: true }] }])[0]!;
    expect(row['Ripubblicato']).toBe('sì');
    expect(row['Altri URL']).toBe('https://www.immobiliare.it/annunci/1/');
    expect(row['Portale']).toBe('Immobiliare.it');
    expect(toExportRows([lead])[0]!['Ripubblicato']).toBe('');
    expect(EXPORT_COLUMNS.indexOf('Ripubblicato')).toBe(EXPORT_COLUMNS.indexOf('Età stimata') + 1);
    expect(EXPORT_COLUMNS.indexOf('Prima visita')).toBe(EXPORT_COLUMNS.indexOf('Ripubblicato') + 1);
  });
```

Se un test esistente confronta l'intera riga esportata con `toEqual` (riga 48 circa, `'Note': 'chiamare la sera', …`), aggiungi `'Ripubblicato': ''` all'oggetto atteso.

- [ ] **Step 3: verificare che falliscano**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx tests/unit/core/export.test.ts`
Expected: FAIL (nessuna pillola, nessuna colonna).

- [ ] **Step 4: implementare `LeadItem`**

In `src/ui/sidepanel/LeadItem.tsx`:

- import: `import { formatDayMonth, formatEuro } from '@/shared/format';`
- dopo `const { listing, evaluation, state, prices, market, others } = lead;` aggiungi `const portals = leadPortals(lead);`
- sostituisci le etichette e la pillola:

```tsx
          {portals.map((p) => (
            <span key={p} className="portal-tag">{PORTAL_TAGS[p]}</span>
          ))}
          {portals.length > 1 && <span className="pill pill--multi">{`Su ${portals.length} portali`}</span>}
          {lead.reposted && <span className="pill pill--multi">Ripubblicato</span>}
```

- nell'elenco delle fonti: `{[{ listing, evaluation, previous: false }, ...others].map((s) => (` e, dopo l'etichetta del portale della riga:

```tsx
                  {s.previous && (
                    <span className="sources__previous">{`Annuncio precedente · visto fino al ${formatDayMonth(s.listing.lastSeenAt)}`}</span>
                  )}
```

- nome accessibile di "Separa": `aria-label={s.previous ? \`Separa annuncio precedente ${PORTAL_TAGS[s.listing.portal]}\` : \`Separa ${PORTAL_TAGS[s.listing.portal]}\`}`

In `src/ui/sidepanel/styles.css`, dopo `.sources__facts`:

```css
.sources__previous { font-size: 12px; color: var(--muted); font-style: italic; }
```

- [ ] **Step 5: filtro "Su più portali"**

In `src/ui/sidepanel/App.tsx`:
- riga 26: `const byMulti = (leads: LeadView[], on: boolean) => (on ? leads.filter((l) => leadPortals(l).length > 1) : leads);`
- riga 309: `.filter((l) => leadPortals(l).length > 1).length;`

- [ ] **Step 6: export**

In `src/core/export.ts`:
- in `EXPORT_COLUMNS`, tra `'Età stimata'` e `'Prima visita'`, inserisci `'Ripubblicato'`;
- in `toExportRows`, dopo `'Età stimata': …`: `'Ripubblicato': view.reposted ? 'sì' : '',`

In `tests/e2e/extension.spec.ts`, dopo `expect(csv).toContain('Priorità;Stato;Richiamo;Portale;Titolo;Indirizzo');`:

```ts
  expect(csv).toContain(';Età stimata;Ripubblicato;Prima visita;');
```

- [ ] **Step 7: verificare**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx tests/unit/core/export.test.ts` → PASS.
Run: `npm test && npm run typecheck` → PASS.
Run: `npm run test:e2e` → PASS.

- [ ] **Step 8: commit**

```bash
git add src/ui/sidepanel src/core/export.ts tests/unit tests/e2e/extension.spec.ts
git commit -m "feat(sidepanel): pillola Ripubblicato, annuncio precedente nelle fonti, colonna Ripubblicato nell'export"
```

---

### Task 6: informativa e documenti

**Files:**
- Modify: `src/core/onboarding.ts`
- Modify: `src/ui/onboarding/Onboarding.tsx` (sezione "Cosa salva", conservazione, legenda)
- Modify: `tests/unit/core/onboarding.test.ts`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`

**Interfaces:**
- Produces: `ONBOARDING_VERSION = 4`, `ONBOARDING_CHANGES[4]`.

- [ ] **Step 1: test**

In `tests/unit/core/onboarding.test.ts`, nel test della versione 3 togli `expect(ONBOARDING_VERSION).toBe(3);` e aggiungi:

```ts
  it('la versione 4 annuncia le ripubblicazioni', () => {
    expect(ONBOARDING_VERSION).toBe(4);
    expect(ONBOARDING_CHANGES[4]).toEqual([
      "HomeRadar ora riconosce un annuncio tolto e ripubblicato sullo stesso portale: il lead tiene età, storico prezzi, stato e note dell'annuncio precedente, che resta salvato finché rivedi la ripubblicazione.",
    ]);
  });
```

- [ ] **Step 2: verificare che fallisca**

Run: `npx vitest run tests/unit/core/onboarding.test.ts` → FAIL.

- [ ] **Step 3: implementare**

`src/core/onboarding.ts`: `export const ONBOARDING_VERSION = 4;` e in `ONBOARDING_CHANGES`:

```ts
  4: ["HomeRadar ora riconosce un annuncio tolto e ripubblicato sullo stesso portale: il lead tiene età, storico prezzi, stato e note dell'annuncio precedente, che resta salvato finché rivedi la ripubblicazione."],
```

`src/ui/onboarding/Onboarding.tsx`:
- in "Cosa salva", dopo il punto sullo stesso immobile su più portali:

```tsx
          <li>
            Quando un annuncio viene tolto e ripubblicato sullo stesso portale, HomeRadar lo riconosce confrontando città, m²,
            locali, tipologia, zona, indirizzo e prezzo, e il lead tiene età, storico prezzi, stato e note dell'annuncio
            precedente. Se separi un annuncio unito per errore, la scelta viene salvata.
          </li>
```

- nel punto della conservazione, alla fine del testo del template (dopo "Puoi cambiare il periodo nelle impostazioni."): ` L'annuncio precedente di una ripubblicazione resta finché rivedi la ripubblicazione.`
- nella legenda, dopo la voce "· 2 portali":

```tsx
          <li>
            <Badge priority="medium">· ripubblicato</Badge>
            <span>l'annuncio è stato tolto e ripubblicato sullo stesso portale: età e ribassi partono dall'annuncio precedente.</span>
          </li>
```

- [ ] **Step 4: documenti**

`docs/smoke-test.md`: dopo la sezione "Stesso immobile su più portali" (prima della riga "Se il sito è cambiato…") aggiungi:

```markdown
## Ripubblicazioni

54. Da un'installazione con l'informativa confermata alla versione precedente, apri il pannello.
    - [ ] Il pannello chiede di riconfermare; "Cosa è cambiato" cita le ripubblicazioni; la legenda ha "· ripubblicato".
55. Su un **profilo di prova** (mai sul profilo di lavoro), apri una ricerca di Immobiliare con privati e poi esporta un backup. Nel file duplica un annuncio privato e, nella copia, metti un `portalId` più basso (e `key`/`url` coerenti), `firstSeenAt` e `lastSeenAt` a un mese prima del `firstSeenAt` dell'originale, `currentPrice` del 10% più alto e, se c'è, `portalCreatedAt` di qualche mese prima. Importa il file.
    - [ ] Il lead dell'originale mostra "Ripubblicato", il ribasso del 10% e l'età della copia.
    - [ ] "Fonti (2)" mostra la riga "Annuncio precedente · visto fino al …"; "Su più portali" non conta il lead.
    - [ ] Ricaricando la ricerca, il badge della card finisce con "· ripubblicato".
56. Premi "Separa" sull'annuncio precedente.
    - [ ] I lead diventano due; ricaricando la ricerca non si riuniscono.
57. Esporta CSV.
    - [ ] Colonna "Ripubblicato" con "sì" sul lead ripubblicato (prima di "Separa") e "Altri URL" con il link dell'annuncio precedente.
```

`CLAUDE.md`: nella descrizione di `same-property.ts`, dopo "un annuncio per portale e ogni coppia compatibile;", aggiungi: "prima, per portale, le catene di ripubblicazione (ID più alto, mai visti insieme, stessi dati, prezzo da −20% a +5%; coppie transitive tolte, casi ambigui lasciati soli), e il confronto tra portali usa solo l'ultimo annuncio di ogni catena;". Nella descrizione di `lead-groups.ts`, dopo "principale,": "sempre un annuncio vivo, `others` con gli annunci precedenti (`previous`), storico prezzi della catena,". Nella stessa riga sostituisci "`service.ts` (`LeadService`, unico scrittore su Dexie)" con "`service.ts` (`LeadService`, unico scrittore su Dexie; la pulizia automatica decide per immobile: un gruppo si cancella solo se tutti i suoi annunci sono vecchi e non lavorati)".

- [ ] **Step 5: verificare**

Run: `npm test && npm run typecheck` → PASS. Run: `npm run build` → build in `.output/chrome-mv3` senza errori.

- [ ] **Step 6: commit**

```bash
git add src/core/onboarding.ts src/ui/onboarding/Onboarding.tsx tests/unit/core/onboarding.test.ts docs/smoke-test.md CLAUDE.md
git commit -m "docs: informativa v4, smoke test e CLAUDE.md per le ripubblicazioni"
```
