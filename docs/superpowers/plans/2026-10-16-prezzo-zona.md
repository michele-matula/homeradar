# Prezzo al m² rispetto alla zona — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** segnalare nel pannello i lead il cui €/m² supera di almeno il 10% la mediana dei privati già visti nella stessa zona (o città), con ordinamento ed export.

**Architecture:** modulo puro `src/core/market.ts` che, dall'elenco completo dei `ListingRecord`, calcola per ogni lead un `MarketComparison` (mediana di zona escluso il lead, ripiego sulla città). `LeadService.listLeads()` lo assegna a `LeadView.market` prima di filtrare i lead visibili. Pannello, ordinamento ed export leggono quel campo. Niente di nuovo salvato.

**Tech Stack:** TypeScript, React (side panel), Vitest + Testing Library, Dexie (fake-indexeddb nei test).

**Spec:** `docs/superpowers/specs/2026-10-16-prezzo-zona-design.md`

## Global Constraints

- Campione: solo `ListingRecord` salvati (tutti privati), qualunque stato del lead.
- Valido se `currentPrice != null`, `surfaceM2 >= 20`, `300 <= currentPrice / surfaceM2 <= 30000`, `normalize(city)` non vuota.
- Chiavi: `cityKey = normalize(city)`, `zoneKey = cityKey + '|' + normalize(zone)` (solo se la zona normalizzata non è vuota). `normalize` da `src/core/lead-filters.ts`. Portali uniti.
- Zona se restano almeno 5 valori escluso il lead (`MIN_ZONE_SAMPLE = 5`), altrimenti città con almeno 8 (`MIN_CITY_SAMPLE = 8`), altrimenti nessun confronto.
- Mediana: valore centrale; con numero pari, media dei due centrali. `deltaPercent = (perM2 / mediana − 1) × 100`, non arrotondato.
- Si mostra se `deltaPercent >= 10` (`ABOVE_MARKET_PERCENT = 10`). Priorità, badge sulle card e filtri non cambiano.
- Nessun cambio a schema Dexie, formato di backup, messaggi. `ONBOARDING_VERSION` resta 2.
- Testi in italiano. Etichetta "+18% su Navigli". Nota: "Mediana dei privati visti in zona Navigli (Milano): 4.200 €/m² su 7 annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto." (città: "Mediana dei privati visti a Bologna: …").
- Export: colonne "Sopra mercato %" e "Confronto mercato" subito dopo "Calo %".
- File CRLF nel repo: modificare con l'Edit tool, non con `sed`. Messaggi di commit con heredoc in Bash.

## Review Focus

- Valori duplicati nel gruppo (molti annunci con lo stesso €/m²): l'esclusione del lead ne toglie una sola occorrenza, la mediana resta quel valore → scarto 0, nessuna etichetta. Test in Task 1.
- Lead "Nuovo" senza segnali (non restituiti da `listLeads`) devono comunque contare nel campione degli altri. Test in Task 2.
- Zona scritta diversamente tra portali (maiuscole, accenti, apostrofi): stesso gruppo; l'etichetta usa la scrittura del lead. Test in Task 1.
- Fumetto della nota tagliato dal `overflow: hidden` della card, soprattutto sui lead "Scartato" (senza riga dei richiami sotto). CSS in Task 4 + punto di smoke test in Task 5.
- Lead appena sotto soglia (scarto 9,96%, arrotondato "10") non deve mostrare l'etichetta né la colonna dell'export. Test in Task 3 e Task 4.

---

### Task 1: modulo `market.ts` (calcolo puro)

**Files:**
- Modify: `src/shared/types.ts` (aggiunge `MarketComparison`)
- Create: `src/core/market.ts`
- Test: `tests/unit/core/market.test.ts`

**Interfaces:**
- Produces (da `src/shared/types.ts`):
  ```ts
  export interface MarketComparison {
    scope: 'zone' | 'city';
    label: string;      // zona o città come la scrive il portale del lead (trim)
    city: string;       // città del lead (trim)
    medianPerM2: number;
    sampleSize: number; // valori usati per la mediana, escluso il lead
    deltaPercent: number;
  }
  ```
