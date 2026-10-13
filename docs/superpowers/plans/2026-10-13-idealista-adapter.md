# Adattatore Idealista.it — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HomeRadar funziona anche su Idealista.it (vendita): badge sui privati, lead nel pannello con etichetta del portale, età stimata dall'ID, ribassi; Immobiliare resta invariato.

**Architecture:** `PortalAdapter` diventa generico. Ha due modalità di lettura: "payload" (Immobiliare, via bridge) e "DOM" (Idealista, `readDocument` dal content script isolato). La ricerca delle card passa dall'adattatore. La calibrazione ID→data diventa per portale (migrazione Dexie), con punti iniziali dal Wayback Machine e apprendimento dalla pagina "più recenti". Ribassi senza data datati dal `LeadService`; avviso adattatore per portale.

**Tech Stack:** WXT (MV3) + TypeScript + React, Dexie (IndexedDB), Vitest (jsdom + fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-idealista-adapter-design.md`

## Global Constraints

- Nessuna richiesta HTTP dell'estensione verso i portali; niente crawling. Su Idealista niente bridge e niente MAIN world.
- Salvare solo annunci di privati; mai nomi o telefoni del venditore. Su Idealista non leggere mai il testo di `.professional-name`, dei blocchi contatto o di `.item-description`.
- Repository pubblico: fixture solo via `scripts/sanitize-fixture.mjs`; file grezzi in `fixtures-raw/` (ignorata).
- Timestamp sempre in ms epoch UTC.
- Testi dell'interfaccia in italiano; commenti nel codice in italiano, come il codice esistente.
- I test esistenti di Immobiliare restano verdi; si cambiano solo firme e valori legati a portale, avviso e colonne.
- Ritmo di riferimento Idealista: **8.200 ID al giorno**; punto appreso accettato se il ritmo è tra **0,5×** e **2×**, ID maggiore di tutti i punti noti, almeno **1 giorno** dopo l'ultimo punto.
- Comandi: `npm test`, `npm run typecheck`, `npx vitest run <file>`, `npm run test:e2e`.

## Review Focus

1. **Loop di mutazioni su Idealista:** il badge inserito fa scattare il MutationObserver → `scan()`. Non deve reinviare `ingest` né generare cicli. Test in Task 4 ("scan ripetuto senza card nuove non reinvia").
2. **Card aggiunte senza cambio di URL** (lazy-load/scroll): devono essere inviate solo le nuove. Test in Task 4.
3. **Annunci correlati nella scheda Idealista** (card `article.item` in fondo al dettaglio): non devono produrre osservazioni oltre all'annuncio principale. Test in Task 5.
4. **Dettagli della card con importi** ("Box opz. 30.000 €") e titoli senza via ("Bilocale in Lorenteggio, Milano"): non devono finire in m², locali o indirizzo. Test in Task 5.
5. **Database esistente dei piloti** (calibrazione v1, `adapterWarning` booleano salvato): l'aggiornamento non perde dati e il pannello mostra l'avviso di Immobiliare. Test in Task 1 e Task 3.

---

## File

| File | Responsabilità |
|---|---|
| `src/shared/types.ts` | `Portal`, `PORTALS`, `PORTAL_SITES`, `PORTAL_TAGS`, `ObservedPriceDrop`, `PriceDrop.dateEstimated`, `CalibrationPoint.portal`, `CalibrationHint`, `ParseResult.newestId`, `Diagnostics.adapterWarning` per portale |
| `src/shared/messages.ts` | `ingest.calibrationHint`, `parseStatus.portal`, `ParseSource` |
| `src/core/age.ts` | calibrazione per portale, `acceptLearnedPoint`, `utcDay`, `LEARN_RATE_PER_DAY` |
| `src/core/db.ts` | tabella `calibration` + migrazione v2/v3 |
| `src/core/service.ts` | calibrazione per portale, punto appreso, data dei ribassi, avviso per portale |
| `src/core/rules.ts` | testi "Da verificare" e "rilevato il" |
| `src/core/diagnostics.ts` | `warnedPortals`, report per portale |
| `src/core/router.ts` | inoltro hint, contatore `domScans`, avviso per portale |
| `src/core/export.ts` | colonna "Portale" |
| `src/adapters/types.ts` | interfaccia generica |
| `src/adapters/immobiliare/index.ts` | `parsePayload`, `cardFor`, `badgeHost`, `cardIds` |
| `src/adapters/idealista/urls.ts` | `pageKind`, `listingIdFromHref`, `isNewestFirst` |
| `src/adapters/idealista/parse.ts` | `parseTitle`, `parseSearch`, `parseDetail` (funzioni pure su DOM) |
| `src/adapters/idealista/index.ts` | `idealistaAdapter` |
| `src/content/badges.ts` | badge tramite l'adattatore |
| `src/content/controller.ts` | `process`, `handle`, `scan` |
| `src/entrypoints/idealista.content.ts` | content script Idealista |
| `src/ui/sidepanel/App.tsx`, `LeadItem.tsx`, `styles.css` | banner per portale, etichetta portale, testo lista vuota |
| `scripts/sanitize-fixture.mjs` | modalità `idealista-search`, `idealista-detail` |
| `tests/unit/adapters/idealista-builders.ts` | HTML sintetico per i test |

---

### Task 1: Calibrazione per portale

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/messages.ts`, `src/core/age.ts`, `src/core/db.ts`, `src/core/service.ts`, `src/core/router.ts`
- Test: `tests/unit/core/age.test.ts`, `tests/unit/core/db.test.ts` (nuovo), `tests/unit/core/service.ingest.test.ts`

**Interfaces:**
- Produces:
  - `type Portal = 'immobiliare' | 'idealista'`
  - `PORTALS: Portal[]`
  - `interface CalibrationPoint { portal: Portal; portalId: number; createdAt: number }`
  - `interface CalibrationHint { portal: Portal; portalId: number }`
  - `type IdDate = { portalId: number; createdAt: number }`
  - `DEFAULT_CALIBRATION: Record<Portal, IdDate[]>`
  - `LEARN_RATE_PER_DAY: Partial<Record<Portal, number>>`
  - `utcDay(ms: number): number`
  - `acceptLearnedPoint(candidate: IdDate, points: IdDate[], ratePerDay: number): boolean`
  - `estimateCreatedAt(id: number, points: IdDate[]): number | null`
  - `mergeCalibration(defaults: IdDate[], learned: IdDate[]): IdDate[]`
  - `HomeRadarDB.calibration: Table<CalibrationPoint, [Portal, number]>`
  - `LeadService.ingest(observations, hint?: CalibrationHint)`
  - Request `ingest` con campo opzionale `calibrationHint`

- [ ] **Step 1: Test di `age`**

In `tests/unit/core/age.test.ts` cambia l'import e il test della calibrazione predefinita, poi aggiungi i nuovi blocchi:

```ts
import { acceptLearnedPoint, DEFAULT_CALIBRATION, estimateCreatedAt, mergeCalibration, utcDay } from '@/core/age';
```

```ts
  it('con la calibrazione predefinita colloca un ID noto alla sua data', () => {
    expect(estimateCreatedAt(131597836, DEFAULT_CALIBRATION.immobiliare)).toBe(1786025032000);
    expect(estimateCreatedAt(36_000_000, DEFAULT_CALIBRATION.idealista)).toBe(Date.UTC(2026, 5, 13));
  });
```

```ts
describe('utcDay', () => {
  it('riporta alla mezzanotte UTC', () => {
    expect(utcDay(Date.UTC(2026, 9, 13, 23, 59))).toBe(Date.UTC(2026, 9, 13));
  });
});

describe('acceptLearnedPoint', () => {
  const pts = DEFAULT_CALIBRATION.idealista; // ultimo punto: 37.142.000 il 13/10/2026
  const RATE = 8200;
  const at = (day: number) => Date.UTC(2026, 9, day);

  it('accetta l\'annuncio più recente di una grande città', () => {
    expect(acceptLearnedPoint({ portalId: 37_200_000, createdAt: at(20) }, pts, RATE)).toBe(true);
  });
  it('rifiuta un ID non maggiore di quelli noti', () => {
    expect(acceptLearnedPoint({ portalId: 37_100_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
  it('rifiuta un punto nello stesso giorno dell\'ultimo', () => {
    expect(acceptLearnedPoint({ portalId: 37_150_000, createdAt: at(13) }, pts, RATE)).toBe(false);
  });
  it('rifiuta un ritmo troppo basso (comune piccolo, annuncio vecchio)', () => {
    expect(acceptLearnedPoint({ portalId: 37_150_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
  it('rifiuta un ritmo troppo alto', () => {
    expect(acceptLearnedPoint({ portalId: 37_400_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
  it('senza punti di riferimento non accetta nulla', () => {
    expect(acceptLearnedPoint({ portalId: 37_200_000, createdAt: at(20) }, [], RATE)).toBe(false);
  });
});
```

- [ ] **Step 2: Test della migrazione** — crea `tests/unit/core/db.test.ts`:

```ts
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { HomeRadarDB } from '@/core/db';

describe('HomeRadarDB migrazioni', () => {
  it('sposta la calibrazione v1 nella tabella per portale senza toccare gli annunci', async () => {
    const name = `mig-${Math.random()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status', idCalibration: 'portalId', meta: 'key',
    });
    await old.table('idCalibration').put({ portalId: 128416572, createdAt: 1776643200000 });
    await old.table('listings').put({ key: 'immobiliare:128416572', lastSeenAt: 5 });
    await old.table('leadStates').put({ listingKey: 'immobiliare:128416572', status: 'contacted' });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.calibration.toArray()).toEqual([{ portal: 'immobiliare', portalId: 128416572, createdAt: 1776643200000 }]);
    expect(await db.listings.get('immobiliare:128416572')).toMatchObject({ lastSeenAt: 5 });
    expect(await db.leadStates.get('immobiliare:128416572')).toMatchObject({ status: 'contacted' });
    expect(db.tables.map((t) => t.name)).not.toContain('idCalibration');
  });
});
```

- [ ] **Step 3: Test del service** — in `tests/unit/core/service.ingest.test.ts`:
  - riga 33: sostituisci l'asserzione con
    ```ts
    expect(await db.calibration.get(['immobiliare', 128416572])).toEqual({ portal: 'immobiliare', portalId: 128416572, createdAt: created });
    ```
  - aggiungi in fondo al `describe`:

```ts
  const idealista = (o: Partial<ListingObservation> = {}) => obs({
    portal: 'idealista', portalId: 37200000, url: 'https://www.idealista.it/immobile/37200000/', lastDrop: null, ...o,
  });

  it('impara un punto di calibrazione Idealista dalla pagina "più recenti"', async () => {
    const { db, svc } = setup(Date.UTC(2026, 9, 20, 12));
    await svc.ingest([idealista({ sellerType: 'agency' })], { portal: 'idealista', portalId: 37200000 });
    expect(await db.calibration.get(['idealista', 37200000])).toEqual({ portal: 'idealista', portalId: 37200000, createdAt: Date.UTC(2026, 9, 20) });
  });

  it('scarta un punto Idealista con ritmo anomalo', async () => {
    const { db, svc } = setup(Date.UTC(2026, 9, 20, 12));
    await svc.ingest([idealista({ portalId: 37150000 })], { portal: 'idealista', portalId: 37150000 });
    expect(await db.calibration.count()).toBe(0);
  });

  it('stima l\'età Idealista solo con i punti Idealista', async () => {
    const { db, svc } = setup(Date.UTC(2026, 9, 13, 12));
    await svc.ingest([idealista({ portalId: 36000000 })]);
    expect((await db.listings.get('idealista:36000000'))!.estimatedCreatedAt).toBe(Date.UTC(2026, 5, 13));
  });
```

  Aggiungi gli import:

```ts
import type { ListingObservation } from '@/shared/types';
```

- [ ] **Step 4: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/age.test.ts tests/unit/core/db.test.ts tests/unit/core/service.ingest.test.ts`
Expected: FAIL (`acceptLearnedPoint`/`utcDay` non esportati, `db.calibration` undefined).

