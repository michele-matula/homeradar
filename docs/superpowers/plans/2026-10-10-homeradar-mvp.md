# HomeRadar MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estensione Chrome (MV3) che, mentre l'agente naviga Immobiliare.it, riconosce gli annunci di privati, ne costruisce lo storico prezzi in locale, mostra un badge di priorità sulle card e gestisce i lead in un pannello laterale con export XLSX/CSV.

**Architecture:** Un "ponte" nel contesto della pagina (MAIN world) legge `__NEXT_DATA__` e intercetta le risposte XHR del sito; il content script (ISOLATED world) le passa a un adattatore puro (zod, lista di campi ammessi) e invia le osservazioni al background, unico scrittore su IndexedDB (Dexie), che applica un motore regole puro. Il pannello laterale React legge tutto via messaggi. Se l'intercettazione non arriva, il content script mostra un banner "ricarica".

**Tech Stack:** WXT 0.20 (Manifest V3) · TypeScript · React 19 · Dexie 4 · zod 4 · SheetJS (xlsx 0.20.3 dal CDN ufficiale) · Vitest + jsdom + fake-indexeddb + Testing Library · Playwright.

**Spec:** `docs/superpowers/specs/2026-10-10-homeradar-mvp-design.md`

## Global Constraints

- Solo `https://www.immobiliare.it/*`, solo vendita (`/vendita-…/` e `/annunci/{id}/`).
- L'estensione **non effettua mai richieste HTTP proprie** verso il portale: legge solo `__NEXT_DATA__` e le risposte delle richieste fatte dal sito.
- Nessun backend, nessuna richiesta di rete verso altri host: tutti i dati restano in IndexedDB.
- Si salvano **solo annunci di privati** (`advertiser.agency` assente e `advertiser.supervisor.type === "user"`).
- Telefoni, nomi del venditore, descrizioni e foto **non escono mai dall'adattatore** (gli schemi zod eliminano i campi non dichiarati).
- Soglie predefinite: `minAgeDays = 120`, `minDropPercent = 0`, `retentionDays = 90`; margine di incertezza dell'età stimata: `±15` giorni.
- Lead = privato **e** (A anzianità **oppure** B ribasso). Alta = A e B; Media = solo uno; Da verificare = età stimata nell'intervallo `[soglia−15, soglia+15)` senza B.
- Badge: `● Alta · 173 gg · −5,6%`, `● Media · ~170 gg`, `◐ Da verificare · ~112 gg`, `Privato · 45 gg`. `~` = età stimata. Agenzie: nessun badge.
- Badge sovrapposto in alto a sinistra della foto, `pointer-events: none`.
- Testi dell'interfaccia in italiano. Numeri in formato italiano (`235.000`, `5,6`).
- Fixture del portale nel repository **solo dopo la sanitizzazione** (`scripts/sanitize-fixture.mjs`); i file grezzi stanno in `fixtures-raw/` (ignorata da git). Il repository è **pubblico**.
- Timestamp interni sempre in millisecondi epoch (UTC).
- Ogni messaggio di commit termina con la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Prezzo nascosto** ("Prezzo su richiesta", `price.visible === false` o `value` assente): nessun crash, prezzo `null`, nessun ribasso calcolato. Test nei Task 3 e 6.
2. **Stesso annuncio ricevuto due volte nella stessa visita** (`__NEXT_DATA__` + XHR, o due schede in parallelo): un solo `leadState`, nessuno snapshot duplicato, `seenCount` incrementato una volta ogni 30 minuti. Test nel Task 7.
3. **Prezzo rialzato dopo un ribasso**: il calo si calcola sul massimo noto; se il prezzo torna al massimo il segnale B si spegne. Test nel Task 6.
4. **ID fuori dall'intervallo di calibrazione** (data stimata nel futuro): età bloccata a 0, mai negativa. Test nei Task 5 e 6.
5. **Export con testi ostili** (note o titoli che iniziano con `=`, `+`, `-`, `@` oppure contengono `;`, virgolette, a capo): CSV correttamente quotato e senza formule eseguibili in Excel. Test nel Task 9.

---

## File Structure

```
homeradar/
├── package.json · wxt.config.ts · tsconfig.json · vitest.config.ts · playwright.config.ts
├── scripts/sanitize-fixture.mjs          # ripulisce le fixture catturate dal portale
├── src/
│   ├── shared/
│   │   ├── types.ts                      # tutti i tipi di dominio + costanti
│   │   ├── format.ts                     # formattazione italiana (euro, %, date)
│   │   └── messages.ts                   # tipi Request/Response + send() lato client
│   ├── adapters/
│   │   ├── types.ts                      # interfaccia PortalAdapter
│   │   └── immobiliare/
│   │       ├── urls.ts                   # pageKind, isListingsApiUrl, listingIdFromHref (senza zod: usato dal ponte)
│   │       ├── format.ts                 # parsing "€ 249.000", "5,6", "21/09/2026", "65 m²"
│   │       ├── schemas.ts                # schemi zod (lista campi ammessi)
│   │       └── index.ts                  # parse + immobiliareAdapter
│   ├── core/
│   │   ├── age.ts                        # stima data di creazione da ID
│   │   ├── rules.ts                      # motore regole (puro)
│   │   ├── leads.ts                      # ordinamento, raggruppamento, etichette
│   │   ├── settings.ts                   # validazione impostazioni
│   │   ├── db.ts                         # schema Dexie
│   │   ├── service.ts                    # LeadService: ingest, lead, stati, purge, diagnostica
│   │   ├── diagnostics.ts                # testo del report diagnostico
│   │   ├── export.ts                     # righe, CSV, XLSX
│   │   └── router.ts                     # dispatch dei messaggi nel background
│   ├── bridge/bridge.ts                  # installBridge (MAIN world)
│   ├── content/
│   │   ├── badges.ts                     # disegno badge sulle card
│   │   ├── banner.ts                     # banner di riserva
│   │   ├── route-watcher.ts              # rileva cambi rotta senza dati
│   │   └── controller.ts                 # collega adattatore, background e badge
│   ├── ui/sidepanel/
│   │   ├── api.ts · App.tsx · LeadItem.tsx · Sparkline.tsx · SettingsView.tsx · ExportBar.tsx · download.ts · styles.css
│   └── entrypoints/
│       ├── background.ts
│       ├── immobiliare-bridge.content.ts # world: MAIN
│       ├── immobiliare.content.ts        # world: ISOLATED
│       └── sidepanel/ (index.html, main.tsx)
├── tests/
│   ├── unit/…                            # Vitest
│   ├── fixtures/immobiliare/…            # JSON sanitizzati
│   └── e2e/…                             # Playwright
└── docs/ (spec, piano, smoke-test.md, privacy-pilota.md) · CLAUDE.md · README.md
```

---

### Task 1: Scaffold del progetto WXT

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/entrypoints/background.ts`, `src/entrypoints/sidepanel/index.html`, `src/entrypoints/sidepanel/main.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nessuna
- Produces: alias `@/` → `src/`; script npm `dev`, `build`, `typecheck`, `test`, `test:e2e`; output di build in `.output/chrome-mv3/`

- [ ] **Step 1: Crea `package.json`**

```json
{
  "name": "homeradar",
  "description": "Estensione Chrome per agenti immobiliari: annunci di privati maturi su Immobiliare.it",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "wxt",
    "build": "wxt build",
    "zip": "wxt zip",
    "postinstall": "wxt prepare",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "wxt build && playwright test"
  }
}
```

- [ ] **Step 2: Crea `wxt.config.ts`**

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'HomeRadar',
    description: 'Evidenzia gli annunci di privati maturi su Immobiliare.it',
    permissions: ['sidePanel', 'alarms', 'clipboardWrite'],
    host_permissions: ['https://www.immobiliare.it/*'],
    action: { default_title: 'HomeRadar' },
  },
});
```

- [ ] **Step 3: Crea `tsconfig.json` e `vitest.config.ts`**

`tsconfig.json`:
```json
{
  "extends": "./.wxt/tsconfig.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "strict": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
// WXT 0.20. Se la versione installata non espone questo percorso, usa `import { WxtVitest } from 'wxt/testing'`.
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 4: Crea gli entrypoint minimi**

`src/entrypoints/background.ts`:
```ts
export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
```

`src/entrypoints/sidepanel/index.html`:
```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HomeRadar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/entrypoints/sidepanel/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<p>HomeRadar</p>);
```

- [ ] **Step 5: Aggiungi `fixtures-raw/` a `.gitignore`**

Aggiungi in fondo a `.gitignore`:
```
# Fixture grezze catturate dal portale (contengono dati personali): MAI committare
fixtures-raw/
```

- [ ] **Step 6: Installa le dipendenze**

```bash
npm install react react-dom dexie zod
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
npm install -D wxt @wxt-dev/module-react typescript @types/react @types/react-dom vitest jsdom fake-indexeddb @testing-library/react @testing-library/dom @playwright/test
npx playwright install chromium
```
Expected: installazione senza errori; `postinstall` esegue `wxt prepare` e crea `.wxt/`.

- [ ] **Step 7: Verifica build, typecheck e test**

Run: `npm run build && npm run typecheck && npm test`
Expected: build OK; `.output/chrome-mv3/manifest.json` contiene `"side_panel"` e `"host_permissions": ["https://www.immobiliare.it/*"]`; typecheck senza errori; Vitest "No test files found" con exit 0.

Verifica il manifest:
```bash
node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(m.manifest_version, !!m.side_panel, m.host_permissions)"
```
Expected: `3 true [ 'https://www.immobiliare.it/*' ]`

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json wxt.config.ts tsconfig.json vitest.config.ts .gitignore src
git commit -m "chore: scaffold WXT + React extension"
```

---

### Task 2: Tipi di dominio e formattazione

**Files:**
- Create: `src/shared/types.ts`, `src/shared/format.ts`, `src/adapters/immobiliare/format.ts`
- Test: `tests/unit/shared/format.test.ts`, `tests/unit/adapters/immobiliare-format.test.ts`

**Interfaces:**
- Produces (`src/shared/types.ts`): tutti i tipi sotto, `DEFAULT_SETTINGS`, `DAY_MS`, `listingKey(portal, portalId)`
- Produces (`src/shared/format.ts`): `formatEuro(n: number): string`, `formatPercent(n: number): string`, `formatDate(ms: number): string` (`gg/mm/aaaa`), `formatDayMonth(ms: number): string` (`gg/mm`)
- Produces (`src/adapters/immobiliare/format.ts`): `parseEuro(text): number | null`, `parseItalianDecimal(text): number | null`, `parseItalianDate(text): number | null`, `parseSurface(text): number | null`, `parseRooms(text): number | null`

- [ ] **Step 1: Crea `src/shared/types.ts`** (solo tipi e costanti, nessun test proprio)

```ts
export type Portal = 'immobiliare';
export type SellerType = 'private' | 'agency' | 'constructor' | 'unknown';
export type PageKind = 'search' | 'detail' | 'other';
export type ObservationSource = 'search' | 'detail';

export const DAY_MS = 86_400_000;

export interface PriceDrop {
  fromPrice: number;
  toPrice: number;
  percent: number;
  /** ms epoch, mezzanotte UTC del giorno del ribasso */
  date: number;
}

export interface ListingObservation {
  portal: Portal;
  portalId: number;
  url: string;
  title: string;
  address: string | null;
  city: string | null;
  zone: string | null;
  typology: string | null;
  surfaceM2: number | null;
  rooms: number | null;
  price: number | null;
  sellerType: SellerType;
  portalCreatedAt: number | null;
  lastDrop: PriceDrop | null;
  source: ObservationSource;
}

export interface ParseResult {
  observations: ListingObservation[];
  errors: string[];
}

export interface ListingRecord {
  key: string;
  portal: Portal;
  portalId: number;
  url: string;
  title: string;
  address: string | null;
  city: string | null;
  zone: string | null;
  typology: string | null;
  surfaceM2: number | null;
  rooms: number | null;
  currentPrice: number | null;
  portalCreatedAt: number | null;
  estimatedCreatedAt: number | null;
  lastDrop: PriceDrop | null;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
}

export type SnapshotSource = 'observed' | 'declared';

export interface PriceSnapshot {
  id?: number;
  listingKey: string;
  price: number;
  at: number;
  source: SnapshotSource;
}

export type LeadStatus = 'new' | 'to_contact' | 'contacted' | 'discarded';
export const LEAD_STATUSES: LeadStatus[] = ['new', 'to_contact', 'contacted', 'discarded'];

export interface LeadState {
  listingKey: string;
  status: LeadStatus;
  notes: string;
  statusChangedAt: number;
}

export interface Settings {
  minAgeDays: number;
  minDropPercent: number;
  retentionDays: number;
}

export const DEFAULT_SETTINGS: Settings = { minAgeDays: 120, minDropPercent: 0, retentionDays: 90 };

export interface CalibrationPoint {
  portalId: number;
  createdAt: number;
}

export type Priority = 'high' | 'medium' | 'verify' | 'none';

export interface Evaluation {
  listingKey: string;
  portalId: number;
  priority: Priority;
  ageDays: number | null;
  ageEstimated: boolean;
  ageUncertain: boolean;
  dropPercent: number;
  dropCount: number;
  maxKnownPrice: number | null;
  reasons: string[];
  badgeText: string;
}

export interface LeadView {
  listing: ListingRecord;
  evaluation: Evaluation;
  state: LeadState;
  prices: PriceSnapshot[];
}

export interface Diagnostics {
  version: string;
  counters: Record<string, number>;
  errors: { at: number; message: string }[];
  adapterWarning: boolean;
}

export function listingKey(portal: Portal, portalId: number): string {
  return `${portal}:${portalId}`;
}
```

- [ ] **Step 2: Scrivi i test che falliscono**

`tests/unit/shared/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDate, formatDayMonth, formatEuro, formatPercent } from '@/shared/format';

describe('format', () => {
  it('formatta gli euro con il punto delle migliaia', () => {
    expect(formatEuro(235000)).toBe('235.000');
    expect(formatEuro(2500)).toBe('2.500');
    expect(formatEuro(1250000)).toBe('1.250.000');
    expect(formatEuro(950)).toBe('950');
  });
  it('formatta le percentuali con la virgola e al massimo un decimale', () => {
    expect(formatPercent(5.6224)).toBe('5,6');
    expect(formatPercent(10)).toBe('10');
    expect(formatPercent(9.96)).toBe('10');
  });
  it('formatta le date in UTC', () => {
    expect(formatDate(Date.UTC(2026, 8, 21))).toBe('21/09/2026');
    expect(formatDayMonth(Date.UTC(2026, 8, 1))).toBe('01/09');
  });
});
```

`tests/unit/adapters/immobiliare-format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  parseEuro, parseItalianDate, parseItalianDecimal, parseRooms, parseSurface,
} from '@/adapters/immobiliare/format';