- Produces (da `src/core/market.ts`): `MIN_ZONE_SAMPLE`, `MIN_CITY_SAMPLE`, `ABOVE_MARKET_PERCENT`, `validPerM2(l: ListingRecord): number | null`, `compareToMarket(listings: ListingRecord[]): Map<string, MarketComparison>` (chiave `listing.key`), `isAboveMarket(m: MarketComparison | null): m is MarketComparison`, `aboveMarketText(m): string` ("+18% su Navigli"), `marketExplanation(m): string` (testo della nota), `marketSummary(m): string` (testo dell'export, "Navigli (Milano), 7 annunci, 4.200 €/m²").

- [ ] **Step 1: aggiungi il tipo**

In `src/shared/types.ts`, subito prima di `export interface LeadView {`:

```ts
/** Confronto del €/m² di un lead con la mediana dei privati visti nella stessa zona o città. Calcolato, mai salvato. */
export interface MarketComparison {
  scope: 'zone' | 'city';
  /** Zona o città come la scrive il portale del lead. */
  label: string;
  /** Città del lead, per il testo della zona. */
  city: string;
  medianPerM2: number;
  /** Annunci usati per la mediana, escluso il lead. */
  sampleSize: number;
  deltaPercent: number;
}

```

- [ ] **Step 2: scrivi i test**

`tests/unit/core/market.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aboveMarketText, compareToMarket, isAboveMarket, marketExplanation, marketSummary, validPerM2 } from '@/core/market';
import type { ListingRecord, MarketComparison } from '@/shared/types';

let n = 0;
/** Annuncio di 100 m²: il prezzo è €/m² × 100. */
function rec(perM2: number | null, o: Partial<ListingRecord> = {}): ListingRecord {
  const id = ++n;
  return {
    key: `immobiliare:${id}`, portal: 'immobiliare', portalId: id, url: '', title: '', address: null,
    city: 'Milano', zone: 'Navigli', typology: null, surfaceM2: 100, rooms: null,
    currentPrice: perM2 == null ? null : perM2 * 100, portalCreatedAt: null, estimatedCreatedAt: null,
    lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 1, ...o,
  };
}
const many = (values: number[], o: Partial<ListingRecord> = {}) => values.map((v) => rec(v, o));

describe('validPerM2', () => {
  it('scarta prezzo mancante, superficie piccola o mancante e valori fuori intervallo', () => {
    expect(validPerM2(rec(4000))).toBe(4000);
    expect(validPerM2(rec(null))).toBeNull();
    expect(validPerM2(rec(4000, { surfaceM2: null }))).toBeNull();
    expect(validPerM2(rec(4000, { surfaceM2: 19, currentPrice: 76000 }))).toBeNull();
    expect(validPerM2(rec(4000, { surfaceM2: 20, currentPrice: 80000 }))).toBe(4000);
    expect(validPerM2(rec(299))).toBeNull();
    expect(validPerM2(rec(300))).toBe(300);
    expect(validPerM2(rec(30000))).toBe(30000);
    expect(validPerM2(rec(30001))).toBeNull();
  });
});

describe('compareToMarket', () => {
  it('confronta con la mediana della zona, escluso il lead (dispari)', () => {
    const x = rec(5500);
    const m = compareToMarket([x, ...many([4000, 4200, 4400, 4600, 4800])]).get(x.key)!;
    expect(m).toMatchObject({ scope: 'zone', label: 'Navigli', city: 'Milano', medianPerM2: 4400, sampleSize: 5 });
    expect(m.deltaPercent).toBeCloseTo(25);
  });

  it('con un numero pari di valori usa la media dei due centrali', () => {
    const x = rec(5000);
    const m = compareToMarket([x, ...many([4000, 4100, 4200, 4400, 4600, 4800])]).get(x.key)!;
    expect(m.medianPerM2).toBe(4300);
    expect(m.sampleSize).toBe(6);
  });

  it('con valori uguali toglie una sola occorrenza: scarto 0', () => {
    const all = many([4000, 4000, 4000, 4000, 4000, 4000]);
    const result = compareToMarket(all);
    for (const l of all) expect(result.get(l.key)).toMatchObject({ medianPerM2: 4000, sampleSize: 5, deltaPercent: 0 });
  });

  it('il lead stesso non entra nella propria mediana', () => {
    // Con il lead (9000) i valori sarebbero 6 e la mediana 4500; senza, 5 valori e mediana 4400.
    const x = rec(9000);
    expect(compareToMarket([x, ...many([4000, 4200, 4400, 4600, 4800])]).get(x.key)!.medianPerM2).toBe(4400);
  });

  it('con meno di 5 annunci in zona ripiega sulla città (almeno 8)', () => {
    const x = rec(5000);
    const zone = many([4000, 4000, 4000]);
    const brera = many([6000, 6000, 6000, 6000, 6000, 6000, 6000, 6000], { zone: 'Brera' });
    const m = compareToMarket([x, ...zone, ...brera]).get(x.key)!;
    expect(m).toMatchObject({ scope: 'city', label: 'Milano', city: 'Milano', medianPerM2: 6000, sampleSize: 11 });
    expect(m.deltaPercent).toBeCloseTo(-16.667, 2);
  });

  it('senza zona usa la città', () => {
    const x = rec(5000, { zone: null });
    const m = compareToMarket([x, ...many([4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000])]).get(x.key)!;
    expect(m.scope).toBe('city');
  });

  it('nessun confronto se anche la città ha meno di 8 annunci', () => {
    const x = rec(5000);
    const result = compareToMarket([x, ...many([4000, 4000, 4000, 4000], { zone: 'Brera' }), ...many([4000, 4000, 4000])]);
    expect(result.has(x.key)).toBe(false);
  });

  it('gli annunci non validi non contano e non hanno confronto', () => {
    const x = rec(5000);
    const bad = [rec(null), rec(100), rec(40000), rec(4000, { surfaceM2: 10, currentPrice: 40000 }), rec(4000, { city: null })];
    const result = compareToMarket([x, ...many([4000, 4000, 4000, 4000]), ...bad]);
    expect(result.has(x.key)).toBe(false);
    for (const b of bad) expect(result.has(b.key)).toBe(false);
  });

  it('senza città non c\'è confronto anche se la zona ha abbastanza annunci', () => {
    const x = rec(5000, { city: null });
    const result = compareToMarket([x, ...many([4000, 4000, 4000, 4000, 4000], { city: null })]);
    expect(result.size).toBe(0);
  });

  it('unisce le zone scritte in modo diverso dai portali; l\'etichetta è quella del lead', () => {
    const x = rec(5000, { zone: "Sant'Ambrogio", city: 'Milano' });
    const others = [
      rec(4000, { portal: 'subito', zone: 'sant ambrogio', city: 'MILANO' }),
      rec(4000, { portal: 'idealista', zone: 'Sant’Ambrogio', city: 'milano' }),
      rec(4000, { zone: 'SANT AMBROGIO ' }),
      rec(4000, { zone: 'Sànt Ambrogio' }),
      rec(4000, { zone: "Sant'Ambrogio" }),
    ];
    expect(compareToMarket([x, ...others]).get(x.key)).toMatchObject({ scope: 'zone', label: "Sant'Ambrogio", sampleSize: 5 });
  });
});

const zoneCmp = (deltaPercent: number): MarketComparison => ({ scope: 'zone', label: 'Navigli', city: 'Milano', medianPerM2: 4200.4, sampleSize: 7, deltaPercent });
const cityCmp: MarketComparison = { scope: 'city', label: 'Bologna', city: 'Bologna', medianPerM2: 3100, sampleSize: 12, deltaPercent: 18 };

describe('testi', () => {
  it('sopra mercato da +10% in su', () => {
    expect(isAboveMarket(null)).toBe(false);
    expect(isAboveMarket(zoneCmp(9.96))).toBe(false);
    expect(isAboveMarket(zoneCmp(10))).toBe(true);
  });

  it('etichetta, nota e riepilogo per zona e città', () => {
    expect(aboveMarketText(zoneCmp(18.4))).toBe('+18% su Navigli');
    expect(marketExplanation(zoneCmp(18.4))).toBe(
      "Mediana dei privati visti in zona Navigli (Milano): 4.200 €/m² su 7 annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto.",
    );
    expect(marketExplanation(cityCmp)).toBe(
      "Mediana dei privati visti a Bologna: 3.100 €/m² su 12 annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto.",
    );
    expect(marketSummary(zoneCmp(18.4))).toBe('Navigli (Milano), 7 annunci, 4.200 €/m²');
    expect(marketSummary(cityCmp)).toBe('Bologna, 12 annunci, 3.100 €/m²');
  });
});
```

- [ ] **Step 3: verifica che falliscano**

Run: `npx vitest run tests/unit/core/market.test.ts`
Expected: FAIL, "Failed to resolve import "@/core/market"".

- [ ] **Step 4: implementa**

`src/core/market.ts`:

```ts
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

function entryOf(listing: ListingRecord): Entry | null {
  const perM2 = validPerM2(listing);
  const cityKey = normalize(listing.city ?? '');
  if (perM2 == null || !cityKey) return null;
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
```

- [ ] **Step 5: verifica che passino**

Run: `npx vitest run tests/unit/core/market.test.ts`
Expected: PASS (tutti). Se il test "Sant'Ambrogio" fallisce per l'apostrofo tipografico `’`, controlla che `normalize` lo trasformi in spazio (lo fa: non è lettera né cifra).

- [ ] **Step 6: commit**

```bash
git add src/shared/types.ts src/core/market.ts tests/unit/core/market.test.ts
git commit -F - <<'EOF'
feat(market): mediana €/m² per zona e città dai privati salvati

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `LeadView.market` calcolato in `listLeads()`

**Files:**
- Modify: `src/shared/types.ts` (`LeadView`)
- Modify: `src/core/service.ts:106-129` (`listLeads`)
- Modify (builder dei test): `tests/unit/core/leads.test.ts:5-12`, `tests/unit/core/export.test.ts:6-20`, `tests/unit/core/lead-filters.test.ts:7-13`, `tests/unit/ui/sidepanel.test.tsx:15-33`
- Test: `tests/unit/core/service.leads.test.ts`

**Interfaces:**
- Consumes: `compareToMarket` (Task 1).
- Produces: `LeadView.market: MarketComparison | null`.

- [ ] **Step 1: test del service**

In `tests/unit/core/service.leads.test.ts`, dentro `describe('LeadService.listLeads', …)` aggiungi:

```ts
  it('confronta il €/m² con tutto l\'archivio, anche con gli annunci non mostrati', async () => {
    const { svc } = setup();
    // Lead Alta: 235.000 € su 62 m² ≈ 3.790 €/m². Altri 5 privati della zona a 3.000 €/m², senza segnali.
    await svc.ingest([obs(), ...[1, 2, 3, 4, 5].map((i) => obs({ portalId: 131597836 + i, lastDrop: null, price: 186000 }))]);
    const leads = await svc.listLeads();
    expect(leads.map((l) => l.listing.portalId)).toEqual([128416572]);
    expect(leads[0]!.market).toMatchObject({ scope: 'zone', label: 'Precotto', medianPerM2: 3000, sampleSize: 5 });
    expect(leads[0]!.market!.deltaPercent).toBeCloseTo(26.34, 1);
  });

  it('senza abbastanza annunci il confronto è null', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    expect((await svc.listLeads())[0]!.market).toBeNull();
  });
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.leads.test.ts`
Expected: FAIL (`market` è `undefined`).

- [ ] **Step 3: aggiungi il campo e calcolalo**

In `src/shared/types.ts`, in `LeadView`, dopo `prices: PriceSnapshot[];`:

```ts
  /** Confronto con la mediana €/m² della zona o della città; null se il campione non basta. */
  market: MarketComparison | null;