- [ ] **Step 5: Tipi** — in `src/shared/types.ts`:

```ts
export type Portal = 'immobiliare' | 'idealista';
export const PORTALS: Portal[] = ['immobiliare', 'idealista'];
```

e sostituisci `CalibrationPoint`:

```ts
export interface CalibrationPoint {
  portal: Portal;
  portalId: number;
  createdAt: number;
}

/** ID dell'annuncio più recente di una pagina "più recenti": candidato punto "creato oggi". */
export interface CalibrationHint {
  portal: Portal;
  portalId: number;
}
```

In `src/shared/messages.ts` importa `CalibrationHint` e cambia la variante `ingest`:

```ts
  | { type: 'ingest'; observations: ListingObservation[]; calibrationHint?: CalibrationHint }
```

- [ ] **Step 6: `src/core/age.ts`** — sostituisci l'intero file:

```ts
import { DAY_MS, type Portal } from '@/shared/types';

export type IdDate = { portalId: number; createdAt: number };

/**
 * Coppie ID → data per portale.
 * Immobiliare: verificate sul sito il 2026-10-10.
 * Idealista: prima cattura sul Wayback Machine degli annunci di ogni fascia di ID
 * (CDX `url=www.idealista.it/immobile/{prefisso}&matchType=prefix&collapse=urlkey`),
 * quindi un limite superiore con pochi giorni di ritardo; l'ultimo punto è stato letto dal sito il 2026-10-13.
 */
export const DEFAULT_CALIBRATION: Record<Portal, IdDate[]> = {
  immobiliare: [
    { portalId: 128416572, createdAt: Date.UTC(2026, 3, 20) },
    { portalId: 131597836, createdAt: 1786025032000 },
    { portalId: 133428292, createdAt: 1791609879000 },
  ],
  idealista: [
    { portalId: 33_000_000, createdAt: Date.UTC(2025, 5, 16) },
    { portalId: 34_000_000, createdAt: Date.UTC(2025, 9, 30) },
    { portalId: 35_000_000, createdAt: Date.UTC(2026, 2, 5) },
    { portalId: 36_000_000, createdAt: Date.UTC(2026, 5, 13) },
    { portalId: 37_000_000, createdAt: Date.UTC(2026, 9, 5) },
    { portalId: 37_142_000, createdAt: Date.UTC(2026, 9, 13) },
  ],
};

/** Ritmo medio di nuovi ID al giorno, per i portali che imparano dalla pagina "più recenti". */
export const LEARN_RATE_PER_DAY: Partial<Record<Portal, number>> = { idealista: 8200 };

export const utcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

export function mergeCalibration(defaults: IdDate[], learned: IdDate[]): IdDate[] {
  const byId = new Map<number, IdDate>();
  for (const p of [...defaults, ...learned]) byId.set(p.portalId, { portalId: p.portalId, createdAt: p.createdAt });
  return [...byId.values()].sort((a, b) => a.portalId - b.portalId);
}

/**
 * Un punto "creato oggi" è affidabile solo se viene da una zona con molti annunci nuovi:
 * l'ID deve superare tutti quelli noti e il ritmo rispetto all'ultimo punto deve essere plausibile.
 */
export function acceptLearnedPoint(candidate: IdDate, points: IdDate[], ratePerDay: number): boolean {
  const last = mergeCalibration([], points).at(-1);
  if (!last || candidate.portalId <= last.portalId) return false;
  const days = (candidate.createdAt - last.createdAt) / DAY_MS;
  if (days < 1) return false;
  const rate = (candidate.portalId - last.portalId) / days;
  return rate >= ratePerDay * 0.5 && rate <= ratePerDay * 2;
}

export function estimateCreatedAt(portalId: number, points: IdDate[]): number | null {
  const pts = mergeCalibration([], points);
  if (pts.length < 2) return null;
  const exact = pts.find((p) => p.portalId === portalId);
  if (exact) return exact.createdAt;

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let a = first;
  let b = last;
  if (portalId > first.portalId && portalId < last.portalId) {
    const i = pts.findIndex((p) => p.portalId > portalId);
    a = pts[i - 1]!;
    b = pts[i]!;
  }
  return Math.round(a.createdAt + ((portalId - a.portalId) * (b.createdAt - a.createdAt)) / (b.portalId - a.portalId));
}
```

Nota: `mergeCalibration` ora restituisce solo `{ portalId, createdAt }`. Il test esistente `mergeCalibration` resta verde perché i suoi punti hanno già quella forma.

- [ ] **Step 7: `src/core/db.ts`** — sostituisci la classe:

```ts
import Dexie, { type Table } from 'dexie';
import type { CalibrationPoint, LeadState, ListingRecord, Portal, PriceSnapshot } from '@/shared/types';

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class HomeRadarDB extends Dexie {
  declare listings: Table<ListingRecord, string>;
  declare priceSnapshots: Table<PriceSnapshot, number>;
  declare leadStates: Table<LeadState, string>;
  declare calibration: Table<CalibrationPoint, [Portal, number]>;
  declare meta: Table<MetaRecord, string>;

  constructor(name = 'homeradar') {
    super(name);
    this.version(1).stores({
      listings: 'key, lastSeenAt',
      priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status',
      idCalibration: 'portalId',
      meta: 'key',
    });
    // v2: la calibrazione diventa per portale; i punti salvati finora sono tutti di Immobiliare.
    this.version(2)
      .stores({ calibration: '[portal+portalId], portal' })
      .upgrade(async (tx) => {
        const old = await tx.table<{ portalId: number; createdAt: number }>('idCalibration').toArray();
        await tx.table('calibration').bulkPut(old.map((p) => ({ portal: 'immobiliare', portalId: p.portalId, createdAt: p.createdAt })));
      });
    this.version(3).stores({ idCalibration: null });
  }
}
```

- [ ] **Step 8: `src/core/service.ts`**
  - Import:
    ```ts
    import { acceptLearnedPoint, DEFAULT_CALIBRATION, estimateCreatedAt, LEARN_RATE_PER_DAY, mergeCalibration, utcDay } from '@/core/age';
    ```
  - Aggiungi `type CalibrationHint, type Portal` all'import dei tipi.
  - Sostituisci l'inizio di `ingest`, fino alla riga `const calibration = …` inclusa:

```ts
  async ingest(observations: ListingObservation[], hint?: CalibrationHint): Promise<Evaluation[]> {
    const now = this.clock();
    const settings = await this.getSettings();
    const { listings, priceSnapshots, leadStates, calibration } = this.db;

    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, calibration], async () => {
      for (const o of observations) {
        if (o.portalCreatedAt != null) await calibration.put({ portal: o.portal, portalId: o.portalId, createdAt: o.portalCreatedAt });
      }
      const learned = await calibration.toArray();
      const pointsFor = (p: Portal) => mergeCalibration(DEFAULT_CALIBRATION[p], learned.filter((x) => x.portal === p));
      const rate = hint && LEARN_RATE_PER_DAY[hint.portal];
      if (hint && rate) {
        const candidate = { portal: hint.portal, portalId: hint.portalId, createdAt: utcDay(now) };
        if (acceptLearnedPoint(candidate, pointsFor(hint.portal), rate)) {
          await calibration.put(candidate);
          learned.push(candidate);
        }
      }
```

  - Nel ciclo cambia `estimatedCreatedAt: estimateCreatedAt(o.portalId, calibration),` in:
    ```ts
    estimatedCreatedAt: estimateCreatedAt(o.portalId, pointsFor(o.portal)),
    ```

- [ ] **Step 9: `src/core/router.ts`** — nella case `ingest`:

```ts
      const evaluations = await service.ingest(req.observations, req.calibrationHint);
```

- [ ] **Step 10: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS, nessun errore di tipo.

- [ ] **Step 11: Commit**

```bash
git add src/shared/types.ts src/shared/messages.ts src/core/age.ts src/core/db.ts src/core/service.ts src/core/router.ts tests/unit/core/age.test.ts tests/unit/core/db.test.ts tests/unit/core/service.ingest.test.ts
git commit -m "feat(core): per-portal ID calibration with Idealista defaults and learned points"
```

---

### Task 2: Ribassi senza data e testi delle regole

**Files:**
- Modify: `src/shared/types.ts`, `src/core/service.ts`, `src/core/rules.ts`
- Test: `tests/unit/core/service.ingest.test.ts`, `tests/unit/core/rules.test.ts`

**Interfaces:**
- Consumes: `utcDay` (Task 1).
- Produces:
  - `interface ObservedPriceDrop { fromPrice; toPrice; percent; date: number | null }`
  - `ListingObservation.lastDrop: ObservedPriceDrop | null`
  - `PriceDrop.dateEstimated?: boolean`

- [ ] **Step 1: Test del service** — in fondo al `describe` di `tests/unit/core/service.ingest.test.ts`, che usa ancora l'helper `idealista` del Task 1:

```ts
  it('dà al ribasso senza data il giorno in cui è stato visto e lo conserva alle visite successive', async () => {
    const { db, svc, advance } = setup();
    const lastDrop = { fromPrice: 645000, toPrice: 625000, percent: 3.1, date: null };
    await svc.ingest([idealista({ portalId: 37011951, price: 625000, lastDrop })]);
    const key = 'idealista:37011951';
    expect((await db.listings.get(key))!.lastDrop).toEqual({ ...lastDrop, date: Date.UTC(2026, 9, 10), dateEstimated: true });
    advance(3 * DAY_MS);
    await svc.ingest([idealista({ portalId: 37011951, price: 625000, lastDrop })]);
    expect((await db.listings.get(key))!.lastDrop!.date).toBe(Date.UTC(2026, 9, 10));
    const declared = (await db.priceSnapshots.where('listingKey').equals(key).toArray()).filter((s) => s.source === 'declared');
    expect(declared).toHaveLength(2);
  });

  it('un nuovo ribasso senza data prende il giorno in cui compare', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([idealista({ portalId: 37011951, price: 625000, lastDrop: { fromPrice: 645000, toPrice: 625000, percent: 3.1, date: null } })]);
    advance(3 * DAY_MS);
    await svc.ingest([idealista({ portalId: 37011951, price: 600000, lastDrop: { fromPrice: 625000, toPrice: 600000, percent: 4, date: null } })]);
    expect((await db.listings.get('idealista:37011951'))!.lastDrop).toMatchObject({ toPrice: 600000, date: Date.UTC(2026, 9, 13), dateEstimated: true });
  });
```

Aggiungi `DAY_MS` all'import: `import { DAY_MS, type ListingObservation } from '@/shared/types';`.

- [ ] **Step 2: Test delle regole** — in `tests/unit/core/rules.test.ts`, dentro `describe('evaluate')`:

```ts
  it('su Idealista l\'età incerta non rimanda alla scheda', () => {
    const e = ev(listing({ key: 'idealista:1', portal: 'idealista', estimatedCreatedAt: daysAgo(125) }));
    expect(e.priority).toBe('verify');
    expect(e.reasons).toContain('Età stimata vicina alla soglia');
    expect(e.reasons).not.toContain("Età da verificare: apri l'annuncio");
  });

  it('per un ribasso con data stimata dice "rilevato il"', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(45), lastDrop: { ...lastDrop, dateEstimated: true } }), declaredDrop);
    expect(e.reasons.at(-1)).toBe('Ribassato del 5,6% (249.000 → 235.000 €) rilevato il 21/09');
  });
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.ingest.test.ts tests/unit/core/rules.test.ts`
Expected: FAIL (typecheck di `date: null` / testi mancanti).

- [ ] **Step 4: Tipi** — in `src/shared/types.ts` sostituisci `PriceDrop` e aggiungi `ObservedPriceDrop`:

```ts
export interface PriceDrop {
  fromPrice: number;
  toPrice: number;
  percent: number;
  /** ms epoch, mezzanotte UTC del giorno del ribasso */
  date: number;
  /** true se il portale non dichiara la data: è il giorno in cui HomeRadar ha visto il ribasso. */
  dateEstimated?: boolean;
}

/** Ribasso come letto dal portale: Idealista non ne dichiara la data. */
export interface ObservedPriceDrop {
  fromPrice: number;
  toPrice: number;
  percent: number;
  date: number | null;
}
```