describe('immobiliare format', () => {
  it('legge importi in euro', () => {
    expect(parseEuro('€ 249.000')).toBe(249000);
    expect(parseEuro('€ 1.250.000')).toBe(1250000);
    expect(parseEuro('Prezzo su richiesta')).toBeNull();
  });
  it('legge decimali italiani', () => {
    expect(parseItalianDecimal('5,6')).toBe(5.6);
    expect(parseItalianDecimal('12')).toBe(12);
    expect(parseItalianDecimal('')).toBeNull();
    expect(parseItalianDecimal('n.d.')).toBeNull();
  });
  it('legge date gg/mm/aaaa come mezzanotte UTC', () => {
    expect(parseItalianDate('21/09/2026')).toBe(Date.UTC(2026, 8, 21));
    expect(parseItalianDate('2026-09-21')).toBeNull();
  });
  it('legge superficie e locali', () => {
    expect(parseSurface('65 m²')).toBe(65);
    expect(parseSurface('1.200 m²')).toBe(1200);
    expect(parseSurface('')).toBeNull();
    expect(parseRooms('2')).toBe(2);
    expect(parseRooms('5+')).toBe(5);
    expect(parseRooms('')).toBeNull();
  });
});
```

- [ ] **Step 3: Esegui i test e verifica che falliscano**

Run: `npx vitest run tests/unit/shared tests/unit/adapters/immobiliare-format.test.ts`
Expected: FAIL, moduli `@/shared/format` e `@/adapters/immobiliare/format` non trovati.

- [ ] **Step 4: Implementa**

`src/shared/format.ts`:
```ts
export function formatEuro(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatPercent(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDayMonth(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

export function formatDate(ms: number): string {
  return `${formatDayMonth(ms)}/${new Date(ms).getUTCFullYear()}`;
}
```

`src/adapters/immobiliare/format.ts`:
```ts
export function parseEuro(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export function parseItalianDecimal(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseItalianDate(text: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export function parseSurface(text: string): number | null {
  const digits = text.split('m')[0]!.replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

export function parseRooms(text: string): number | null {
  const n = parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `npx vitest run tests/unit/shared tests/unit/adapters/immobiliare-format.test.ts && npm run typecheck`
Expected: PASS, typecheck OK.

- [ ] **Step 6: Commit**

```bash
git add src/shared src/adapters tests/unit
git commit -m "feat: domain types and Italian formatting helpers"
```

---

### Task 3: Adattatore Immobiliare.it

**Files:**
- Create: `src/adapters/types.ts`, `src/adapters/immobiliare/urls.ts`, `src/adapters/immobiliare/schemas.ts`, `src/adapters/immobiliare/index.ts`
- Test: `tests/unit/adapters/builders.ts`, `tests/unit/adapters/immobiliare.test.ts`

**Interfaces:**
- Consumes: tipi del Task 2; `parseEuro`, `parseItalianDecimal`, `parseItalianDate`, `parseSurface`, `parseRooms`
- Produces:
  - `urls.ts`: `pageKind(url: string): PageKind`, `isListingsApiUrl(url: string): boolean`, `listingIdFromHref(href: string): number | null`
  - `index.ts`: `immobiliareAdapter: PortalAdapter`, `parseSearchData(data: unknown, source?): ParseResult`, `parseDetailData(detailData: unknown): ParseResult`
  - `PortalAdapter` = `{ portal; pageKind(url); parseNextData(json, url): ParseResult; isInterceptedUrl(url): boolean; parseIntercepted(url, json): ParseResult; listingIdFromHref(href): number | null }`

Struttura reale verificata il 2026-10-10 (vedi spec §4): risultati in `props.pageProps.dehydratedState.queries[i].state.data.results[]`; la risposta XHR `/api-next/search-list/listings/` ha la stessa forma di `data` (`results[]` al primo livello); dettaglio in `props.pageProps.detailData.realEstate` con `createdAt` in secondi; `properties[0]` ha `surface: "65 m²"`, `rooms: "2"`, `typology.name`, `location.{address, city, macrozone, microzone}`; `seo.url` è l'URL dell'annuncio.

- [ ] **Step 1: Crea i builder dei test**

`tests/unit/adapters/builders.ts`:
```ts
export const SEARCH_URL = 'https://www.immobiliare.it/vendita-case/milano/da-privati/';
export const DETAIL_URL = 'https://www.immobiliare.it/annunci/128416572/';
export const API_URL = 'https://www.immobiliare.it/api-next/search-list/listings/?pag=2';

export function realEstate(overrides: Record<string, unknown> = {}) {
  return {
    id: 128416572,
    title: 'Bilocale via della Torre 16, Precotto, Milano',
    price: {
      visible: true,
      value: 235000,
      formattedValue: '€ 235.000',
      loweredPrice: {
        originalPrice: '€ 249.000',
        currentPrice: '€ 235.000',
        discountPercentage: '5,6',
        priceDecreasedBy: '€ 14.000',
        passedDays: 19,
        date: '21/09/2026',
        typologiesCount: 0,
      },
    },
    properties: [
      {
        surface: '62 m²',
        rooms: '2',
        typology: { id: 14, name: 'Appartamento' },
        description: 'Testo lungo della descrizione',
        location: { address: 'Via della Torre', city: 'Milano', macrozone: 'Turro', microzone: 'Precotto' },
      },
    ],
    advertiser: {
      supervisor: { type: 'user', phones: [{ type: 'tel1', value: '333 123 4567' }], label: 'privato' },
      hasCallNumbers: true,
    },
    ...overrides,
  };
}

export const agencyAdvertiser = {
  agency: { id: 1, type: 'agency', displayName: 'Agenzia X', phones: [{ type: 'tel1', value: '02 1234567' }] },
  supervisor: { type: 'agent' },
};

export function searchResult(re: unknown, id = 128416572) {
  return { realEstate: re, seo: { url: `https://www.immobiliare.it/annunci/${id}/` }, idGeoHash: 'x' };
}

export function searchNextData(results: unknown[]) {
  return {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: ['geo'], state: { data: { foo: 1 } } },
            { queryKey: ['real-estate-list'], state: { data: { count: results.length, currentPage: 1, results } } },
          ],
        },
      },
    },
  };
}

export function detailNextData(re: unknown) {
  return { props: { pageProps: { detailData: { realEstate: re } } } };
}
```

- [ ] **Step 2: Scrivi i test che falliscono**

`tests/unit/adapters/immobiliare.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { immobiliareAdapter as A } from '@/adapters/immobiliare';
import {
  API_URL, DETAIL_URL, SEARCH_URL, agencyAdvertiser, detailNextData, realEstate, searchNextData, searchResult,
} from './builders';

describe('immobiliareAdapter.pageKind', () => {
  it('riconosce ricerca, dettaglio e altro', () => {
    expect(A.pageKind(SEARCH_URL)).toBe('search');
    expect(A.pageKind('https://www.immobiliare.it/vendita-appartamenti/roma/?pag=2')).toBe('search');
    expect(A.pageKind(DETAIL_URL)).toBe('detail');
    expect(A.pageKind('https://www.immobiliare.it/')).toBe('other');
    expect(A.pageKind('https://www.immobiliare.it/affitto-case/milano/')).toBe('other');
  });
});

describe('immobiliareAdapter.parseNextData — ricerca', () => {
  it('normalizza un annuncio di privato', () => {
    const r = A.parseNextData(searchNextData([searchResult(realEstate())]), SEARCH_URL);
    expect(r.errors).toEqual([]);
    expect(r.observations).toEqual([
      {
        portal: 'immobiliare',
        portalId: 128416572,
        url: 'https://www.immobiliare.it/annunci/128416572/',
        title: 'Bilocale via della Torre 16, Precotto, Milano',
        address: 'Via della Torre',
        city: 'Milano',
        zone: 'Precotto',
        typology: 'Appartamento',
        surfaceM2: 62,
        rooms: 2,
        price: 235000,
        sellerType: 'private',
        portalCreatedAt: null,
        lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) },
        source: 'search',
      },
    ]);
  });

  it('non fa mai uscire telefoni, nomi o descrizioni', () => {
    const r = A.parseNextData(
      searchNextData([searchResult(realEstate()), searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2)]),
      SEARCH_URL,
    );
    const text = JSON.stringify(r);
    expect(text).not.toContain('333 123 4567');
    expect(text).not.toContain('02 1234567');
    expect(text).not.toContain('Agenzia X');
    expect(text).not.toContain('phones');
    expect(text).not.toContain('Testo lungo');
  });

  it('distingue agenzie e costruttori', () => {
    const r = A.parseNextData(
      searchNextData([
        searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2),
        searchResult(realEstate({ id: 3, advertiser: { agency: { type: 'constructor' } } }), 3),
        searchResult(realEstate({ id: 4, advertiser: undefined }), 4),
      ]),
      SEARCH_URL,
    );
    expect(r.observations.map((o) => o.sellerType)).toEqual(['agency', 'constructor', 'unknown']);
  });

  it('gestisce il prezzo nascosto senza ribasso', () => {
    const hidden = realEstate({ price: { visible: false, formattedValue: 'Prezzo su richiesta' } });
    const r = A.parseNextData(searchNextData([searchResult(hidden)]), SEARCH_URL);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.price).toBeNull();
    expect(r.observations[0]!.lastDrop).toBeNull();
  });

  it('scarta un ribasso incoerente', () => {
    const weird = realEstate({
      price: { visible: true, value: 249000, loweredPrice: { originalPrice: '€ 235.000', currentPrice: '€ 249.000', discountPercentage: '0', date: '21/09/2026' } },
    });
    expect(A.parseNextData(searchNextData([searchResult(weird)]), SEARCH_URL).observations[0]!.lastDrop).toBeNull();
  });

  it('registra un errore per il singolo elemento malformato e prosegue', () => {
    const r = A.parseNextData(
      searchNextData([searchResult({ title: 'senza id' }), searchResult(realEstate({ id: 5 }), 5)]),
      SEARCH_URL,
    );
    expect(r.observations.map((o) => o.portalId)).toEqual([5]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^result\[0\]/);
  });

  it('segnala quando il contenitore dei risultati manca', () => {
    expect(A.parseNextData({ props: {} }, SEARCH_URL)).toEqual({ observations: [], errors: ['search data not found'] });
  });

  it('non fa nulla sulle pagine non gestite', () => {
    expect(A.parseNextData({}, 'https://www.immobiliare.it/')).toEqual({ observations: [], errors: [] });
  });
});

describe('immobiliareAdapter.parseNextData — dettaglio', () => {
  it('legge la data di creazione in millisecondi', () => {
    const r = A.parseNextData(detailNextData(realEstate({ createdAt: 1776643200 })), DETAIL_URL);
    expect(r.errors).toEqual([]);
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]!.portalCreatedAt).toBe(1776643200000);
    expect(r.observations[0]!.source).toBe('detail');
    expect(r.observations[0]!.url).toBe(DETAIL_URL);
  });

  it('segnala quando il dettaglio manca', () => {
    expect(A.parseNextData({ props: { pageProps: {} } }, DETAIL_URL).errors).toEqual(['detail data not found']);
  });
});

describe('immobiliareAdapter — risposte intercettate', () => {
  it('riconosce solo la chiamata dei risultati', () => {
    expect(A.isInterceptedUrl(API_URL)).toBe(true);
    expect(A.isInterceptedUrl('/api-next/search-list/listings/?pag=3')).toBe(true);
    expect(A.isInterceptedUrl('https://www.immobiliare.it/api-next/listing/banners/')).toBe(false);
  });

  it('legge la risposta con la stessa forma dei dati di ricerca', () => {
    const r = A.parseIntercepted(API_URL, { count: 1, currentPage: 2, results: [searchResult(realEstate())] });
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.portalId).toBe(128416572);
  });

  it('segnala una risposta senza results', () => {
    expect(A.parseIntercepted(API_URL, { foo: 1 }).errors).toEqual(['search data not found']);
  });
});

describe('immobiliareAdapter.listingIdFromHref', () => {
  it('estrae l\'ID dai link degli annunci', () => {
    expect(A.listingIdFromHref('https://www.immobiliare.it/annunci/128416572/')).toBe(128416572);
    expect(A.listingIdFromHref('/annunci/133428292/?foo=1')).toBe(133428292);
    expect(A.listingIdFromHref('/agenzie-immobiliari/51157/')).toBeNull();
  });
});
```

- [ ] **Step 3: Esegui i test e verifica che falliscano**

Run: `npx vitest run tests/unit/adapters/immobiliare.test.ts`
Expected: FAIL, modulo `@/adapters/immobiliare` non trovato.

- [ ] **Step 4: Implementa**

`src/adapters/types.ts`:
```ts
import type { PageKind, ParseResult, Portal } from '@/shared/types';

export interface PortalAdapter {
  portal: Portal;
  pageKind(url: string): PageKind;
  parseNextData(json: unknown, url: string): ParseResult;
  isInterceptedUrl(url: string): boolean;
  parseIntercepted(url: string, json: unknown): ParseResult;
  listingIdFromHref(href: string): number | null;
}
```

`src/adapters/immobiliare/urls.ts`:
```ts
import type { PageKind } from '@/shared/types';

function pathOf(url: string): string {
  try {
    return new URL(url, 'https://www.immobiliare.it').pathname;
  } catch {
    return '';
  }
}

export function pageKind(url: string): PageKind {
  const path = pathOf(url);
  if (/^\/annunci\/\d+\/?/.test(path)) return 'detail';
  if (/^\/vendita-[a-z-]+\//.test(path)) return 'search';
  return 'other';
}

export function isListingsApiUrl(url: string): boolean {
  return pathOf(url).startsWith('/api-next/search-list/listings/');
}

export function listingIdFromHref(href: string): number | null {
  const m = /\/annunci\/(\d+)\//.exec(href);
  return m ? Number(m[1]) : null;
}
```

`src/adapters/immobiliare/schemas.ts`:
```ts
import { z } from 'zod';

// Gli oggetti zod scartano le chiavi non dichiarate: questa è la lista dei campi ammessi.
// Telefoni, nomi, descrizioni e foto non sono dichiarati e quindi non escono mai.
export const LoweredPriceSchema = z.object({
  originalPrice: z.string(),
  currentPrice: z.string(),
  discountPercentage: z.string(),
  date: z.string(),
});

export const PriceSchema = z.object({
  visible: z.boolean().optional(),
  value: z.number().nullish(),
  loweredPrice: LoweredPriceSchema.nullish(),
});

export const LocationSchema = z.object({
  address: z.string().nullish(),
  city: z.string().nullish(),
  macrozone: z.string().nullish(),
  microzone: z.string().nullish(),
});

export const PropertySchema = z.object({
  surface: z.string().nullish(),
  rooms: z.string().nullish(),
  typology: z.object({ name: z.string() }).nullish(),
  location: LocationSchema.nullish(),
});

export const AdvertiserSchema = z.object({
  agency: z.object({ type: z.string() }).nullish(),
  supervisor: z.object({ type: z.string() }).nullish(),
});

export const RealEstateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  price: PriceSchema,
  properties: z.array(PropertySchema).min(1),
  advertiser: AdvertiserSchema.nullish(),
  createdAt: z.number().nullish(),
});

export const SearchResultSchema = z.object({
  realEstate: RealEstateSchema,
  seo: z.object({ url: z.string() }).nullish(),
});

export type RealEstate = z.infer<typeof RealEstateSchema>;
```

`src/adapters/immobiliare/index.ts`:
```ts
import type { PortalAdapter } from '@/adapters/types';
import type {
  ListingObservation, ObservationSource, ParseResult, PriceDrop, SellerType,
} from '@/shared/types';
import { parseEuro, parseItalianDate, parseItalianDecimal, parseRooms, parseSurface } from './format';
import { RealEstateSchema, SearchResultSchema, type RealEstate } from './schemas';
import { isListingsApiUrl, listingIdFromHref, pageKind } from './urls';

type Json = Record<string, unknown> | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);

function sellerTypeOf(adv: RealEstate['advertiser']): SellerType {
  if (adv?.agency) return adv.agency.type === 'constructor' ? 'constructor' : 'agency';
  if (adv?.supervisor?.type === 'user') return 'private';
  return 'unknown';
}

function toLastDrop(lp: NonNullable<RealEstate['price']['loweredPrice']> | null | undefined): PriceDrop | null {
  if (!lp) return null;
  const fromPrice = parseEuro(lp.originalPrice);
  const toPrice = parseEuro(lp.currentPrice);
  const date = parseItalianDate(lp.date);
  if (fromPrice == null || toPrice == null || date == null || !(fromPrice > toPrice)) return null;
  const percent = parseItalianDecimal(lp.discountPercentage) ?? Math.round(((fromPrice - toPrice) / fromPrice) * 1000) / 10;
  return { fromPrice, toPrice, percent, date };
}

function toObservation(re: RealEstate, url: string, source: ObservationSource): ListingObservation {
  const p = re.properties[0]!;
  const loc = p.location;
  const price = re.price.visible === false ? null : (re.price.value ?? null);
  return {
    portal: 'immobiliare',
    portalId: re.id,
    url,
    title: re.title,
    address: loc?.address ?? null,
    city: loc?.city ?? null,
    zone: loc?.microzone ?? loc?.macrozone ?? null,
    typology: p.typology?.name ?? null,
    surfaceM2: p.surface ? parseSurface(p.surface) : null,
    rooms: p.rooms ? parseRooms(p.rooms) : null,
    price,
    sellerType: sellerTypeOf(re.advertiser),
    portalCreatedAt: re.createdAt != null ? re.createdAt * 1000 : null,
    lastDrop: price == null ? null : toLastDrop(re.price.loweredPrice),
    source,
  };
}

const listingUrl = (id: number) => `https://www.immobiliare.it/annunci/${id}/`;

export function parseSearchData(data: unknown, source: ObservationSource = 'search'): ParseResult {
  const results = obj(data)?.results;
  if (!Array.isArray(results)) return { observations: [], errors: ['search data not found'] };
  const out: ParseResult = { observations: [], errors: [] };
  results.forEach((raw, i) => {
    const parsed = SearchResultSchema.safeParse(raw);
    if (!parsed.success) {
      out.errors.push(`result[${i}]: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
      return;
    }
    const re = parsed.data.realEstate;
    out.observations.push(toObservation(re, parsed.data.seo?.url ?? listingUrl(re.id), source));
  });
  return out;
}

export function parseDetailData(detailData: unknown): ParseResult {
  const raw = obj(detailData)?.realEstate;
  if (!raw) return { observations: [], errors: ['detail data not found'] };
  const parsed = RealEstateSchema.safeParse(raw);
  if (!parsed.success) {
    return { observations: [], errors: [`detail: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`] };
  }
  return { observations: [toObservation(parsed.data, listingUrl(parsed.data.id), 'detail')], errors: [] };
}

function findSearchData(json: unknown): unknown {
  const queries = obj(obj(obj(obj(json)?.props)?.pageProps)?.dehydratedState)?.queries;
  if (!Array.isArray(queries)) return undefined;
  const q = queries.find((x) => Array.isArray(obj(obj(obj(x)?.state)?.data)?.results));
  return obj(obj(q)?.state)?.data;
}

export const immobiliareAdapter: PortalAdapter = {
  portal: 'immobiliare',
  pageKind,
  parseNextData(json, url) {
    const kind = pageKind(url);
    if (kind === 'search') return parseSearchData(findSearchData(json));
    if (kind === 'detail') return parseDetailData(obj(obj(obj(json)?.props)?.pageProps)?.detailData);
    return { observations: [], errors: [] };
  },
  isInterceptedUrl: isListingsApiUrl,
  parseIntercepted(url, json) {
    return isListingsApiUrl(url) ? parseSearchData(json) : { observations: [], errors: [] };
  },
  listingIdFromHref,
};
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `npx vitest run tests/unit/adapters && npm run typecheck`
Expected: PASS, typecheck OK.

- [ ] **Step 6: Commit**

```bash
git add src/adapters tests/unit/adapters
git commit -m "feat: Immobiliare.it adapter with zod allow-list schemas"
```

---

### Task 4: Fixture reali sanitizzate

**Files:**
- Create: `scripts/sanitize-fixture.mjs`
- Create: `tests/fixtures/immobiliare/search-privati.json`, `tests/fixtures/immobiliare/api-listings.json`, `tests/fixtures/immobiliare/detail-private.json`
- Test: `tests/unit/adapters/immobiliare.fixtures.test.ts`

**Interfaces:**
- Consumes: `immobiliareAdapter` (Task 3)
- Produces: tre fixture usate anche dal Task 14 (e2e). `search-privati.json` deve contenere **almeno un privato con `loweredPrice`**.

> **Nota per chi esegue:** gli Step 2–4 richiedono un browser reale sul sito (DataDome blocca le richieste fuori dal browser). Se sei un agente senza Claude in Chrome, chiedi all'utente di eseguirli e di confermare quando i tre file grezzi sono in `fixtures-raw/`.

- [ ] **Step 1: Crea lo script di sanitizzazione**

`scripts/sanitize-fixture.mjs`:
```js
// Uso: node scripts/sanitize-fixture.mjs <search|detail|api> <input.json> <output.json>
// Tiene solo la parte di JSON che serve all'adattatore ed elimina dati personali e testi lunghi.
import { readFileSync, writeFileSync } from 'node:fs';

const [kind, input, output] = process.argv.slice(2);
if (!['search', 'detail', 'api'].includes(kind) || !input || !output) {
  console.error('Uso: node scripts/sanitize-fixture.mjs <search|detail|api> <input.json> <output.json>');
  process.exit(1);
}

const DROP = new Set([
  'phones', 'phone', 'displayName', 'label', 'agencyUrl', 'imageUrls', 'image', 'imageGender', 'imageType',
  'description', 'defaultDescription', 'caption', 'multimedia', 'photo', 'photos',
  'featureList', 'features', 'ga4features', 'mainFeatures', 'primaryFeatures', 'costs', 'cadastrals', 'energy',
]);

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
let out;
if (kind === 'search') {
  const q = raw.props.pageProps.dehydratedState.queries.find((x) => Array.isArray(x?.state?.data?.results));
  const d = q.state.data;
  out = { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { count: d.count, currentPage: d.currentPage, results: scrub(d.results) } } }] } } } };
} else if (kind === 'detail') {
  out = { props: { pageProps: { detailData: { realEstate: scrub(raw.props.pageProps.detailData.realEstate) } } } };
} else {
  out = { count: raw.count, currentPage: raw.currentPage, results: scrub(raw.results) };
}

const text = JSON.stringify(out, null, 1);
const suspicious = text.match(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/g);
if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
writeFileSync(output, `${text}\n`);
console.log(`OK: ${output}`);
```

- [ ] **Step 2: Cattura la pagina di ricerca** (browser reale)

1. Apri `https://www.immobiliare.it/vendita-case/milano/da-privati/?pag=15` (se nella pagina non c'è nessun annuncio con "Prezzo diminuito", prova pagine vicine).
2. DevTools → Console: `copy(document.getElementById('__NEXT_DATA__').textContent)`
3. Incolla in `fixtures-raw/search.json`.