```

In `src/core/service.ts` aggiungi l'import `import { compareToMarket } from '@/core/market';` accanto agli altri import di `@/core/…`, e in `listLeads()` sostituisci il blocco `const views = listings.map(...)` con:

```ts
    // Mediana sull'archivio intero, prima di nascondere i lead senza segnali: anche loro sono prezzi della zona.
    const market = compareToMarket(listings);
    const views = listings.map((listing): LeadView => {
      const prices = (snapsByKey.get(listing.key) ?? []).sort((a, b) => a.at - b.at);
      return {
        listing,
        evaluation: evaluate(listing, prices, settings, now),
        state: stateByKey.get(listing.key) ?? { listingKey: listing.key, status: 'new', notes: '', statusChangedAt: listing.firstSeenAt, updatedAt: listing.firstSeenAt, recallAt: null },
        prices,
        market: market.get(listing.key) ?? null,
      };
    });
```

- [ ] **Step 4: aggiorna i builder dei test**

Aggiungi `market: null,` dopo `prices: …,` nei quattro builder:
- `tests/unit/core/leads.test.ts`, funzione `lead` (dopo `prices: [],`);
- `tests/unit/core/export.test.ts`, costante `lead` (dopo `prices: [],`);
- `tests/unit/core/lead-filters.test.ts`, funzione `lead` (dopo `prices: [],`);
- `tests/unit/ui/sidepanel.test.tsx`, funzione `lead` (dopo la chiusura dell'array `prices: [ … ],`).

- [ ] **Step 5: verifica**

Run: `npx vitest run tests/unit/core/service.leads.test.ts && npm run typecheck`
Expected: PASS e nessun errore di tipi. Se `typecheck` segnala altri punti che costruiscono `LeadView` (non dovrebbero esserci: l'unico in `src/` è `listLeads`), aggiungi `market: null` lì.

- [ ] **Step 6: commit**

```bash
git add src/shared/types.ts src/core/service.ts tests/unit
git commit -F - <<'EOF'
feat(leads): confronto col mercato della zona su ogni lead

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: ordinamento "Sopra mercato" ed export

