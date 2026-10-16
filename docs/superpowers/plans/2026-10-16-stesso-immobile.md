# Stesso immobile su più portali — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riconoscere gli annunci di portali diversi che descrivono lo stesso immobile e mostrarli come un solo lead con più fonti, età più vecchia e "· N portali", con separazione manuale ricordata.

**Architecture:** Un modulo puro (`same-property.ts`) calcola i gruppi a ogni lettura dagli annunci salvati e dalle coppie separate dall'agente (nuova tabella Dexie `splits`, unico dato nuovo). Un secondo modulo puro (`lead-groups.ts`) costruisce i `LeadView` (principale, altre fonti, valutazione e stato del gruppo, mediana senza doppioni); il servizio lo usa in `listLeads`, nell'`ingest` (badge delle card) e per contare i richiami. Stato e note restano per annuncio e si scrivono su tutto il gruppo.

**Tech Stack:** TypeScript, Dexie (IndexedDB), zod, React, Vitest (jsdom + fake-indexeddb), WXT.

**Spec:** `docs/superpowers/specs/2026-10-16-stesso-immobile-design.md`

## Global Constraints

- Nessuna richiesta HTTP verso i portali; nessun dato nuovo letto dai portali.
- Gruppi calcolati in memoria, mai salvati; si salva solo la tabella `splits` (`version(6)`), senza modificare le versioni Dexie esistenti.
- Soglie: m² `|a − b| ≤ max(3, 5% del minore)`; prezzo `|a − b| ≤ 5% del minore`; locali uguali o mancanti su uno; portali diversi; stessa città normalizzata; al massimo un annuncio per portale nel gruppo; ogni coppia del gruppo compatibile.
- `BACKUP_FORMAT_VERSION` resta 1; `splits` nel file è facoltativo.
- `ONBOARDING_VERSION` passa a 3 con voce in `ONBOARDING_CHANGES`.
- Timestamp in ms epoch UTC. Testi dell'interfaccia in italiano.
- Molti file del repo sono CRLF: modificare con l'editor, non con `sed`. Commit con heredoc in Bash (le virgolette doppie rompono `git commit -m` in PowerShell).
- Ogni commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Note diverse già scritte su due annunci che poi si uniscono: nessuna nota deve sparire dalla vista (test in Task 5, `mergeGroupState`).
- Un portale cambia prezzo oltre il 5%: il gruppo si scioglie e ogni fonte resta con lo stato scritto sul gruppo (test in Task 6).
- "Separa" su un annuncio entrato nel gruppo dopo l'ultima modifica: non deve tornare "Nuovo" (test in Task 6).
- Un richiamo impostato su un lead unito conta 1, non 2, sull'icona (test in Task 6).
- Backup di una versione precedente senza `splits`, o con separazioni di annunci assenti: si importa, le coppie orfane si scartano (test in Task 4).

---

### Task 1: Riconoscimento dei gruppi (`same-property.ts`)

**Files:**
- Modify: `src/shared/types.ts` (aggiunge `SplitPair`)
- Create: `src/core/same-property.ts`
- Test: `tests/unit/core/same-property.test.ts`

**Interfaces:**
- Produces: `interface SplitPair { a: string; b: string; at: number }` in `@/shared/types`; `splitPair(x, y, at): SplitPair`, `splitId(x, y): string`, `groupListings(listings: ListingRecord[], splits: SplitPair[]): string[][]` e le costanti `SURFACE_TOLERANCE_PERCENT`, `SURFACE_TOLERANCE_M2`, `PRICE_TOLERANCE_PERCENT` in `@/core/same-property`.

- [ ] **Step 1: Aggiungi il tipo `SplitPair`**

In `src/shared/types.ts`, subito dopo `export type SnapshotSource = 'observed' | 'declared';` e l'interfaccia `PriceSnapshot`, aggiungi:

```ts
/** Due annunci che l'agente ha separato: non vanno più uniti. `a < b`, chiavi di listing. */
export interface SplitPair {
  a: string;
  b: string;
  at: number;
}
```

- [ ] **Step 2: Scrivi il test che fallisce**

Crea `tests/unit/core/same-property.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupListings, splitPair } from '@/core/same-property';
import type { ListingRecord, Portal } from '@/shared/types';

function rec(portal: Portal, id: number, o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: `${portal}:${id}`, portal, portalId: id, url: '', title: '', address: null,
    city: 'Milano', zone: null, typology: null, surfaceM2: 80, rooms: 3, currentPrice: 300000,
    portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 1, ...o,
  };
}

describe('splitPair', () => {
  it('mette le chiavi in ordine', () => {
    expect(splitPair('subito:1', 'idealista:2', 5)).toEqual({ a: 'idealista:2', b: 'subito:1', at: 5 });
  });
});

describe('groupListings', () => {
  it('unisce due annunci compatibili di portali diversi', () => {
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2)], [])).toEqual([['idealista:2', 'immobiliare:1']]);
  });

  it('non unisce mai due annunci dello stesso portale', () => {
    expect(groupListings([rec('immobiliare', 1), rec('immobiliare', 2)], [])).toEqual([]);
  });

  it('città confrontata senza maiuscole e accenti; città diverse non si uniscono', () => {
    expect(groupListings([rec('immobiliare', 1, { city: 'Forlì' }), rec('idealista', 2, { city: 'forli' })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2, { city: 'Monza' })], [])).toEqual([]);
  });

  it('servono città, m² e prezzo su entrambi', () => {
    expect(groupListings([rec('immobiliare', 1, { city: null }), rec('idealista', 2, { city: null })], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: null }), rec('idealista', 2)], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { currentPrice: null }), rec('idealista', 2)], [])).toEqual([]);
  });

  it('m²: tollera 3 m² o il 5% del minore, il più largo', () => {
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 50 }), rec('idealista', 2, { surfaceM2: 53 })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 50 }), rec('idealista', 2, { surfaceM2: 54 })], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 100 }), rec('idealista', 2, { surfaceM2: 105 })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 100 }), rec('idealista', 2, { surfaceM2: 106 })], [])).toEqual([]);
  });

  it('prezzo: tollera il 5% del minore', () => {
    expect(groupListings([rec('immobiliare', 1, { currentPrice: 200000 }), rec('idealista', 2, { currentPrice: 210000 })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1, { currentPrice: 200000 }), rec('idealista', 2, { currentPrice: 210001 })], [])).toEqual([]);
  });

  it('locali: devono coincidere se presenti su entrambi', () => {
    expect(groupListings([rec('immobiliare', 1, { rooms: 3 }), rec('idealista', 2, { rooms: 4 })], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { rooms: 3 }), rec('idealista', 2, { rooms: null })], [])).toHaveLength(1);
  });

  it('unisce tre portali se ogni coppia è compatibile', () => {
    const g = groupListings([rec('subito', 3), rec('immobiliare', 1), rec('idealista', 2)], []);
    expect(g).toEqual([['idealista:2', 'immobiliare:1', 'subito:3']]);
  });

  it('caso ambiguo (due annunci dello stesso portale compatibili con uno): restano separati', () => {
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2), rec('idealista', 3, { currentPrice: 305000 })], [])).toEqual([]);
  });

  it('catena non valida: A~B e B~C ma A e C troppo diversi, nessun gruppo', () => {
    const list = [
      rec('immobiliare', 1, { currentPrice: 290000 }),
      rec('idealista', 2, { currentPrice: 300000 }),
      rec('subito', 3, { currentPrice: 310000 }),
    ];
    // 290k~300k e 300k~310k entro il 5%; 290k e 310k no (20k > 14,5k).
    expect(groupListings(list, [])).toEqual([]);
  });

  it('una coppia separata non si unisce; nel gruppo di tre fa cadere chi è separato', () => {
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2)], [splitPair('immobiliare:1', 'idealista:2', 0)])).toEqual([]);
    const three = [rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3)];
    const splits = [splitPair('subito:3', 'immobiliare:1', 0), splitPair('subito:3', 'idealista:2', 0)];
    expect(groupListings(three, splits)).toEqual([['idealista:2', 'immobiliare:1']]);
  });

  it("il risultato non dipende dall'ordine degli annunci", () => {
    const list = [rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3), rec('immobiliare', 4, { city: 'Roma' }), rec('subito', 5, { city: 'Roma' })];
    const expected = groupListings(list, []);
    expect(groupListings([...list].reverse(), [])).toEqual(expected);
    expect(expected).toEqual([['idealista:2', 'immobiliare:1', 'subito:3'], ['immobiliare:4', 'subito:5']]);
  });
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `npx vitest run tests/unit/core/same-property.test.ts`
Expected: FAIL, modulo `@/core/same-property` non trovato.

- [ ] **Step 4: Implementa**

Crea `src/core/same-property.ts`:

```ts
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