- [ ] **Step 3: Cattura la risposta XHR**

1. Sulla stessa pagina, DevTools → Network, filtro `listings`.
2. Clicca il link alla pagina successiva dei risultati.
3. Seleziona la richiesta `/api-next/search-list/listings/…` → Response → copia tutto → incolla in `fixtures-raw/api.json`.

- [ ] **Step 4: Cattura un dettaglio di privato**

1. Apri un annuncio di privato della pagina.
2. Console: `copy(document.getElementById('__NEXT_DATA__').textContent)` → incolla in `fixtures-raw/detail.json`.

- [ ] **Step 5: Sanitizza e controlla**

```bash
mkdir -p tests/fixtures/immobiliare
node scripts/sanitize-fixture.mjs search fixtures-raw/search.json tests/fixtures/immobiliare/search-privati.json
node scripts/sanitize-fixture.mjs api fixtures-raw/api.json tests/fixtures/immobiliare/api-listings.json
node scripts/sanitize-fixture.mjs detail fixtures-raw/detail.json tests/fixtures/immobiliare/detail-private.json
node -e "const d=require('./tests/fixtures/immobiliare/search-privati.json');console.log(d.props.pageProps.dehydratedState.queries[0].state.data.results.filter(r=>r.realEstate.price.loweredPrice&&!r.realEstate.advertiser?.agency).length)"
```
Expected: tre righe `OK: …`, nessun avviso sui telefoni (se compare, apri il file e verifica a mano), ultimo comando ≥ 1.

- [ ] **Step 6: Scrivi i test sulle fixture**

`tests/unit/adapters/immobiliare.fixtures.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { immobiliareAdapter as A } from '@/adapters/immobiliare';

const read = (name: string) => readFileSync(`tests/fixtures/immobiliare/${name}`, 'utf8');
const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/;

describe.each(['search-privati.json', 'api-listings.json', 'detail-private.json'])('fixture %s', (name) => {
  it('non contiene dati personali', () => {
    const text = read(name);
    expect(text).not.toContain('"phones"');
    expect(text).not.toContain('"displayName"');
    expect(text).not.toMatch(PHONE);
  });
});

describe('adattatore sulle fixture reali', () => {
  it('legge la pagina di ricerca senza errori', () => {
    const r = A.parseNextData(JSON.parse(read('search-privati.json')), 'https://www.immobiliare.it/vendita-case/milano/da-privati/?pag=15');
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
    expect(r.observations.some((o) => o.sellerType === 'private')).toBe(true);
    expect(r.observations.some((o) => o.sellerType === 'private' && o.lastDrop)).toBe(true);
    for (const o of r.observations) {
      expect(o.portalId).toBeGreaterThan(0);
      expect(o.url).toMatch(/^https:\/\/www\.immobiliare\.it\/annunci\/\d+\/$/);
    }
  });

  it('legge la risposta XHR', () => {
    const r = A.parseIntercepted('https://www.immobiliare.it/api-next/search-list/listings/?pag=16', JSON.parse(read('api-listings.json')));
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
  });

  it('legge il dettaglio con la data di creazione', () => {
    const json = JSON.parse(read('detail-private.json'));
    const id = json.props.pageProps.detailData.realEstate.id;
    const r = A.parseNextData(json, `https://www.immobiliare.it/annunci/${id}/`);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]!.sellerType).toBe('private');
    expect(r.observations[0]!.portalCreatedAt).toBeGreaterThan(Date.UTC(2015, 0, 1));
  });
});
```

- [ ] **Step 7: Esegui i test**

Run: `npx vitest run tests/unit/adapters/immobiliare.fixtures.test.ts`
Expected: PASS. Se un test di parsing fallisce, il portale ha campi diversi da quelli attesi: correggi gli schemi in `src/adapters/immobiliare/schemas.ts` (non le fixture) e riesegui anche `tests/unit/adapters`.

- [ ] **Step 8: Commit** (mai `fixtures-raw/`)

```bash
git status --short fixtures-raw   # Expected: nessun output (ignorata)
git add scripts tests/fixtures tests/unit/adapters/immobiliare.fixtures.test.ts
git commit -m "test: sanitized Immobiliare.it fixtures and fixture-based adapter tests"
```

---

### Task 5: Stima dell'età dall'ID

**Files:**
- Create: `src/core/age.ts`
- Test: `tests/unit/core/age.test.ts`

**Interfaces:**
- Consumes: `CalibrationPoint`
- Produces: `DEFAULT_CALIBRATION: CalibrationPoint[]`, `estimateCreatedAt(portalId: number, points: CalibrationPoint[]): number | null`, `mergeCalibration(defaults: CalibrationPoint[], learned: CalibrationPoint[]): CalibrationPoint[]`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/core/age.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALIBRATION, estimateCreatedAt, mergeCalibration } from '@/core/age';

const pts = [
  { portalId: 100, createdAt: 0 },
  { portalId: 150, createdAt: 400 },
  { portalId: 200, createdAt: 1000 },
];

describe('estimateCreatedAt', () => {
  it('restituisce la data esatta per un punto noto', () => {
    expect(estimateCreatedAt(150, pts)).toBe(400);
  });
  it('interpola tra i punti vicini', () => {
    expect(estimateCreatedAt(125, pts)).toBe(200);
    expect(estimateCreatedAt(175, pts)).toBe(700);
  });
  it('estrapola con il primo e l\'ultimo punto', () => {
    expect(estimateCreatedAt(300, pts)).toBe(2000);
    expect(estimateCreatedAt(50, pts)).toBe(-500);
  });
  it('richiede almeno due punti', () => {
    expect(estimateCreatedAt(150, [{ portalId: 150, createdAt: 400 }])).toBeNull();
    expect(estimateCreatedAt(150, [])).toBeNull();
  });
  it('ignora l\'ordine di ingresso', () => {
    expect(estimateCreatedAt(125, [...pts].reverse())).toBe(200);
  });
  it('con la calibrazione predefinita colloca un ID noto alla sua data', () => {
    expect(estimateCreatedAt(131597836, DEFAULT_CALIBRATION)).toBe(1786025032000);
  });
});

describe('mergeCalibration', () => {
  it('i punti appresi sostituiscono quelli predefiniti con lo stesso ID', () => {
    const merged = mergeCalibration([{ portalId: 1, createdAt: 10 }, { portalId: 2, createdAt: 20 }], [{ portalId: 2, createdAt: 25 }, { portalId: 3, createdAt: 30 }]);
    expect(merged).toEqual([
      { portalId: 1, createdAt: 10 },
      { portalId: 2, createdAt: 25 },
      { portalId: 3, createdAt: 30 },
    ]);
  });
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/unit/core/age.test.ts`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: Implementa**

`src/core/age.ts`:
```ts
import type { CalibrationPoint } from '@/shared/types';

/** Coppie ID → data reale verificate su Immobiliare.it il 2026-10-10. */
export const DEFAULT_CALIBRATION: CalibrationPoint[] = [
  { portalId: 128416572, createdAt: Date.UTC(2026, 3, 20) },
  { portalId: 131597836, createdAt: 1786025032000 },
  { portalId: 133428292, createdAt: 1791609879000 },
];

export function mergeCalibration(defaults: CalibrationPoint[], learned: CalibrationPoint[]): CalibrationPoint[] {
  const byId = new Map<number, CalibrationPoint>();
  for (const p of [...defaults, ...learned]) byId.set(p.portalId, p);
  return [...byId.values()].sort((a, b) => a.portalId - b.portalId);
}

export function estimateCreatedAt(portalId: number, points: CalibrationPoint[]): number | null {
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

- [ ] **Step 4: Esegui e verifica che passi**

Run: `npx vitest run tests/unit/core/age.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/age.ts tests/unit/core/age.test.ts
git commit -m "feat: estimate listing creation date from portal ID"
```

---

### Task 6: Motore regole e helper dei lead

**Files:**
- Create: `src/core/rules.ts`, `src/core/leads.ts`
- Test: `tests/unit/core/rules.test.ts`, `tests/unit/core/leads.test.ts`

**Interfaces:**
- Consumes: tipi del Task 2; `formatEuro`, `formatPercent`, `formatDayMonth`
- Produces:
  - `rules.ts`: `UNCERTAINTY_DAYS = 15`, `evaluate(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings, now: number): Evaluation`
  - `leads.ts`: `PRIORITY_LABELS: Record<Priority, string>`, `STATUS_LABELS: Record<LeadStatus, string>`, `sortLeads(leads: LeadView[]): LeadView[]`, `groupByStatus(leads: LeadView[]): Record<LeadStatus, LeadView[]>`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/core/rules.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { evaluate } from '@/core/rules';
import { DAY_MS, DEFAULT_SETTINGS, type ListingRecord, type PriceSnapshot } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 10, 12);
const daysAgo = (d: number) => NOW - d * DAY_MS - 1000;
const DROP_DATE = Date.UTC(2026, 8, 21);

function listing(o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: 'immobiliare:1', portal: 'immobiliare', portalId: 1, url: 'u', title: 't',
    address: null, city: null, zone: null, typology: null, surfaceM2: null, rooms: null,
    currentPrice: 235000, portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null,
    firstSeenAt: NOW, lastSeenAt: NOW, seenCount: 1, ...o,
  };
}
const snap = (price: number, at: number, source: PriceSnapshot['source'] = 'observed'): PriceSnapshot => ({ listingKey: 'immobiliare:1', price, at, source });
const declaredDrop = [snap(249000, DROP_DATE - 1, 'declared'), snap(235000, DROP_DATE, 'declared')];
const lastDrop = { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: DROP_DATE };
const ev = (l: ListingRecord, s: PriceSnapshot[] = [], settings = DEFAULT_SETTINGS) => evaluate(l, s, settings, NOW);

describe('evaluate', () => {
  it('Alta: data reale oltre soglia e ribasso dichiarato', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(173), lastDrop }), declaredDrop);
    expect(e.priority).toBe('high');
    expect(e.ageDays).toBe(173);
    expect(e.ageEstimated).toBe(false);
    expect(e.dropPercent).toBe(5.6);
    expect(e.dropCount).toBe(1);
    expect(e.reasons).toEqual(['Online da 173 gg', 'Ribassato del 5,6% (249.000 → 235.000 €) il 21/09']);
    expect(e.badgeText).toBe('● Alta · 173 gg · −5,6%');
  });

  it('Media: solo anzianità', () => {
    const e = ev(listing({ currentPrice: 300000, portalCreatedAt: daysAgo(150) }), [snap(300000, daysAgo(10))]);
    expect(e.priority).toBe('medium');
    expect(e.badgeText).toBe('● Media · 150 gg');
  });

  it('Media: solo ribasso', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(45), lastDrop }), declaredDrop);
    expect(e.priority).toBe('medium');
    expect(e.badgeText).toBe('● Media · 45 gg · −5,6%');
  });

  it('Media: età stimata ben oltre la soglia', () => {
    const e = ev(listing({ estimatedCreatedAt: daysAgo(170) }));
    expect(e.priority).toBe('medium');
    expect(e.ageEstimated).toBe(true);
    expect(e.reasons).toEqual(['Online da ~170 gg']);
    expect(e.badgeText).toBe('● Media · ~170 gg');
  });

  it('Da verificare: età stimata vicina alla soglia, senza ribasso', () => {
    const e = ev(listing({ estimatedCreatedAt: daysAgo(112) }));
    expect(e.priority).toBe('verify');
    expect(e.ageUncertain).toBe(true);
    expect(e.reasons).toContain("Età da verificare: apri l'annuncio");
    expect(e.badgeText).toBe('◐ Da verificare · ~112 gg');
  });

  it('il margine di incertezza vale anche sopra la soglia', () => {
    expect(ev(listing({ estimatedCreatedAt: daysAgo(134) })).priority).toBe('verify');
    expect(ev(listing({ estimatedCreatedAt: daysAgo(135) })).priority).toBe('medium');
    expect(ev(listing({ estimatedCreatedAt: daysAgo(104) })).priority).toBe('none');
    expect(ev(listing({ estimatedCreatedAt: daysAgo(105) })).priority).toBe('verify');
  });

  it('Media con avviso: età incerta ma ribassato', () => {
    const e = ev(listing({ estimatedCreatedAt: daysAgo(125), lastDrop }), declaredDrop);
    expect(e.priority).toBe('medium');
    expect(e.reasons).toContain("Età da verificare: apri l'annuncio");
    expect(e.badgeText).toBe('● Media · ~125 gg · −5,6%');
  });

  it('nessuna priorità: data reale sotto soglia, senza ribassi', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(112) }));
    expect(e.priority).toBe('none');
    expect(e.badgeText).toBe('Privato · 112 gg');
  });

  it('nessuna priorità: nessuna data e nessun ribasso', () => {
    const e = ev(listing());
    expect(e.priority).toBe('none');
    expect(e.ageDays).toBeNull();
    expect(e.badgeText).toBe('Privato');
  });

  it('conta più ribassi osservati', () => {
    const e = ev(listing({ currentPrice: 270000, portalCreatedAt: daysAgo(30) }), [snap(300000, daysAgo(20)), snap(290000, daysAgo(10)), snap(270000, daysAgo(1))]);
    expect(e.dropCount).toBe(2);
    expect(e.reasons).toContain('2 ribassi, −10% totale');
  });

  it('prezzo tornato al massimo: niente segnale B', () => {
    const e = ev(listing({ currentPrice: 249000, portalCreatedAt: daysAgo(30), lastDrop }), [...declaredDrop, snap(249000, daysAgo(2))]);
    expect(e.dropPercent).toBe(0);
    expect(e.priority).toBe('none');
  });

  it('prezzo rialzato parzialmente: calo misurato sul massimo noto', () => {
    const e = ev(listing({ currentPrice: 230000, portalCreatedAt: daysAgo(30) }), [snap(249000, daysAgo(20)), snap(200000, daysAgo(10)), snap(230000, daysAgo(2))]);
    expect(e.dropPercent).toBe(7.6);
    expect(e.dropCount).toBe(1);
    expect(e.priority).toBe('medium');
  });

  it('rispetta il ribasso minimo impostato', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(45), lastDrop }), declaredDrop, { ...DEFAULT_SETTINGS, minDropPercent: 10 });
    expect(e.priority).toBe('none');
  });

  it('prezzo sconosciuto: nessun ribasso e nessun errore', () => {
    const e = ev(listing({ currentPrice: null, portalCreatedAt: daysAgo(45) }), declaredDrop);
    expect(e.dropPercent).toBe(0);
    expect(e.priority).toBe('none');
  });

  it('data stimata nel futuro: età bloccata a 0', () => {
    const e = ev(listing({ estimatedCreatedAt: NOW + 5 * DAY_MS }));
    expect(e.ageDays).toBe(0);
    expect(e.badgeText).toBe('Privato · ~0 gg');
  });
});
```

`tests/unit/core/leads.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { groupByStatus, sortLeads } from '@/core/leads';
import type { LeadStatus, LeadView, Priority } from '@/shared/types';

function lead(key: string, priority: Priority, ageDays: number | null, status: LeadStatus = 'new'): LeadView {
  return {
    listing: { key } as LeadView['listing'],
    evaluation: { listingKey: key, priority, ageDays } as LeadView['evaluation'],
    state: { listingKey: key, status, notes: '', statusChangedAt: 0 },
    prices: [],
  };
}

describe('sortLeads', () => {
  it('ordina per priorità e poi per età decrescente, età sconosciute in fondo', () => {
    const sorted = sortLeads([lead('a', 'medium', 130), lead('b', 'high', 125), lead('c', 'medium', 200), lead('d', 'verify', 110), lead('e', 'medium', null)]);
    expect(sorted.map((l) => l.listing.key)).toEqual(['b', 'c', 'a', 'e', 'd']);
  });
});

describe('groupByStatus', () => {
  it('raggruppa mantenendo l\'ordine', () => {
    const g = groupByStatus([lead('a', 'high', 1), lead('b', 'high', 1, 'contacted'), lead('c', 'medium', 1)]);
    expect(g.new.map((l) => l.listing.key)).toEqual(['a', 'c']);
    expect(g.contacted.map((l) => l.listing.key)).toEqual(['b']);
    expect(g.to_contact).toEqual([]);
    expect(g.discarded).toEqual([]);
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `npx vitest run tests/unit/core/rules.test.ts tests/unit/core/leads.test.ts`
Expected: FAIL, moduli non trovati.

- [ ] **Step 3: Implementa**

`src/core/rules.ts`:
```ts
import { formatDayMonth, formatEuro, formatPercent } from '@/shared/format';
import {
  DAY_MS, type Evaluation, type ListingRecord, type PriceSnapshot, type Priority, type Settings,
} from '@/shared/types';

export const UNCERTAINTY_DAYS = 15;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function evaluate(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings, now: number): Evaluation {
  // Segnale A: anzianità
  const created = listing.portalCreatedAt ?? listing.estimatedCreatedAt;
  const ageEstimated = listing.portalCreatedAt == null;
  const ageDays = created == null ? null : Math.max(0, Math.floor((now - created) / DAY_MS));
  const ageUncertain =
    ageDays != null &&
    ageEstimated &&
    ageDays >= settings.minAgeDays - UNCERTAINTY_DAYS &&
    ageDays < settings.minAgeDays + UNCERTAINTY_DAYS;
  const signalA = ageDays != null && !ageUncertain && ageDays >= settings.minAgeDays;

  // Segnale B: ribassi rispetto al massimo prezzo noto
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
  const signalB = dropPercent > 0 && dropPercent >= settings.minDropPercent;
  let dropCount = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.price < ordered[i - 1]!.price) dropCount++;

  let priority: Priority = 'none';
  if (signalA && signalB) priority = 'high';
  else if (signalA || signalB) priority = 'medium';
  else if (ageUncertain) priority = 'verify';

  const agePart = ageDays != null ? `${ageEstimated ? '~' : ''}${ageDays} gg` : null;
  const reasons: string[] = [];
  if (agePart) reasons.push(`Online da ${agePart}`);
  if (ageUncertain) reasons.push("Età da verificare: apri l'annuncio");
  if (signalB && current != null && maxKnownPrice != null) {
    if (dropCount >= 2) {
      reasons.push(`${dropCount} ribassi, −${formatPercent(dropPercent)}% totale`);
    } else {
      const when = listing.lastDrop && listing.lastDrop.toPrice === current ? ` il ${formatDayMonth(listing.lastDrop.date)}` : '';
      reasons.push(`Ribassato del ${formatPercent(dropPercent)}% (${formatEuro(maxKnownPrice)} → ${formatEuro(current)} €)${when}`);
    }
  }

  const dropPart = signalB ? `−${formatPercent(dropPercent)}%` : null;
  const head = { high: '● Alta', medium: '● Media', verify: '◐ Da verificare', none: 'Privato' }[priority];
  const parts = priority === 'high' || priority === 'medium' ? [head, agePart, dropPart] : [head, agePart];

  return {
    listingKey: listing.key,
    portalId: listing.portalId,
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
```

`src/core/leads.ts`:
```ts
import { LEAD_STATUSES, type LeadStatus, type LeadView, type Priority } from '@/shared/types';

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'Alta', medium: 'Media', verify: 'Da verificare', none: '' };
export const STATUS_LABELS: Record<LeadStatus, string> = { new: 'Nuovo', to_contact: 'Da contattare', contacted: 'Contattato', discarded: 'Scartato' };

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, verify: 2, none: 3 };