**Files:**
- Modify: `src/core/leads.ts:27-57` (`SortKey`, `SORT_KEYS`, `SORT_LABELS`, `SORT_VALUES`)
- Modify: `src/core/export.ts:7-11` e `toExportRows`
- Test: `tests/unit/core/leads.test.ts`, `tests/unit/core/export.test.ts`

**Interfaces:**
- Consumes: `LeadView.market` (Task 2); `isAboveMarket`, `marketSummary` (Task 1).
- Produces: `SortKey` `'above_market'` (etichetta "Sopra mercato"); colonne `'Sopra mercato %'`, `'Confronto mercato'`.

- [ ] **Step 1: test dell'ordinamento**

In `tests/unit/core/leads.test.ts`, nell'interfaccia `Fields` aggiungi `above?: number | null;` e in `item` aggiungi al return:

```ts
    market: f.above == null ? null : { scope: 'zone', label: 'Z', city: 'C', medianPerM2: 1, sampleSize: 5, deltaPercent: f.above },
```

Poi, dentro `describe('sortLeadsBy', …)`:

```ts
  it('"Sopra mercato": scarto più alto prima, anche sotto il 10%; senza confronto in fondo', () => {
    const ls = [item('a', { above: 12 }), item('b', { above: -5 }), item('c', {}), item('d', { above: 30 })];
    expect(keys(sortLeadsBy(ls, 'above_market'))).toEqual(['d', 'a', 'b', 'c']);
  });
```