In `ListingObservation` cambia `lastDrop: PriceDrop | null;` in `lastDrop: ObservedPriceDrop | null;`. `ListingRecord` resta `PriceDrop | null`.

- [ ] **Step 5: `src/core/service.ts`**
  - Aggiungi `type ObservedPriceDrop, type PriceDrop` all'import dei tipi.
  - Aggiungi sopra la classe:

```ts
/** Dà una data al ribasso: quella del portale, quella già registrata per lo stesso ribasso o oggi. */
function resolveDrop(drop: ObservedPriceDrop | null, prev: PriceDrop | null, now: number): PriceDrop | null {
  if (!drop) return null;
  if (drop.date != null) return { ...drop, date: drop.date };
  if (prev && prev.fromPrice === drop.fromPrice && prev.toPrice === drop.toPrice) return prev;
  return { ...drop, date: utcDay(now), dateEstimated: true };
}
```

  - Nel ciclo di `ingest`, dopo `const prev = await listings.get(key);`:
    ```ts
    const drop = resolveDrop(o.lastDrop, prev?.lastDrop ?? null, now);
    ```
  - Nel record: `lastDrop: drop ?? prev?.lastDrop ?? null,`.
  - Cambia la chiamata in `await this.recordSnapshots(key, drop, o.price, now);`.
  - Sostituisci la firma e l'inizio di `recordSnapshots`:

```ts
  private async recordSnapshots(key: string, drop: PriceDrop | null, price: number | null, now: number): Promise<void> {
    const { priceSnapshots } = this.db;
    if (drop) {
      const declared = [
        { price: drop.fromPrice, at: drop.date - 1 },
        { price: drop.toPrice, at: drop.date },
      ];
```

    Poi, nel resto del metodo, usa `price` al posto di `o.price`.

- [ ] **Step 6: `src/core/rules.ts`**
  - Aggiungi `type Portal` all'import dei tipi.
  - Sopra `evaluate`:

```ts
// Su Immobiliare la scheda contiene la data vera; su Idealista no.
const VERIFY_REASON: Record<Portal, string> = {
  immobiliare: "Età da verificare: apri l'annuncio",
  idealista: 'Età stimata vicina alla soglia',
};
```

  - Sostituisci `if (ageUncertain) reasons.push("Età da verificare: apri l'annuncio");` con:
    ```ts
    if (ageUncertain) reasons.push(VERIFY_REASON[listing.portal]);
    ```
  - Sostituisci la riga `const when = …` con:

```ts
      const d = listing.lastDrop;
      const when = d && d.toPrice === current ? ` ${d.dateEstimated ? 'rilevato il' : 'il'} ${formatDayMonth(d.date)}` : '';
```

- [ ] **Step 7: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/core/service.ts src/core/rules.ts tests/unit/core/service.ingest.test.ts tests/unit/core/rules.test.ts
git commit -m "feat(core): date undated price drops on first sight and portal-aware rule texts"
```

---

### Task 3: Avviso dell'adattatore per portale

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/messages.ts`, `src/core/diagnostics.ts`, `src/core/service.ts`, `src/core/router.ts`, `src/content/controller.ts`, `src/ui/sidepanel/App.tsx`
- Test: `tests/unit/core/router.test.ts`, `tests/unit/core/service.leads.test.ts`, `tests/unit/core/diagnostics.test.ts`, `tests/unit/content/controller.test.ts`, `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Produces:
  - `PORTAL_SITES: Record<Portal, string>` (`'Immobiliare.it' | 'Idealista.it'`)
  - `Diagnostics.adapterWarning: Partial<Record<Portal, boolean>>`
  - `type ParseSource = 'next-data' | 'api' | 'dom'`
  - Request `parseStatus { portal: Portal; ok; errors; source: ParseSource }`
  - `warnedPortals(w: Partial<Record<Portal, boolean>> | boolean | undefined): Portal[]`
  - `LeadService.setAdapterWarning(portal: Portal, on: boolean): Promise<boolean>` (restituisce se almeno un portale ha l'avviso)

- [ ] **Step 1: Aggiorna i test**
  - `tests/unit/core/diagnostics.test.ts`: nell'input `adapterWarning: true` → `adapterWarning: { immobiliare: true }`; riga attesa `'Avviso adattatore: sì'` → `'Avviso adattatore: Immobiliare.it'`. Aggiungi:

```ts
  it('elenca i portali con avviso e dice "no" senza avvisi', () => {
    const base = { version: 'v', counters: {}, errors: [] };
    expect(formatDiagnostics({ ...base, adapterWarning: { immobiliare: true, idealista: true } }, 0)).toContain('Avviso adattatore: Immobiliare.it, Idealista.it');
    expect(formatDiagnostics({ ...base, adapterWarning: { immobiliare: false } }, 0)).toContain('Avviso adattatore: no');
  });
```

  - `tests/unit/core/router.test.ts`: sostituisci il test `parseStatus …` con:

```ts
  it('parseStatus gestisce l\'avviso per portale e registra gli errori', async () => {
    const { svc } = setup();
    const h = hooks();
    await handleRequest(svc, { type: 'parseStatus', portal: 'immobiliare', ok: false, errors: ['search data not found'], source: 'api' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(true);
    let d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toEqual({ immobiliare: true });
    expect(d.errors.map((e) => e.message)).toEqual(['search data not found']);
    await handleRequest(svc, { type: 'parseStatus', portal: 'idealista', ok: false, errors: [], source: 'dom' }, '0.1.0', h);
    await handleRequest(svc, { type: 'parseStatus', portal: 'immobiliare', ok: true, errors: [], source: 'next-data' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(true); // Idealista ha ancora l'avviso
    d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toEqual({ immobiliare: false, idealista: true });
    expect(d.counters).toMatchObject({ apiPayloads: 1, nextDataPayloads: 1, domScans: 1 });
    await handleRequest(svc, { type: 'parseStatus', portal: 'idealista', ok: true, errors: [], source: 'dom' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(false);
  });
```

  - `tests/unit/core/service.leads.test.ts` (test diagnostica):
    - `await svc.setAdapterWarning(true);` → `expect(await svc.setAdapterWarning('immobiliare', true)).toBe(true);`
    - `expect(d.adapterWarning).toBe(true);` → `expect(d.adapterWarning).toEqual({ immobiliare: true });`
    - Aggiungi:

```ts
  it('legge come avviso di Immobiliare il booleano salvato dalle versioni precedenti', async () => {
    const { db, svc } = setup();
    await db.meta.put({ key: 'diagnostics', value: { counters: {}, errors: [], adapterWarning: true } });
    expect((await svc.getDiagnostics('v')).adapterWarning).toEqual({ immobiliare: true });
  });
```

  - `tests/unit/content/controller.test.ts`: nelle due asserzioni `toEqual({ type: 'parseStatus', … })` aggiungi `portal: 'immobiliare',`.
  - `tests/unit/ui/sidepanel.test.tsx`:
    - in `fakeApi` cambia la firma in `function fakeApi(leads: LeadView[], adapterWarning: Diagnostics['adapterWarning'] = {}): Api` e importa `type Diagnostics`;
    - nel test del banner `fakeApi([], true)` → `fakeApi([], { immobiliare: true })`;
    - aggiungi:

```ts
  it('nel banner nomina il portale con l\'avviso', async () => {
    render(<App api={fakeApi([], { immobiliare: false, idealista: true })} />);
    expect(await screen.findByText('Idealista.it potrebbe essere cambiato: alcuni dati non sono stati letti.')).toBeTruthy();
  });

  it('con due portali li elenca entrambi', async () => {
    render(<App api={fakeApi([], { immobiliare: true, idealista: true })} />);
    expect(await screen.findByText('Immobiliare.it e Idealista.it potrebbero essere cambiati: alcuni dati non sono stati letti.')).toBeTruthy();
  });
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core tests/unit/content tests/unit/ui`
Expected: FAIL.

- [ ] **Step 3: Tipi e messaggi**
  - `src/shared/types.ts`: dopo `PORTALS` aggiungi
    ```ts
    export const PORTAL_SITES: Record<Portal, string> = { immobiliare: 'Immobiliare.it', idealista: 'Idealista.it' };
    ```
  - In `Diagnostics` cambia `adapterWarning: boolean;` in `adapterWarning: Partial<Record<Portal, boolean>>;`.
  - `src/shared/messages.ts`: aggiungi `export type ParseSource = 'next-data' | 'api' | 'dom';`, importa `Portal` e cambia la variante:
    ```ts
    | { type: 'parseStatus'; portal: Portal; ok: boolean; errors: string[]; source: ParseSource }
    ```

- [ ] **Step 4: `src/core/diagnostics.ts`** — sostituisci il file:

```ts
import { formatDate } from '@/shared/format';
import { PORTAL_SITES, PORTALS, type Diagnostics, type Portal } from '@/shared/types';

/** Portali con l'avviso acceso; un booleano (versioni precedenti) vale per Immobiliare. */
export function warnedPortals(w: Partial<Record<Portal, boolean>> | boolean | undefined): Portal[] {
  if (typeof w === 'boolean') return w ? ['immobiliare'] : [];
  return PORTALS.filter((p) => w?.[p]);
}

export function formatDiagnostics(d: Diagnostics, now: number): string {
  const counters = Object.entries(d.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(', ');
  const warned = warnedPortals(d.adapterWarning).map((p) => PORTAL_SITES[p]);
  const lines = [
    `HomeRadar ${d.version} — report del ${formatDate(now)}`,
    `Avviso adattatore: ${warned.length ? warned.join(', ') : 'no'}`,
    `Contatori: ${counters || 'nessuno'}`,
    'Ultimi errori:',
    ...(d.errors.length ? d.errors.map((e) => `- ${formatDate(e.at)} ${e.message}`) : ['- nessuno']),
  ];
  return lines.join('\n');
}
```

- [ ] **Step 5: `src/core/service.ts`**
  - Importa `warnedPortals` da `@/core/diagnostics`.
  - Sostituisci `diag()` e `setAdapterWarning`:

```ts
  private async diag(): Promise<Omit<Diagnostics, 'version'>> {
    const rec = await this.db.meta.get('diagnostics');
    const raw = (rec?.value ?? {}) as Partial<Omit<Diagnostics, 'adapterWarning'>> & { adapterWarning?: Diagnostics['adapterWarning'] | boolean };
    const warning = raw.adapterWarning;
    return {
      counters: raw.counters ?? {},
      errors: raw.errors ?? [],
      adapterWarning: typeof warning === 'boolean' ? (warning ? { immobiliare: true } : {}) : (warning ?? {}),
    };
  }
```

```ts
  /** Aggiorna l'avviso del portale; restituisce true se almeno un portale ha l'avviso acceso. */
  async setAdapterWarning(portal: Portal, on: boolean): Promise<boolean> {
    let any = false;
    await this.updateDiag((d) => {
      d.adapterWarning = { ...d.adapterWarning, [portal]: on };
      any = warnedPortals(d.adapterWarning).length > 0;
    });
    return any;
  }
```

- [ ] **Step 6: `src/core/router.ts`**
  - Sopra `handleRequest`:

```ts
const PAYLOAD_COUNTERS = { api: 'apiPayloads', 'next-data': 'nextDataPayloads', dom: 'domScans' } as const;
```

  - Sostituisci la case `parseStatus`:

```ts
    case 'parseStatus': {
      await service.bumpCounter(PAYLOAD_COUNTERS[req.source]);
      for (const e of req.errors.slice(0, 5)) await service.recordError(e);
      hooks.setWarning(await service.setAdapterWarning(req.portal, !req.ok));
      return null;
    }
```

- [ ] **Step 7: `src/content/controller.ts`** — nella chiamata `parseStatus` aggiungi `portal: adapter.portal`:

```ts
    await send({ type: 'parseStatus', portal: adapter.portal, ok, errors: result.errors, source: kind });
```

- [ ] **Step 8: `src/ui/sidepanel/App.tsx`**
  - Import:

```ts
import { warnedPortals } from '@/core/diagnostics';
import { LEAD_STATUSES, PORTAL_SITES, type LeadStatus, type LeadView, type Portal, type Priority } from '@/shared/types';
```

  - Sotto `errorText` aggiungi:

```ts
function warningText(portals: Portal[]): string {
  const sites = portals.map((p) => PORTAL_SITES[p]);
  return sites.length === 1
    ? `${sites[0]} potrebbe essere cambiato: alcuni dati non sono stati letti.`
    : `${sites.join(' e ')} potrebbero essere cambiati: alcuni dati non sono stati letti.`;
}
```

  - Sostituisci lo stato `warning` con `const [warned, setWarned] = useState<Portal[]>([]);` e in `refresh` scrivi `setWarned(warnedPortals(diag.adapterWarning));`.
  - Sostituisci il blocco del banner:

```tsx
      {warned.length > 0 && (
        <p className="banner banner--warning">
          <AlertIcon />
          <span>{warningText(warned)}</span>
        </p>
      )}
```

- [ ] **Step 9: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared src/core src/content/controller.ts src/ui/sidepanel/App.tsx tests/unit
git commit -m "feat(diagnostics): adapter warning per portal"
```

---

### Task 4: Adattatore generico, badge e controller con lettura del DOM

**Files:**
- Modify: `src/shared/types.ts`, `src/adapters/types.ts`, `src/adapters/immobiliare/index.ts`, `src/content/badges.ts`, `src/content/controller.ts`
- Test: `tests/unit/content/badges.test.ts`, `tests/unit/content/controller.test.ts`

**Interfaces:**
- Consumes: `CalibrationHint`, `ParseSource`, Request `ingest.calibrationHint` (Task 1, 3).
- Produces:
  - `ParseResult.newestId?: number`
  - `PortalAdapter`, come sotto
  - `renderBadge(root, ev, adapter: Pick<PortalAdapter, 'cardFor' | 'badgeHost'>)`
  - `createController(...)` restituisce `{ handle, scan, applyAll, hasUnseenListings }`, dove `scan(): Promise<void>`

- [ ] **Step 1: Test dei badge** — in `tests/unit/content/badges.test.ts` importa `immobiliareAdapter` da `@/adapters/immobiliare` e aggiungi `, immobiliareAdapter` come terzo argomento a ogni chiamata `renderBadge(document, …)`. Nessun altro cambiamento.

- [ ] **Step 2: Test del controller in modalità DOM** — in fondo a `tests/unit/content/controller.test.ts`:

```ts
describe('createController in modalità DOM', () => {
  const url = 'https://portale.test/vendita/';
  const card = (id: number) => `<article data-id="${id}"><div class="foto"><img></div></article>`;
  // Adattatore minimo: una card = un privato; la pagina "?nuovi" segnala l'ID più recente.
  const domAdapter: PortalAdapter = {
    portal: 'idealista',
    pageKind: () => 'search',
    readDocument(root, u) {
      const ids = [...root.querySelectorAll('article[data-id]')].map((a) => Number(a.getAttribute('data-id')));
      return {
        observations: ids.map((id) => obsFor(id)),
        errors: [],
        ...(u.endsWith('?nuovi') && ids.length ? { newestId: Math.max(...ids) } : {}),
      };
    },
    cardFor: (root, id) => root.querySelector<HTMLElement>(`article[data-id="${id}"]`),
    badgeHost: (c) => c.querySelector<HTMLElement>('.foto') ?? c,
    cardIds: (root) => [...root.querySelectorAll('article[data-id]')].map((a) => Number(a.getAttribute('data-id'))),
  };
  const obsFor = (id: number): ListingObservation => ({
    portal: 'idealista', portalId: id, url: `https://portale.test/immobile/${id}/`, title: 't', address: null, city: null, zone: null,
    typology: null, surfaceM2: null, rooms: null, price: 1, sellerType: 'private', portalCreatedAt: null, lastDrop: null, source: 'search',
  });
  const ingests = (send: ReturnType<typeof fakeSend>) => send.mock.calls.map((c) => c[0]).filter((r) => r.type === 'ingest');

  it('legge le card, invia lo stato "dom" e disegna i badge', async () => {
    document.body.innerHTML = card(1) + card(2);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    expect(send.mock.calls[0]![0]).toEqual({ type: 'parseStatus', portal: 'idealista', ok: true, errors: [], source: 'dom' });
    expect(ingests(send)).toHaveLength(1);
    expect(document.querySelectorAll(`.foto > [${BADGE_ATTR}]`)).toHaveLength(2);
  });

  it('scan ripetuto senza card nuove non reinvia nulla (niente cicli col MutationObserver)', async () => {
    document.body.innerHTML = card(1);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    await c.scan();
    await c.scan();
    expect(send).toHaveBeenCalledTimes(2); // un parseStatus + un ingest
  });

  it('invia solo le card aggiunte dopo il primo scan', async () => {
    document.body.innerHTML = card(1);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => url });
    await c.scan();
    document.body.insertAdjacentHTML('beforeend', card(3));
    await c.scan();
    const sent = ingests(send).map((r) => (r as Extract<Request, { type: 'ingest' }>).observations.map((o) => o.portalId));
    expect(sent).toEqual([[1], [3]]);
  });

  it('passa l\'ID più recente come candidato di calibrazione', async () => {
    document.body.innerHTML = card(5) + card(9);
    const send = fakeSend();
    const c = createController({ adapter: domAdapter, send, root: document, getUrl: () => `${url}?nuovi` });
    await c.scan();
    expect(ingests(send)[0]).toMatchObject({ calibrationHint: { portal: 'idealista', portalId: 9 } });
  });

  it('un adattatore senza readDocument non fa nulla in scan', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL });
    await c.scan();
    expect(send).not.toHaveBeenCalled();
  });
});
```

Aggiungi gli import:

```ts
import type { PortalAdapter } from '@/adapters/types';
import type { ListingObservation } from '@/shared/types';
```

In `fakeSend` la chiave deve dipendere dal portale: sostituisci `` listingKey: `immobiliare:${o.portalId}` `` con `` listingKey: `${o.portal}:${o.portalId}` ``.

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/content`
Expected: FAIL (`scan` non esiste; firma di `renderBadge`).