export function sortLeads(leads: LeadView[]): LeadView[] {
  return [...leads].sort((a, b) => {
    const p = PRIORITY_ORDER[a.evaluation.priority] - PRIORITY_ORDER[b.evaluation.priority];
    if (p !== 0) return p;
    return (b.evaluation.ageDays ?? -1) - (a.evaluation.ageDays ?? -1);
  });
}

export function groupByStatus(leads: LeadView[]): Record<LeadStatus, LeadView[]> {
  const groups = Object.fromEntries(LEAD_STATUSES.map((s) => [s, [] as LeadView[]])) as Record<LeadStatus, LeadView[]>;
  for (const l of leads) groups[l.state.status].push(l);
  return groups;
}
```

- [ ] **Step 4: Esegui e verifica che passino**

Run: `npx vitest run tests/unit/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/rules.ts src/core/leads.ts tests/unit/core/rules.test.ts tests/unit/core/leads.test.ts
git commit -m "feat: lead rules engine and lead sorting helpers"
```

---

### Task 7: Database e ingestione delle osservazioni

**Files:**
- Create: `src/core/db.ts`, `src/core/settings.ts`, `src/core/service.ts`
- Test: `tests/unit/core/helpers.ts`, `tests/unit/core/service.ingest.test.ts`, `tests/unit/core/settings.test.ts`

**Interfaces:**
- Consumes: `evaluate` (Task 6), `estimateCreatedAt`, `mergeCalibration`, `DEFAULT_CALIBRATION` (Task 5)
- Produces:
  - `db.ts`: `class HomeRadarDB extends Dexie` con tabelle `listings`, `priceSnapshots`, `leadStates`, `idCalibration`, `meta`
  - `settings.ts`: `validateSettings(input: Partial<Settings>): Settings` (lancia `Error` con messaggio italiano)
  - `service.ts`: `VISIT_GAP_MS = 30 * 60_000`; `class LeadService { constructor(db: HomeRadarDB, clock?: () => number); getSettings(): Promise<Settings>; ingest(observations: ListingObservation[]): Promise<Evaluation[]> }` (altri metodi nel Task 8)

- [ ] **Step 1: Crea gli helper dei test**

`tests/unit/core/helpers.ts`:
```ts
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
    title: 'Bilocale via della Torre 16, Precotto, Milano', address: 'Via della Torre', city: 'Milano', zone: 'Precotto',
    typology: 'Appartamento', surfaceM2: 62, rooms: 2, price: 235000, sellerType: 'private', portalCreatedAt: null,
    lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) }, source: 'search',
    ...o,
  };
}
```

- [ ] **Step 2: Scrivi i test che falliscono**

`tests/unit/core/settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateSettings } from '@/core/settings';
import { DEFAULT_SETTINGS } from '@/shared/types';

describe('validateSettings', () => {
  it('completa con i valori predefiniti', () => {
    expect(validateSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ minAgeDays: 180 })).toEqual({ ...DEFAULT_SETTINGS, minAgeDays: 180 });
  });
  it('rifiuta valori non validi', () => {
    expect(() => validateSettings({ minAgeDays: 0 })).toThrow('Soglia giorni non valida');
    expect(() => validateSettings({ minAgeDays: 12.5 })).toThrow('Soglia giorni non valida');
    expect(() => validateSettings({ minDropPercent: -1 })).toThrow('Ribasso minimo non valido');
    expect(() => validateSettings({ minDropPercent: 101 })).toThrow('Ribasso minimo non valido');
    expect(() => validateSettings({ retentionDays: 3 })).toThrow('Conservazione non valida');
  });
});
```

`tests/unit/core/service.ingest.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { VISIT_GAP_MS } from '@/core/service';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';

describe('LeadService.ingest', () => {
  it('salva il privato, crea lo stato "new" e gli snapshot dichiarati', async () => {
    const { db, svc } = setup();
    const [e] = await svc.ingest([obs()]);
    expect(e!.priority).toBe('high');
    expect(e!.badgeText).toBe('● Alta · ~173 gg · −5,6%');

    const l = await db.listings.get(KEY);
    expect(l).toMatchObject({ currentPrice: 235000, seenCount: 1, portalCreatedAt: null });
    expect(l!.estimatedCreatedAt).toBe(Date.UTC(2026, 3, 20));
    expect(await db.leadStates.get(KEY)).toMatchObject({ status: 'new', notes: '' });
    const snaps = await db.priceSnapshots.where('listingKey').equals(KEY).sortBy('at');
    expect(snaps.map((s) => [s.price, s.source])).toEqual([[249000, 'declared'], [235000, 'declared']]);
  });

  it('ignora agenzie e costruttori', async () => {
    const { db, svc } = setup();
    expect(await svc.ingest([obs({ sellerType: 'agency' }), obs({ portalId: 2, sellerType: 'constructor' })])).toEqual([]);
    expect(await db.listings.count()).toBe(0);
  });

  it('usa e conserva la data reale del dettaglio e la aggiunge alla calibrazione', async () => {
    const { db, svc } = setup();
    const created = Date.UTC(2026, 3, 1);
    const [e] = await svc.ingest([obs({ source: 'detail', portalCreatedAt: created })]);
    expect(e!.ageEstimated).toBe(false);
    expect(await db.idCalibration.get(128416572)).toEqual({ portalId: 128416572, createdAt: created });
    await svc.ingest([obs()]);
    expect((await db.listings.get(KEY))!.portalCreatedAt).toBe(created);
  });

  it('aggiunge uno snapshot osservato solo quando il prezzo cambia', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([obs({ lastDrop: null, price: 300000 })]);
    advance(VISIT_GAP_MS);
    await svc.ingest([obs({ lastDrop: null, price: 300000 })]);
    advance(VISIT_GAP_MS);
    await svc.ingest([obs({ lastDrop: null, price: 290000 })]);
    const snaps = await db.priceSnapshots.where('listingKey').equals(KEY).sortBy('at');
    expect(snaps.map((s) => [s.price, s.source])).toEqual([[300000, 'observed'], [290000, 'observed']]);
    expect((await db.listings.get(KEY))!.currentPrice).toBe(290000);
  });

  it('prezzo nascosto: mantiene l\'ultimo prezzo noto e non crea snapshot', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs({ lastDrop: null, price: 300000 })]);
    await svc.ingest([obs({ lastDrop: null, price: null })]);
    expect((await db.listings.get(KEY))!.currentPrice).toBe(300000);
    expect(await db.priceSnapshots.count()).toBe(1);
  });

  it('stesso annuncio due volte nella stessa visita (anche in parallelo): nessun duplicato', async () => {
    const { db, svc, advance } = setup();
    await Promise.all([svc.ingest([obs()]), svc.ingest([obs()])]);
    expect(await db.leadStates.count()).toBe(1);
    expect(await db.priceSnapshots.count()).toBe(2);
    expect((await db.listings.get(KEY))!.seenCount).toBe(1);
    advance(VISIT_GAP_MS - 1);
    await svc.ingest([obs()]);
    expect((await db.listings.get(KEY))!.seenCount).toBe(1);
    advance(1);
    await svc.ingest([obs()]);
    expect((await db.listings.get(KEY))!.seenCount).toBe(2);
  });

  it('non sovrascrive stato e note dell\'agente', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs()]);
    await db.leadStates.put({ listingKey: KEY, status: 'contacted', notes: 'richiamare', statusChangedAt: 1 });
    await svc.ingest([obs()]);
    expect(await db.leadStates.get(KEY)).toMatchObject({ status: 'contacted', notes: 'richiamare' });
  });
});
```

- [ ] **Step 3: Esegui e verifica che falliscano**

Run: `npx vitest run tests/unit/core/settings.test.ts tests/unit/core/service.ingest.test.ts`
Expected: FAIL, moduli non trovati.

- [ ] **Step 4: Implementa**

`src/core/db.ts`:
```ts
import Dexie, { type Table } from 'dexie';
import type { CalibrationPoint, LeadState, ListingRecord, PriceSnapshot } from '@/shared/types';

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class HomeRadarDB extends Dexie {
  declare listings: Table<ListingRecord, string>;
  declare priceSnapshots: Table<PriceSnapshot, number>;
  declare leadStates: Table<LeadState, string>;
  declare idCalibration: Table<CalibrationPoint, number>;
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
  }
}
```

`src/core/settings.ts`:
```ts
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';

export function validateSettings(input: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  if (!Number.isInteger(s.minAgeDays) || s.minAgeDays < 1 || s.minAgeDays > 3650) throw new Error('Soglia giorni non valida');
  if (!Number.isFinite(s.minDropPercent) || s.minDropPercent < 0 || s.minDropPercent > 100) throw new Error('Ribasso minimo non valido');
  if (!Number.isInteger(s.retentionDays) || s.retentionDays < 7 || s.retentionDays > 3650) throw new Error('Conservazione non valida');
  return s;
}
```

`src/core/service.ts`:
```ts
import Dexie from 'dexie';
import { DEFAULT_CALIBRATION, estimateCreatedAt, mergeCalibration } from '@/core/age';
import type { HomeRadarDB } from '@/core/db';
import { evaluate } from '@/core/rules';
import { validateSettings } from '@/core/settings';
import {
  listingKey, type Evaluation, type ListingObservation, type ListingRecord, type Settings,
} from '@/shared/types';

export const VISIT_GAP_MS = 30 * 60_000;

export class LeadService {
  constructor(
    private readonly db: HomeRadarDB,
    private readonly clock: () => number = Date.now,
  ) {}

  async getSettings(): Promise<Settings> {
    const rec = await this.db.meta.get('settings');
    return validateSettings((rec?.value ?? {}) as Partial<Settings>);
  }

  async ingest(observations: ListingObservation[]): Promise<Evaluation[]> {
    const now = this.clock();
    const settings = await this.getSettings();
    const { listings, priceSnapshots, leadStates, idCalibration } = this.db;

    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, idCalibration], async () => {
      for (const o of observations) {
        if (o.portalCreatedAt != null) await idCalibration.put({ portalId: o.portalId, createdAt: o.portalCreatedAt });
      }
      const calibration = mergeCalibration(DEFAULT_CALIBRATION, await idCalibration.toArray());

      const evaluations: Evaluation[] = [];
      for (const o of observations) {
        if (o.sellerType !== 'private') continue;
        const key = listingKey(o.portal, o.portalId);
        const prev = await listings.get(key);
        const record: ListingRecord = {
          key,
          portal: o.portal,
          portalId: o.portalId,
          url: o.url,
          title: o.title,
          address: o.address ?? prev?.address ?? null,
          city: o.city ?? prev?.city ?? null,
          zone: o.zone ?? prev?.zone ?? null,
          typology: o.typology ?? prev?.typology ?? null,
          surfaceM2: o.surfaceM2 ?? prev?.surfaceM2 ?? null,
          rooms: o.rooms ?? prev?.rooms ?? null,
          currentPrice: o.price ?? prev?.currentPrice ?? null,
          portalCreatedAt: o.portalCreatedAt ?? prev?.portalCreatedAt ?? null,
          estimatedCreatedAt: estimateCreatedAt(o.portalId, calibration),
          lastDrop: o.lastDrop ?? prev?.lastDrop ?? null,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSeenAt: now,
          seenCount: !prev ? 1 : now - prev.lastSeenAt >= VISIT_GAP_MS ? prev.seenCount + 1 : prev.seenCount,
        };
        // Se la visita precedente è recente, lastSeenAt non avanza: altrimenti visite ravvicinate
        // spezzerebbero all'infinito la finestra di VISIT_GAP_MS.
        if (prev && now - prev.lastSeenAt < VISIT_GAP_MS) record.lastSeenAt = prev.lastSeenAt;
        await listings.put(record);
        await this.recordSnapshots(key, o, now);
        if (!(await leadStates.get(key))) {
          await leadStates.add({ listingKey: key, status: 'new', notes: '', statusChangedAt: now });
        }
        const snaps = await priceSnapshots.where('listingKey').equals(key).toArray();
        evaluations.push(evaluate(record, snaps, settings, now));
      }
      return evaluations;
    });
  }

  private async recordSnapshots(key: string, o: ListingObservation, now: number): Promise<void> {
    const { priceSnapshots } = this.db;
    if (o.lastDrop) {
      const declared = [
        { price: o.lastDrop.fromPrice, at: o.lastDrop.date - 1 },
        { price: o.lastDrop.toPrice, at: o.lastDrop.date },
      ];
      for (const s of declared) {
        const exists = await priceSnapshots.where('[listingKey+at]').equals([key, s.at]).first();
        if (!exists) await priceSnapshots.add({ listingKey: key, price: s.price, at: s.at, source: 'declared' });
      }
    }
    if (o.price != null) {
      const last = await priceSnapshots.where('[listingKey+at]').between([key, Dexie.minKey], [key, Dexie.maxKey]).last();
      if (!last || last.price !== o.price) {
        await priceSnapshots.add({ listingKey: key, price: o.price, at: now, source: 'observed' });
      }
    }
  }
}
```

- [ ] **Step 5: Esegui e verifica che passino**

Run: `npx vitest run tests/unit/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/db.ts src/core/settings.ts src/core/service.ts tests/unit/core
git commit -m "feat: IndexedDB schema and observation ingest with price snapshots"
```

---

### Task 8: Lead, stati, impostazioni, pulizia e diagnostica

**Files:**
- Modify: `src/core/service.ts` (aggiungi metodi alla classe `LeadService`)
- Create: `src/core/diagnostics.ts`
- Test: `tests/unit/core/service.leads.test.ts`, `tests/unit/core/diagnostics.test.ts`

**Interfaces:**
- Consumes: `LeadService` (Task 7), `sortLeads` (Task 6)
- Produces (metodi di `LeadService`):
  - `listLeads(): Promise<LeadView[]>` (priorità ≠ none oppure stato ≠ new, ordinati)
  - `setLeadState(listingKey: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState>`
  - `deleteListing(listingKey: string): Promise<void>`
  - `saveSettings(input: Partial<Settings>): Promise<Settings>`
  - `purge(): Promise<number>`
  - `recordError(message: string): Promise<void>` (ultimi 20), `bumpCounter(name: string, by?: number): Promise<void>`, `setAdapterWarning(on: boolean): Promise<void>`, `getDiagnostics(version: string): Promise<Diagnostics>`
- Produces (`diagnostics.ts`): `formatDiagnostics(d: Diagnostics, now: number): string`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/core/service.leads.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DAY_MS } from '@/shared/types';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';

describe('LeadService.listLeads', () => {
  it('restituisce solo lead o annunci già lavorati, ordinati', async () => {
    const { svc } = setup();
    await svc.ingest([
      obs(), // Alta
      obs({ portalId: 131597836, lastDrop: null, price: 410000 }), // ~65 gg, nessun segnale
      obs({ portalId: 120000000, lastDrop: null, price: 500000 }), // molto vecchio → Media
    ]);
    let leads = await svc.listLeads();
    expect(leads.map((l) => [l.listing.portalId, l.evaluation.priority])).toEqual([
      [128416572, 'high'],
      [120000000, 'medium'],
    ]);
    await svc.setLeadState('immobiliare:131597836', { status: 'discarded' });
    leads = await svc.listLeads();
    expect(leads.map((l) => l.listing.portalId)).toContain(131597836);
    expect(leads[0]!.prices.map((p) => p.price)).toEqual([249000, 235000]);
  });
});

describe('LeadService.setLeadState', () => {
  it('aggiorna stato e data solo quando lo stato cambia', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    advance(1000);
    const s1 = await svc.setLeadState(KEY, { status: 'to_contact' });
    expect(s1).toMatchObject({ status: 'to_contact', statusChangedAt: now() });
    advance(1000);
    const s2 = await svc.setLeadState(KEY, { notes: 'chiamare sera' });
    expect(s2).toMatchObject({ status: 'to_contact', notes: 'chiamare sera', statusChangedAt: now() - 1000 });
  });

  it('rifiuta un annuncio sconosciuto', async () => {
    const { svc } = setup();
    await expect(svc.setLeadState('immobiliare:1', { status: 'contacted' })).rejects.toThrow('Annuncio non trovato');
  });
});

describe('LeadService.deleteListing', () => {
  it('elimina annuncio, snapshot e stato', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs()]);
    await svc.deleteListing(KEY);
    expect(await db.listings.count()).toBe(0);
    expect(await db.priceSnapshots.count()).toBe(0);
    expect(await db.leadStates.count()).toBe(0);
  });
});

describe('LeadService impostazioni', () => {
  it('salva, valida e influenza la valutazione', async () => {
    const { svc } = setup();
    await svc.ingest([obs({ portalId: 120000000, lastDrop: null, price: 500000 })]);
    expect((await svc.listLeads())).toHaveLength(1);
    expect(await svc.saveSettings({ minAgeDays: 3000 })).toMatchObject({ minAgeDays: 3000 });
    expect(await svc.listLeads()).toHaveLength(0);
    await expect(svc.saveSettings({ minAgeDays: -1 })).rejects.toThrow('Soglia giorni non valida');
    expect((await svc.getSettings()).minAgeDays).toBe(3000);
  });
});

describe('LeadService.purge', () => {
  it('elimina solo annunci vecchi rimasti "new"', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([obs(), obs({ portalId: 2, lastDrop: null }), obs({ portalId: 3, lastDrop: null })]);
    await svc.setLeadState('immobiliare:2', { status: 'contacted' });
    advance(91 * DAY_MS);
    await svc.ingest([obs({ portalId: 3, lastDrop: null })]);
    expect(await svc.purge()).toBe(1);
    expect((await db.listings.toCollection().primaryKeys()).sort()).toEqual(['immobiliare:2', 'immobiliare:3']);
    expect(await db.priceSnapshots.where('listingKey').equals(KEY).count()).toBe(0);
    expect(await db.leadStates.get(KEY)).toBeUndefined();
  });
});

describe('LeadService diagnostica', () => {
  it('tiene contatori, ultimi 20 errori e avviso adattatore', async () => {
    const { svc } = setup();
    await svc.bumpCounter('apiPayloads');
    await svc.bumpCounter('apiPayloads', 2);
    for (let i = 0; i < 25; i++) await svc.recordError(`errore ${i}`);
    await svc.setAdapterWarning(true);
    const d = await svc.getDiagnostics('0.1.0');
    expect(d.version).toBe('0.1.0');
    expect(d.counters.apiPayloads).toBe(3);
    expect(d.errors).toHaveLength(20);
    expect(d.errors[19]!.message).toBe('errore 24');
    expect(d.adapterWarning).toBe(true);
  });
});
```

`tests/unit/core/diagnostics.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '@/core/diagnostics';

describe('formatDiagnostics', () => {
  it('produce un testo senza dati degli annunci', () => {
    const text = formatDiagnostics(
      { version: '0.1.0', counters: { ingested: 50, apiPayloads: 3 }, errors: [{ at: Date.UTC(2026, 9, 10), message: 'result[0]: id Required' }], adapterWarning: true },
      Date.UTC(2026, 9, 10, 12),
    );
    expect(text).toBe([
      'HomeRadar 0.1.0 — report del 10/10/2026',
      'Avviso adattatore: sì',
      'Contatori: apiPayloads=3, ingested=50',
      'Ultimi errori:',
      '- 10/10/2026 result[0]: id Required',
    ].join('\n'));
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.leads.test.ts tests/unit/core/diagnostics.test.ts`
Expected: FAIL (metodi e modulo mancanti).

- [ ] **Step 3: Implementa**

In `src/core/service.ts` aggiorna gli import:
```ts
import Dexie from 'dexie';
import { DEFAULT_CALIBRATION, estimateCreatedAt, mergeCalibration } from '@/core/age';
import type { HomeRadarDB } from '@/core/db';
import { sortLeads } from '@/core/leads';
import { evaluate } from '@/core/rules';
import { validateSettings } from '@/core/settings';
import {
  DAY_MS, listingKey, type Diagnostics, type Evaluation, type LeadState, type LeadStatus, type LeadView,
  type ListingObservation, type ListingRecord, type PriceSnapshot, type Settings,
} from '@/shared/types';
```
e aggiungi alla classe `LeadService`:
```ts
  async saveSettings(input: Partial<Settings>): Promise<Settings> {
    const s = validateSettings({ ...(await this.getSettings()), ...input });
    await this.db.meta.put({ key: 'settings', value: s });
    return s;
  }

  async listLeads(): Promise<LeadView[]> {
    const now = this.clock();
    const settings = await this.getSettings();
    const [listings, states, snaps] = await Promise.all([
      this.db.listings.toArray(),
      this.db.leadStates.toArray(),
      this.db.priceSnapshots.toArray(),
    ]);
    const stateByKey = new Map(states.map((s) => [s.listingKey, s]));
    const snapsByKey = new Map<string, PriceSnapshot[]>();
    for (const s of snaps) snapsByKey.set(s.listingKey, [...(snapsByKey.get(s.listingKey) ?? []), s]);

    const views = listings.map((listing): LeadView => {
      const prices = (snapsByKey.get(listing.key) ?? []).sort((a, b) => a.at - b.at);
      return {
        listing,
        evaluation: evaluate(listing, prices, settings, now),
        state: stateByKey.get(listing.key) ?? { listingKey: listing.key, status: 'new', notes: '', statusChangedAt: listing.firstSeenAt },
        prices,
      };
    });
    return sortLeads(views.filter((v) => v.evaluation.priority !== 'none' || v.state.status !== 'new'));
  }

  async setLeadState(key: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState> {
    const now = this.clock();
    return this.db.transaction('rw', [this.db.listings, this.db.leadStates], async () => {
      if (!(await this.db.listings.get(key))) throw new Error('Annuncio non trovato');
      const prev = (await this.db.leadStates.get(key)) ?? { listingKey: key, status: 'new' as LeadStatus, notes: '', statusChangedAt: now };
      const next: LeadState = { ...prev };
      if (patch.notes !== undefined) next.notes = patch.notes;
      if (patch.status !== undefined && patch.status !== prev.status) {
        next.status = patch.status;
        next.statusChangedAt = now;
      }
      await this.db.leadStates.put(next);
      return next;
    });
  }

  async deleteListing(key: string): Promise<void> {
    await this.db.transaction('rw', [this.db.listings, this.db.priceSnapshots, this.db.leadStates], async () => {
      await this.db.listings.delete(key);
      await this.db.priceSnapshots.where('listingKey').equals(key).delete();
      await this.db.leadStates.delete(key);
    });
  }

  async purge(): Promise<number> {
    const settings = await this.getSettings();
    const cutoff = this.clock() - settings.retentionDays * DAY_MS;
    const stale = await this.db.listings.where('lastSeenAt').below(cutoff).primaryKeys();
    let removed = 0;
    for (const key of stale) {
      const state = await this.db.leadStates.get(key);
      if (state && state.status !== 'new') continue;
      await this.deleteListing(key);
      removed++;
    }
    return removed;
  }

  private async diag(): Promise<Omit<Diagnostics, 'version'>> {
    const rec = await this.db.meta.get('diagnostics');
    return (rec?.value as Omit<Diagnostics, 'version'>) ?? { counters: {}, errors: [], adapterWarning: false };
  }

  private async updateDiag(fn: (d: Omit<Diagnostics, 'version'>) => void): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const d = await this.diag();
      fn(d);
      await this.db.meta.put({ key: 'diagnostics', value: d });
    });
  }

  recordError(message: string): Promise<void> {
    const at = this.clock();
    return this.updateDiag((d) => {
      d.errors = [...d.errors, { at, message }].slice(-20);
    });
  }

  bumpCounter(name: string, by = 1): Promise<void> {
    return this.updateDiag((d) => {
      d.counters[name] = (d.counters[name] ?? 0) + by;
    });
  }

  setAdapterWarning(on: boolean): Promise<void> {
    return this.updateDiag((d) => {
      d.adapterWarning = on;
    });
  }

  async getDiagnostics(version: string): Promise<Diagnostics> {
    return { version, ...(await this.diag()) };
  }
```

`src/core/diagnostics.ts`:
```ts
import { formatDate } from '@/shared/format';
import type { Diagnostics } from '@/shared/types';

export function formatDiagnostics(d: Diagnostics, now: number): string {
  const counters = Object.entries(d.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(', ');
  const lines = [
    `HomeRadar ${d.version} — report del ${formatDate(now)}`,
    `Avviso adattatore: ${d.adapterWarning ? 'sì' : 'no'}`,
    `Contatori: ${counters || 'nessuno'}`,
    'Ultimi errori:',
    ...(d.errors.length ? d.errors.map((e) => `- ${formatDate(e.at)} ${e.message}`) : ['- nessuno']),
  ];
  return lines.join('\n');
}
```

- [ ] **Step 4: Esegui e verifica che passino**

Run: `npx vitest run tests/unit/core && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core tests/unit/core
git commit -m "feat: lead listing, states, settings, retention purge and diagnostics"
```

---

### Task 9: Export CSV e XLSX

**Files:**
- Create: `src/core/export.ts`
- Test: `tests/unit/core/export.test.ts`

**Interfaces:**
- Consumes: `LeadView`, `PRIORITY_LABELS`, `STATUS_LABELS`, `formatDate`
- Produces: `EXPORT_COLUMNS` (readonly string[]), `type ExportRow`, `toExportRows(leads: LeadView[]): ExportRow[]`, `toCsv(rows: ExportRow[]): string`, `toXlsx(rows: ExportRow[]): Uint8Array`, `exportFileName(ext: 'csv' | 'xlsx', now: number): string`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/core/export.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { EXPORT_COLUMNS, exportFileName, toCsv, toExportRows, toXlsx } from '@/core/export';
import type { LeadView } from '@/shared/types';

const lead: LeadView = {
  listing: {
    key: 'immobiliare:128416572', portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/',
    title: 'Bilocale via della Torre 16, Precotto, Milano', address: 'Via della Torre', city: 'Milano', zone: 'Precotto',
    typology: 'Appartamento', surfaceM2: 62, rooms: 2, currentPrice: 235000, portalCreatedAt: null,
    estimatedCreatedAt: Date.UTC(2026, 3, 20), lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) },
    firstSeenAt: Date.UTC(2026, 9, 1), lastSeenAt: Date.UTC(2026, 9, 10), seenCount: 3,
  },
  evaluation: {
    listingKey: 'immobiliare:128416572', portalId: 128416572, priority: 'high', ageDays: 173, ageEstimated: true, ageUncertain: false,
    dropPercent: 5.6, dropCount: 1, maxKnownPrice: 249000, reasons: [], badgeText: '',
  },
  state: { listingKey: 'immobiliare:128416572', status: 'to_contact', notes: 'chiamare la sera', statusChangedAt: 0 },
  prices: [],
};