- [ ] **Step 2: test dell'export**

In `tests/unit/core/export.test.ts`, nel test `'mappa tutte le colonne'`, dopo `'Calo %': 5.6,` aggiungi `'Sopra mercato %': '', 'Confronto mercato': '',`. Poi aggiungi in `describe('toExportRows', …)`:

```ts
  it('colonne del mercato solo da +10% in su', () => {
    const market = { scope: 'zone' as const, label: 'Precotto', city: 'Milano', medianPerM2: 4200, sampleSize: 7, deltaPercent: 18.4 };
    const row = toExportRows([{ ...lead, market }])[0]!;
    expect(row['Sopra mercato %']).toBe(18);
    expect(row['Confronto mercato']).toBe('Precotto (Milano), 7 annunci, 4.200 €/m²');
    expect(EXPORT_COLUMNS.indexOf('Sopra mercato %')).toBe(EXPORT_COLUMNS.indexOf('Calo %') + 1);
    const below = toExportRows([{ ...lead, market: { ...market, deltaPercent: 9.96 } }])[0]!;
    expect(below['Sopra mercato %']).toBe('');
    expect(below['Confronto mercato']).toBe('');
  });
```

- [ ] **Step 3: verifica che falliscano**

Run: `npx vitest run tests/unit/core/leads.test.ts tests/unit/core/export.test.ts`
Expected: FAIL (chiave e colonne sconosciute).

- [ ] **Step 4: implementa l'ordinamento**

In `src/core/leads.ts`:
- `SortKey`: aggiungi `| 'above_market'` dopo `'price_m2'`;
- `SORT_KEYS`: aggiungi `'above_market'` dopo `'price_m2'`;
- `SORT_LABELS`: dopo `price_m2: '€/m² più basso',` aggiungi `above_market: 'Sopra mercato',`;
- `SORT_VALUES`: dopo `price_m2: [pricePerM2, 1],` aggiungi `above_market: [(l) => l.market?.deltaPercent ?? null, -1],`.