- [ ] **Step 4: `ParseResult`** — in `src/shared/types.ts`:

```ts
export interface ParseResult {
  observations: ListingObservation[];
  errors: string[];
  /** Pagine "più recenti": ID più alto in pagina, candidato punto di calibrazione. */
  newestId?: number;
}
```

- [ ] **Step 5: `src/adapters/types.ts`** — sostituisci il file:

```ts
import type { PageKind, ParseResult, Portal } from '@/shared/types';

export type PayloadKind = 'next-data' | 'api';

export interface PortalAdapter {
  portal: Portal;
  pageKind(url: string): PageKind;
  /** Modalità "payload": JSON inoltrato dal bridge (Immobiliare). */
  parsePayload?(kind: PayloadKind, url: string, json: unknown): ParseResult;
  /** Modalità "DOM": legge le card già mostrate dalla pagina (Idealista). */
  readDocument?(root: ParentNode, url: string): ParseResult;
  /** Card dell'annuncio in pagina, se presente. */
  cardFor(root: ParentNode, portalId: number): HTMLElement | null;
  /** Elemento della card in cui appendere il badge (di solito il contenitore della foto). */
  badgeHost(card: HTMLElement): HTMLElement;
  /** ID di tutte le card presenti in pagina, agenzie comprese. */
  cardIds(root: ParentNode): number[];
}
```

- [ ] **Step 6: `src/adapters/immobiliare/index.ts`** — sostituisci l'oggetto finale `immobiliareAdapter`:

```ts
function parseNextData(json: unknown, url: string): ParseResult {
  const kind = pageKind(url);
  if (kind === 'search') return parseSearchData(findSearchData(json));
  if (kind === 'detail') return parseDetailData(obj(obj(obj(json)?.props)?.pageProps)?.detailData);
  return { observations: [], errors: [] };
}

function parseIntercepted(url: string, json: unknown): ParseResult {
  return isListingsApiUrl(url) ? parseSearchData(json) : { observations: [], errors: [] };
}

export const immobiliareAdapter = {
  portal: 'immobiliare' as const,
  pageKind,
  parsePayload: (kind: PayloadKind, url: string, json: unknown) =>
    kind === 'next-data' ? parseNextData(json, url) : parseIntercepted(url, json),
  cardFor: (root: ParentNode, id: number) => root.querySelector<HTMLAnchorElement>(`a[href*="/annunci/${id}/"]`)?.closest('li') ?? null,
  badgeHost(card: HTMLElement): HTMLElement {
    const img = card.querySelector('img');
    return img?.closest<HTMLElement>('.nd-slideshow__content') ?? img?.parentElement ?? card;
  },
  cardIds: (root: ParentNode) =>
    [...root.querySelectorAll<HTMLAnchorElement>('li a[href*="/annunci/"]')]
      .map((a) => listingIdFromHref(a.getAttribute('href') ?? ''))
      .filter((id): id is number => id != null),
  // Usati direttamente dai test dell'adattatore.
  parseNextData,
  parseIntercepted,
  listingIdFromHref,
} satisfies PortalAdapter;
```

Aggiorna l'import dei tipi: `import type { PayloadKind, PortalAdapter } from '@/adapters/types';`.

- [ ] **Step 7: `src/content/badges.ts`** — rimuovi `findCard` e sostituisci l'inizio di `renderBadge`, fino alla creazione dell'host:

```ts
import type { PortalAdapter } from '@/adapters/types';
```

```ts
export function renderBadge(
  root: ParentNode,
  ev: Evaluation,
  adapter: Pick<PortalAdapter, 'cardFor' | 'badgeHost'>,
): 'created' | 'updated' | 'unchanged' | 'no-card' {
  const card = adapter.cardFor(root, ev.portalId);
  if (!card) return 'no-card';

  let badge = card.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  if (badge && badge.textContent === ev.badgeText && badge.dataset.priority === ev.priority) return 'unchanged';

  let result: 'created' | 'updated' = 'updated';
  if (!badge) {
    const host = adapter.badgeHost(card);
    const pos = host.ownerDocument.defaultView?.getComputedStyle(host).position;
```

Il resto della funzione resta invariato.

- [ ] **Step 8: `src/content/controller.ts`** — sostituisci il file:

```ts
import type { PayloadKind, PortalAdapter } from '@/adapters/types';
import { renderBadge } from '@/content/badges';
import type { ParseSource, Request } from '@/shared/messages';
import type { Evaluation, ParseResult } from '@/shared/types';

export interface ControllerDeps {
  adapter: PortalAdapter;
  send: (req: Request) => Promise<unknown>;
  root: ParentNode;
  /** URL della pagina corrente (iniettato per testabilità). */
  getUrl: () => string;
}

export function createController({ adapter, send, root, getUrl }: ControllerDeps) {
  const evaluations = new Map<number, Evaluation>();
  /** ID di tutti gli annunci ricevuti, agenzie comprese. */
  const seen = new Set<number>();
  /** Modalità DOM: ID già inviati per l'URL corrente. */
  const sent = new Set<number>();
  let scannedUrl: string | null = null;

  function applyAll(): void {
    for (const ev of evaluations.values()) renderBadge(root, ev, adapter);
  }

  /** true se nelle card in pagina c'è un annuncio mai arrivato in un payload (dati persi). */
  function hasUnseenListings(): boolean {
    return adapter.cardIds(root).some((id) => !seen.has(id));
  }

  async function process(result: ParseResult, source: ParseSource): Promise<void> {
    const total = result.errors.length + result.observations.length;
    const hasUnknownSeller = result.observations.some((o) => o.sellerType === 'unknown');
    const ok = !hasUnknownSeller && (total === 0 || result.errors.length <= total * 0.2);
    for (const o of result.observations) seen.add(o.portalId);
    await send({ type: 'parseStatus', portal: adapter.portal, ok, errors: result.errors, source });
    if (!result.observations.length) return;
    const calibrationHint = result.newestId != null ? { portal: adapter.portal, portalId: result.newestId } : undefined;
    const evs = (await send({ type: 'ingest', observations: result.observations, ...(calibrationHint ? { calibrationHint } : {}) })) as Evaluation[];
    for (const ev of evs) evaluations.set(ev.portalId, ev);
    applyAll();
  }

  async function handle(kind: PayloadKind, url: string, payload: unknown): Promise<void> {
    if (!adapter.parsePayload) return;
    // Le risposte api valgono solo sulle pagine di ricerca: /annunci/{id}/ serve anche gli affitti.
    if (kind === 'api' && adapter.pageKind(getUrl()) !== 'search') return;
    await process(adapter.parsePayload(kind, url, payload), kind);
  }

  /** Modalità DOM: invia le card nuove; se non ce ne sono si limita a riapplicare i badge. */
  async function scan(): Promise<void> {
    if (!adapter.readDocument) return;
    const url = getUrl();
    const isNewUrl = url !== scannedUrl;
    if (isNewUrl) {
      scannedUrl = url;
      sent.clear();
    }
    const result = adapter.readDocument(root, url);
    const fresh = result.observations.filter((o) => !sent.has(o.portalId));
    if (!isNewUrl && !fresh.length) {
      applyAll();
      return;
    }
    for (const o of fresh) sent.add(o.portalId);
    await process({ ...result, observations: fresh }, 'dom');
  }

  return { handle, scan, applyAll, hasUnseenListings };
}
```

- [ ] **Step 9: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS. Anche i test `immobiliare.test.ts` e `immobiliare.fixtures.test.ts` restano verdi, perché `parseNextData`, `parseIntercepted` e `listingIdFromHref` restano sull'oggetto.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/adapters src/content tests/unit/content
git commit -m "refactor(content): generic adapter interface with DOM reading mode"
```

---

### Task 5: Parser di Idealista

**Files:**
- Create: `src/adapters/idealista/urls.ts`, `src/adapters/idealista/parse.ts`, `src/adapters/idealista/index.ts`, `tests/unit/adapters/idealista-builders.ts`, `tests/unit/adapters/idealista.test.ts`
- Test: `tests/unit/content/badges.test.ts`

**Interfaces:**
- Consumes: `PortalAdapter` (Task 4); `ObservedPriceDrop` (Task 2); `parseEuro` da `@/adapters/immobiliare/format` (generico: estrae le cifre).
- Produces:
  - `idealistaAdapter: PortalAdapter`
  - `pageKind(url)`, `listingIdFromHref(href)`, `isNewestFirst(url)`
  - `parseTitle(title): TitleParts`, `parseSearch(root)`, `parseDetail(root, url)`

- [ ] **Step 1: HTML sintetico per i test** — crea `tests/unit/adapters/idealista-builders.ts`. La struttura è quella verificata sul sito il 2026-10-13; nomi e testi sono inventati.

```ts
export const SEARCH_URL = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc';
export const NEWEST_URL = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=pubblicazione-desc';
export const DETAIL_URL = 'https://www.idealista.it/immobile/37118651/';
export const SELLER_NAME = 'Graziella Esempio';
export const DESCRIPTION = 'Descrizione scritta dal venditore, da non salvare';

export interface CardOpts {
  id?: number;
  /** valore di data-is-professional-ad; null = attributo assente */
  professional?: 'true' | 'false' | null;
  title?: string;
  price?: string;
  details?: string[];
  drop?: { from: string; pct: string };
}

export function card(o: CardOpts = {}): string {
  const id = o.id ?? 37118651;
  const prof = o.professional === undefined ? 'false' : o.professional;
  const title = o.title ?? 'Quadrilocale in Via Esempio, 1, Precotto, Milano';
  const drop = o.drop
    ? `<span class="pricedown"><span class="pricedown_price"> ${o.drop.from} </span><span class="pricedown_icon icon-pricedown">${o.drop.pct}</span></span>`
    : '';
  return `<article class="item extended-item item-multimedia-container" data-element-id="${id}"${prof === null ? '' : ` data-is-professional-ad="${prof}"`} data-is-offmarket="false">
    <div class="item-multimedia"><div class="mask"><div class="placeholder"><picture><img src="x.jpg" alt=""></picture></div></div></div>
    <div class="item-info-container">
      <a href="/immobile/${id}/" role="heading" class="item-link" title="${title}">${title}</a>
      <div class="price-row"><span class="item-price h2-simulated">${o.price ?? '245.000<span class="txt-big">€</span>'}</span>${drop}</div>
      <div class="item-detail-char">${(o.details ?? ['4 locali', '101 m²', '1º piano con ascensore']).map((d) => `<span class="item-detail">${d}</span>`).join('')}</div>
      <div class="item-description description"><p class="ellipsis">${DESCRIPTION}</p></div>
    </div>
  </article>`;
}

export const AD_SLOT = '<article class="adv noHover" aria-label="Spazio pubblicitario"></article>';

export function searchBody(cards: string[]): string {
  return `<main id="main-content"><section class="items-container items-list">${cards.join('')}</section></main>`;
}

export interface DetailOpts {
  title?: string;
  price?: string;
  drop?: { from: string; pct: string };
  seller?: 'private' | 'agency' | 'none';
  related?: string[];
}

/** Imposta document.title e il body come una scheda annuncio. */
export function renderDetail(doc: Document, o: DetailOpts = {}): void {
  doc.title = `${o.title ?? 'Bilocale in vendita in Via Esempio, 2, Mercalli - Quadronno, Milano'} — idealista, N.1 in Italia`;
  const drop = o.drop
    ? `<span class="pricedown"><span class="pricedown_price"> ${o.drop.from} </span><span class="pricedown_icon icon-pricedown">${o.drop.pct}</span></span>`
    : '';
  const seller = {
    private: `<div class="professional-name"><span class="particular">${SELLER_NAME}</span></div>`,
    agency: '<div class="professional-name"><span>Agenzia Esempio</span></div>',
    none: '',
  }[o.seller ?? 'private'];
  doc.body.innerHTML = `<main class="detail-container">
    <div class="info-data"><span class="info-data-price"><span class="txt-bold">${o.price ?? '445.000'}</span> €</span>${drop}</div>
    <div class="info-features"><span>52 m²</span><span>2 locali</span><span>Piano rialzato con ascensore</span></div>
    <div class="comment"><p>${DESCRIPTION}</p></div>
    <aside class="advertiser-name">${seller}</aside>
    <section class="related">${(o.related ?? []).join('')}</section>
  </main>`;
}
```

- [ ] **Step 2: Test dell'adattatore** — crea `tests/unit/adapters/idealista.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { idealistaAdapter as A } from '@/adapters/idealista';
import { isNewestFirst, listingIdFromHref, pageKind } from '@/adapters/idealista/urls';
import { parseTitle } from '@/adapters/idealista/parse';
import { AD_SLOT, card, DESCRIPTION, DETAIL_URL, NEWEST_URL, renderDetail, SEARCH_URL, searchBody, SELLER_NAME } from './idealista-builders';

const read = (url = SEARCH_URL) => A.readDocument!(document, url);

beforeEach(() => {
  document.title = '';
  document.body.innerHTML = '';
});

describe('urls', () => {
  it('riconosce ricerca, pagine successive, scheda e affitti', () => {
    expect(pageKind(SEARCH_URL)).toBe('search');
    expect(pageKind('https://www.idealista.it/vendita-case/milano-milano/lista-2.htm')).toBe('search');
    expect(pageKind(DETAIL_URL)).toBe('detail');
    expect(pageKind('https://www.idealista.it/affitto-case/milano-milano/')).toBe('other');
    expect(pageKind('https://www.idealista.it/')).toBe('other');
  });
  it('estrae l\'ID dai link', () => {
    expect(listingIdFromHref('/immobile/37118651/')).toBe(37118651);
    expect(listingIdFromHref('/agenzie-immobiliari/1/')).toBeNull();
  });
  it('"più recenti" vale solo sulla prima pagina', () => {
    expect(isNewestFirst(NEWEST_URL)).toBe(true);
    expect(isNewestFirst('https://www.idealista.it/vendita-case/milano-milano/lista-2.htm?ordine=pubblicazione-desc')).toBe(false);
    expect(isNewestFirst(SEARCH_URL)).toBe(false);
  });
});

describe('parseTitle', () => {
  it('separa tipologia, indirizzo con civico, zona e città', () => {
    expect(parseTitle('Trilocale in Via Rogoredo, 27, Rogoredo - Santa Giulia, Milano')).toEqual({
      typology: 'Trilocale', address: 'Via Rogoredo, 27', zone: 'Rogoredo - Santa Giulia', city: 'Milano',
    });
  });
  it('accetta il titolo della scheda ("in vendita in")', () => {
    expect(parseTitle('Bilocale in vendita in Via Esempio, 2, Mercalli - Quadronno, Milano')).toMatchObject({ typology: 'Bilocale', address: 'Via Esempio, 2' });
  });
  it('senza via: zona e città, indirizzo nullo', () => {
    expect(parseTitle('Bilocale in Lorenteggio, Milano')).toEqual({ typology: 'Bilocale', address: null, zone: 'Lorenteggio', city: 'Milano' });
  });
  it('via senza zona: la riconosce come indirizzo', () => {
    expect(parseTitle('Villa in Via Esempio, Milano')).toEqual({ typology: 'Villa', address: 'Via Esempio', zone: null, city: 'Milano' });
  });
  it('titolo non riconosciuto: tutto nullo', () => {
    expect(parseTitle('???')).toEqual({ typology: null, address: null, zone: null, city: null });
  });
});

describe('ricerca', () => {
  it('legge un privato con tutti i campi', () => {
    document.body.innerHTML = searchBody([card()]);
    expect(read()).toEqual({
      errors: [],
      observations: [{
        portal: 'idealista', portalId: 37118651, url: 'https://www.idealista.it/immobile/37118651/',
        title: 'Quadrilocale in Via Esempio, 1, Precotto, Milano', address: 'Via Esempio, 1', city: 'Milano', zone: 'Precotto',
        typology: 'Quadrilocale', surfaceM2: 101, rooms: 4, price: 245000, sellerType: 'private', portalCreatedAt: null,
        lastDrop: null, source: 'search',
      }],
    });
  });

  it('distingue agenzia, privato e flag assente; ignora le pubblicità', () => {
    document.body.innerHTML = searchBody([card({ id: 1, professional: 'true' }), AD_SLOT, card({ id: 2 }), card({ id: 3, professional: null })]);
    expect(read().observations.map((o) => [o.portalId, o.sellerType])).toEqual([[1, 'agency'], [2, 'private'], [3, 'unknown']]);
  });

  it('legge il ribasso senza data e ricalcola la percentuale', () => {
    document.body.innerHTML = searchBody([card({ price: '625.000€', drop: { from: '645.000 €', pct: '3%' } })]);
    expect(read().observations[0]!.lastDrop).toEqual({ fromPrice: 645000, toPrice: 625000, percent: 3.1, date: null });
  });

  it('prezzo su richiesta: prezzo e ribasso nulli', () => {
    document.body.innerHTML = searchBody([card({ price: 'Prezzo su richiesta', drop: { from: '645.000 €', pct: '3%' } })]);
    expect(read().observations[0]).toMatchObject({ price: null, lastDrop: null });
  });

  it('non scambia importi o piani per m² e locali', () => {
    document.body.innerHTML = searchBody([card({ details: ['Box opz. 30.000 €', '1 locale', '45 m²', '2º piano'] })]);
    expect(read().observations[0]).toMatchObject({ rooms: 1, surfaceM2: 45 });
    document.body.innerHTML = searchBody([card({ details: ['Box compreso', 'Piano terra'] })]);
    expect(read().observations[0]).toMatchObject({ rooms: null, surfaceM2: null });
  });

  it('segnala le card senza ID o titolo', () => {
    document.body.innerHTML = searchBody([card(), '<article class="item"><a class="item-link"></a></article>']);
    const r = read();
    expect(r.observations).toHaveLength(1);
    expect(r.errors).toEqual(['card[1]: id o titolo mancanti']);
  });

  it('pagina senza card (es. blocco anti-bot): nessun errore', () => {
    document.body.innerHTML = '<p>Ops! Al momento non siamo disponibili</p>';
    expect(read()).toEqual({ observations: [], errors: [] });
  });

  it('sulla pagina "più recenti" indica l\'ID più alto', () => {
    document.body.innerHTML = searchBody([card({ id: 37142258, professional: 'true' }), card({ id: 37142311 }), card({ id: 37072729 })]);
    expect(read(NEWEST_URL).newestId).toBe(37142311);
    expect(read().newestId).toBeUndefined();
  });

  it('non salva mai la descrizione', () => {
    document.body.innerHTML = searchBody([card()]);
    expect(JSON.stringify(read())).not.toContain(DESCRIPTION);
  });
});