describe('toExportRows', () => {
  it('mappa tutte le colonne', () => {
    expect(toExportRows([lead])).toEqual([{
      'Priorità': 'Alta', 'Stato': 'Da contattare', 'Titolo': 'Bilocale via della Torre 16, Precotto, Milano',
      'Indirizzo': 'Via della Torre', 'Città/Zona': 'Milano / Precotto', 'Tipologia': 'Appartamento', 'm²': 62, 'Locali': 2,
      'Prezzo attuale': 235000, 'Prezzo massimo noto': 249000, 'Calo %': 5.6, 'Data ultimo ribasso': '21/09/2026',
      'Online da (giorni)': 173, 'Età stimata': 'sì', 'Prima visita': '01/10/2026', 'Ultima visita': '10/10/2026',
      'Note': 'chiamare la sera', 'URL': 'https://www.immobiliare.it/annunci/128416572/',
    }]);
    expect(Object.keys(toExportRows([lead])[0]!)).toEqual([...EXPORT_COLUMNS]);
  });
});

describe('toCsv', () => {
  it('usa ; come separatore, BOM UTF-8 e virgola decimale', () => {
    const csv = toCsv(toExportRows([lead]));
    expect(csv.startsWith('﻿Priorità;Stato;Titolo;')).toBe(true);
    expect(csv).toContain(';5,6;');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('quota i testi ostili e neutralizza le formule', () => {
    const hostile = { ...lead, state: { ...lead.state, notes: '=HYPERLINK("http://x")' }, listing: { ...lead.listing, title: 'Via "A"; scala B\nint. 3' } };
    const row = toCsv(toExportRows([hostile])).split('\r\n')[1]!;
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(row).toContain('"Via ""A""; scala B\nint. 3"');
    for (const bad of ['+1', '-1', '@x']) {
      const r = toCsv(toExportRows([{ ...lead, state: { ...lead.state, notes: bad } }])).split('\r\n')[1]!;
      expect(r).toContain(`;'${bad};`);
    }
  });
});

describe('toXlsx', () => {
  it('produce un file leggibile con le stesse righe', () => {
    const wb = XLSX.read(toXlsx(toExportRows([lead])), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Lead']!);
    expect(rows[0]).toMatchObject({ 'Priorità': 'Alta', 'Prezzo attuale': 235000, 'Note': 'chiamare la sera' });
  });
});

describe('exportFileName', () => {
  it('include la data', () => {
    expect(exportFileName('xlsx', Date.UTC(2026, 9, 10))).toBe('homeradar-lead-2026-10-10.xlsx');
  });
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/unit/core/export.test.ts`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: Implementa**

`src/core/export.ts`:
```ts
import * as XLSX from 'xlsx';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/core/leads';
import { formatDate } from '@/shared/format';
import type { LeadView } from '@/shared/types';

export const EXPORT_COLUMNS = [
  'Priorità', 'Stato', 'Titolo', 'Indirizzo', 'Città/Zona', 'Tipologia', 'm²', 'Locali', 'Prezzo attuale',
  'Prezzo massimo noto', 'Calo %', 'Data ultimo ribasso', 'Online da (giorni)', 'Età stimata', 'Prima visita',
  'Ultima visita', 'Note', 'URL',
] as const;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number>;

export function toExportRows(leads: LeadView[]): ExportRow[] {
  return leads.map(({ listing: l, evaluation: e, state: s }) => ({
    'Priorità': PRIORITY_LABELS[e.priority],
    'Stato': STATUS_LABELS[s.status],
    'Titolo': l.title,
    'Indirizzo': l.address ?? '',
    'Città/Zona': [l.city, l.zone].filter(Boolean).join(' / '),
    'Tipologia': l.typology ?? '',
    'm²': l.surfaceM2 ?? '',
    'Locali': l.rooms ?? '',
    'Prezzo attuale': l.currentPrice ?? '',
    'Prezzo massimo noto': e.maxKnownPrice ?? '',
    'Calo %': e.dropPercent || '',
    'Data ultimo ribasso': l.lastDrop ? formatDate(l.lastDrop.date) : '',
    'Online da (giorni)': e.ageDays ?? '',
    'Età stimata': e.ageDays == null ? '' : e.ageEstimated ? 'sì' : 'no',
    'Prima visita': formatDate(l.firstSeenAt),
    'Ultima visita': formatDate(l.lastSeenAt),
    'Note': s.notes,
    'URL': l.url,
  }));
}

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  // Neutralizza formule (CSV injection) e quota i caratteri speciali.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(';'), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(';'))];
  return `﻿${lines.join('\r\n')}`;
}

export function toXlsx(rows: ExportRow[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lead');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

export function exportFileName(ext: 'csv' | 'xlsx', now: number): string {
  return `homeradar-lead-${new Date(now).toISOString().slice(0, 10)}.${ext}`;
}
```

- [ ] **Step 4: Esegui e verifica che passi**

Run: `npx vitest run tests/unit/core/export.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/export.ts tests/unit/core/export.test.ts
git commit -m "feat: CSV and XLSX lead export"
```

---

### Task 10: Messaggi e background

**Files:**
- Create: `src/shared/messages.ts`, `src/core/router.ts`
- Modify: `src/entrypoints/background.ts`
- Test: `tests/unit/core/router.test.ts`, `tests/unit/shared/messages.test.ts`

**Interfaces:**
- Consumes: `LeadService` (Task 7–8)
- Produces:
  - `messages.ts`: `type Request` (unione sotto), `type Response<T>`, `LEADS_CHANGED = 'leadsChanged'`, `send<T>(req: Request, attempts?: number): Promise<T>`
  - `router.ts`: `interface RouterHooks { setWarning(on: boolean): void; leadsChanged(): void }`, `handleRequest(service: LeadService, req: Request, version: string, hooks: RouterHooks): Promise<unknown>`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/core/router.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from '@/core/router';
import { obs, setup } from './helpers';

function hooks() {
  return { setWarning: vi.fn(), leadsChanged: vi.fn() };
}

describe('handleRequest', () => {
  it('ingest restituisce le valutazioni e notifica il pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    const evs = (await handleRequest(svc, { type: 'ingest', observations: [obs()] }, '0.1.0', h)) as { priority: string }[];
    expect(evs[0]!.priority).toBe('high');
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
    expect((await svc.getDiagnostics('x')).counters.ingested).toBe(1);
  });

  it('parseStatus accende e spegne l\'avviso e registra gli errori', async () => {
    const { svc } = setup();
    const h = hooks();
    await handleRequest(svc, { type: 'parseStatus', ok: false, errors: ['search data not found'], source: 'api' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(true);
    let d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toBe(true);
    expect(d.errors.map((e) => e.message)).toEqual(['search data not found']);
    await handleRequest(svc, { type: 'parseStatus', ok: true, errors: [], source: 'next-data' }, '0.1.0', h);
    expect(h.setWarning).toHaveBeenLastCalledWith(false);
    d = await svc.getDiagnostics('0.1.0');
    expect(d.adapterWarning).toBe(false);
    expect(d.counters).toMatchObject({ apiPayloads: 1, nextDataPayloads: 1 });
  });

  it('inoltra le richieste del pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    await svc.ingest([obs()]);
    expect(((await handleRequest(svc, { type: 'listLeads' }, 'v', h)) as unknown[]).length).toBe(1);
    expect(await handleRequest(svc, { type: 'setLeadState', listingKey: 'immobiliare:128416572', status: 'contacted' }, 'v', h)).toMatchObject({ status: 'contacted' });
    expect(await handleRequest(svc, { type: 'saveSettings', settings: { minAgeDays: 150, minDropPercent: 0, retentionDays: 90 } }, 'v', h)).toMatchObject({ minAgeDays: 150 });
    expect(await handleRequest(svc, { type: 'getSettings' }, 'v', h)).toMatchObject({ minAgeDays: 150 });
    await handleRequest(svc, { type: 'fallbackShown' }, 'v', h);
    expect(await handleRequest(svc, { type: 'getDiagnostics' }, 'v', h)).toMatchObject({ version: 'v', counters: { fallbackShown: 1 } });
    await handleRequest(svc, { type: 'deleteListing', listingKey: 'immobiliare:128416572' }, 'v', h);
    expect(await handleRequest(svc, { type: 'listLeads' }, 'v', h)).toEqual([]);
  });

  it('rifiuta richieste sconosciute', async () => {
    const { svc } = setup();
    await expect(handleRequest(svc, { type: 'boh' } as never, 'v', hooks())).rejects.toThrow('Richiesta sconosciuta: boh');
  });
});
```

`tests/unit/shared/messages.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { send } from '@/shared/messages';

afterEach(() => vi.restoreAllMocks());

describe('send', () => {
  it('restituisce i dati della risposta', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: true, data: 42 });
    await expect(send({ type: 'listLeads' })).resolves.toBe(42);
  });

  it('trasforma gli errori del background in eccezioni', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: false, error: 'Annuncio non trovato' });
    await expect(send({ type: 'listLeads' })).rejects.toThrow('Annuncio non trovato');
  });

  it('ritenta una volta se il service worker non risponde', async () => {
    const spy = vi.spyOn(browser.runtime, 'sendMessage')
      .mockRejectedValueOnce(new Error('Could not establish connection. Receiving end does not exist.'))
      .mockResolvedValueOnce({ ok: true, data: 'ok' });
    await expect(send({ type: 'listLeads' })).resolves.toBe('ok');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `npx vitest run tests/unit/core/router.test.ts tests/unit/shared/messages.test.ts`
Expected: FAIL, moduli non trovati.

- [ ] **Step 3: Implementa**

`src/shared/messages.ts`:
```ts
import { browser } from 'wxt/browser';
import type { LeadStatus, ListingObservation, Settings } from '@/shared/types';

export const LEADS_CHANGED = 'leadsChanged';

export type Request =
  | { type: 'ingest'; observations: ListingObservation[] }
  | { type: 'listLeads' }
  | { type: 'setLeadState'; listingKey: string; status?: LeadStatus; notes?: string }
  | { type: 'deleteListing'; listingKey: string }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: Settings }
  | { type: 'parseStatus'; ok: boolean; errors: string[]; source: 'next-data' | 'api' }
  | { type: 'fallbackShown' }
  | { type: 'getDiagnostics' };

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const TRANSIENT = /Receiving end does not exist|Could not establish connection|Nessuna risposta dal background/;

export async function send<T>(req: Request, attempts = 2): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = (await browser.runtime.sendMessage(req)) as Response<T> | undefined;
      if (!res) throw new Error('Nessuna risposta dal background');
      if (!res.ok) throw new Error(res.error);
      return res.data;
    } catch (err) {
      if (i >= attempts || !TRANSIENT.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
}
```

`src/core/router.ts`:
```ts
import type { LeadService } from '@/core/service';
import type { Request } from '@/shared/messages';

export interface RouterHooks {
  setWarning(on: boolean): void;
  leadsChanged(): void;
}

export async function handleRequest(service: LeadService, req: Request, version: string, hooks: RouterHooks): Promise<unknown> {
  switch (req.type) {
    case 'ingest': {
      const evaluations = await service.ingest(req.observations);
      await service.bumpCounter('ingested', req.observations.length);
      if (evaluations.length) hooks.leadsChanged();
      return evaluations;
    }
    case 'listLeads':
      return service.listLeads();
    case 'setLeadState':
      return service.setLeadState(req.listingKey, { status: req.status, notes: req.notes });
    case 'deleteListing':
      await service.deleteListing(req.listingKey);
      hooks.leadsChanged();
      return null;
    case 'getSettings':
      return service.getSettings();
    case 'saveSettings': {
      const saved = await service.saveSettings(req.settings);
      hooks.leadsChanged();
      return saved;
    }
    case 'parseStatus':
      await service.bumpCounter(req.source === 'api' ? 'apiPayloads' : 'nextDataPayloads');
      for (const e of req.errors.slice(0, 5)) await service.recordError(e);
      await service.setAdapterWarning(!req.ok);
      hooks.setWarning(!req.ok);
      return null;
    case 'fallbackShown':
      await service.bumpCounter('fallbackShown');
      return null;
    case 'getDiagnostics':
      return service.getDiagnostics(version);
    default:
      throw new Error(`Richiesta sconosciuta: ${(req as { type?: string }).type}`);
  }
}
```

`src/entrypoints/background.ts` (sostituisci tutto):
```ts
import { HomeRadarDB } from '@/core/db';
import { handleRequest, type RouterHooks } from '@/core/router';
import { LeadService } from '@/core/service';
import { LEADS_CHANGED, type Request } from '@/shared/messages';

export default defineBackground(() => {
  const service = new LeadService(new HomeRadarDB());
  const version = browser.runtime.getManifest().version;

  const hooks: RouterHooks = {
    setWarning(on) {
      void browser.action.setBadgeText({ text: on ? '!' : '' });
      if (on) void browser.action.setBadgeBackgroundColor({ color: '#d97706' });
    },
    leadsChanged() {
      browser.runtime.sendMessage({ type: LEADS_CHANGED }).catch(() => {});
    },
  };

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = (msg as { type?: unknown } | undefined)?.type;
    if (typeof type !== 'string' || type === LEADS_CHANGED) return false;
    handleRequest(service, msg as Request, version, hooks).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  browser.alarms.create('purge', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'purge') void service.purge();
  });
});
```

- [ ] **Step 4: Esegui test, typecheck e build**

Run: `npx vitest run tests/unit && npm run typecheck && npm run build`
Expected: PASS, build OK.

- [ ] **Step 5: Commit**

```bash
git add src/shared/messages.ts src/core/router.ts src/entrypoints/background.ts tests/unit
git commit -m "feat: background message router, purge alarm and warning badge"
```

---

### Task 11: Ponte nel contesto della pagina

**Files:**
- Create: `src/bridge/bridge.ts`, `src/entrypoints/immobiliare-bridge.content.ts`
- Test: `tests/unit/bridge/bridge.test.ts`

**Interfaces:**
- Consumes: `isListingsApiUrl` (Task 3, `src/adapters/immobiliare/urls.ts`, senza zod)
- Produces: `BRIDGE_SOURCE = 'homeradar-bridge'`, `type BridgeMessage = { source: 'homeradar-bridge'; kind: 'next-data' | 'api'; url: string; payload: unknown }`, `isBridgeMessage(data: unknown): data is BridgeMessage`, `interface BridgeWindow`, `installBridge(win: BridgeWindow, isInterceptedUrl: (url: string) => boolean): void`

- [ ] **Step 1: Scrivi il test che fallisce**

`tests/unit/bridge/bridge.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { BRIDGE_SOURCE, installBridge, isBridgeMessage, type BridgeWindow } from '@/bridge/bridge';

interface FakeXHR extends EventTarget {
  responseType: string;
  responseText: string;
  response: unknown;
  open(method: string, url: string): void;
  send(): void;
}

function fakeWindow(nextData?: string) {
  // Classe nuova a ogni test: installBridge modifica il prototype.
  const FakeXHR = class extends EventTarget {
    responseType = '';
    responseText = '';
    response: unknown = null;
    open(_method: string, _url: string) {}
    send() {}
  };
  document.body.innerHTML = nextData ? `<script id="__NEXT_DATA__" type="application/json">${nextData}</script>` : '';
  const postMessage = vi.fn();
  const win = {
    XMLHttpRequest: FakeXHR as unknown as typeof XMLHttpRequest,
    fetch: vi.fn(async () => new Response('{"results":[1]}')) as unknown as typeof fetch,
    postMessage,
    location: { origin: 'https://www.immobiliare.it', href: 'https://www.immobiliare.it/vendita-case/milano/' },
    document,
  } satisfies BridgeWindow;
  return { win, postMessage };
}

const isApi = (url: string) => url.includes('/api-next/search-list/listings/');

describe('installBridge', () => {
  it('inoltra __NEXT_DATA__ quando il documento è pronto', () => {
    const { win, postMessage } = fakeWindow('{"props":{"a":1}}');
    installBridge(win, isApi);
    expect(postMessage).toHaveBeenCalledWith(
      { source: BRIDGE_SOURCE, kind: 'next-data', url: win.location.href, payload: { props: { a: 1 } } },
      'https://www.immobiliare.it',
    );
  });

  it('inoltra le risposte XHR della chiamata dei risultati e ignora le altre', () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isApi);
    const ok = new win.XMLHttpRequest() as unknown as FakeXHR;
    ok.open('GET', '/api-next/search-list/listings/?pag=2');
    ok.send();
    ok.responseText = '{"results":[]}';
    ok.dispatchEvent(new Event('load'));
    const other = new win.XMLHttpRequest() as unknown as FakeXHR;
    other.open('GET', '/api-next/listing/banners/');
    other.send();
    other.responseText = '{"x":1}';
    other.dispatchEvent(new Event('load'));
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0]![0]).toEqual({ source: BRIDGE_SOURCE, kind: 'api', url: '/api-next/search-list/listings/?pag=2', payload: { results: [] } });
  });

  it('ignora risposte XHR non JSON', () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isApi);
    const x = new win.XMLHttpRequest() as unknown as FakeXHR;
    x.open('GET', '/api-next/search-list/listings/');
    x.send();
    x.responseText = '<html>';
    expect(() => x.dispatchEvent(new Event('load'))).not.toThrow();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('inoltra le risposte fetch della chiamata dei risultati senza consumarle', async () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isApi);
    const res = await win.fetch('https://www.immobiliare.it/api-next/search-list/listings/?pag=3');
    await expect(res.json()).resolves.toEqual({ results: [1] });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls[0]![0]).toMatchObject({ kind: 'api', payload: { results: [1] } });
  });
});