- [ ] **Step 5: implementa l'export**

In `src/core/export.ts`:
- import: `import { isAboveMarket, marketSummary } from '@/core/market';`
- `EXPORT_COLUMNS`: inserisci `'Sopra mercato %', 'Confronto mercato',` subito dopo `'Calo %',`;
- in `toExportRows` destruttura anche `market` (`({ listing: l, evaluation: e, state: s, market })`) e dopo `'Calo %': e.dropPercent || '',` aggiungi:

```ts
    'Sopra mercato %': isAboveMarket(market) ? Math.round(market.deltaPercent) : '',
    'Confronto mercato': isAboveMarket(market) ? marketSummary(market) : '',
```

- [ ] **Step 6: verifica**

Run: `npx vitest run tests/unit/core/leads.test.ts tests/unit/core/export.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add src/core/leads.ts src/core/export.ts tests/unit/core/leads.test.ts tests/unit/core/export.test.ts
git commit -F - <<'EOF'
feat(leads): ordinamento "Sopra mercato" e colonne del mercato nell'export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: etichetta e nota sul lead nel pannello

**Files:**
- Modify: `src/ui/sidepanel/LeadItem.tsx`
- Modify: `src/ui/sidepanel/styles.css` (sezione "Lead")
- Test: `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `isAboveMarket`, `aboveMarketText`, `marketExplanation` (Task 1); `InfoTip` (`src/ui/sidepanel/InfoTip.tsx`, props `label`, `children`).

- [ ] **Step 1: test**

In `tests/unit/ui/sidepanel.test.tsx`, dentro `describe('LeadItem', …)`:

```ts
  it('mostra "sopra mercato" con la spiegazione solo da +10%', () => {
    const market = { scope: 'zone' as const, label: 'Navigli', city: 'Milano', medianPerM2: 4200, sampleSize: 7, deltaPercent: 18.4 };
    render(<ul><LeadItem lead={{ ...lead(1, 'high'), market }} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('+18% su Navigli')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Informazioni: Sopra mercato' })).toBeTruthy();
    expect(screen.getByText(/Mediana dei privati visti in zona Navigli \(Milano\): 4\.200 €\/m² su 7 annunci/)).toBeTruthy();
    cleanup();
    render(<ul><LeadItem lead={{ ...lead(1, 'high'), market: { ...market, deltaPercent: 9.96 } }} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByText(/su Navigli/)).toBeNull();
    cleanup();
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByRole('button', { name: 'Informazioni: Sopra mercato' })).toBeNull();
  });
```

- [ ] **Step 2: verifica che fallisca**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx -t "sopra mercato"`
Expected: FAIL (testo non trovato).

- [ ] **Step 3: implementa**

In `src/ui/sidepanel/LeadItem.tsx`:
- import: `import { aboveMarketText, isAboveMarket, marketExplanation } from '@/core/market';` e `import { InfoTip } from './InfoTip';`
- destruttura anche `market`: `const { listing, evaluation, state, prices, market } = lead;`
- subito dopo `<div className="lead__meta">…</div>`:

```tsx
      {isAboveMarket(market) && (
        <div className="lead__market">
          <span className="market-tag">{aboveMarketText(market)}</span>
          <InfoTip label="Sopra mercato">{marketExplanation(market)}</InfoTip>
        </div>
      )}
```

In `src/ui/sidepanel/styles.css`, dopo la riga `.lead__meta { … }`:

```css
/* Riga "sopra mercato": il fumetto della nota si apre sotto la riga, largo quanto la card. */
.lead__market { position: relative; display: flex; align-items: center; gap: 6px; margin: -4px 0 10px; }
.market-tag {
  font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--medium-border); background: var(--medium-soft); color: var(--medium);
}
/* La card taglia ciò che esce (striscia colorata a sinistra): con la nota aperta la lascia uscire. */
.lead:has(.lead__market .info__tip:not([hidden])) { overflow: visible; z-index: 2; }
```

- [ ] **Step 4: verifica**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/ui/sidepanel/LeadItem.tsx src/ui/sidepanel/styles.css tests/unit/ui/sidepanel.test.tsx
git commit -F - <<'EOF'
feat(sidepanel): etichetta "sopra mercato" con la mediana di confronto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: legenda dell'informativa e documenti

**Files:**
- Modify: `src/ui/onboarding/Onboarding.tsx` (sezione "Come leggere i badge")
- Modify: `src/ui/onboarding/onboarding.css`
- Modify: `docs/smoke-test.md` (nuova sezione prima della riga finale "Se il sito è cambiato…")
- Modify: `CLAUDE.md` (elenco dei moduli di `src/core/`)
- Test: `tests/unit/ui/onboarding.test.tsx`

- [ ] **Step 1: test**

In `tests/unit/ui/onboarding.test.tsx`, nel test `'mostra informativa e legenda con le soglie attuali delle impostazioni'`, dopo le asserzioni esistenti e con lo stesso stile di query del file, aggiungi:

```ts
    expect(screen.getByText('+18% su Navigli')).toBeTruthy();
    expect(screen.getByText(/sopra la mediana degli annunci di privati che hai visto nella stessa zona/)).toBeTruthy();