describe('scheda', () => {
  it('legge il privato dal titolo, dal prezzo e dalle caratteristiche', () => {
    renderDetail(document, { drop: { from: '450.000 €', pct: '1%' } });
    expect(read(DETAIL_URL)).toEqual({
      errors: [],
      observations: [{
        portal: 'idealista', portalId: 37118651, url: DETAIL_URL,
        title: 'Bilocale in Via Esempio, 2, Mercalli - Quadronno, Milano', address: 'Via Esempio, 2', city: 'Milano',
        zone: 'Mercalli - Quadronno', typology: 'Bilocale', surfaceM2: 52, rooms: 2, price: 445000, sellerType: 'private',
        portalCreatedAt: null, lastDrop: { fromPrice: 450000, toPrice: 445000, percent: 1.1, date: null }, source: 'detail',
      }],
    });
  });

  it('agenzia e venditore non riconoscibile', () => {
    renderDetail(document, { seller: 'agency' });
    expect(read(DETAIL_URL).observations[0]!.sellerType).toBe('agency');
    renderDetail(document, { seller: 'none' });
    expect(read(DETAIL_URL).observations[0]!.sellerType).toBe('unknown');
  });

  it('ignora gli annunci correlati in fondo alla scheda', () => {
    renderDetail(document, { related: [card({ id: 1 }), card({ id: 2 })] });
    expect(read(DETAIL_URL).observations.map((o) => o.portalId)).toEqual([37118651]);
  });

  it('ignora gli affitti', () => {
    renderDetail(document, { title: 'Bilocale in affitto in Via Esempio, 2, Brera, Milano' });
    expect(read(DETAIL_URL)).toEqual({ observations: [], errors: [] });
  });

  it('non salva mai il nome del venditore né la descrizione', () => {
    renderDetail(document);
    const text = JSON.stringify(read(DETAIL_URL));
    expect(text).not.toContain(SELLER_NAME);
    expect(text).not.toContain(DESCRIPTION);
  });

  it('senza blocco prezzo segnala un errore', () => {
    renderDetail(document);
    document.querySelector('.info-data')!.remove();
    expect(read(DETAIL_URL).errors).toEqual(['detail: prezzo non trovato']);
  });
});

describe('card in pagina', () => {
  it('trova la card, il contenitore della foto e gli ID', () => {
    document.body.innerHTML = searchBody([card({ id: 1 }), AD_SLOT, card({ id: 2, professional: 'true' })]);
    const c = A.cardFor(document, 1)!;
    expect(c.getAttribute('data-element-id')).toBe('1');
    expect(A.badgeHost(c).className).toBe('item-multimedia');
    expect(A.cardFor(document, 99)).toBeNull();
    expect(A.cardIds(document)).toEqual([1, 2]);
  });
});
```

- [ ] **Step 3: Test del badge su card Idealista** — in `tests/unit/content/badges.test.ts` aggiungi:

```ts
import { idealistaAdapter } from '@/adapters/idealista';
import { card, searchBody } from '../adapters/idealista-builders';
```

```ts
  it('su Idealista mette il badge nel contenitore della foto della card', () => {
    document.body.innerHTML = searchBody([card({ id: 111 })]);
    expect(renderBadge(document, ev(), idealistaAdapter)).toBe('created');
    expect(document.querySelectorAll(`article .item-multimedia > [${BADGE_ATTR}]`)).toHaveLength(1);
  });
```

- [ ] **Step 4: Verifica che falliscano**

Run: `npx vitest run tests/unit/adapters/idealista.test.ts tests/unit/content/badges.test.ts`
Expected: FAIL (moduli `@/adapters/idealista…` inesistenti).

- [ ] **Step 5: `src/adapters/idealista/urls.ts`**

```ts
import type { PageKind } from '@/shared/types';

const BASE = 'https://www.idealista.it';

function urlOf(url: string): URL | null {
  try {
    return new URL(url, BASE);
  } catch {
    return null;
  }
}