describe('isBridgeMessage', () => {
  it('accetta solo messaggi del ponte ben formati', () => {
    expect(isBridgeMessage({ source: BRIDGE_SOURCE, kind: 'api', url: '/x', payload: {} })).toBe(true);
    expect(isBridgeMessage({ source: 'altro', kind: 'api', url: '/x', payload: {} })).toBe(false);
    expect(isBridgeMessage({ source: BRIDGE_SOURCE, kind: 'boh', url: '/x' })).toBe(false);
    expect(isBridgeMessage(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/unit/bridge`
Expected: FAIL, modulo non trovato.

- [ ] **Step 3: Implementa**

`src/bridge/bridge.ts`:
```ts
// Gira nel contesto della pagina (MAIN world). Nessuna logica di business e nessuna
// richiesta propria: inoltra al content script solo ciò che il sito ha già caricato.
export const BRIDGE_SOURCE = 'homeradar-bridge';

export interface BridgeMessage {
  source: typeof BRIDGE_SOURCE;
  kind: 'next-data' | 'api';
  url: string;
  payload: unknown;
}

export function isBridgeMessage(data: unknown): data is BridgeMessage {
  const d = data as Partial<BridgeMessage> | null;
  return !!d && d.source === BRIDGE_SOURCE && (d.kind === 'next-data' || d.kind === 'api') && typeof d.url === 'string';
}

export interface BridgeWindow {
  XMLHttpRequest: typeof XMLHttpRequest;
  fetch: typeof fetch;
  postMessage(message: unknown, targetOrigin: string): void;
  location: { origin: string; href: string };
  document: Document;
}

type TrackedXHR = XMLHttpRequest & { __homeradarUrl?: string };

export function installBridge(win: BridgeWindow, isInterceptedUrl: (url: string) => boolean): void {
  const post = (kind: BridgeMessage['kind'], url: string, payload: unknown) =>
    win.postMessage({ source: BRIDGE_SOURCE, kind, url, payload } satisfies BridgeMessage, win.location.origin);

  const proto = win.XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;
  proto.open = function (this: TrackedXHR, ...args: unknown[]) {
    this.__homeradarUrl = String(args[1]);
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as unknown as typeof proto.open;
  proto.send = function (this: TrackedXHR, ...args: unknown[]) {
    const url = this.__homeradarUrl;
    if (url && isInterceptedUrl(url)) {
      this.addEventListener('load', () => {
        try {
          post('api', url, this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
        } catch {
          // risposta non JSON: ignorata
        }
      });
    }
    return (origSend as (...a: unknown[]) => void).apply(this, args);
  } as unknown as typeof proto.send;

  const origFetch = win.fetch;
  win.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    const res = await origFetch.apply(this, args);
    const input = args[0];
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isInterceptedUrl(url)) {
      res.clone().json().then((payload) => post('api', url, payload), () => {});
    }
    return res;
  } as unknown as typeof fetch;

  const sendNextData = () => {
    const text = win.document.getElementById('__NEXT_DATA__')?.textContent;
    if (!text) return;
    try {
      post('next-data', win.location.href, JSON.parse(text));
    } catch {
      // JSON non valido: il content script mostrerà il banner di riserva
    }
  };
  if (win.document.readyState === 'loading') {
    win.document.addEventListener('DOMContentLoaded', sendNextData, { once: true });
  } else {
    sendNextData();
  }
}
```

`src/entrypoints/immobiliare-bridge.content.ts`:
```ts
import { isListingsApiUrl } from '@/adapters/immobiliare/urls';
import { installBridge } from '@/bridge/bridge';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installBridge(window, isListingsApiUrl);
  },
});
```

- [ ] **Step 4: Esegui test e build**

Run: `npx vitest run tests/unit/bridge && npm run typecheck && npm run build`
Expected: PASS; nel manifest compare un content script con `"world": "MAIN"`:
```bash
node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(m.content_scripts.map(c=>[c.world||'ISOLATED',c.run_at]))"
```
Expected: `[ [ 'MAIN', 'document_start' ] ]`

- [ ] **Step 5: Commit**

```bash
git add src/bridge src/entrypoints/immobiliare-bridge.content.ts tests/unit/bridge
git commit -m "feat: MAIN-world bridge forwarding __NEXT_DATA__ and listings XHR"
```

---

### Task 12: Content script (badge, banner di riserva, controller)

**Files:**
- Create: `src/content/badges.ts`, `src/content/banner.ts`, `src/content/route-watcher.ts`, `src/content/controller.ts`, `src/entrypoints/immobiliare.content.ts`
- Test: `tests/unit/content/badges.test.ts`, `tests/unit/content/route-watcher.test.ts`, `tests/unit/content/controller.test.ts`

**Interfaces:**
- Consumes: `immobiliareAdapter`, `isBridgeMessage`, `send`, `Evaluation`
- Produces:
  - `badges.ts`: `BADGE_ATTR = 'data-homeradar-badge'`, `renderBadge(root: ParentNode, ev: Evaluation): 'created' | 'updated' | 'unchanged' | 'no-card'`
  - `banner.ts`: `BANNER_ID = 'homeradar-banner'`, `FALLBACK_TEXT`, `showBanner(doc: Document, text: string): void`
  - `route-watcher.ts`: `class RouteWatcher { constructor(opts: RouteWatcherOptions); notifyPayload(): void; check(): void }`
  - `controller.ts`: `createController(deps: { adapter: PortalAdapter; send: (req: Request) => Promise<unknown>; root: ParentNode }): { handle(kind: 'next-data' | 'api', url: string, payload: unknown): Promise<void>; applyAll(): void }`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/content/badges.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { BADGE_ATTR, renderBadge } from '@/content/badges';
import type { Evaluation } from '@/shared/types';

const ev = (o: Partial<Evaluation> = {}): Evaluation => ({
  listingKey: 'immobiliare:111', portalId: 111, priority: 'high', ageDays: 173, ageEstimated: false, ageUncertain: false,
  dropPercent: 5.6, dropCount: 1, maxKnownPrice: 249000, reasons: [], badgeText: '● Alta · 173 gg · −5,6%', ...o,
});

beforeEach(() => {
  document.body.innerHTML = `
    <ul>
      <li id="card"><div class="nd-slideshow__content"><img src="x.jpg"></div><a href="https://www.immobiliare.it/annunci/111/">Bilocale</a></li>
      <li><a href="https://www.immobiliare.it/annunci/222/">Senza foto</a></li>
    </ul>`;
});

describe('renderBadge', () => {
  it('crea il badge sopra la foto della card', () => {
    expect(renderBadge(document, ev())).toBe('created');
    const badge = document.querySelector<HTMLElement>(`#card .nd-slideshow__content > [${BADGE_ATTR}]`)!;
    expect(badge.textContent).toBe('● Alta · 173 gg · −5,6%');
    expect(badge.dataset.priority).toBe('high');
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.pointerEvents).toBe('none');
    expect(document.querySelector<HTMLElement>('#card .nd-slideshow__content')!.style.position).toBe('relative');
  });

  it('non tocca il DOM se il badge è già aggiornato', () => {
    renderBadge(document, ev());
    const node = document.querySelector(`[${BADGE_ATTR}]`)!.firstChild;
    expect(renderBadge(document, ev())).toBe('unchanged');
    expect(document.querySelector(`[${BADGE_ATTR}]`)!.firstChild).toBe(node);
  });

  it('aggiorna testo e priorità', () => {
    renderBadge(document, ev());
    expect(renderBadge(document, ev({ priority: 'medium', badgeText: '● Media · 173 gg' }))).toBe('updated');
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(`[${BADGE_ATTR}]`)!.dataset.priority).toBe('medium');
  });

  it('usa la card intera se manca la foto e salta gli annunci senza card', () => {
    expect(renderBadge(document, ev({ portalId: 222 }))).toBe('created');
    expect(renderBadge(document, ev({ portalId: 999 }))).toBe('no-card');
  });
});
```

`tests/unit/content/route-watcher.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteWatcher } from '@/content/route-watcher';

let url = 'https://www.immobiliare.it/vendita-case/milano/';
const onMissing = vi.fn();
const make = () => new RouteWatcher({
  getUrl: () => url,
  isRelevant: (u) => u.includes('/vendita-'),
  timeoutMs: 5000,
  graceMs: 3000,
  onMissing,
});

beforeEach(() => {
  vi.useFakeTimers();
  onMissing.mockReset();
  url = 'https://www.immobiliare.it/vendita-case/milano/';
});
afterEach(() => vi.useRealTimers());

describe('RouteWatcher', () => {
  it('nessun banner se i dati arrivano dopo il cambio rotta', () => {
    const w = make();
    w.check();
    vi.advanceTimersByTime(2000);
    w.notifyPayload();
    vi.advanceTimersByTime(5000);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('nessun banner se i dati arrivano poco prima del cambio URL', () => {
    const w = make();
    w.check();
    w.notifyPayload();
    vi.advanceTimersByTime(1000);
    w.notifyPayload();
    url = 'https://www.immobiliare.it/vendita-case/milano/?pag=2';
    w.check();
    vi.advanceTimersByTime(6000);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('banner se dopo un cambio rotta non arriva nulla', () => {
    const w = make();
    w.check();
    w.notifyPayload();
    vi.advanceTimersByTime(10_000);
    url = 'https://www.immobiliare.it/vendita-case/milano/?pag=2';
    w.check();
    vi.advanceTimersByTime(5000);
    expect(onMissing).toHaveBeenCalledWith('https://www.immobiliare.it/vendita-case/milano/?pag=2');
  });

  it('ignora le pagine non gestite e le verifiche senza cambio URL', () => {
    url = 'https://www.immobiliare.it/';
    const w = make();
    w.check();
    w.check();
    vi.advanceTimersByTime(10_000);
    expect(onMissing).not.toHaveBeenCalled();
  });
});
```

`tests/unit/content/controller.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { createController } from '@/content/controller';
import { BADGE_ATTR } from '@/content/badges';
import type { Request } from '@/shared/messages';
import { SEARCH_URL, agencyAdvertiser, realEstate, searchNextData, searchResult } from '../adapters/builders';

beforeEach(() => {
  document.body.innerHTML = `<ul>
    <li><img><a href="/annunci/128416572/">a</a></li>
    <li><img><a href="/annunci/2/">b</a></li></ul>`;
});

function fakeSend() {
  return vi.fn(async (req: Request) => {
    if (req.type === 'ingest') {
      return req.observations.filter((o) => o.sellerType === 'private').map((o) => ({
        listingKey: `immobiliare:${o.portalId}`, portalId: o.portalId, priority: 'high', badgeText: '● Alta · 173 gg · −5,6%',
      }));
    }
    return null;
  });
}

describe('createController', () => {
  it('invia lo stato del parsing, ingerisce e disegna i badge solo per i privati', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document });
    await c.handle('next-data', SEARCH_URL, searchNextData([
      searchResult(realEstate()),
      searchResult(realEstate({ id: 2, advertiser: agencyAdvertiser }), 2),
    ]));
    expect(send.mock.calls[0]![0]).toEqual({ type: 'parseStatus', ok: true, errors: [], source: 'next-data' });
    expect(send.mock.calls[1]![0]).toMatchObject({ type: 'ingest' });
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
  });

  it('segnala un errore di parsing senza chiamare ingest', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document });
    await c.handle('api', 'https://www.immobiliare.it/api-next/search-list/listings/', { nope: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual({ type: 'parseStatus', ok: false, errors: ['search data not found'], source: 'api' });
  });

  it('ridisegna i badge dopo che il sito ha rigenerato le card', async () => {
    const send = fakeSend();
    const c = createController({ adapter: immobiliareAdapter, send, root: document });
    await c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate())]));
    document.body.innerHTML = '<ul><li><img><a href="/annunci/128416572/">a</a></li></ul>';
    c.applyAll();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Esegui e verifica che falliscano**