const byKey = (x: Candidate, y: Candidate) => (x.listing.key < y.listing.key ? -1 : 1);

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
    cs.sort(byKey);
    const ok = (i: number, j: number) => compatible(cs[i]!, cs[j]!) && !separated.has(splitId(cs[i]!.listing.key, cs[j]!.listing.key));
    const parent = cs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) if (ok(i, j)) parent[find(j)] = find(i);
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
      groups.push(members.map((i) => cs[i]!.listing.key));
    }
  }
  return groups.sort((g, h) => (g[0]! < h[0]! ? -1 : 1));
}
```

- [ ] **Step 5: Verifica che passi**

Run: `npx vitest run tests/unit/core/same-property.test.ts`
Expected: PASS (13 test).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/core/same-property.ts tests/unit/core/same-property.test.ts
git commit -F - <<'EOF'
feat(core): riconoscimento dello stesso immobile su portali diversi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Valutazione del gruppo (`evaluateGroup` in `rules.ts`)

**Files:**
- Modify: `src/core/rules.ts` (intero file)
- Test: `tests/unit/core/rules.test.ts`

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: `interface GroupMember { listing: ListingRecord; prices: PriceSnapshot[] }` e `evaluateGroup(target: ListingRecord, members: GroupMember[], settings: Settings, now: number): Evaluation` in `@/core/rules`. `evaluate` invariata nel comportamento.

- [ ] **Step 1: Scrivi il test che fallisce**

In `tests/unit/core/rules.test.ts` cambia l'import in `import { evaluate, evaluateGroup } from '@/core/rules';` e aggiungi in fondo:

```ts
describe('evaluateGroup', () => {
  const immo = listing({ portalCreatedAt: daysAgo(45), lastDrop }); // Media: solo ribasso
  const idea = listing({ key: 'idealista:2', portal: 'idealista', portalId: 2, estimatedCreatedAt: daysAgo(200), currentPrice: 239000 }); // Media: solo età

  it('età da un portale e ribasso da un altro fanno Alta', () => {
    const e = evaluateGroup(immo, [{ listing: immo, prices: declaredDrop }, { listing: idea, prices: [] }], DEFAULT_SETTINGS, NOW);
    expect(ev(immo, declaredDrop).priority).toBe('medium');
    expect(ev(idea).priority).toBe('medium');
    expect(e).toMatchObject({ listingKey: 'immobiliare:1', portalId: 1, priority: 'high', ageDays: 200, ageEstimated: true, dropPercent: 5.6 });
    expect(e.badgeText).toBe('● Alta · ~200 gg · −5,6% · 2 portali');
  });

  it("l'età è del membro più vecchio con il segnale A, anche se un altro è più vecchio ma incerto", () => {
    const certain = listing({ portalCreatedAt: daysAgo(130) });
    const uncertain = listing({ key: 'subito:3', portal: 'subito', portalId: 3, estimatedCreatedAt: daysAgo(134) });
    const e = evaluateGroup(certain, [{ listing: certain, prices: [] }, { listing: uncertain, prices: [] }], DEFAULT_SETTINGS, NOW);
    expect(e).toMatchObject({ priority: 'medium', ageDays: 130, ageEstimated: false, ageUncertain: false });
  });

  it('senza segnali: età del più vecchio, nessuna priorità, badge con i portali', () => {
    const a = listing({ portalCreatedAt: daysAgo(10) });
    const b = listing({ key: 'idealista:2', portal: 'idealista', portalId: 2, estimatedCreatedAt: daysAgo(30) });
    const e = evaluateGroup(a, [{ listing: a, prices: [] }, { listing: b, prices: [] }], DEFAULT_SETTINGS, NOW);
    expect(e).toMatchObject({ priority: 'none', ageDays: 30 });
    expect(e.badgeText).toBe('Privato · ~30 gg · 2 portali');
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `npx vitest run tests/unit/core/rules.test.ts`
Expected: FAIL, `evaluateGroup` non esportata.

- [ ] **Step 3: Implementa**

Sostituisci il contenuto di `src/core/rules.ts` con:

```ts
import { priorityLabel } from '@/core/leads';
import { formatDayMonth, formatEuro, formatPercent } from '@/shared/format';
import {
  DAY_MS, type Evaluation, type ListingRecord, type Portal, type PriceDrop, type PriceSnapshot, type Priority, type Settings,
} from '@/shared/types';

export const UNCERTAINTY_DAYS = 15;
/** Oltre questa età una stima in giorni suggerirebbe una precisione che l'ID non dà. */
const ESTIMATED_YEARS_FROM_DAYS = 3 * 365;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Su Immobiliare la scheda contiene la data vera; su Idealista e Subito no.
const VERIFY_REASON: Record<Portal, string> = {
  immobiliare: "Età da verificare: apri l'annuncio",
  idealista: 'Età stimata vicina alla soglia',
  subito: 'Età stimata vicina alla soglia',
};

interface AgeFacts {
  /** Portale dell'annuncio da cui viene l'età: decide i testi dell'età incerta. */
  portal: Portal;
  ageDays: number | null;
  ageEstimated: boolean;
  ageUncertain: boolean;
  /** Segnale A: anzianità. */
  signal: boolean;
}

function ageFacts(listing: ListingRecord, settings: Settings, now: number): AgeFacts {
  const created = listing.portalCreatedAt ?? listing.estimatedCreatedAt;
  const ageEstimated = listing.portalCreatedAt == null;
  const ageDays = created == null ? null : Math.max(0, Math.floor((now - created) / DAY_MS));
  const ageUncertain =
    ageDays != null &&
    ageEstimated &&
    ageDays >= settings.minAgeDays - UNCERTAINTY_DAYS &&
    ageDays < settings.minAgeDays + UNCERTAINTY_DAYS;
  const signal = ageDays != null && !ageUncertain && ageDays >= settings.minAgeDays;
  return { portal: listing.portal, ageDays, ageEstimated, ageUncertain, signal };
}

interface DropFacts {
  current: number | null;
  lastDrop: PriceDrop | null;
  maxKnownPrice: number | null;
  dropPercent: number;
  dropCount: number;
  /** Segnale B: ribasso. */
  signal: boolean;
}

/** Ribassi rispetto al massimo prezzo noto. */
function dropFacts(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings): DropFacts {
  const ordered = [...snapshots].sort((a, b) => a.at - b.at);
  const current = listing.currentPrice;
  const known = ordered.map((s) => s.price);
  if (listing.lastDrop) known.push(listing.lastDrop.fromPrice);
  if (current != null) known.push(current);
  const maxKnownPrice = known.length ? Math.max(...known) : null;
  const dropPercent =
    current != null && maxKnownPrice != null && maxKnownPrice > current
      ? round1(((maxKnownPrice - current) / maxKnownPrice) * 100)
      : 0;
  const signal = dropPercent > 0 && dropPercent >= settings.minDropPercent;
  let dropCount = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.price < ordered[i - 1]!.price) dropCount++;
  return { current, lastDrop: listing.lastDrop, maxKnownPrice, dropPercent, dropCount, signal };
}

/** Priorità, motivi e badge da età e ribasso; `portals` > 1 aggiunge "· N portali" al badge. */
function compose(target: ListingRecord, age: AgeFacts, drop: DropFacts, portals = 1): Evaluation {
  const { ageDays, ageEstimated, ageUncertain } = age;
  const { current, maxKnownPrice, dropPercent, dropCount } = drop;

  let priority: Priority = 'none';
  if (age.signal && drop.signal) priority = 'high';
  else if (age.signal || drop.signal) priority = 'medium';
  else if (ageUncertain) priority = 'verify';

  const agePart =
    ageDays == null ? null
    : ageEstimated && ageDays >= ESTIMATED_YEARS_FROM_DAYS ? `oltre ${Math.floor(ageDays / 365)} anni`
    : `${ageEstimated ? '~' : ''}${ageDays} gg`;
  const reasons: string[] = [];
  if (agePart) reasons.push(`Online da ${agePart}`);
  if (ageUncertain) reasons.push(VERIFY_REASON[age.portal]);
  if (drop.signal && current != null && maxKnownPrice != null) {
    if (dropCount >= 2) {
      reasons.push(`${dropCount} ribassi, −${formatPercent(dropPercent)}% totale`);
    } else {
      const d = drop.lastDrop;
      const when = d && d.toPrice === current ? ` ${d.dateEstimated ? 'rilevato il' : 'il'} ${formatDayMonth(d.date)}` : '';
      reasons.push(`Ribassato del ${formatPercent(dropPercent)}% (${formatEuro(maxKnownPrice)} → ${formatEuro(current)} €)${when}`);
    }
  }

  const dropPart = drop.signal ? `−${formatPercent(dropPercent)}%` : null;
  const head = { high: '● Alta', medium: '● Media', verify: `◐ ${priorityLabel('verify', age.portal)}`, none: 'Privato' }[priority];
  const parts = priority === 'high' || priority === 'medium' ? [head, agePart, dropPart] : [head, agePart];
  if (portals > 1) parts.push(`${portals} portali`);

  return {
    listingKey: target.key,
    portalId: target.portalId,
    priority,
    ageDays,
    ageEstimated,
    ageUncertain,
    dropPercent,
    dropCount,
    maxKnownPrice,
    reasons,
    badgeText: parts.filter(Boolean).join(' · '),
  };
}

export function evaluate(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings, now: number): Evaluation {
  return compose(listing, ageFacts(listing, settings, now), dropFacts(listing, snapshots, settings));
}

export interface GroupMember {
  listing: ListingRecord;
  prices: PriceSnapshot[];
}

const days = (a: AgeFacts) => a.ageDays ?? -1;

/**
 * Valutazione dello stesso immobile su più portali: le regole di `evaluate` sui fatti del gruppo.
 * Età del membro più vecchio tra quelli con il segnale A (altrimenti del più vecchio), ribasso maggiore.
 * `listingKey` e `portalId` sono quelli di `target`.
 */
export function evaluateGroup(target: ListingRecord, members: GroupMember[], settings: Settings, now: number): Evaluation {
  const ages = members.map((m) => ageFacts(m.listing, settings, now));
  const pool = ages.some((a) => a.signal) ? ages.filter((a) => a.signal) : ages;
  // A parità di giorni vince l'età esatta.
  const age = pool.reduce((best, a) => (days(a) > days(best) || (days(a) === days(best) && best.ageEstimated && !a.ageEstimated) ? a : best));
  const drop = members
    .map((m) => dropFacts(m.listing, m.prices, settings))
    .reduce((best, d) => ((d.signal && !best.signal) || (d.signal === best.signal && d.dropPercent > best.dropPercent) ? d : best));
  return compose(target, age, drop, members.length);
}
```

- [ ] **Step 4: Verifica che passi**

Run: `npx vitest run tests/unit/core/rules.test.ts tests/unit/core/service.ingest.test.ts`
Expected: PASS (i test esistenti di `evaluate` restano verdi: il refactor non cambia il comportamento).

- [ ] **Step 5: Commit**

```bash
git add src/core/rules.ts tests/unit/core/rules.test.ts
git commit -F - <<'EOF'
feat(rules): valutazione del gruppo di annunci dello stesso immobile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Tabella `splits` e cancellazioni a cascata

**Files:**
- Modify: `src/core/db.ts`
- Modify: `src/core/service.ts` (`deleteListings`, `deleteAllListings`)
- Test: `tests/unit/core/db.test.ts`, `tests/unit/core/service.leads.test.ts`

**Interfaces:**
- Consumes: `SplitPair` (Task 1), `splitPair` (Task 1).
- Produces: `db.splits: Table<SplitPair, [string, string]>` con indici `a` e `b`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `tests/unit/core/db.test.ts`, dentro `describe('HomeRadarDB migrazioni', …)`, aggiungi:

```ts
  it('v6: aggiunge la tabella delle coppie separate senza toccare i dati', async () => {
    const name = `mig-${Math.random()}`;
    const old = new Dexie(name);
    old.version(5).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status, recallAt', calibration: '[portal+portalId], portal', meta: 'key',
    });
    await old.table('listings').put({ key: 'immobiliare:1', lastSeenAt: 5 });
    await old.table('leadStates').put({ listingKey: 'immobiliare:1', status: 'contacted', recallAt: null, updatedAt: 3 });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.splits.count()).toBe(0);
    await db.splits.put({ a: 'idealista:2', b: 'immobiliare:1', at: 7 });
    expect(await db.splits.where('b').equals('immobiliare:1').count()).toBe(1);
    expect(await db.listings.get('immobiliare:1')).toMatchObject({ lastSeenAt: 5 });
    expect(await db.leadStates.get('immobiliare:1')).toMatchObject({ status: 'contacted' });
  });
```

In `tests/unit/core/service.leads.test.ts` aggiungi l'import `import { splitPair } from '@/core/same-property';` e in fondo:

```ts
describe('coppie separate e cancellazioni', () => {
  it('eliminare un annuncio cancella le coppie che lo contengono; azzerare le cancella tutte', async () => {
    const { svc, db } = setup();
    await svc.ingest([obs(), obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/' })]);
    await db.splits.bulkPut([splitPair(KEY, 'idealista:9', 1), splitPair('subito:8', KEY, 1), splitPair('idealista:9', 'subito:8', 1)]);
    await svc.deleteListings([KEY]);
    expect(await db.splits.toArray()).toEqual([{ a: 'idealista:9', b: 'subito:8', at: 1 }]);
    await svc.deleteAllListings();
    expect(await db.splits.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/db.test.ts tests/unit/core/service.leads.test.ts`
Expected: FAIL, `db.splits` undefined.

- [ ] **Step 3: Implementa**

In `src/core/db.ts`: aggiungi `SplitPair` all'import dei tipi, la dichiarazione `declare splits: Table<SplitPair, [string, string]>;` dopo `declare meta`, e in fondo al costruttore, dopo `version(5)`:

```ts
    // v6: coppie di annunci che l'agente ha separato, per non unirle più come stesso immobile.
    this.version(6).stores({ splits: '[a+b], a, b' });
```

In `src/core/service.ts` sostituisci `deleteListings` e `deleteAllListings` con:

```ts
  async deleteListings(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const { listings, priceSnapshots, leadStates, splits } = this.db;
    await this.db.transaction('rw', [listings, priceSnapshots, leadStates, splits], async () => {
      await listings.bulkDelete(keys);
      await priceSnapshots.where('listingKey').anyOf(keys).delete();
      await leadStates.bulkDelete(keys);
      await splits.where('a').anyOf(keys).delete();
      await splits.where('b').anyOf(keys).delete();
    });
  }

  async deleteAllListings(): Promise<number> {
    const { listings, priceSnapshots, leadStates, splits } = this.db;
    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, splits], async () => {
      const count = await listings.count();
      await Promise.all([listings.clear(), priceSnapshots.clear(), leadStates.clear(), splits.clear()]);
      return count;
    });
  }
```

`purge` passa da `deleteListing` → `deleteListings`, quindi cancella già le coppie.

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/unit/core/db.test.ts tests/unit/core/service.leads.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/db.ts src/core/service.ts tests/unit/core/db.test.ts tests/unit/core/service.leads.test.ts
git commit -F - <<'EOF'
feat(db): tabella delle coppie separate (v6), cancellate con gli annunci

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Coppie separate nel backup

**Files:**
- Modify: `src/core/backup.ts`
- Modify: `src/core/service.ts` (`exportBackup`, `importBackup`)
- Test: `tests/unit/core/backup.test.ts`, `tests/unit/core/backup-merge.test.ts`, `tests/unit/core/service.backup.test.ts`

**Interfaces:**
- Consumes: `SplitPair`, `splitId` (Task 1), `db.splits` (Task 3).
- Produces: `BackupData.splits?: SplitPair[]`, `BackupFile.splits: SplitPair[]` (sempre presente dopo `parseBackup`/`buildBackup`), `CurrentData.splits?: SplitPair[]`, `MergeResult.splits: SplitPair[]`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `tests/unit/core/backup.test.ts` aggiungi (adatta il nome del builder del file se diverso: il file usa `buildBackup` e il builder `listing` di `./backup-builders`):

```ts
describe('separazioni nel backup', () => {
  const base = () => buildBackup({ listings: [listing()], priceSnapshots: [], leadStates: [], calibration: [] }, NOW, 'v');

  it('un file senza separazioni resta valido', () => {
    const json = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete json.splits;
    expect(parseBackup(json).splits).toEqual([]);
  });

  it('esporta e rilegge le separazioni', () => {
    const file = buildBackup({ listings: [listing()], priceSnapshots: [], leadStates: [], calibration: [], splits: [{ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 }] }, NOW, 'v');
    expect(parseBackup(JSON.parse(JSON.stringify(file))).splits).toEqual([{ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 }]);
  });

  it('rifiuta una separazione con le chiavi non in ordine', () => {
    const json = { ...JSON.parse(JSON.stringify(base())), splits: [{ a: 'subito:1', b: 'idealista:2', at: 5 }] };
    expect(() => parseBackup(json)).toThrow('Backup non valido (separazioni)');
  });
});
```

In `tests/unit/core/backup-merge.test.ts` aggiungi (usa gli helper già presenti nel file per costruire `current` e `incoming`; qui gli oggetti sono scritti per esteso):

```ts
  it('separazioni: unione senza doppioni, scarta quelle di annunci sconosciuti', () => {
    const l = listing();
    const known = { a: 'idealista:2', b: l.key, at: 1 };
    const current = { listings: [l], priceSnapshots: [], leadStates: [], calibration: [], settingsSaved: true, splits: [known] };
    const incoming = {
      listings: [listing({ key: 'idealista:2', portal: 'idealista' as const, portalId: 2, url: 'https://www.idealista.it/immobile/2/' })],
      priceSnapshots: [], leadStates: [], calibration: [],
      splits: [{ ...known, at: 9 }, { a: 'idealista:2', b: 'subito:3', at: 2 }, { a: 'immobiliare:128416572', b: 'subito:4', at: 3 }],
    };
    // subito:3 e subito:4 non sono né nel browser né nel file.
    expect(mergeBackup(current, incoming, NOW).splits).toEqual([]);
    const withSubito = { ...incoming, listings: [...incoming.listings, listing({ key: 'subito:3', portal: 'subito' as const, portalId: 3, url: 'https://www.subito.it/x/3.htm' })] };
    expect(mergeBackup(current, withSubito, NOW).splits).toEqual([{ a: 'idealista:2', b: 'subito:3', at: 2 }]);
  });
```

In `tests/unit/core/service.backup.test.ts` aggiungi (usa `setup`, `obs` da `./helpers`):

```ts
it('le separazioni passano dal backup a un altro browser', async () => {
  const a = setup();
  await a.svc.ingest([obs(), obs({ portal: 'idealista', portalId: 2, url: 'https://www.idealista.it/immobile/2/', lastDrop: null })]);
  await a.db.splits.put({ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 });
  const file = JSON.parse(JSON.stringify(await a.svc.exportBackup('v')));
  const b = setup();
  await b.svc.importBackup(file);
  expect(await b.db.splits.toArray()).toEqual([{ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 }]);
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/backup.test.ts tests/unit/core/backup-merge.test.ts tests/unit/core/service.backup.test.ts`
Expected: FAIL (`splits` assente).

- [ ] **Step 3: Implementa in `backup.ts`**

- Import: aggiungi `splitId` da `@/core/same-property` e il tipo `SplitPair` da `@/shared/types`.
- `BackupData`: aggiungi `splits?: SplitPair[];`.
- `BackupFile`: aggiungi `splits: SplitPair[];` (oltre all'`extends`).
- Dopo `CalibrationSchema`:

```ts
const SplitSchema = z.object({ a: z.string(), b: z.string(), at: num }).refine((s) => s.a < s.b);
```

- In `parseBackup`, nell'oggetto `file`, dopo `calibration`:

```ts
    // Facoltativo: i backup precedenti alle separazioni non lo hanno.
    splits: raw.splits === undefined ? [] : table(raw, 'splits', SplitSchema, 'separazioni'),
```

- In `buildBackup`, dopo `calibration: data.calibration,`:

```ts
    splits: data.splits ?? [],
```

- `CurrentData`: aggiungi `splits?: SplitPair[];`. `MergeResult`: aggiungi `splits: SplitPair[];`.
- In `mergeBackup`: inizializza `out` con `splits: []` e, prima di `if (!current.settingsSaved …)`:

```ts
  // Una separazione serve solo se entrambi gli annunci esistono qui o nel file.
  const known = new Set([...curListings.keys(), ...incListings.keys()]);
  const seenSplits = new Set((current.splits ?? []).map((s) => splitId(s.a, s.b)));
  for (const s of incoming.splits ?? []) {
    const id = splitId(s.a, s.b);
    if (seenSplits.has(id) || !known.has(s.a) || !known.has(s.b)) continue;
    seenSplits.add(id);
    out.splits.push(s);
  }
```

- [ ] **Step 4: Implementa in `service.ts`**

In `exportBackup`: aggiungi `splits` alla destrutturazione `const { listings, priceSnapshots, leadStates, calibration, meta, splits } = this.db;`, alla lista della transazione, e `splits: await splits.toArray(),` dopo `calibration` nei dati passati a `buildBackup`.

In `importBackup`: stessa aggiunta alla destrutturazione e alla transazione; `splits: await splits.toArray(),` nell'oggetto `CurrentData`; dopo `await calibration.bulkPut(m.calibration);` aggiungi `await splits.bulkPut(m.splits);`.

- [ ] **Step 5: Verifica che passino**

Run: `npx vitest run tests/unit/core/backup.test.ts tests/unit/core/backup-merge.test.ts tests/unit/core/service.backup.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/backup.ts src/core/service.ts tests/unit/core/backup.test.ts tests/unit/core/backup-merge.test.ts tests/unit/core/service.backup.test.ts
git commit -F - <<'EOF'
feat(backup): separazioni tra annunci nel file di backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Costruzione dei lead uniti (`lead-groups.ts`, `LeadView.others`)

**Files:**
- Modify: `src/shared/types.ts` (`LeadSource`, `LeadView.others`)
- Modify: `src/core/leads.ts` (`PRIORITY_ORDER` esportato, `leadKeys`, `leadPortals`)
- Create: `src/core/lead-groups.ts`
- Test: `tests/unit/core/lead-groups.test.ts`
- Modify (builder dei test, aggiungono `others: []`): `tests/unit/core/export.test.ts`, `tests/unit/core/lead-filters.test.ts`, `tests/unit/core/leads.test.ts`, `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `groupListings` (Task 1), `evaluate`, `evaluateGroup`, `GroupMember` (Task 2), `compareToMarket` (`market.ts`).
- Produces:
  - `interface LeadSource { listing: ListingRecord; evaluation: Evaluation; prices: PriceSnapshot[] }` e `LeadView.others: LeadSource[]` in `@/shared/types`.
  - `PRIORITY_ORDER`, `leadKeys(l: LeadView): string[]`, `leadPortals(l: LeadView): Portal[]` in `@/core/leads`.
  - In `@/core/lead-groups`: `interface Archive { listings: ListingRecord[]; states: LeadState[]; snapshots: PriceSnapshot[]; splits: SplitPair[] }`, `defaultState(listing): LeadState`, `interface MemberState { listing: ListingRecord; state: LeadState }`, `NOTES_SEPARATOR = ' · '`, `mergeGroupState(members: MemberState[]): LeadState`, `buildLeadViews(archive: Archive, settings: Settings, now: number): LeadView[]`, `isListed(v: LeadView): boolean`.

- [ ] **Step 1: Tipi**

In `src/shared/types.ts`, prima di `export interface LeadView`:

```ts
/** Un annuncio del lead, con la sua valutazione e il suo storico prezzi. */
export interface LeadSource {
  listing: ListingRecord;
  evaluation: Evaluation;
  prices: PriceSnapshot[];
}
```

e in `LeadView`, dopo `market`:

```ts
  /** Altre fonti dello stesso immobile su portali diversi, senza il principale (`listing`); vuoto se il lead è da solo. */
  others: LeadSource[];
```

- [ ] **Step 2: Helper in `leads.ts`**

In `src/core/leads.ts` cambia `const PRIORITY_ORDER` in `export const PRIORITY_ORDER` e aggiungi dopo `STATUS_LABELS`:

```ts
/** Chiavi di tutti gli annunci del lead: il principale per primo. */
export function leadKeys(l: LeadView): string[] {
  return [l.listing.key, ...l.others.map((o) => o.listing.key)];
}

export function leadPortals(l: LeadView): Portal[] {
  return [l.listing.portal, ...l.others.map((o) => o.listing.portal)];
}
```

- [ ] **Step 3: Aggiorna i builder dei test**

Nei builder di `LeadView` di `tests/unit/core/export.test.ts` (costante `lead`), `tests/unit/core/lead-filters.test.ts` (funzione `lead`), `tests/unit/core/leads.test.ts` (funzione `lead`) e `tests/unit/ui/sidepanel.test.tsx` (funzione `lead`), aggiungi `others: [],` dopo `market: null,` (o dopo il campo `market` del builder).

Run: `npm run typecheck`
Expected: nessun errore su `others` (gli altri errori, se ci sono, vengono dai task successivi e non devono esserci ancora).

- [ ] **Step 4: Scrivi il test che fallisce**

Crea `tests/unit/core/lead-groups.test.ts`:

```ts
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
    // 6 annunci a Navigli: il gruppo (2) + 4 da soli di Immobiliare a 300.000 → per il gruppo restano 4 annunci di confronto.
    const others = [10, 11, 12, 13].map((id) => rec('immobiliare', id, { surfaceM2: 100, rooms: null }));
    const views = buildLeadViews(archive([rec('immobiliare', 1), rec('idealista', 2), ...others]), DEFAULT_SETTINGS, NOW);
    const group = views.find((v) => v.others.length)!;
    // Con 4 annunci la zona non basta (minimo 5) e la città neppure: senza doppioni il confronto non c'è.
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
```

- [ ] **Step 5: Verifica che fallisca**

Run: `npx vitest run tests/unit/core/lead-groups.test.ts`
Expected: FAIL, modulo non trovato.

- [ ] **Step 6: Implementa**

Crea `src/core/lead-groups.ts`:

```ts
import { PRIORITY_ORDER } from '@/core/leads';
import { compareToMarket } from '@/core/market';
import { evaluate, evaluateGroup } from '@/core/rules';
import { groupListings } from '@/core/same-property';
import {
  PORTAL_TAGS,
  type LeadSource, type LeadState, type LeadView, type ListingRecord, type PriceSnapshot, type Settings, type SplitPair,
} from '@/shared/types';

/** Tutto ciò che serve per costruire i lead, letto dal database. */
export interface Archive {
  listings: ListingRecord[];
  states: LeadState[];
  snapshots: PriceSnapshot[];
  splits: SplitPair[];
}

export function defaultState(listing: ListingRecord): LeadState {
  return { listingKey: listing.key, status: 'new', notes: '', statusChangedAt: listing.firstSeenAt, updatedAt: listing.firstSeenAt, recallAt: null };
}

export interface MemberState {
  listing: ListingRecord;
  state: LeadState;
}

/** Il campo note è su una riga: le note di portali diversi si separano così. */
export const NOTES_SEPARATOR = ' · ';

/**
 * Stato del lead unito: stato, richiamo e date del membro modificato più di recente. Le note, se diverse,
 * si mostrano tutte con il portale davanti, così nessuna sparisce. `listingKey` è del primo membro (il principale).
 */
export function mergeGroupState(members: MemberState[]): LeadState {
  const latest = members.reduce((best, m) => (m.state.updatedAt > best.state.updatedAt ? m : best));
  const noted = members.filter((m) => m.state.notes.trim());
  const distinct = new Set(noted.map((m) => m.state.notes.trim()));
  const notes =
    distinct.size <= 1
      ? (noted[0]?.state.notes.trim() ?? '')
      : noted.map((m) => `${PORTAL_TAGS[m.listing.portal]}: ${m.state.notes.trim()}`).join(NOTES_SEPARATOR);
  return { ...latest.state, listingKey: members[0]!.listing.key, notes };
}

/** Principale del gruppo: priorità più alta, poi età maggiore, poi visto più di recente, poi chiave. */
function byPrimary(a: LeadSource, b: LeadSource): number {
  const p = PRIORITY_ORDER[a.evaluation.priority] - PRIORITY_ORDER[b.evaluation.priority];
  if (p !== 0) return p;
  const age = (b.evaluation.ageDays ?? -1) - (a.evaluation.ageDays ?? -1);
  if (age !== 0) return age;
  if (a.listing.lastSeenAt !== b.listing.lastSeenAt) return b.listing.lastSeenAt - a.listing.lastSeenAt;
  return a.listing.key < b.listing.key ? -1 : 1;
}

/** Un lead per immobile, senza filtri di visibilità né ordinamento. */
export function buildLeadViews({ listings, states, snapshots, splits }: Archive, settings: Settings, now: number): LeadView[] {
  const stateByKey = new Map(states.map((s) => [s.listingKey, s]));
  const snapsByKey = new Map<string, PriceSnapshot[]>();
  for (const s of snapshots) {
    const list = snapsByKey.get(s.listingKey);
    if (list) list.push(s);
    else snapsByKey.set(s.listingKey, [s]);
  }
  const sources = new Map<string, LeadSource>();
  for (const listing of listings) {
    const prices = (snapsByKey.get(listing.key) ?? []).sort((a, b) => a.at - b.at);
    sources.set(listing.key, { listing, prices, evaluation: evaluate(listing, prices, settings, now) });
  }

  const units: LeadSource[][] = [];
  const grouped = new Set<string>();
  for (const keys of groupListings(listings, splits)) {
    units.push(keys.map((k) => sources.get(k)!).sort(byPrimary));
    for (const k of keys) grouped.add(k);
  }
  for (const s of sources.values()) if (!grouped.has(s.listing.key)) units.push([s]);

  // Mediana sull'archivio intero, prima dei filtri di visibilità, e un solo annuncio per immobile.
  const market = compareToMarket(units.map((u) => u[0]!.listing));
  const stateOf = (l: ListingRecord) => stateByKey.get(l.key) ?? defaultState(l);

  return units.map((members) => {
    const [primary, ...others] = members as [LeadSource, ...LeadSource[]];
    return {
      listing: primary.listing,
      evaluation: others.length ? evaluateGroup(primary.listing, members, settings, now) : primary.evaluation,
      state: others.length ? mergeGroupState(members.map((m) => ({ listing: m.listing, state: stateOf(m.listing) }))) : stateOf(primary.listing),
      prices: primary.prices,
      market: market.get(primary.listing.key) ?? null,
      others,
    };
  });
}

/** Un lead si mostra se ha segnali, è già stato lavorato o ha un richiamo: l'icona lo conta. */
export function isListed(v: LeadView): boolean {
  return v.evaluation.priority !== 'none' || v.state.status !== 'new' || v.state.recallAt != null;
}
```

- [ ] **Step 7: Verifica che passi**

Run: `npx vitest run tests/unit/core/lead-groups.test.ts`
Expected: PASS (6 test). Il test della mediana si regge sulle soglie di `market.ts` (`MIN_ZONE_SAMPLE = 5`, `MIN_CITY_SAMPLE = 8`): senza doppioni il principale ha 4 annunci di confronto e nessun confronto; contando il gemello sarebbero 5 e il confronto comparirebbe.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/core/leads.ts src/core/lead-groups.ts tests/unit/core/lead-groups.test.ts tests/unit/core/export.test.ts tests/unit/core/lead-filters.test.ts tests/unit/core/leads.test.ts tests/unit/ui/sidepanel.test.tsx
git commit -F - <<'EOF'
feat(core): lead unito con principale, altre fonti, stato e note del gruppo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Servizio — lead uniti, scritture sul gruppo, separazione, badge e richiami

**Files:**
- Modify: `src/core/service.ts`
- Test: `tests/unit/core/service.groups.test.ts` (nuovo)

**Interfaces:**
- Consumes: `buildLeadViews`, `isListed`, `mergeGroupState`, `defaultState`, `Archive` (Task 5); `leadKeys` (Task 5); `groupListings`, `splitPair` (Task 1); `db.splits` (Task 3).
- Produces:
  - `listLeads(): Promise<LeadView[]>` con `others` valorizzato.
  - `setLeadState(keys: string | string[], patch): Promise<LeadState>` (restituisce lo stato della prima chiave).
  - `splitListing(key: string, fromKeys: string[]): Promise<void>`.
  - `ingest` restituisce, per gli annunci in un gruppo, la valutazione del gruppo con `listingKey`/`portalId` dell'annuncio.
  - `dueRecallCount(now)` conta un gruppo una volta.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `tests/unit/core/service.groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { startOfLocalDay } from '@/core/recall';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';
const TWIN = 'idealista:33000001';
/** Lo stesso bilocale di `obs()` pubblicato su Idealista, a un prezzo poco diverso. */
const twin = (o = {}) => obs({ portal: 'idealista', portalId: 33000001, url: 'https://www.idealista.it/immobile/33000001/', lastDrop: null, price: 239000, ...o });

describe('stesso immobile su più portali', () => {
  it('listLeads: un solo lead con le due fonti', async () => {
    const { svc } = setup();
    await svc.ingest([obs(), twin()]);
    const leads = await svc.listLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0]!.listing.key).toBe(KEY);
    expect(leads[0]!.others.map((o) => o.listing.key)).toEqual([TWIN]);
    expect(leads[0]!.evaluation.badgeText).toMatch(/· 2 portali$/);
  });

  it('ingest: il badge della card è quello del gruppo, con la chiave della card', async () => {
    const { svc } = setup();
    const evs = await svc.ingest([obs(), twin()]);
    const card = evs.find((e) => e.listingKey === TWIN)!;
    expect(card).toMatchObject({ portalId: 33000001, priority: 'high' });
    expect(card.badgeText).toMatch(/^● Alta · .* · 2 portali$/);
  });

  it('lo stato scritto sul gruppo vale per tutte le fonti', async () => {
    const { svc, db } = setup();
    await svc.ingest([obs(), twin()]);
    await svc.setLeadState([KEY, TWIN], { status: 'contacted', notes: 'sera' });
    expect(await db.leadStates.get(TWIN)).toMatchObject({ status: 'contacted', notes: 'sera' });
    expect(await db.leadStates.get(KEY)).toMatchObject({ status: 'contacted', notes: 'sera' });
  });

  it('note scritte prima su annunci diversi: il lead le mostra tutte', async () => {
    const { svc } = setup();
    await svc.ingest([obs(), twin()]);
    await svc.setLeadState(KEY, { notes: 'sera' });
    await svc.setLeadState(TWIN, { notes: 'ha un agente' });
    expect((await svc.listLeads())[0]!.state.notes).toBe('Immobiliare: sera · Idealista: ha un agente');
  });

  it('un prezzo che diverge scioglie il gruppo; ogni fonte resta con lo stato del gruppo', async () => {
    const { svc } = setup();
    await svc.ingest([obs(), twin()]);
    await svc.setLeadState([KEY, TWIN], { status: 'contacted' });
    await svc.ingest([twin({ price: 280000 })]);
    const leads = await svc.listLeads();
    expect(leads.map((l) => [l.listing.key, l.others.length, l.state.status]).sort()).toEqual([
      [TWIN, 0, 'contacted'],
      [KEY, 0, 'contacted'],
    ].sort());
  });

  it('separa: copia lo stato del gruppo anche su chi non era stato toccato e non riunisce più', async () => {
    const { svc, db, advance } = setup();
    await svc.ingest([obs(), twin()]);
    // Senza avanzare l'orologio i due stati avrebbero lo stesso updatedAt dell'ingest.
    advance(1000);
    await svc.setLeadState(KEY, { status: 'contacted', notes: 'sera' }); // solo il principale
    await svc.splitListing(TWIN, [KEY]);
    expect(await db.leadStates.get(TWIN)).toMatchObject({ status: 'contacted', notes: 'sera' });
    await svc.ingest([obs(), twin()]);
    const leads = await svc.listLeads();
    expect(leads.map((l) => l.listing.key).sort()).toEqual([TWIN, KEY].sort());
    expect(leads.every((l) => l.others.length === 0)).toBe(true);
  });

  it('separa: annuncio inesistente', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await expect(svc.splitListing(TWIN, [KEY])).rejects.toThrow('Annuncio non trovato');
  });

  it("richiami: un gruppo conta una volta sull'icona", async () => {
    const { svc, now } = setup();
    await svc.ingest([obs(), twin(), obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/', city: 'Roma' })]);
    const today = startOfLocalDay(now());
    await svc.setLeadState([KEY, TWIN], { recallAt: today });
    await svc.setLeadState('immobiliare:2', { recallAt: today });
    expect(await svc.dueRecallCount(now())).toBe(2);
  });

  it('mediana di zona senza doppioni', async () => {
    const { svc } = setup();
    // Come in service.leads.test: 5 privati della zona a 3.000 €/m², più il gemello Idealista del lead.
    await svc.ingest([obs(), twin(), ...[1, 2, 3, 4, 5].map((i) => obs({ portalId: 131597836 + i, lastDrop: null, price: 186000 }))]);
    const lead = (await svc.listLeads()).find((l) => l.listing.key === KEY)!;
    expect(lead.market).toMatchObject({ scope: 'zone', sampleSize: 5, medianPerM2: 3000 });
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.groups.test.ts`
Expected: FAIL (`others` assente, `splitListing` non esiste, `setLeadState` non accetta un elenco).

- [ ] **Step 3: Implementa `listLeads` e l'archivio**

In `src/core/service.ts`:

- Import: `import { buildLeadViews, defaultState, isListed, mergeGroupState, type Archive } from '@/core/lead-groups';`, `import { groupListings, splitPair } from '@/core/same-property';`, `leadKeys` da `@/core/leads` (accanto a `sortLeads`). Rimuovi gli import che non servono più (`compareToMarket`, eventualmente `PriceSnapshot`): `npm run typecheck` li segnala.
- Aggiungi il metodo privato:

```ts
  private async archive(): Promise<Archive> {
    const [listings, states, snapshots, splits] = await Promise.all([
      this.db.listings.toArray(),
      this.db.leadStates.toArray(),
      this.db.priceSnapshots.toArray(),
      this.db.splits.toArray(),
    ]);
    return { listings, states, snapshots, splits };
  }
```

- Sostituisci `listLeads` con:

```ts
  async listLeads(): Promise<LeadView[]> {
    const settings = await this.getSettings();
    const views = buildLeadViews(await this.archive(), settings, this.clock());
    // Un lead con un richiamo resta visibile anche se è "Nuovo" senza segnali: l'icona lo conta.
    return sortLeads(views.filter(isListed));
  }
```

- [ ] **Step 4: Implementa `setLeadState` su più chiavi**

Sostituisci `setLeadState` con:

```ts
  /** Stato, note e richiamo di uno o più annunci (lo stesso immobile su più portali), in una transazione. */
  async setLeadState(keys: string | string[], patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): Promise<LeadState> {
    const now = this.clock();
    const list = Array.isArray(keys) ? keys : [keys];
    if (!list.length) throw new Error('Annuncio non trovato');
    return this.db.transaction('rw', [this.db.listings, this.db.leadStates], async () => {
      const saved: LeadState[] = [];
      for (const key of list) saved.push(await this.applyLeadState(key, patch, now));
      return saved[0]!;
    });
  }

  private async applyLeadState(key: string, patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }, now: number): Promise<LeadState> {
    if (!(await this.db.listings.get(key))) throw new Error('Annuncio non trovato');
    const prev = (await this.db.leadStates.get(key)) ?? { listingKey: key, status: 'new' as LeadStatus, notes: '', statusChangedAt: now, updatedAt: now, recallAt: null };
    const next: LeadState = { ...prev, recallAt: prev.recallAt ?? null };
    const recallAt = patch.recallAt == null ? patch.recallAt : startOfLocalDay(patch.recallAt);
    let status = patch.status ?? prev.status;
    if (status === 'discarded' && recallAt != null) throw new Error(RECALL_ON_DISCARDED);
    // Un lead con un richiamo è già in lavorazione: da "Nuovo" passa a "Da contattare".
    if (recallAt != null && status === 'new') status = 'to_contact';
    if (patch.notes !== undefined && patch.notes !== prev.notes) {
      next.notes = patch.notes;
      next.updatedAt = now;
    }
    if (status !== prev.status) {
      next.status = status;
      next.statusChangedAt = now;
      next.updatedAt = now;
    }
    const nextRecall = status === 'discarded' ? null : recallAt === undefined ? next.recallAt : recallAt;
    if (nextRecall !== next.recallAt) {
      next.recallAt = nextRecall;
      next.updatedAt = now;
    }
    await this.db.leadStates.put(next);
    return next;
  }
```

(Il corpo di `applyLeadState` è quello di oggi, spostato.)

- [ ] **Step 5: Implementa `splitListing`**

Dopo `setLeadState`:

```ts
  /**
   * Stacca `key` dalle altre fonti del suo gruppo. Prima scrive su tutti lo stato del gruppo, così un annuncio entrato
   * nel gruppo dopo l'ultima modifica non torna "Nuovo"; poi salva le coppie, che non si uniranno più.
   */
  async splitListing(key: string, fromKeys: string[]): Promise<void> {
    const now = this.clock();
    const { listings, leadStates, splits } = this.db;
    const keys = [key, ...fromKeys];
    await this.db.transaction('rw', [listings, leadStates, splits], async () => {
      const recs = await listings.bulkGet(keys);
      const members = [];
      for (const listing of recs) {
        if (!listing) throw new Error('Annuncio non trovato');
        members.push({ listing, state: (await leadStates.get(listing.key)) ?? defaultState(listing) });
      }
      const merged = mergeGroupState(members);
      await leadStates.bulkPut(keys.map((k) => ({ ...merged, listingKey: k, updatedAt: now })));
      await splits.bulkPut(fromKeys.map((k) => splitPair(key, k, now)));
    });
  }
```

- [ ] **Step 6: Badge del gruppo nell'`ingest`**

In `ingest`, cambia `return this.db.transaction('rw', …, async () => { … return evaluations; });` in:

```ts
    const evaluations = await this.db.transaction('rw', [listings, priceSnapshots, leadStates, calibration], async () => {
      // … corpo invariato …
      return evaluations;
    });
    return this.withGroups(evaluations, settings, now);
```

(Rinomina la variabile interna se TypeScript segnala l'ombreggiatura: ad esempio `const out: Evaluation[] = []` dentro la transazione.)

Aggiungi il metodo:

```ts
  /** Per gli annunci che fanno parte di un gruppo, la card mostra la valutazione del gruppo. */
  private async withGroups(evaluations: Evaluation[], settings: Settings, now: number): Promise<Evaluation[]> {
    if (!evaluations.length) return evaluations;
    const byKey = new Map<string, Evaluation>();
    for (const v of buildLeadViews(await this.archive(), settings, now)) {
      if (v.others.length) for (const k of leadKeys(v)) byKey.set(k, v.evaluation);
    }
    return evaluations.map((e) => {
      const g = byKey.get(e.listingKey);
      return g ? { ...g, listingKey: e.listingKey, portalId: e.portalId } : e;
    });
  }
```

- [ ] **Step 7: Richiami contati per gruppo**

Sostituisci `dueRecallCount` con:

```ts
  /** Richiami da fare oggi o in ritardo, per il numero sull'icona: lo stesso immobile su più portali conta una volta. */
  async dueRecallCount(now: number): Promise<number> {
    const due = await this.db.leadStates
      .where('recallAt')
      .below(addDays(startOfLocalDay(now), 1))
      .filter((s) => s.status !== 'discarded')
      .toArray();
    if (due.length < 2) return due.length;
    const [listings, splits] = await Promise.all([this.db.listings.toArray(), this.db.splits.toArray()]);
    const groupOf = new Map<string, string>();
    for (const g of groupListings(listings, splits)) for (const k of g) groupOf.set(k, g[0]!);
    return new Set(due.map((s) => groupOf.get(s.listingKey) ?? s.listingKey)).size;
  }
```

- [ ] **Step 8: Verifica che passino**

Run: `npx vitest run tests/unit/core`
Expected: PASS, compresi `service.leads.test.ts`, `service.ingest.test.ts`, `router.test.ts` (il router usa ancora `req.listingKey`, che resta valido come chiave singola fino al Task 7).

- [ ] **Step 9: Commit**

```bash
git add src/core/service.ts tests/unit/core/service.groups.test.ts
git commit -F - <<'EOF'
feat(service): lead uniti, stato sul gruppo, separazione, badge e richiami per gruppo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Messaggi, router e api

**Files:**
- Modify: `src/shared/messages.ts`, `src/core/router.ts`, `src/ui/sidepanel/api.ts`
- Test: `tests/unit/core/router.test.ts`

**Interfaces:**
- Consumes: `setLeadState(keys[], patch)`, `splitListing(key, fromKeys)` (Task 6).
- Produces: richiesta `{ type: 'setLeadState'; listingKeys: string[]; status?; notes?; recallAt? }`, richiesta `{ type: 'splitListing'; listingKey: string; fromKeys: string[] }`; in `Api`: `setLeadState(listingKeys: string[], patch): Promise<LeadState>`, `splitListing(listingKey: string, fromKeys: string[]): Promise<void>`.

- [ ] **Step 1: Aggiorna i test del router (falliscono)**

In `tests/unit/core/router.test.ts` sostituisci nelle due chiamate `setLeadState` `listingKey: 'immobiliare:128416572'` con `listingKeys: ['immobiliare:128416572']`. Aggiungi:

```ts
  it("splitListing separa e aggiorna il segnale sull'icona", async () => {
    const { svc, db } = setup();
    await svc.ingest([obs(), obs({ portal: 'idealista', portalId: 33000001, url: 'https://www.idealista.it/immobile/33000001/', lastDrop: null, price: 239000 })]);
    const h = hooks();
    expect(await handleRequest(svc, { type: 'splitListing', listingKey: 'idealista:33000001', fromKeys: ['immobiliare:128416572'] }, 'v', h)).toBeNull();
    expect(await db.splits.count()).toBe(1);
    expect(h.recallsChanged).toHaveBeenCalled();
  });
```

(Usa i nomi degli helper già presenti nel file: se la fabbrica degli hook si chiama diversamente da `hooks()`, usa quella; prima di confermare l'informativa il servizio scarta l'ingest, quindi riusa il setup già usato dagli altri test di `setLeadState` nel file, che conferma l'informativa.)

Run: `npx vitest run tests/unit/core/router.test.ts`
Expected: FAIL (errori di tipo su `listingKeys` e `splitListing`, o asserzioni).

- [ ] **Step 2: Implementa**

In `src/shared/messages.ts`, nella union `Request`:

```ts
  | { type: 'setLeadState'; listingKeys: string[]; status?: LeadStatus; notes?: string; recallAt?: number | null }
  | { type: 'splitListing'; listingKey: string; fromKeys: string[] }
```

(la prima riga sostituisce quella esistente di `setLeadState`).

In `src/core/router.ts`:

```ts
    case 'setLeadState': {
      const state = await service.setLeadState(req.listingKeys, { status: req.status, notes: req.notes, recallAt: req.recallAt });
      hooks.recallsChanged();
      return state;
    }
    case 'splitListing':
      await service.splitListing(req.listingKey, req.fromKeys);
      // Separare può cambiare il numero dei richiami: un gruppo diventa due lead.
      hooks.recallsChanged();
      return null;
```

In `src/ui/sidepanel/api.ts`: nell'interfaccia `Api`

```ts
  setLeadState(listingKeys: string[], patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): Promise<LeadState>;
  splitListing(listingKey: string, fromKeys: string[]): Promise<void>;
```

e in `defaultApi`

```ts
  setLeadState: (listingKeys, patch) => send({ type: 'setLeadState', listingKeys, ...patch }),
  splitListing: (listingKey, fromKeys) => send({ type: 'splitListing', listingKey, fromKeys }),
```

- [ ] **Step 3: Verifica**

Run: `npx vitest run tests/unit/core/router.test.ts` → PASS.
Run: `npm run typecheck` → gli unici errori ammessi sono in `src/ui/sidepanel/App.tsx` e `tests/unit/ui/sidepanel.test.tsx` (chiamata `setLeadState(l.listing.key, …)` e `fakeApi` senza `splitListing`), corretti nel Task 8.

- [ ] **Step 4: Commit**

```bash
git add src/shared/messages.ts src/core/router.ts src/ui/sidepanel/api.ts tests/unit/core/router.test.ts
git commit -F - <<'EOF'
feat(messages): stato su più annunci e separazione di un annuncio dal gruppo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Pannello — fonti, separazione e filtri

**Files:**
- Modify: `src/core/lead-filters.ts` (`matchesText` su tutte le fonti)
- Modify: `src/ui/sidepanel/LeadItem.tsx`, `src/ui/sidepanel/App.tsx`, `src/ui/sidepanel/styles.css`
- Test: `tests/unit/core/lead-filters.test.ts`, `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `leadKeys`, `leadPortals` (Task 5); `Api.setLeadState(keys[])`, `Api.splitListing` (Task 7).
- Produces: `LeadItem` con prop facoltativa `onSplit?(key: string): void`.

- [ ] **Step 1: Test della ricerca (fallisce)**

In `tests/unit/core/lead-filters.test.ts` aggiungi (il builder `lead(key, fields)` del file costruisce `listing` con i campi passati):

```ts
  it('la ricerca trova un lead unito anche dal testo di un\'altra fonte', () => {
    const main = lead('immobiliare:1', { title: 'Bilocale', address: null });
    const other = lead('idealista:2', { title: 'Bilocale in via Padova' });
    const merged = { ...main, others: [{ listing: other.listing, evaluation: other.evaluation, prices: [] }] };
    expect(matchesText(merged, 'padova')).toBe(true);
    expect(matchesText(main, 'padova')).toBe(false);
  });
```

- [ ] **Step 2: Test del pannello (falliscono)**

In `tests/unit/ui/sidepanel.test.tsx`:

- In `fakeApi` aggiungi `splitListing: vi.fn(async () => {}),`.
- Cambia l'aspettativa alla riga con `expect(api.setLeadState).toHaveBeenCalledWith('immobiliare:1', { recallAt: dayOffset(1) });` in `expect(api.setLeadState).toHaveBeenCalledWith(['immobiliare:1'], { recallAt: dayOffset(1) });`.
- Aggiungi un helper e i test:

```ts
/** Lead unito: il principale di Immobiliare e la stessa casa su Idealista. */
function merged(id: number, priority: Priority = 'high'): LeadView {
  const main = lead(id, priority);
  const twin = from('idealista', lead(id + 1000, priority));
  return { ...main, others: [{ listing: { ...twin.listing, currentPrice: 239000, surfaceM2: 62 }, evaluation: twin.evaluation, prices: [] }] };
}

describe('lead su più portali', () => {
  it('mostra i portali, "Su 2 portali" e le fonti; "Separa" stacca la fonte', () => {
    const onSplit = vi.fn();
    render(<ul><LeadItem lead={merged(1)} now={Date.now()} onChange={() => {}} onDelete={() => {}} onSplit={onSplit} /></ul>);
    expect(screen.getByText('Immobiliare')).toBeTruthy();
    expect(screen.getByText('Idealista')).toBeTruthy();
    expect(screen.getByText('Su 2 portali')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Separa Idealista' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fonti (2)' }));
    expect(screen.getByText('€ 239.000 · 62 m²', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Separa Idealista' }));
    expect(onSplit).toHaveBeenCalledWith('idealista:1001');
  });

  it('un lead da solo non ha fonti né pillola', () => {
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByText(/Su \d portali/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Fonti/ })).toBeNull();
  });

  it('elimina il gruppo intero, lo stato vale per tutte le fonti, separa con le altre chiavi', async () => {
    const api = fakeApi([merged(1)]);
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    fireEvent.change(screen.getByLabelText('Stato'), { target: { value: 'contacted' } });
    expect(api.setLeadState).toHaveBeenCalledWith(['immobiliare:1', 'idealista:1001'], { status: 'contacted' });
    fireEvent.click(screen.getByRole('button', { name: 'Fonti (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Separa Idealista' }));
    expect(api.splitListing).toHaveBeenCalledWith('idealista:1001', ['immobiliare:1']);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma: elimina 2 annunci' }));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:1', 'idealista:1001']);
  });

  it('filtro per sito e "Su più portali"', async () => {
    const api = fakeApi([merged(1), lead(2, 'high')]);
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    // Il lead unito ha una fonte su Idealista: il filtro Idealista lo trova.
    fireEvent.click(screen.getByRole('button', { name: 'Idealista (1)' }));
    expect(screen.queryByText('Bilocale 2')).toBeNull();
    expect(screen.getByText('Bilocale 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Idealista (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Su più portali (1)' }));
    expect(screen.queryByText('Bilocale 2')).toBeNull();
    expect(screen.getByText(/Elimina tutti «su più portali» \(1\)/)).toBeTruthy();
  });
});
```

Run: `npx vitest run tests/unit/core/lead-filters.test.ts tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Ricerca su tutte le fonti**

In `src/core/lead-filters.ts` sostituisci il corpo di `matchesText` dopo il controllo `ws.length`:

```ts
  const fields = [lead.listing, ...lead.others.map((o) => o.listing)]
    .flatMap(({ title, address, city, zone, typology }) => [title, address, city, zone, typology])
    .filter((f): f is string => f != null)
    .map(normalize);
  return ws.every((w) => fields.some((f) => f.includes(w)));
```

e aggiorna il commento della funzione: "Ogni parola della ricerca deve comparire in almeno uno dei campi testuali di una fonte del lead."

- [ ] **Step 4: `LeadItem`**

In `src/ui/sidepanel/LeadItem.tsx`:

- Import: aggiungi `leadPortals` da `@/core/leads`.
- Props: aggiungi `onSplit?(key: string): void;` e destrutturalo nella firma.
- In testa al componente: `const { listing, evaluation, state, prices, market, others } = lead;` e `const [showSources, setShowSources] = useState(false);`.
- Sostituisci `<span className="portal-tag">{PORTAL_TAGS[listing.portal]}</span>` con:

```tsx
          {leadPortals(lead).map((p) => (
            <span key={p} className="portal-tag">{PORTAL_TAGS[p]}</span>
          ))}
          {others.length > 0 && <span className="pill pill--multi">{`Su ${others.length + 1} portali`}</span>}
```

- Sostituisci il pulsante di conferma eliminazione `Conferma eliminazione` con:

```tsx
            <button type="button" className="btn btn--danger btn--sm" onClick={onDelete}>
              {others.length ? `Conferma: elimina ${others.length + 1} annunci` : 'Conferma eliminazione'}
            </button>
```

- Dopo il blocco `isAboveMarket(market) && …`, aggiungi:

```tsx
      {others.length > 0 && (
        <div className="sources">
          <button type="button" className="btn btn--sm" aria-expanded={showSources} onClick={() => setShowSources((s) => !s)}>
            {`Fonti (${others.length + 1})`}
          </button>
          {showSources && (
            <ul className="sources__list">
              {[{ listing, evaluation }, ...others].map((s) => (
                <li key={s.listing.key} className="sources__item">
                  <span className="portal-tag">{PORTAL_TAGS[s.listing.portal]}</span>
                  <span className="sources__facts">
                    {[
                      s.listing.currentPrice != null ? `€ ${formatEuro(s.listing.currentPrice)}` : 'Prezzo n.d.',
                      s.listing.surfaceM2 != null ? `${s.listing.surfaceM2} m²` : null,
                      s.evaluation.ageDays != null ? `${s.evaluation.ageEstimated ? '~' : ''}${s.evaluation.ageDays} gg` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  <a className="btn btn--sm" href={s.listing.url} target="_blank" rel="noreferrer">
                    Apri <ExternalIcon />
                  </a>
                  {onSplit && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={`Separa ${PORTAL_TAGS[s.listing.portal]}`}
                      title="Non è lo stesso immobile: mostralo come lead a sé"
                      onClick={() => onSplit(s.listing.key)}
                    >
                      Separa
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
```

In un gruppo di due, "Separa" su una qualsiasi delle due fonti scioglie il gruppo; in un gruppo di tre stacca solo quella fonte.

- [ ] **Step 5: `App`**

In `src/ui/sidepanel/App.tsx`:

- Import: aggiungi `leadKeys`, `leadPortals` da `@/core/leads`.
- Sostituisci `byPortals`:

```ts
/** Filtro per sito: lista vuota = tutti i siti. Un lead unito passa se ha una fonte su uno dei siti scelti. */
const byPortals = (leads: LeadView[], ps: Portal[]) => (ps.length ? leads.filter((l) => leadPortals(l).some((p) => ps.includes(p))) : leads);
const byMulti = (leads: LeadView[], on: boolean) => (on ? leads.filter((l) => l.others.length > 0) : leads);
```

- Stato: `const [multi, setMulti] = useState(false);` accanto a `portals`.
- `const inPortals = byMulti(byPortals(tabLeads(tab), portals), multi);`
- `tagParts`: dopo la parte dei portali aggiungi `...(multi ? ['su più portali'] : []),`.
- `anyFilter`: aggiungi `|| multi`. `resetFilters`: aggiungi `setMulti(false);`. Dipendenze dell'`useEffect` di `setConfirmingAll`: aggiungi `multi`.
- Conteggio della pillola di ogni portale: `const count = byFilter(byMulti(tabLeads(tab), multi), filter).filter((l) => leadPortals(l).includes(p)).length;`
- Dopo il `map` dei portali, dentro il gruppo "Filtra per sito":

```tsx
                {(() => {
                  const count = byFilter(byPortals(tabLeads(tab), portals), filter).filter((l) => l.others.length > 0).length;
                  return (
                    <button
                      type="button"
                      aria-pressed={multi}
                      aria-label={`Su più portali (${count})`}
                      className={`chip${multi ? ' chip--on' : ''}`}
                      disabled={count === 0 && !multi}
                      onClick={() => setMulti((m) => !m)}
                    >
                      Su più portali <span className="chip__count">{count}</span>
                    </button>
                  );
                })()}
```

- Eliminazione di massa: `run(() => api.deleteListings(visible.flatMap(leadKeys)))`.
- `LeadItem`:

```tsx
                        <LeadItem
                          key={l.listing.key}
                          lead={l}
                          now={now}
                          onChange={(patch) => run(() => api.setLeadState(leadKeys(l), patch))}
                          onDelete={() => run(() => api.deleteListings(leadKeys(l)))}
                          onSplit={(key) => run(() => api.splitListing(key, leadKeys(l).filter((k) => k !== key)))}
                        />
```

- [ ] **Step 6: Stili**

In `src/ui/sidepanel/styles.css`, accanto alle regole di `.lead__market` (stessa sezione), aggiungi usando le variabili di colore già usate dal file (sostituisci i nomi delle variabili con quelli presenti, ad esempio quelli di `.portal-tag` e `.pill`):

```css
.pill--multi {
  background: var(--chip-bg);
  color: var(--text);
}

.sources {
  margin-top: 6px;
}

.sources__list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.sources__item {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sources__facts {
  flex: 1;
  font-size: 12px;
  color: var(--muted);
}
```

- [ ] **Step 7: Verifica**

Run: `npx vitest run tests/unit/core/lead-filters.test.ts tests/unit/ui/sidepanel.test.tsx` → PASS.
Run: `npm run typecheck` → nessun errore.

- [ ] **Step 8: Commit**

```bash
git add src/core/lead-filters.ts src/ui/sidepanel/LeadItem.tsx src/ui/sidepanel/App.tsx src/ui/sidepanel/styles.css tests/unit/core/lead-filters.test.ts tests/unit/ui/sidepanel.test.tsx
git commit -F - <<'EOF'
feat(sidepanel): fonti del lead unito, separazione e filtro "Su più portali"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Export

**Files:**
- Modify: `src/core/export.ts`
- Test: `tests/unit/core/export.test.ts`

**Interfaces:**
- Consumes: `leadPortals` (Task 5).
- Produces: colonna `'Altri URL'` subito dopo `'URL'` in `EXPORT_COLUMNS`.

- [ ] **Step 1: Scrivi il test che fallisce**

In `tests/unit/core/export.test.ts`, dentro `describe('toExportRows', …)`:

```ts
  it('lead unito: tutti i portali e gli altri URL', () => {
    const other = { ...lead.listing, key: 'idealista:2', portal: 'idealista' as const, portalId: 2, url: 'https://www.idealista.it/immobile/2/' };
    const row = toExportRows([{ ...lead, others: [{ listing: other, evaluation: lead.evaluation, prices: [] }] }])[0]!;
    expect(row['Portale']).toBe('Immobiliare.it, Idealista.it');
    expect(row['URL']).toBe('https://www.immobiliare.it/annunci/128416572/');
    expect(row['Altri URL']).toBe('https://www.idealista.it/immobile/2/');
    expect(EXPORT_COLUMNS.indexOf('Altri URL')).toBe(EXPORT_COLUMNS.indexOf('URL') + 1);
    expect(toExportRows([lead])[0]!['Altri URL']).toBe('');
  });
```

Run: `npx vitest run tests/unit/core/export.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implementa**

In `src/core/export.ts`:

- Import: `leadPortals` da `@/core/leads` (accanto a `priorityLabel`, `STATUS_LABELS`).
- In `EXPORT_COLUMNS` sostituisci `'Note', 'URL',` con `'Note', 'URL', 'Altri URL',`.
- In `toExportRows` cambia la destrutturazione in `leads.map((view) => { const { listing: l, evaluation: e, state: s, market, others } = view; return { … }; })` e:

```ts
    'Portale': leadPortals(view).map((p) => PORTAL_SITES[p]).join(', '),
```

  e, dopo `'URL': l.url,`:

```ts
    'Altri URL': others.map((o) => o.listing.url).join(' '),
```

- [ ] **Step 3: Verifica**

Run: `npx vitest run tests/unit/core/export.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/export.ts tests/unit/core/export.test.ts
git commit -F - <<'EOF'
feat(export): una riga per lead unito con tutti i portali e gli altri URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Informativa, documenti e verifica finale

**Files:**
- Modify: `src/core/onboarding.ts`, `src/ui/onboarding/Onboarding.tsx`
- Modify: `tests/unit/core/onboarding.test.ts`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`

**Interfaces:**
- Produces: `ONBOARDING_VERSION = 3`, `ONBOARDING_CHANGES[3]`.

- [ ] **Step 1: Test dell'informativa (fallisce)**

In `tests/unit/core/onboarding.test.ts` sostituisci il blocco `describe('informativa v2', …)` con:

```ts
describe('informativa', () => {
  it('la versione 2 annuncia le date di ricontatto', () => {
    expect(ONBOARDING_CHANGES[2]).toEqual([
      'HomeRadar ora salva la data di ricontatto che imposti su un lead: resta sul tuo browser, come stati e note.',
    ]);
  });

  it('la versione 3 annuncia lo stesso immobile su più portali', () => {
    expect(ONBOARDING_VERSION).toBe(3);
    expect(ONBOARDING_CHANGES[3]).toEqual([
      'HomeRadar ora riconosce lo stesso immobile pubblicato su più portali e lo mostra come un solo lead. Se separi due annunci uniti per errore, la scelta resta salvata sul tuo browser.',
    ]);
  });
});
```

Run: `npx vitest run tests/unit/core/onboarding.test.ts` → FAIL.

- [ ] **Step 2: Implementa**

In `src/core/onboarding.ts`: `export const ONBOARDING_VERSION = 3;` e in `ONBOARDING_CHANGES`:

```ts
  3: ['HomeRadar ora riconosce lo stesso immobile pubblicato su più portali e lo mostra come un solo lead. Se separi due annunci uniti per errore, la scelta resta salvata sul tuo browser.'],
```

In `src/ui/onboarding/Onboarding.tsx`, nella lista "Cosa salva", dopo la voce sullo stato, le date di ricontatto e le note:

```tsx
          <li>
            Quando lo stesso immobile compare su più portali, HomeRadar lo riconosce confrontando città, m², locali e prezzo e
            lo mostra come un solo lead. Se separi due annunci uniti per errore, la scelta viene salvata.
          </li>
```

Nella legenda, dopo la voce `−8%`:

```tsx
          <li>
            <Badge priority="medium">· 2 portali</Badge>
            <span>lo stesso immobile è pubblicato su più portali: età, priorità e ribasso valgono per tutto il gruppo.</span>
          </li>
```

- [ ] **Step 3: Smoke test**

In `docs/smoke-test.md`, dopo la sezione "Prezzo rispetto alla zona" e prima della riga "Se il sito è cambiato", aggiungi (continua la numerazione: il punto precedente è il 47):

```markdown
## Stesso immobile su più portali

48. Trova un privato pubblicato sia su Immobiliare sia su Idealista (o Subito): cerca la stessa via o lo stesso titolo con filtro "privati" su entrambi i siti e apri le due ricerche.
    - [ ] Nel pannello compare un solo lead, con le etichette dei due portali e "Su 2 portali".
    - [ ] Sulla card di Idealista (o Subito) il badge finisce con "· 2 portali" e mostra la stessa età del badge su Immobiliare.
49. Cambia lo stato del lead unito in "Contattato" e scrivi una nota.
    - [ ] "Fonti (2)" mostra le due fonti con prezzo, m² ed età; "Apri" porta all'annuncio giusto.
50. Premi "Separa" su una delle due fonti.
    - [ ] I lead diventano due, entrambi "Contattato" e con la nota; ricaricando le due ricerche non si riuniscono.
51. Esporta CSV con un lead unito nella vista.
    - [ ] Una riga per il lead, "Portale" con entrambi i siti, "Altri URL" con il link dell'altro annuncio.
52. Impostazioni → "Rivedi informativa" (da un'installazione con l'informativa già confermata alla versione precedente, al primo avvio del pannello).
    - [ ] Il pannello chiede di riconfermare; "Cosa è cambiato" cita lo stesso immobile su più portali; la legenda ha "· 2 portali".
```

- [ ] **Step 4: CLAUDE.md**

In `CLAUDE.md`, nella voce di `src/core/`, dopo la descrizione di `market.ts`, aggiungi:

```markdown
`same-property.ts` (stesso immobile su portali diversi: città, m² ±5% o 3 m², prezzo ±5%, locali; un annuncio per portale; le coppie separate dall'agente stanno nella tabella `splits` e nel backup), `lead-groups.ts` (costruisce i `LeadView`: principale, `others`, valutazione con `evaluateGroup` e stato del gruppo; stato e note restano per annuncio e si scrivono su tutto il gruppo),
```

e cambia la descrizione di `market.ts` aggiungendo "un annuncio per immobile".

- [ ] **Step 5: Verifica completa**

Run: `npm run typecheck` → nessun errore.
Run: `npm test` → tutti PASS.
Run: `npm run build` → build in `.output/chrome-mv3` senza errori.
Run: `npm run test:e2e` → PASS (le fixture e2e non hanno gruppi: i badge non devono cambiare).

- [ ] **Step 6: Commit**

```bash
git add src/core/onboarding.ts src/ui/onboarding/Onboarding.tsx tests/unit/core/onboarding.test.ts docs/smoke-test.md CLAUDE.md
git commit -F - <<'EOF'
docs: informativa v3, smoke test e CLAUDE.md per lo stesso immobile su più portali

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Dopo questo task: l'agente esegue i punti 48–52 dello smoke test su `.output/chrome-mv3`; poi push, PR, e nella stessa PR la riga 6 di `docs/roadmap.md` passa a "fatto" con il link.