export function pageKind(url: string): PageKind {
  const path = urlOf(url)?.pathname ?? '';
  if (/^\/immobile\/\d+\/?$/.test(path)) return 'detail';
  if (/^\/vendita-[a-z-]+\//.test(path)) return 'search';
  return 'other';
}

export function listingIdFromHref(href: string): number | null {
  const m = /\/immobile\/(\d+)\//.exec(href);
  return m ? Number(m[1]) : null;
}

/** Prima pagina dell'ordinamento "più recenti": gli annunci in cima sono di oggi. */
export function isNewestFirst(url: string): boolean {
  const u = urlOf(url);
  return !!u && pageKind(url) === 'search' && u.searchParams.get('ordine') === 'pubblicazione-desc' && !/\/lista-\d+\.htm$/.test(u.pathname);
}
```

- [ ] **Step 6: `src/adapters/idealista/parse.ts`**

```ts
// Funzioni pure sul DOM già mostrato da Idealista. Si leggono solo i nodi elencati qui:
// descrizioni, nome del venditore (.professional-name) e contatti non vengono mai letti.
import { parseEuro } from '@/adapters/immobiliare/format';
import type { ListingObservation, ObservationSource, ObservedPriceDrop, ParseResult, SellerType } from '@/shared/types';
import { listingIdFromHref } from './urls';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const round1 = (n: number) => Math.round(n * 10) / 10;
const STREET = /^(via|viale|piazza|piazzale|corso|largo|vicolo|strada|località|loc\.|borgo|contrada|lungomare|salita)\b/i;

export const listingUrl = (id: number) => `https://www.idealista.it/immobile/${id}/`;

export interface TitleParts {
  typology: string | null;
  address: string | null;
  zone: string | null;
  city: string | null;
}

/** "Trilocale in Via X, 27, Zona, Milano"; la scheda ha "Bilocale in vendita in …". */
export function parseTitle(title: string): TitleParts {
  const m = /^(.+?) in (?:vendita in )?(.+)$/.exec(title.trim());
  if (!m) return { typology: null, address: null, zone: null, city: null };
  const parts = m[2]!.split(',').map((s) => s.trim()).filter(Boolean);
  const city = parts.pop() ?? null;
  let zone: string | null = null;
  if (parts.length > 1 || (parts.length === 1 && !STREET.test(parts[0]!))) zone = parts.pop()!;
  return { typology: m[1]!.trim(), address: parts.length ? parts.join(', ') : null, zone, city };
}

function parseFeatures(items: string[]): { rooms: number | null; surfaceM2: number | null } {
  let rooms: number | null = null;
  let surfaceM2: number | null = null;
  for (const t of items) {
    const r = /^(\d+)\s+local[ei]\b/i.exec(t);
    if (r) rooms = Number(r[1]);
    const s = /^([\d.]+)\s*m²/.exec(t);
    if (s) surfaceM2 = Number(s[1]!.replace(/\./g, ''));
  }
  return { rooms, surfaceM2 };
}

function parseDrop(scope: Element, price: number | null): ObservedPriceDrop | null {
  if (price == null) return null;
  const fromPrice = parseEuro(text(scope.querySelector('.pricedown_price')));
  if (fromPrice == null || !(fromPrice > price)) return null;
  return { fromPrice, toPrice: price, percent: round1(((fromPrice - price) / fromPrice) * 100), date: null };
}

function observation(
  id: number, url: string, title: string, price: number | null, features: string[], sellerType: SellerType,
  lastDrop: ObservedPriceDrop | null, source: ObservationSource,
): ListingObservation {
  const t = parseTitle(title);
  return {
    portal: 'idealista', portalId: id, url, title, address: t.address, city: t.city, zone: t.zone, typology: t.typology,
    ...parseFeatures(features), price, sellerType, portalCreatedAt: null, lastDrop, source,
  };
}

function sellerOfCard(card: Element): SellerType {
  const v = card.getAttribute('data-is-professional-ad');
  return v === 'false' ? 'private' : v === 'true' ? 'agency' : 'unknown';
}

export function parseSearch(root: ParentNode): ParseResult {
  const out: ParseResult = { observations: [], errors: [] };
  root.querySelectorAll('article.item').forEach((card, i) => {
    const id = Number(card.getAttribute('data-element-id'));
    const link = card.querySelector('a.item-link');
    const title = link?.getAttribute('title')?.trim() || text(link);
    if (!Number.isInteger(id) || id <= 0 || !title) {
      out.errors.push(`card[${i}]: id o titolo mancanti`);
      return;
    }
    const price = parseEuro(text(card.querySelector('.item-price')));
    const features = [...card.querySelectorAll('.item-detail')].map((d) => text(d));
    out.observations.push(observation(id, listingUrl(id), title, price, features, sellerOfCard(card), parseDrop(card, price), 'search'));
  });
  return out;
}

function docOf(root: ParentNode): Document {
  return (root as Node).ownerDocument ?? (root as Document);
}

export function parseDetail(root: ParentNode, url: string): ParseResult {
  const id = listingIdFromHref(url);
  const fullTitle = docOf(root).title.split(' — ')[0]!.trim();
  if (!id || !fullTitle) return { observations: [], errors: ['detail: id o titolo mancanti'] };
  if (!fullTitle.includes(' in vendita in ')) return { observations: [], errors: [] }; // solo vendita
  const info = root.querySelector('.info-data');
  if (!info) return { observations: [], errors: ['detail: prezzo non trovato'] };
  const price = parseEuro(text(info.querySelector('.info-data-price')));
  const features = [...root.querySelectorAll('.info-features > span')].map((s) => text(s));
  // Solo presenza dei nodi: il testo di .professional-name è il nome del venditore e non va letto.
  const sellerType: SellerType = root.querySelector('.professional-name .particular')
    ? 'private'
    : root.querySelector('.professional-name') ? 'agency' : 'unknown';
  const title = fullTitle.replace(' in vendita in ', ' in ');
  return { observations: [observation(id, listingUrl(id), title, price, features, sellerType, parseDrop(info, price), 'detail')], errors: [] };
}
```

Nota: in `parseSearch` gli ID vengono validati e un `article.item` senza `data-element-id` dà `NaN`, quindi un errore. Le pubblicità sono `article.adv` senza classe `item`, quindi non vengono selezionate.

- [ ] **Step 7: `src/adapters/idealista/index.ts`**

```ts
import type { PortalAdapter } from '@/adapters/types';
import { parseDetail, parseSearch } from './parse';
import { isNewestFirst, pageKind } from './urls';

export const idealistaAdapter: PortalAdapter = {
  portal: 'idealista',
  pageKind,
  readDocument(root, url) {
    const kind = pageKind(url);
    if (kind === 'detail') return parseDetail(root, url);
    if (kind !== 'search') return { observations: [], errors: [] };
    const result = parseSearch(root);
    if (isNewestFirst(url) && result.observations.length) {
      result.newestId = Math.max(...result.observations.map((o) => o.portalId));
    }
    return result;
  },
  cardFor: (root, id) => root.querySelector<HTMLElement>(`article.item[data-element-id="${id}"]`),
  badgeHost: (card) => card.querySelector<HTMLElement>('.item-multimedia') ?? card.querySelector('picture')?.parentElement ?? card,
  cardIds: (root) =>
    [...root.querySelectorAll('article.item[data-element-id]')]
      .map((a) => Number(a.getAttribute('data-element-id')))
      .filter((id) => id > 0),
};
```

- [ ] **Step 8: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/idealista tests/unit/adapters/idealista-builders.ts tests/unit/adapters/idealista.test.ts tests/unit/content/badges.test.ts
git commit -m "feat(idealista): DOM adapter for search cards and listing pages"
```

---

### Task 6: Content script Idealista e manifest

**Files:**
- Create: `src/entrypoints/idealista.content.ts`
- Modify: `wxt.config.ts`, `package.json` (description)
- Test: `tests/unit/content/controller.test.ts`

**Interfaces:**
- Consumes: `idealistaAdapter` (Task 5), `createController().scan` (Task 4).

- [ ] **Step 1: Test di integrazione controller + adattatore reale** — in `tests/unit/content/controller.test.ts`:

```ts
import { idealistaAdapter } from '@/adapters/idealista';
import { card, NEWEST_URL, searchBody } from '../adapters/idealista-builders';
```

```ts
describe('createController con l\'adattatore Idealista', () => {
  it('ingerisce le card della pagina "più recenti", disegna i badge solo sui privati e passa il candidato', async () => {
    document.body.innerHTML = searchBody([card({ id: 37142258, professional: 'true' }), card({ id: 37142311 })]);
    const send = fakeSend();
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => NEWEST_URL });
    await c.scan();
    expect(send.mock.calls[0]![0]).toMatchObject({ type: 'parseStatus', portal: 'idealista', ok: true, source: 'dom' });
    expect(send.mock.calls[1]![0]).toMatchObject({ type: 'ingest', calibrationHint: { portal: 'idealista', portalId: 37142311 } });
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    expect(document.querySelector(`article[data-element-id="37142311"] [${BADGE_ATTR}]`)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Verifica**

Run: `npx vitest run tests/unit/content/controller.test.ts`
Expected: PASS. Il test documenta il collegamento: se fallisce, il problema è in Task 4 o 5 e va corretto lì.

- [ ] **Step 3: `src/entrypoints/idealista.content.ts`**

```ts
import { idealistaAdapter } from '@/adapters/idealista';
import { createController } from '@/content/controller';
import { send } from '@/shared/messages';

// Idealista è renderizzato lato server: si legge il DOM già mostrato, senza bridge.
// La pagina non viene modificata, se non per aggiungere i badge.
export default defineContentScript({
  matches: ['https://www.idealista.it/*'],
  runAt: 'document_idle',
  main(ctx) {
    const controller = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => location.href });
    const scan = () => controller.scan().catch((err) => console.warn('[HomeRadar]', err));
    scan();

    // Card caricate dopo (lazy-load) o rigenerate dal sito: nuova lettura con debounce.
    // scan() senza card nuove riapplica solo i badge, quindi i badge inseriti non creano cicli.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(scan, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
```

- [ ] **Step 4: Manifest** — in `wxt.config.ts`:

```ts
    description: 'Evidenzia gli annunci di privati maturi su Immobiliare.it e Idealista.it',
    permissions: ['sidePanel', 'alarms', 'clipboardWrite'],
    host_permissions: ['https://www.immobiliare.it/*', 'https://www.idealista.it/*'],
```

In `package.json`: `"description": "Estensione Chrome per agenti immobiliari: annunci di privati maturi su Immobiliare.it e Idealista.it"`.

- [ ] **Step 5: Verifica build**

Run: `npm run typecheck && npm run build`
Expected: build OK; `.output/chrome-mv3/manifest.json` contiene un content script con `https://www.idealista.it/*` e il nuovo `host_permissions`. Controlla con
`node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(JSON.stringify([m.host_permissions,m.content_scripts.map(c=>[c.matches,c.world||'ISOLATED'])]))"`
Expected: il content script Idealista è `ISOLATED` e c'è un solo script MAIN, quello di Immobiliare.

- [ ] **Step 6: Commit**

```bash
git add src/entrypoints/idealista.content.ts wxt.config.ts package.json tests/unit/content/controller.test.ts
git commit -m "feat(idealista): content script and host permission"
```

---

### Task 7: Portale nel pannello e nell'export

**Files:**
- Modify: `src/shared/types.ts`, `src/core/export.ts`, `src/ui/sidepanel/LeadItem.tsx`, `src/ui/sidepanel/App.tsx`, `src/ui/sidepanel/styles.css`, `tests/e2e/extension.spec.ts`
- Test: `tests/unit/core/export.test.ts`, `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `PORTAL_SITES` (Task 3).
- Produces: `PORTAL_TAGS: Record<Portal, string>`; colonna export `'Portale'`, subito dopo `'Stato'`.

- [ ] **Step 1: Test**
  - `tests/unit/core/export.test.ts`:
    - nell'oggetto atteso di `mappa tutte le colonne`, dopo `'Stato': 'Da contattare',` aggiungi `'Portale': 'Immobiliare.it',`;
    - riga 38: `'﻿Priorità;Stato;Titolo;'` → `'﻿Priorità;Stato;Portale;Titolo;'`.
  - `tests/unit/ui/sidepanel.test.tsx`:
    - testo atteso della lista vuota → `'Nessun lead in questa scheda. Naviga su Immobiliare.it o Idealista.it per raccoglierne.'`;
    - aggiungi in `describe('LeadItem')`:

```ts
  it('mostra il portale di provenienza', () => {
    const l = lead(1, 'high');
    const fromIdealista = { ...l, listing: { ...l.listing, key: 'idealista:1', portal: 'idealista' as const } };
    render(<ul><LeadItem lead={fromIdealista} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Idealista').className).toBe('portal-tag');
  });
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/export.test.ts tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Tipi** — in `src/shared/types.ts`, dopo `PORTAL_SITES`:

```ts
export const PORTAL_TAGS: Record<Portal, string> = { immobiliare: 'Immobiliare', idealista: 'Idealista' };
```

- [ ] **Step 4: Export** — in `src/core/export.ts`:
  - colonne: `'Priorità', 'Stato', 'Portale', 'Titolo', …`;
  - import `PORTAL_SITES` da `@/shared/types`;
  - nella riga, dopo `'Stato': …`, aggiungi `'Portale': PORTAL_SITES[l.portal],`.

- [ ] **Step 5: `LeadItem.tsx`** — importa `PORTAL_TAGS` e sostituisci il blocco `lead__top`:

```tsx
      <div className="lead__top">
        <div className="lead__tags">
          {evaluation.priority !== 'none' && (
            <span className={`pill pill--${evaluation.priority}`}>{PRIORITY_LABELS[evaluation.priority]}</span>
          )}
          <span className="portal-tag">{PORTAL_TAGS[listing.portal]}</span>
        </div>
        <Sparkline prices={prices.map((p) => p.price)} />
      </div>
```

- [ ] **Step 6: CSS** — in `src/ui/sidepanel/styles.css`, dopo le regole `.lead__top`:

```css
.lead__tags { display: flex; align-items: center; gap: 6px; }
.portal-tag {
  padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--surface-muted); color: var(--muted); font-size: 11px; font-weight: 500;
}
```

Rimuovi la regola `.lead__top:has(> :only-child.sparkline) { … }`: c'è sempre l'etichetta, quindi non serve più.

- [ ] **Step 7: Testo della lista vuota** — in `App.tsx` sostituisci `'Nessun lead in questa scheda. Naviga su Immobiliare.it per raccoglierne.'` con `'Nessun lead in questa scheda. Naviga su Immobiliare.it o Idealista.it per raccoglierne.'`.

- [ ] **Step 8: E2E esistente** — in `tests/e2e/extension.spec.ts` sostituisci `expect(csv).toContain('Priorità;Stato;Titolo;Indirizzo');` con `expect(csv).toContain('Priorità;Stato;Portale;Titolo;Indirizzo');`.

- [ ] **Step 9: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/core/export.ts src/ui/sidepanel tests/unit tests/e2e/extension.spec.ts
git commit -m "feat(sidepanel): portal tag on leads and Portale export column"
```

---

### Task 8: Fixture reali di Idealista (serve l'utente)

**Files:**
- Modify: `scripts/sanitize-fixture.mjs`
- Create: `tests/fixtures/idealista/search-privati.html`, `detail-private.html`, `detail-agency.html`, `tests/unit/adapters/idealista.fixtures.test.ts`
- Eventualmente modify: `src/adapters/idealista/parse.ts`, `src/adapters/idealista/index.ts` (solo selettori smentiti dalle fixture)

**Interfaces:**
- Consumes: `idealistaAdapter`, `parseTitle` (Task 5).

- [ ] **Step 1: Chiedi all'utente le pagine** — fermati e chiedi, navigando normalmente in Chrome (non con automazione: DataDome), di salvare con Ctrl+S → "Pagina web, solo HTML":
  1. `https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc` → `fixtures-raw/idealista-search.html`. La pagina deve contenere privati, agenzie, almeno un ribasso e una pubblicità: in quell'ordinamento i privati sono in cima e le agenzie compaiono più in basso o in pagina 2. Se la prima pagina ha solo privati, salva anche una seconda pagina con agenzie come `fixtures-raw/idealista-search-2.html`.
  2. La scheda di un privato con ribasso (badge "↓ x%" nella card) → `fixtures-raw/idealista-detail-private.html`.
  3. La scheda di un'agenzia → `fixtures-raw/idealista-detail-agency.html`.

  Attendi la conferma prima di proseguire.

- [ ] **Step 2: Verifica i selettori sui file grezzi** — in locale, senza commit:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom';
for (const f of ['idealista-search','idealista-detail-private','idealista-detail-agency']) {
  const d = new JSDOM(readFileSync('fixtures-raw/'+f+'.html','utf8')).window.document;
  console.log(f, {
    cards: d.querySelectorAll('article.item[data-element-id]').length,
    priv: d.querySelectorAll('article.item[data-is-professional-ad=\"false\"]').length,
    drops: d.querySelectorAll('article.item .pricedown_price').length,
    multimedia: d.querySelectorAll('article.item .item-multimedia').length,
    infoData: !!d.querySelector('.info-data .info-data-price'), features: d.querySelectorAll('.info-features > span').length,
    particular: !!d.querySelector('.professional-name .particular'), professional: !!d.querySelector('.professional-name'),
    title: d.title.slice(0, 40).replace(/in .*/, 'in …'),
  });
}"
```

Expected:
- `idealista-search`: `cards` ≥ 20, `priv` > 0, `drops` > 0, `multimedia` = `cards`.
- Schede: `infoData: true`, `features` ≥ 2.
- Privato: `particular: true`.
- Agenzia: `particular: false`, `professional: true`.

Se un valore non torna, correggi il selettore in `parse.ts`/`index.ts` e il builder in `idealista-builders.ts` perché rifletta la struttura reale, poi riesegui `npm test`. Esempi: un altro contenitore per la foto, oppure l'agenzia senza `.professional-name` ma con `.logo-branding`, nel qual caso la regola diventa `.professional-name, .logo-branding` → `agency`.

- [ ] **Step 3: Sanitizzazione HTML** — in `scripts/sanitize-fixture.mjs`:
  - estendi l'uso e il controllo dei tipi:

```js
// Uso: node scripts/sanitize-fixture.mjs <search|detail|api|idealista-search|idealista-detail> <input> <output>
```

```js
const KINDS = ['search', 'detail', 'api', 'idealista-search', 'idealista-detail'];
if (!KINDS.includes(kind) || !input || !output) {
  console.error(`Uso: node scripts/sanitize-fixture.mjs <${KINDS.join('|')}> <input> <output>`);
  process.exit(1);
}
```

  - Prima della riga `const raw = JSON.parse(...)`, aggiungi il ramo Idealista, che termina con `process.exit(0)`:

```js
if (kind.startsWith('idealista-')) {
  const { JSDOM } = await import('jsdom');
  const { document } = new JSDOM(readFileSync(input, 'utf8')).window;
  // Tipologia, zona e città restano; via e civico diventano "Via Esempio N".
  const anonymizeTitle = (title, n) => {
    const m = /^(.+?) in (vendita in )?(.+)$/.exec(title.trim());
    if (!m) return `Appartamento in Via Esempio ${n}, Centro, Milano`;
    const parts = m[3].split(',').map((s) => s.trim()).filter(Boolean);
    const city = parts.pop() ?? 'Milano';
    const zone = parts.length > 1 ? parts.pop() : 'Centro';
    return `${m[1]} in ${m[2] ?? ''}Via Esempio ${n}, ${zone}, ${city}`;
  };
  const KEEP_ATTRS = new Set(['class', 'data-element-id', 'data-is-professional-ad', 'href', 'title']);
  const scrubNode = (root) => {
    root.querySelectorAll('script, style, noscript, iframe, img, source, svg, .item-description, .item-toolbar, .contact-phones, [class*="phone"], [class*="contact"], .logo-branding').forEach((e) => e.remove());
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) if (!KEEP_ATTRS.has(a.name)) el.removeAttribute(a.name);
      if (el.tagName === 'A' && !el.classList.contains('item-link')) el.removeAttribute('href');
    }
    return root;
  };
  let html;
  if (kind === 'idealista-search') {
    const cards = [...document.querySelectorAll('article.item, article.adv')].map((c, i) => {
      const link = c.querySelector('a.item-link');
      if (link) {
        const t = anonymizeTitle(link.getAttribute('title') || link.textContent, i + 1);
        link.setAttribute('title', t);
        link.textContent = t;
      }
      return scrubNode(c).outerHTML;
    });
    html = `<main id="main-content"><section class="items-container items-list">\n${cards.join('\n')}\n</section></main>`;
    document.title = 'Fixture Idealista — ricerca';
  } else {
    const info = document.querySelector('.info-data');
    const features = document.querySelector('.info-features');
    // Del blocco inserzionista resta solo la struttura che distingue privato e agenzia, senza nomi.
    const seller = document.querySelector('.professional-name .particular')
      ? '<div class="professional-name"><span class="particular">Privato</span></div>'
      : document.querySelector('.professional-name') ? '<div class="professional-name"><span>Agenzia</span></div>' : '';
    html = `<main class="detail-container">${info ? scrubNode(info).outerHTML : ''}${features ? scrubNode(features).outerHTML : ''}<aside class="advertiser-name">${seller}</aside></main>`;
    document.title = `${anonymizeTitle(document.title.split(' — ')[0], 1)} — idealista, N.1 in Italia`;
  }
  const out = `<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><title>${document.title}</title></head><body>\n${html}\n</body></html>\n`;
  const suspicious = out.match(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/g);
  if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
  writeFileSync(output, out);
  console.log(`OK: ${output}`);
  process.exit(0);
}
```

  Se nello Step 2 hai cambiato la regola dell'agenzia, applica la stessa regola alla variabile `seller` qui sopra.

- [ ] **Step 4: Genera le fixture**

```bash
mkdir -p tests/fixtures/idealista
node scripts/sanitize-fixture.mjs idealista-search fixtures-raw/idealista-search.html tests/fixtures/idealista/search-privati.html
node scripts/sanitize-fixture.mjs idealista-detail fixtures-raw/idealista-detail-private.html tests/fixtures/idealista/detail-private.html
node scripts/sanitize-fixture.mjs idealista-detail fixtures-raw/idealista-detail-agency.html tests/fixtures/idealista/detail-agency.html
```

Expected: tre righe `OK:` e nessun avviso di telefoni. Apri i file e controlla a occhio che non contengano nomi, descrizioni o vie reali.

- [ ] **Step 5: Test sulle fixture** — crea `tests/unit/adapters/idealista.fixtures.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idealistaAdapter as A } from '@/adapters/idealista';

const read = (name: string) => readFileSync(`tests/fixtures/idealista/${name}`, 'utf8');
const parse = (name: string) => new DOMParser().parseFromString(read(name), 'text/html');
const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/;
const SEARCH = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc';

describe.each(['search-privati.html', 'detail-private.html', 'detail-agency.html'])('fixture %s', (name) => {
  it('non contiene dati personali né script', () => {
    const text = read(name);
    expect(text).not.toMatch(PHONE);
    expect(text).not.toContain('<script');
    expect(text).not.toContain('item-description');
  });

  it('ha titoli sintetici (nessuna via reale)', () => {
    const doc = parse(name);
    const titles = [doc.title, ...[...doc.querySelectorAll('a.item-link')].map((a) => a.getAttribute('title') ?? '')];
    for (const t of titles.filter((x) => !x.startsWith('Fixture'))) expect(t).toMatch(/Via Esempio \d+/);
  });
});

describe('adattatore Idealista sulle fixture reali', () => {
  it('legge la ricerca senza errori, con privati, agenzie e ribassi', () => {
    const r = A.readDocument!(parse('search-privati.html'), SEARCH);
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
    expect(r.observations.some((o) => o.sellerType === 'private')).toBe(true);
    expect(r.observations.some((o) => o.sellerType === 'agency')).toBe(true);
    expect(r.observations.some((o) => o.lastDrop)).toBe(true);
    expect(r.observations.every((o) => o.sellerType !== 'unknown')).toBe(true);
    for (const o of r.observations) expect(o.url).toMatch(/^https:\/\/www\.idealista\.it\/immobile\/\d+\/$/);
  });

  it('trova il contenitore della foto su ogni card', () => {
    const doc = parse('search-privati.html');
    for (const id of A.cardIds(doc)) {
      const c = A.cardFor(doc, id)!;
      expect(A.badgeHost(c)).not.toBe(c);
    }
  });

  it('legge la scheda di un privato e quella di un\'agenzia', () => {
    const url = 'https://www.idealista.it/immobile/37118651/';
    const p = A.readDocument!(parse('detail-private.html'), url);
    expect(p.errors).toEqual([]);
    expect(p.observations[0]).toMatchObject({ sellerType: 'private', source: 'detail' });
    expect(p.observations[0]!.price).toBeGreaterThan(0);
    expect(A.readDocument!(parse('detail-agency.html'), url).observations[0]!.sellerType).toBe('agency');
  });
});
```

Se la ricerca salvata non ha agenzie, usa la seconda pagina dello Step 1 come terza fixture di ricerca e aggiungila al `describe.each`.

- [ ] **Step 6: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/sanitize-fixture.mjs tests/fixtures/idealista tests/unit/adapters/idealista.fixtures.test.ts src/adapters/idealista tests/unit/adapters/idealista-builders.ts
git commit -m "test(idealista): sanitized real-site fixtures and HTML sanitizer"
```

---

### Task 9: E2E, smoke test e documentazione

**Files:**
- Create: `tests/e2e/idealista.spec.ts`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: fixture `tests/fixtures/idealista/search-privati.html` (Task 8); `.portal-tag` (Task 7).

- [ ] **Step 1: Test E2E** — crea `tests/e2e/idealista.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

const html = readFileSync('tests/fixtures/idealista/search-privati.html', 'utf8');
const privates = (html.match(/data-is-professional-ad="false"/g) ?? []).length;
const SEARCH = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc';

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: il "sito" è servito dalla fixture.
  await context.route(/^https?:\/\/(?!www\.idealista\.it\/)/, (route) => route.abort());
  await context.route('https://www.idealista.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/vendita-case/')) return route.fulfill({ contentType: 'text/html', body: html });
    return route.fulfill({ status: 404, body: '' });
  });
});