Run: `npx vitest run tests/unit/content`
Expected: FAIL, moduli non trovati.

- [ ] **Step 3: Implementa**

`src/content/badges.ts`:
```ts
import type { Evaluation, Priority } from '@/shared/types';

export const BADGE_ATTR = 'data-homeradar-badge';

const BASE: Partial<CSSStyleDeclaration> = {
  position: 'absolute', top: '8px', left: '8px', zIndex: '5', pointerEvents: 'none',
  padding: '3px 8px', borderRadius: '999px', borderWidth: '1px', borderStyle: 'solid',
  font: '600 12px/1.3 system-ui, sans-serif', whiteSpace: 'nowrap',
};

const COLORS: Record<Priority, Partial<CSSStyleDeclaration>> = {
  high: { background: '#fde2e1', color: '#a4161a', borderColor: '#f5a3a0' },
  medium: { background: '#fff1d6', color: '#8a5300', borderColor: '#f3c77a' },
  verify: { background: '#e7eefc', color: '#1d4ed8', borderColor: '#a9c1f5' },
  none: { background: '#f1f1f1', color: '#555555', borderColor: '#dddddd' },
};

function findCard(root: ParentNode, portalId: number): HTMLElement | null {
  const anchor = root.querySelector<HTMLAnchorElement>(`a[href*="/annunci/${portalId}/"]`);
  return anchor?.closest('li') ?? null;
}

export function renderBadge(root: ParentNode, ev: Evaluation): 'created' | 'updated' | 'unchanged' | 'no-card' {
  const card = findCard(root, ev.portalId);
  if (!card) return 'no-card';

  let badge = card.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  if (badge && badge.textContent === ev.badgeText && badge.dataset.priority === ev.priority) return 'unchanged';

  let result: 'created' | 'updated' = 'updated';
  if (!badge) {
    const img = card.querySelector('img');
    const host = (img?.closest<HTMLElement>('.nd-slideshow__content') ?? img?.parentElement ?? card) as HTMLElement;
    const pos = host.ownerDocument.defaultView?.getComputedStyle(host).position;
    if (!pos || pos === 'static') host.style.position = 'relative';
    badge = host.ownerDocument.createElement('span');
    badge.setAttribute(BADGE_ATTR, '');
    host.append(badge);
    result = 'created';
  }
  badge.textContent = ev.badgeText;
  badge.dataset.priority = ev.priority;
  Object.assign(badge.style, BASE, COLORS[ev.priority]);
  return result;
}
```

`src/content/banner.ts`:
```ts
export const BANNER_ID = 'homeradar-banner';
export const FALLBACK_TEXT = 'HomeRadar: ricarica la pagina per analizzare questi risultati';

export function showBanner(doc: Document, text: string): void {
  if (doc.getElementById(BANNER_ID)) return;
  const el = doc.createElement('div');
  el.id = BANNER_ID;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
    background: '#1d4ed8', color: '#fff', padding: '8px 12px', borderRadius: '8px',
    font: '500 13px/1.4 system-ui, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,.2)',
    display: 'flex', gap: '10px', alignItems: 'center',
  } satisfies Partial<CSSStyleDeclaration>);
  const msg = doc.createElement('span');
  msg.textContent = text;
  const reload = doc.createElement('button');
  reload.textContent = 'Ricarica';
  reload.addEventListener('click', () => doc.defaultView?.location.reload());
  const close = doc.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Chiudi');
  close.addEventListener('click', () => el.remove());
  el.append(msg, reload, close);
  doc.body.append(el);
}
```

`src/content/route-watcher.ts`:
```ts
export interface RouteWatcherOptions {
  getUrl(): string;
  isRelevant(url: string): boolean;
  timeoutMs: number;
  /** Un payload arrivato fino a graceMs prima del cambio URL vale per la nuova pagina. */
  graceMs: number;
  onMissing(url: string): void;
}

export class RouteWatcher {
  private lastUrl = '';
  private lastPayloadAt = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly opts: RouteWatcherOptions) {}

  notifyPayload(): void {
    this.lastPayloadAt = Date.now();
  }

  check(): void {
    const url = this.opts.getUrl();
    if (url === this.lastUrl) return;
    this.lastUrl = url;
    if (this.timer) clearTimeout(this.timer);
    if (!this.opts.isRelevant(url)) return;
    const since = Date.now();
    this.timer = setTimeout(() => {
      if (this.lastPayloadAt < since - this.opts.graceMs && this.opts.getUrl() === url) this.opts.onMissing(url);
    }, this.opts.timeoutMs);
  }
}
```

`src/content/controller.ts`:
```ts
import type { PortalAdapter } from '@/adapters/types';
import { renderBadge } from '@/content/badges';
import type { Request } from '@/shared/messages';
import type { Evaluation } from '@/shared/types';

export interface ControllerDeps {
  adapter: PortalAdapter;
  send: (req: Request) => Promise<unknown>;
  root: ParentNode;
}

export function createController({ adapter, send, root }: ControllerDeps) {
  const evaluations = new Map<number, Evaluation>();

  function applyAll(): void {
    for (const ev of evaluations.values()) renderBadge(root, ev);
  }

  async function handle(kind: 'next-data' | 'api', url: string, payload: unknown): Promise<void> {
    const result = kind === 'next-data' ? adapter.parseNextData(payload, url) : adapter.parseIntercepted(url, payload);
    const ok = result.errors.length === 0 || result.observations.length > 0;
    await send({ type: 'parseStatus', ok, errors: result.errors, source: kind });
    if (!result.observations.length) return;
    const evs = (await send({ type: 'ingest', observations: result.observations })) as Evaluation[];
    for (const ev of evs) evaluations.set(ev.portalId, ev);
    applyAll();
  }

  return { handle, applyAll };
}
```

`src/entrypoints/immobiliare.content.ts`:
```ts
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { isBridgeMessage } from '@/bridge/bridge';
import { FALLBACK_TEXT, showBanner } from '@/content/banner';
import { createController } from '@/content/controller';
import { RouteWatcher } from '@/content/route-watcher';
import { send } from '@/shared/messages';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  runAt: 'document_start',
  main(ctx) {
    const controller = createController({ adapter: immobiliareAdapter, send, root: document });
    const watcher = new RouteWatcher({
      getUrl: () => location.href,
      isRelevant: (url) => immobiliareAdapter.pageKind(url) !== 'other',
      timeoutMs: 5000,
      graceMs: 3000,
      onMissing: () => {
        showBanner(document, FALLBACK_TEXT);
        send({ type: 'fallbackShown' }).catch(() => {});
      },
    });

    window.addEventListener('message', (event) => {
      if (event.source !== window || !isBridgeMessage(event.data)) return;
      watcher.notifyPayload();
      controller.handle(event.data.kind, event.data.url, event.data.payload).catch((err) => console.warn('[HomeRadar]', err));
    });

    watcher.check();
    ctx.setInterval(() => watcher.check(), 1000);

    let pending: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => controller.applyAll(), 300);
    });
    const start = () => observer.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    ctx.onInvalidated(() => observer.disconnect());
  },
});
```

- [ ] **Step 4: Esegui test, typecheck e build**

Run: `npx vitest run tests/unit && npm run typecheck && npm run build`
Expected: PASS; il manifest ha due content script (`MAIN` e `ISOLATED`), entrambi `document_start`.

- [ ] **Step 5: Commit**

```bash
git add src/content src/entrypoints/immobiliare.content.ts tests/unit/content
git commit -m "feat: content script with photo badges, fallback banner and route watcher"
```

---

### Task 13: Pannello laterale

**Files:**
- Create: `src/ui/sidepanel/api.ts`, `src/ui/sidepanel/download.ts`, `src/ui/sidepanel/Sparkline.tsx`, `src/ui/sidepanel/LeadItem.tsx`, `src/ui/sidepanel/ExportBar.tsx`, `src/ui/sidepanel/SettingsView.tsx`, `src/ui/sidepanel/App.tsx`, `src/ui/sidepanel/styles.css`
- Modify: `src/entrypoints/sidepanel/main.tsx`
- Test: `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `send`, `LEADS_CHANGED`, `groupByStatus`, `PRIORITY_LABELS`, `STATUS_LABELS`, `toExportRows`, `toCsv`, `toXlsx`, `exportFileName`, `formatDiagnostics`, `formatEuro`
- Produces: `interface Api { listLeads; setLeadState; deleteListing; getSettings; saveSettings; getDiagnostics; onLeadsChanged(cb: () => void): () => void }`, `defaultApi`, componente `App({ api })`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/ui/sidepanel.test.tsx`:
```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/ui/sidepanel/App';
import type { Api } from '@/ui/sidepanel/api';
import { LeadItem } from '@/ui/sidepanel/LeadItem';
import { Sparkline } from '@/ui/sidepanel/Sparkline';
import { DEFAULT_SETTINGS, type LeadStatus, type LeadView, type Priority } from '@/shared/types';

afterEach(cleanup);

function lead(id: number, priority: Priority, status: LeadStatus = 'new'): LeadView {
  const key = `immobiliare:${id}`;
  return {
    listing: {
      key, portal: 'immobiliare', portalId: id, url: `https://www.immobiliare.it/annunci/${id}/`, title: `Bilocale ${id}`,
      address: null, city: 'Milano', zone: null, typology: null, surfaceM2: null, rooms: null, currentPrice: 235000,
      portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 3,
    },
    evaluation: {
      listingKey: key, portalId: id, priority, ageDays: 173, ageEstimated: false, ageUncertain: false, dropPercent: 5.6,
      dropCount: 1, maxKnownPrice: 249000, reasons: ['Online da 173 gg', 'Ribassato del 5,6%'], badgeText: '',
    },
    state: { listingKey: key, status, notes: '', statusChangedAt: 0 },
    prices: [
      { listingKey: key, price: 249000, at: 1, source: 'declared' },
      { listingKey: key, price: 235000, at: 2, source: 'declared' },
    ],
  };
}

function fakeApi(leads: LeadView[], adapterWarning = false): Api {
  return {
    listLeads: vi.fn(async () => leads),
    setLeadState: vi.fn(async (k, p) => ({ listingKey: k, status: p.status ?? 'new', notes: p.notes ?? '', statusChangedAt: 0 })),
    deleteListing: vi.fn(async () => {}),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (s) => s),
    getDiagnostics: vi.fn(async () => ({ version: '0.1.0', counters: {}, errors: [], adapterWarning })),
    onLeadsChanged: vi.fn(() => () => {}),
  };
}