```

Run: `npx vitest run tests/unit/ui/onboarding.test.tsx` → FAIL.

- [ ] **Step 2: implementa la riga di legenda**

In `src/ui/onboarding/Onboarding.tsx`, nella `<ul className="legend">`, dopo la riga del ribasso (`−8%`) e prima di quella dell'icona (`3`):

```tsx
          <li>
            <span className="legend__market">+18% su Navigli</span>
            <span>
              nel pannello: €/m² sopra la mediana degli annunci di privati che hai visto nella stessa zona (o città, se in zona
              sono pochi). È un'indicazione, non una valutazione.
            </span>
          </li>
```

In `src/ui/onboarding/onboarding.css`, dopo `.legend li { … }`:

```css
.legend__market {
  font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--medium-border); background: var(--medium-soft); color: var(--medium);
}
```

Verifica che `--medium-border` e `--medium-soft` siano definite anche nella pagina di onboarding (`grep -rn "medium-soft" src/ui src/entrypoints`). Se la pagina non carica `styles.css` del pannello, usa i colori di `BADGE_COLORS.medium` come fa `Badge` nello stesso file: `<span className="legend__market" style={toReactStyle({ ...BADGE_LOOK, ...BADGE_COLORS.medium }) as CSSProperties}>` e niente regola CSS.

Run: `npx vitest run tests/unit/ui/onboarding.test.tsx` → PASS. `ONBOARDING_VERSION` resta 2.

- [ ] **Step 3: smoke test**

In `docs/smoke-test.md`, prima della riga "Se il sito è cambiato: …", aggiungi:

```markdown
## Prezzo rispetto alla zona

44. Su Immobiliare, cerca in una città con filtro "privati" e scorri qualche pagina finché il pannello ha almeno 6 privati con m² nella stessa zona (oppure 9 nella stessa città).
    - [ ] Su qualche lead compare "+N% su <zona>" (o "su <città>"); mai sotto il 10%.
    - [ ] L'icona "i" accanto apre la nota: zona, mediana €/m², numero di annunci, "È un'indicazione, non una valutazione". La nota si legge per intero, anche su un lead "Scartato".
45. Ordina per "Sopra mercato".
    - [ ] In cima i lead con la percentuale più alta; i lead senza etichetta seguono, quelli senza m² in fondo.
46. Esporta CSV.
    - [ ] Colonne "Sopra mercato %" e "Confronto mercato" valorizzate solo sui lead con l'etichetta.
47. Impostazioni → "Rivedi informativa".
    - [ ] Nella legenda c'è la riga "+18% su Navigli"; l'informativa non chiede una nuova conferma.
```

- [ ] **Step 4: CLAUDE.md**

Nella riga `src/core/` di `CLAUDE.md`, dopo la parte su `lead-filters.ts (…)`, aggiungi: `` `market.ts` (mediana €/m² dei privati salvati per zona, ripiego sulla città; calcolata in `listLeads()`, mai salvata), ``.

- [ ] **Step 5: verifica completa**

Run: `npm run typecheck && npm test && npm run build`
Expected: tutto verde; build in `.output/chrome-mv3`.

- [ ] **Step 6: commit**

```bash
git add src/ui/onboarding docs/smoke-test.md CLAUDE.md tests/unit/ui/onboarding.test.tsx
git commit -F - <<'EOF'
docs: legenda "sopra mercato", smoke test e CLAUDE.md

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