test('Idealista: badge solo sui privati', async ({ context }) => {
  expect(privates).toBeGreaterThan(0);
  const page = await context.newPage();
  await page.goto(SEARCH);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(privates);
  await expect(page.locator('article[data-is-professional-ad="true"] [data-homeradar-badge]')).toHaveCount(0);
});

test('Idealista: i lead compaiono nel pannello con l\'etichetta del portale', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead').first()).toBeVisible();
  await expect(panel.locator('.lead .portal-tag').first()).toHaveText('Idealista');
});
```

Nota: il pannello mostra solo i lead con priorità o con stato diverso da "nuovo". Se nella fixture nessun privato ha ribassi o età ≥ 120 giorni, il secondo test fallisce: in quel caso imposta la soglia a 0 dalle impostazioni del pannello prima dell'asserzione, oppure scegli in Task 8 una pagina con ribassi.

- [ ] **Step 2: Esegui gli E2E**

Run: `npm run test:e2e`
Expected: PASS, compresi i 4 test di Immobiliare.

- [ ] **Step 3: Smoke test** — in `docs/smoke-test.md`:
  - sostituisci il titolo della prima sezione numerata con `## Immobiliare.it`, preceduto da una riga vuota;
  - prima della riga finale "Se il sito è cambiato…" aggiungi:

```markdown
## Idealista.it

Naviga a mano, senza automazione: Idealista usa DataDome.

12. Apri `https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc`.
    - [ ] Badge sulla foto di ogni privato; nessun badge su agenzie e pubblicità.
13. Vai alla pagina 2 con il link del sito (la pagina si ricarica).
    - [ ] Badge sulla nuova pagina; nessun banner "ricarica".
14. Apri la scheda di un privato con ribasso.
    - [ ] Nel pannello il lead ha l'etichetta "Idealista" e "Ribassato del …% (… → … €) rilevato il gg/mm".
15. Apri `?ordine=pubblicazione-desc` (prima pagina), poi Impostazioni → "Copia report diagnostico".
    - [ ] Il report non segnala avvisi per Idealista.it e ha il contatore `domScans`.
16. Export XLSX/CSV.
    - [ ] Colonna "Portale" con "Idealista.it" / "Immobiliare.it".
17. Console di Chrome sulla pagina di ricerca.
    - [ ] Nessun errore `[HomeRadar]`.
```

  - Aggiorna la riga finale: `Se il sito è cambiato: ricattura le fixture (Immobiliare: piano MVP, Task 4; Idealista: piano 2026-10-13, Task 8), aggiorna schemi o selettori, riesegui npm test.`

- [ ] **Step 4: `CLAUDE.md`**
  - Prima riga descrittiva: "su Immobiliare.it riconosce…" → "su Immobiliare.it e Idealista.it riconosce…".
  - Sezione Architettura, sostituisci la riga del flusso con:

```markdown
Flusso Immobiliare: `bridge (MAIN world) → content script (ISOLATED) → adapter.parsePayload → background → IndexedDB → side panel`.
Flusso Idealista: `content script (ISOLATED) → adapter.readDocument (DOM già mostrato) → background → …`, nessun bridge.
```

  - Aggiungi dopo la riga di `src/adapters/immobiliare/`:

```markdown
- `src/adapters/idealista/`: funzioni pure sul DOM delle card (`article.item[data-element-id]`, `data-is-professional-ad`). Nessuna data di pubblicazione: l'età si stima dall'ID (`DEFAULT_CALIBRATION.idealista` in `core/age.ts`, più i punti appresi dalla pagina "più recenti"). Non leggere mai `.professional-name` (nome del privato).
- `src/adapters/types.ts`: `PortalAdapter` con modalità `parsePayload` (bridge) o `readDocument` (DOM), più `cardFor`/`badgeHost`/`cardIds` per i badge.
```

  - In "Vincoli", ultima riga: "Se Immobiliare.it cambia struttura…" → "Se un portale cambia struttura: aggiorna schemi (Immobiliare) o selettori (Idealista, `parse.ts`), ricattura le fixture (vedi `docs/smoke-test.md`), non modificare le fixture a mano."

- [ ] **Step 5: Verifica finale**

Run: `npm test && npm run typecheck && npm run build`
Expected: tutto verde.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/idealista.spec.ts docs/smoke-test.md CLAUDE.md
git commit -m "test(e2e): Idealista badges and panel; docs for the second portal"
```

- [ ] **Step 7: Smoke test sul sito reale** — chiedi all'utente di caricare `.output/chrome-mv3` in Chrome e di eseguire le sezioni Immobiliare e Idealista di `docs/smoke-test.md`. Riporta l'esito.