describe('Sparkline', () => {
  it('non disegna nulla con meno di due prezzi', () => {
    const { container } = render(<Sparkline prices={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
  it('disegna una linea con un punto per prezzo', () => {
    const { container } = render(<Sparkline prices={[249000, 235000, 230000]} />);
    expect(container.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(3);
  });
});

describe('LeadItem', () => {
  it('mostra priorità, titolo, motivi e visite', () => {
    render(<ul><LeadItem lead={lead(1, 'high')} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText('Bilocale 1 — € 235.000')).toBeTruthy();
    expect(screen.getByText('Online da 173 gg · Ribassato del 5,6% · Visto 3 volte')).toBeTruthy();
  });

  it('cambia stato, salva le note all\'uscita e chiede conferma prima di eliminare', () => {
    const onChange = vi.fn();
    const onDelete = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} onChange={onChange} onDelete={onDelete} /></ul>);
    fireEvent.change(screen.getByLabelText('Stato'), { target: { value: 'to_contact' } });
    expect(onChange).toHaveBeenCalledWith({ status: 'to_contact' });
    const notes = screen.getByLabelText('Note');
    fireEvent.change(notes, { target: { value: 'chiamare' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.blur(notes);
    expect(onChange).toHaveBeenLastCalledWith({ notes: 'chiamare' });
    fireEvent.click(screen.getByText('Elimina'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Conferma eliminazione'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('App', () => {
  it('mostra le schede con i conteggi e filtra per stato', async () => {
    render(<App api={fakeApi([lead(1, 'high'), lead(2, 'medium'), lead(3, 'medium', 'contacted')])} />);
    expect(await screen.findByText('Nuovi (2)')).toBeTruthy();
    expect(screen.getByText('Contattati (1)')).toBeTruthy();
    expect(screen.getByText('Bilocale 1 — € 235.000')).toBeTruthy();
    expect(screen.queryByText('Bilocale 3 — € 235.000')).toBeNull();
    fireEvent.click(screen.getByText('Contattati (1)'));
    expect(screen.getByText('Bilocale 3 — € 235.000')).toBeTruthy();
  });

  it('mostra il banner quando l\'adattatore segnala un problema', async () => {
    render(<App api={fakeApi([], true)} />);
    expect(await screen.findByText('Immobiliare.it potrebbe essere cambiato: alcuni dati non sono stati letti.')).toBeTruthy();
    expect(screen.getByText('Nessun lead in questa scheda. Naviga su Immobiliare.it per raccoglierne.')).toBeTruthy();
  });

  it('mostra un errore se il database non risponde, lasciando l\'export disponibile', async () => {
    const api = fakeApi([]);
    api.listLeads = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    render(<App api={api} />);
    expect(await screen.findByText('Errore: QuotaExceededError')).toBeTruthy();
    expect(screen.getByText('⬇ Esporta XLSX')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Esegui e verifica che fallisca**

Run: `npx vitest run tests/unit/ui`
Expected: FAIL, moduli non trovati.

- [ ] **Step 3: Implementa**

`src/ui/sidepanel/api.ts`:
```ts
import { browser } from 'wxt/browser';
import { LEADS_CHANGED, send } from '@/shared/messages';
import type { Diagnostics, LeadState, LeadStatus, LeadView, Settings } from '@/shared/types';

export interface Api {
  listLeads(): Promise<LeadView[]>;
  setLeadState(listingKey: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState>;
  deleteListing(listingKey: string): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  getDiagnostics(): Promise<Diagnostics>;
  onLeadsChanged(cb: () => void): () => void;
}

export const defaultApi: Api = {
  listLeads: () => send({ type: 'listLeads' }),
  setLeadState: (listingKey, patch) => send({ type: 'setLeadState', listingKey, ...patch }),
  deleteListing: (listingKey) => send({ type: 'deleteListing', listingKey }),
  getSettings: () => send({ type: 'getSettings' }),
  saveSettings: (settings) => send({ type: 'saveSettings', settings }),
  getDiagnostics: () => send({ type: 'getDiagnostics' }),
  onLeadsChanged(cb) {
    const listener = (msg: unknown) => {
      if ((msg as { type?: string } | undefined)?.type === LEADS_CHANGED) cb();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  },
};
```

`src/ui/sidepanel/download.ts`:
```ts
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

`src/ui/sidepanel/Sparkline.tsx`:
```tsx
export function Sparkline({ prices, width = 90, height = 18 }: { prices: number[]; width?: number; height?: number }) {
  if (prices.length < 2) return null;
  const min = Math.min(...prices);
  const span = Math.max(...prices) - min || 1;
  const step = (width - 4) / (prices.length - 1);
  const points = prices
    .map((p, i) => `${(2 + i * step).toFixed(1)},${(2 + (1 - (p - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label="Storico prezzi" className="sparkline">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} />
    </svg>
  );
}
```

`src/ui/sidepanel/LeadItem.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/core/leads';
import { formatEuro } from '@/shared/format';
import { LEAD_STATUSES, type LeadStatus, type LeadView } from '@/shared/types';
import { Sparkline } from './Sparkline';

interface Props {
  lead: LeadView;
  onChange(patch: { status?: LeadStatus; notes?: string }): void;
  onDelete(): void;
}

export function LeadItem({ lead, onChange, onDelete }: Props) {
  const { listing, evaluation, state, prices } = lead;
  const [notes, setNotes] = useState(state.notes);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setNotes(state.notes), [state.notes]);

  const price = listing.currentPrice != null ? `€ ${formatEuro(listing.currentPrice)}` : 'Prezzo n.d.';
  const visits = `Visto ${listing.seenCount} ${listing.seenCount === 1 ? 'volta' : 'volte'}`;

  return (
    <li className={`lead lead--${evaluation.priority}`}>
      {evaluation.priority !== 'none' && (
        <span className={`pill pill--${evaluation.priority}`}>{PRIORITY_LABELS[evaluation.priority]}</span>
      )}
      <div className="lead__title">{`${listing.title} — ${price}`}</div>
      <div className="lead__meta">{[...evaluation.reasons, visits].join(' · ')}</div>
      <Sparkline prices={prices.map((p) => p.price)} />
      <div className="lead__actions">
        <select aria-label="Stato" value={state.status} onChange={(e) => onChange({ status: e.target.value as LeadStatus })}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <input
          aria-label="Note"
          placeholder="Note…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== state.notes) onChange({ notes });
          }}
        />
        <a href={listing.url} target="_blank" rel="noreferrer">↗ Apri</a>
        {confirming ? (
          <button type="button" onClick={onDelete}>Conferma eliminazione</button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>Elimina</button>
        )}
      </div>
    </li>
  );
}
```

`src/ui/sidepanel/ExportBar.tsx`:
```tsx
import { exportFileName, toCsv, toExportRows, toXlsx } from '@/core/export';
import type { LeadView } from '@/shared/types';
import { downloadBlob } from './download';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function ExportBar({ leads, download = downloadBlob }: { leads: LeadView[]; download?: (b: Blob, name: string) => void }) {
  const rows = () => toExportRows(leads);
  return (
    <footer className="export">
      <button type="button" onClick={() => download(new Blob([toXlsx(rows())], { type: XLSX_TYPE }), exportFileName('xlsx', Date.now()))}>
        ⬇ Esporta XLSX
      </button>
      <button type="button" onClick={() => download(new Blob([toCsv(rows())], { type: 'text/csv;charset=utf-8' }), exportFileName('csv', Date.now()))}>
        ⬇ CSV
      </button>
      <span className="export__hint">Esporta la vista corrente</span>
    </footer>
  );
}
```

`src/ui/sidepanel/SettingsView.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { formatDiagnostics } from '@/core/diagnostics';
import type { Settings } from '@/shared/types';
import type { Api } from './api';

export function SettingsView({ api, onSaved }: { api: Api; onSaved(): void }) {
  const [form, setForm] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    api.getSettings().then(setForm, (e: unknown) => setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`));
  }, [api]);
  if (!form) return <p>{message ?? 'Caricamento…'}</p>;

  const field = (key: keyof Settings, label: string) => (
    <label className="settings__field">
      {label}
      <input type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
    </label>
  );

  async function save() {
    try {
      await api.saveSettings(form!);
      setMessage('Impostazioni salvate');
      onSaved();
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(formatDiagnostics(await api.getDiagnostics(), Date.now()));
      setMessage('Report copiato negli appunti');
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="settings">
      {field('minAgeDays', 'Soglia anzianità (giorni)')}
      {field('minDropPercent', 'Ribasso minimo (%)')}
      {field('retentionDays', 'Conservazione annunci non lavorati (giorni)')}
      <button type="button" onClick={save}>Salva</button>
      <button type="button" onClick={copyReport}>Copia report diagnostico</button>
      {message && <p className="settings__message">{message}</p>}
    </section>
  );
}
```

`src/ui/sidepanel/App.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { groupByStatus } from '@/core/leads';
import { LEAD_STATUSES, type LeadStatus, type LeadView } from '@/shared/types';
import { defaultApi, type Api } from './api';
import { ExportBar } from './ExportBar';
import { LeadItem } from './LeadItem';
import { SettingsView } from './SettingsView';

const TAB_LABELS: Record<LeadStatus, string> = { new: 'Nuovi', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };
const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

export function App({ api = defaultApi }: { api?: Api }) {
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [tab, setTab] = useState<LeadStatus>('new');
  const [view, setView] = useState<'leads' | 'settings'>('leads');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, diag] = await Promise.all([api.listLeads(), api.getDiagnostics()]);
      setLeads(list);
      setWarning(diag.adapterWarning);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return api.onLeadsChanged(() => void refresh());
  }, [api, refresh]);

  const run = (action: () => Promise<unknown>) => {
    action().then(refresh, (e: unknown) => setError(errorText(e)));
  };

  const groups = groupByStatus(leads);
  const visible = groups[tab];

  return (
    <main className="panel">
      <header className="panel__header">
        <b>HomeRadar</b>
        <button type="button" onClick={() => setView(view === 'leads' ? 'settings' : 'leads')}>
          {view === 'leads' ? '⚙ Impostazioni' : '← Lead'}
        </button>
      </header>
      {warning && <p className="banner banner--warning">Immobiliare.it potrebbe essere cambiato: alcuni dati non sono stati letti.</p>}
      {error && <p className="banner banner--error">{error}</p>}
      {view === 'settings' ? (
        <SettingsView api={api} onSaved={() => void refresh()} />
      ) : (
        <>
          <nav className="tabs">
            {LEAD_STATUSES.map((s) => (
              <button key={s} type="button" className={s === tab ? 'tab tab--on' : 'tab'} onClick={() => setTab(s)}>
                {`${TAB_LABELS[s]} (${groups[s].length})`}
              </button>
            ))}
          </nav>
          {visible.length === 0 ? (
            <p className="empty">Nessun lead in questa scheda. Naviga su Immobiliare.it per raccoglierne.</p>
          ) : (
            <ul className="leads">
              {visible.map((l) => (
                <LeadItem
                  key={l.listing.key}
                  lead={l}
                  onChange={(patch) => run(() => api.setLeadState(l.listing.key, patch))}
                  onDelete={() => run(() => api.deleteListing(l.listing.key))}
                />
              ))}
            </ul>
          )}
          <ExportBar leads={visible} />
        </>
      )}
    </main>
  );
}
```

`src/ui/sidepanel/styles.css`:
```css
:root { font: 13px/1.4 system-ui, sans-serif; color: #222; background: #fff; }
body { margin: 0; }
.panel { display: flex; flex-direction: column; min-height: 100vh; }
.panel__header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid #eee; }
.banner { margin: 8px 12px; padding: 8px; border-radius: 6px; }
.banner--warning { background: #fff1d6; color: #8a5300; }
.banner--error { background: #fde2e1; color: #a4161a; }
.tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #eee; }
.tab { border: 0; border-radius: 6px; padding: 3px 8px; background: #f1f1f1; cursor: pointer; }
.tab--on { background: #222; color: #fff; }
.leads { list-style: none; margin: 0; padding: 0; flex: 1; }
.lead { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; }
.lead__title { font-weight: 600; margin-top: 4px; }
.lead__meta { color: #666; font-size: 12px; margin: 3px 0; }
.lead__actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
.lead__actions input { flex: 1; min-width: 100px; }
.pill { display: inline-block; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.pill--high { background: #fde2e1; color: #a4161a; }
.pill--medium { background: #fff1d6; color: #8a5300; }
.pill--verify { background: #e7eefc; color: #1d4ed8; }
.sparkline { color: #a4161a; }
.empty { padding: 16px 12px; color: #666; }
.export { display: flex; gap: 8px; align-items: center; padding: 10px 12px; background: #fafafa; border-top: 1px solid #eee; }
.export__hint { font-size: 11px; color: #888; }
.settings { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.settings__field { display: flex; flex-direction: column; gap: 4px; }
.settings__message { color: #444; }
```

`src/entrypoints/sidepanel/main.tsx` (sostituisci tutto):
```tsx
import { createRoot } from 'react-dom/client';
import { App } from '@/ui/sidepanel/App';
import '@/ui/sidepanel/styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 4: Esegui test, typecheck e build**

Run: `npx vitest run tests/unit && npm run typecheck && npm run build`
Expected: PASS, build OK.

- [ ] **Step 5: Verifica manuale rapida**

Run: `npm run dev` (apre Chrome con l'estensione). Vai su `https://www.immobiliare.it/vendita-case/milano/da-privati/?pag=15`, clicca l'icona HomeRadar.
Expected: badge sulle foto dei privati; il pannello laterale mostra "Nuovi (N)" con almeno un lead; cambiando pagina dei risultati i badge compaiono anche sulla nuova pagina senza banner.

- [ ] **Step 6: Commit**

```bash
git add src/ui src/entrypoints/sidepanel tests/unit/ui
git commit -m "feat: side panel with lead tabs, notes, settings and export"
```

---

### Task 14: Test end-to-end con Playwright

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/fixture-page.ts`, `tests/e2e/extension.spec.ts`

**Interfaces:**
- Consumes: build in `.output/chrome-mv3/`; fixture del Task 4; `BADGE_ATTR`, `BANNER_ID`
- Produces: `npm run test:e2e` verde, senza richieste al sito reale

- [ ] **Step 1: Crea configurazione e fixture Playwright**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  use: { trace: 'retain-on-failure' },
});
```

`tests/e2e/fixtures.ts`:
```ts
import path from 'node:path';
import { chromium, test as base, type BrowserContext } from '@playwright/test';

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const ext = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      acceptDownloads: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2]!);
  },
});

export const expect = test.expect;
```

`tests/e2e/fixture-page.ts`:
```ts
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type Result = { realEstate: { id: number; title: string } };

export function buildSearchHtml(nextData: { props: { pageProps: { dehydratedState: { queries: { state: { data: { results: Result[] } } }[] } } } }): string {
  const results = nextData.props.pageProps.dehydratedState.queries[0]!.state.data.results;
  const cards = results
    .map((r) => `<li><div class="nd-slideshow__content"><img src="${GIF}" width="150" height="100"></div><a href="https://www.immobiliare.it/annunci/${r.realEstate.id}/">${esc(r.realEstate.title)}</a></li>`)
    .join('');
  const json = JSON.stringify(nextData).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head><body>
<ul id="list">${cards}</ul>
<button id="next">Pagina successiva</button>
<button id="nav-no-data">Naviga senza dati</button>
<script id="__NEXT_DATA__" type="application/json">${json}</script>
<script>
document.getElementById('next').addEventListener('click', function () {
  var x = new XMLHttpRequest();
  x.open('GET', '/api-next/search-list/listings/?pag=2');
  x.onload = function () {
    var d = JSON.parse(x.responseText);
    document.getElementById('list').innerHTML = d.results.map(function (r) {
      return '<li><div class="nd-slideshow__content"><img src="${GIF}"></div><a href="https://www.immobiliare.it/annunci/' + r.realEstate.id + '/">x</a></li>';
    }).join('');
    history.pushState({}, '', '/vendita-case/milano/da-privati/?pag=2');
  };
  x.send();
});
document.getElementById('nav-no-data').addEventListener('click', function () {
  history.pushState({}, '', '/vendita-case/milano/da-privati/?pag=3');
});
</script></body></html>`;
}
```

- [ ] **Step 2: Scrivi i test e2e**

`tests/e2e/extension.spec.ts`:
```ts
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { buildSearchHtml } from './fixture-page';

const nextData = JSON.parse(readFileSync('tests/fixtures/immobiliare/search-privati.json', 'utf8'));
const apiText = readFileSync('tests/fixtures/immobiliare/api-listings.json', 'utf8');
type R = { realEstate: { advertiser?: { agency?: unknown; supervisor?: { type?: string } } } };
const privates = (results: R[]) => results.filter((r) => !r.realEstate.advertiser?.agency && r.realEstate.advertiser?.supervisor?.type === 'user').length;
const SEARCH = 'https://www.immobiliare.it/vendita-case/milano/da-privati/';

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: il "sito" è servito dalle fixture.
  await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/)/, (route) => route.abort());
  await context.route('https://www.immobiliare.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/api-next/search-list/listings/')) return route.fulfill({ contentType: 'application/json', body: apiText });
    if (pathname.startsWith('/vendita-case/')) return route.fulfill({ contentType: 'text/html', body: buildSearchHtml(nextData) });
    return route.fulfill({ status: 404, body: '' });
  });
});

test('mostra un badge su ogni annuncio di privato e su nessuna agenzia', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  const expected = privates(nextData.props.pageProps.dehydratedState.queries[0].state.data.results);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(expected);
  await expect(page.locator('[data-homeradar-badge]').first()).toHaveText(/^(● Alta|● Media|◐ Da verificare|Privato)/);
});

test('intercetta la risposta della pagina successiva senza banner', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await page.click('#next');
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(privates(JSON.parse(apiText).results));
  await page.waitForTimeout(6000);
  await expect(page.locator('#homeradar-banner')).toHaveCount(0);
});

test('mostra il banner di riserva se dopo un cambio pagina non arrivano dati', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await page.waitForTimeout(3500);
  await page.click('#nav-no-data');
  await expect(page.locator('#homeradar-banner')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#homeradar-banner')).toContainText('ricarica la pagina');
});

test('il pannello elenca i lead ed esporta il CSV', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByText(/^Nuovi \([1-9]\d*\)$/)).toBeVisible();
  await expect(panel.locator('.lead').first()).toBeVisible();

  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByText('⬇ CSV').click()]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Priorità;Stato;Titolo;Indirizzo');
  expect(csv).not.toMatch(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/);
});
```

- [ ] **Step 3: Esegui i test e2e**

Run: `npm run test:e2e`
Expected: 4 test PASS. Se il primo test non trova badge, verifica che la build sia aggiornata (`npm run build`) e che il manifest contenga i due content script.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: Playwright end-to-end tests on local fixture pages"
```

---

### Task 15: Documentazione per il pilota e per le prossime sessioni

**Files:**
- Create: `CLAUDE.md`, `README.md`, `docs/smoke-test.md`, `docs/privacy-pilota.md`
- Modify: `docs/superpowers/specs/2026-10-10-homeradar-mvp-design.md` (allinea le colonne di export e la tabella `meta`)

**Interfaces:**
- Consumes: tutto il resto
- Produces: documentazione; nessun codice

- [ ] **Step 1: Crea `CLAUDE.md`**

````markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeRadar è un'estensione Chrome (MV3, WXT + React + TypeScript) per agenti immobiliari: su Immobiliare.it riconosce gli annunci di privati, ne costruisce lo storico prezzi in locale e segnala i lead (anzianità ≥ soglia oppure ribassi). Conversazione e testi dell'interfaccia in italiano.

## Comandi

```bash
npm run dev          # Chrome con estensione in hot reload
npm run build        # build in .output/chrome-mv3
npm run typecheck
npm test             # unit test (Vitest, jsdom + fake-indexeddb)
npx vitest run tests/unit/core/rules.test.ts   # un singolo file
npx vitest run -t "Alta"                        # test per nome
npm run test:e2e     # build + Playwright su pagine fixture locali
```

## Architettura

Flusso: `bridge (MAIN world) → content script (ISOLATED) → adapter → background → IndexedDB → side panel`.

- `src/bridge/bridge.ts`: unico codice nel contesto della pagina. Inoltra `__NEXT_DATA__` e le risposte XHR di `/api-next/search-list/listings/` via `window.postMessage`. Non fa mai richieste proprie.
- `src/adapters/immobiliare/`: funzioni pure. Gli schemi zod sono la **lista dei campi ammessi**: ciò che non è dichiarato (telefoni, nomi, descrizioni) viene scartato. `urls.ts` non importa zod perché è usato anche dal bridge.
- `src/core/`: logica pura e testabile. `rules.ts` (priorità e badge), `age.ts` (stima età da ID), `service.ts` (`LeadService`, unico scrittore su Dexie), `router.ts` (dispatch dei messaggi), `export.ts`.
- `src/content/`: badge sulle card (`li` con link `/annunci/{id}/`), `RouteWatcher` che mostra il banner "ricarica" se dopo un cambio rotta non arrivano dati.
- `src/ui/sidepanel/`: React; parla col background solo tramite `api.ts`.
- Tipi condivisi in `src/shared/types.ts`; messaggi in `src/shared/messages.ts`.

## Vincoli da rispettare

- Mai richieste HTTP dell'estensione verso il portale (DataDome; rischio legale). Niente crawling.
- Salvare solo annunci di privati; mai telefoni o nomi del venditore.
- Il repository è pubblico: le fixture vanno sempre passate da `scripts/sanitize-fixture.mjs`; i file grezzi stanno in `fixtures-raw/` (ignorata).
- Timestamp sempre in ms epoch UTC.
- Se Immobiliare.it cambia struttura: aggiorna gli schemi in `src/adapters/immobiliare/schemas.ts`, ricattura le fixture (vedi `docs/smoke-test.md`), non modificare le fixture a mano.

## Documenti

- Specifica: `docs/superpowers/specs/2026-10-10-homeradar-mvp-design.md`
- Piano: `docs/superpowers/plans/2026-10-10-homeradar-mvp.md`
- Checklist prima di un rilascio al pilota: `docs/smoke-test.md`
````

- [ ] **Step 2: Crea `README.md`**

````markdown
# HomeRadar

Estensione Chrome per agenti immobiliari. Mentre navighi su Immobiliare.it, HomeRadar:

- riconosce gli annunci di **privati**;
- segnala quelli online da più di 120 giorni o con **ribassi di prezzo**, con un badge sulla foto;
- raccoglie i lead in un pannello laterale con stato, note e storico prezzi;
- esporta in **Excel (XLSX)** o **CSV**.

Tutti i dati restano nel tuo browser. L'estensione non effettua richieste proprie al portale e non salva telefoni né nomi dei venditori.

## Installazione per il pilota

1. Scarica lo zip della release (o esegui `npm install && npm run zip`).
2. Chrome → `chrome://extensions` → attiva "Modalità sviluppatore" → "Carica estensione non pacchettizzata" → seleziona la cartella estratta (`.output/chrome-mv3`).
3. Apri una ricerca su Immobiliare.it e clicca l'icona HomeRadar per il pannello.

## Sviluppo

Vedi `CLAUDE.md` per comandi e architettura.
````

- [ ] **Step 3: Crea `docs/smoke-test.md`**

```markdown
# Smoke test sul sito reale (prima di ogni rilascio al pilota)

Durata: ~5 minuti. Usa `npm run build` e carica `.output/chrome-mv3` in Chrome.

1. Apri `https://www.immobiliare.it/vendita-case/milano/da-privati/`.
   - [ ] Compare un badge sulla foto di ogni annuncio di privato; nessun badge sulle agenzie.
2. Passa alla pagina 2 dei risultati con il link del sito (senza ricaricare).
   - [ ] I badge compaiono sulla nuova pagina entro pochi secondi; nessun banner "ricarica".
3. Cambia ordinamento o filtro.
   - [ ] Badge aggiornati, nessun banner. Se compare il banner, la chiamata interna è cambiata: annotalo.
4. Apri un annuncio di privato (dettaglio).
   - [ ] Nessun errore; nel pannello quell'annuncio non mostra più "~" davanti ai giorni.
5. Apri il pannello laterale.
   - [ ] Schede con conteggi; cambia lo stato di un lead e scrivi una nota; ricarica il pannello: dati mantenuti.
6. Export.
   - [ ] XLSX si apre in Excel; CSV si apre in Excel con colonne separate e accenti corretti.
7. Impostazioni → "Copia report diagnostico".
   - [ ] Il testo copiato non contiene indirizzi, titoli o telefoni.
8. Icona dell'estensione.
   - [ ] Nessun "!" arancione (se presente: l'adattatore non riconosce più i dati, vedi il report diagnostico).

Se il sito è cambiato: ricattura le fixture (piano, Task 4), aggiorna gli schemi, riesegui `npm test`.
```

- [ ] **Step 4: Crea `docs/privacy-pilota.md`**

```markdown
# Informativa per gli utenti del pilota (bozza da far verificare a un legale)

**Cosa fa HomeRadar.** Mentre navighi su Immobiliare.it, legge i dati degli annunci che la pagina ti mostra e li salva **solo nel tuo browser**, per calcolare da quanto tempo un annuncio è online e se il prezzo è stato ribassato.

**Quali dati salva.** Per i soli annunci pubblicati da privati: link, titolo, indirizzo come pubblicato nell'annuncio (via e civico), città, zona, tipologia, superficie, locali, prezzi e date osservate. Le **note** che scrivi tu.

**Quali dati non salva.** Nome e numero di telefono del venditore, descrizioni, foto, annunci delle agenzie.

**Dove finiscono.** Restano nel tuo browser (IndexedDB). HomeRadar non ha server e non invia dati a terzi. Escono dal browser solo se esporti un file Excel/CSV: da quel momento il file è sotto la tua responsabilità.

**Per quanto tempo.** Gli annunci che non rivedi da 90 giorni e su cui non hai lavorato vengono cancellati automaticamente. Quelli che hai marcato restano finché non li elimini dal pannello. Disinstallando l'estensione si cancella tutto.

**Contattare i privati.** HomeRadar non contatta nessuno. Se contatti un venditore, rispetta il GDPR e il Registro delle Opposizioni.

_Punti aperti per il legale: termini d'uso di Immobiliare.it, diritto sui generis sulle banche dati (Direttiva 96/9/CE), base giuridica per il trattamento dell'indirizzo, policy del Chrome Web Store._
```

- [ ] **Step 5: Allinea la specifica**

Nel file `docs/superpowers/specs/2026-10-10-homeradar-mvp-design.md`:
- §6: sostituisci la sezione `### \`settings\`` con:
  ```markdown
  ### `meta`

  - Tabella chiave/valore. `settings` = `{ minAgeDays: 120, minDropPercent: 0, retentionDays: 90 }`; `diagnostics` = contatori, ultimi 20 errori, avviso adattatore.
  ```
- §8, "Colonne dell'export": inserisci `Titolo` dopo `Stato`.
- §8, pannello: aggiungi la voce "pulsante **Elimina** con conferma inline".

- [ ] **Step 6: Verifica finale e commit**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: tutto verde.

```bash
git add CLAUDE.md README.md docs
git commit -m "docs: CLAUDE.md, README, smoke test checklist, pilot privacy notice"
git push
```
