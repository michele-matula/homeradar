# Adattatore Subito.it — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HomeRadar funziona anche su Subito.it (tutti gli immobili in vendita): badge sui privati, lead "Subito" nel pannello, età stimata dall'ID, paginazione SPA; Immobiliare e Idealista restano invariati.

**Architecture:** terzo `PortalAdapter` in modalità "payload", come Immobiliare: il bridge (MAIN world) inoltra `__NEXT_DATA__` della ricerca e le risposte `fetch` di `hades.subito.it/v1/search/items`; `subitoAdapter.parsePayload` le valida con zod (whitelist) e produce `ListingObservation`. La scheda annuncio non viene letta. Il content script "payload" di Immobiliare diventa una funzione comune riusata da Subito. Calibrazione ID→data per Subito con punti dal Wayback Machine e apprendimento dagli annunci rinnovati oggi.

**Tech Stack:** WXT (MV3) + TypeScript + React, zod 4, Dexie (IndexedDB), Vitest (jsdom + fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-subito-adapter-design.md`

## Global Constraints

- Nessuna richiesta HTTP dell'estensione verso i portali; niente crawling. Il bridge inoltra solo `__NEXT_DATA__` e risposte già scaricate dal sito.
- Salvare solo annunci di privati; mai nomi o telefoni del venditore. Su Subito gli schemi ammettono di `advertiser` **solo** `company` e `type`; `body` non viene mai letto.
- Repository pubblico: fixture solo via `scripts/sanitize-fixture.mjs`; file grezzi in `fixtures-raw/` (ignorata).
- Timestamp sempre in ms epoch UTC. La data di rinnovo di Subito si usa solo come giorno `YYYY-MM-DD` (ora di Roma) e non si salva.
- Filtro annunci: `type.key === 's'` **e** `category.parentId === '6'`; gli altri sono ignorati senza errore.
- Venditore: `company: false` + `type: 0` → `private`; `company: true` → `agency`; altrimenti `unknown`.
- Ritmo di riferimento Subito: **120.000 ID al giorno** (`LEARN_RATE_PER_DAY.subito = 120_000`).
- Etichette: `PORTAL_SITES.subito = 'Subito.it'`, `PORTAL_TAGS.subito = 'Subito'`; incertezza come Idealista ("Età incerta", "Età stimata vicina alla soglia").
- Testi dell'interfaccia e commenti nel codice in italiano, come il codice esistente.
- Comandi: `npm test`, `npm run typecheck`, `npx vitest run <file>`, `npm run build`, `npm run test:e2e`.

## Review Focus

1. **Annuncio vecchio rinnovato oggi** in una pagina senza annunci nuovi: `newestId` è il suo ID, ma il punto appreso deve essere scartato (ID non maggiore dei noti). Test in Task 1 ("rifiuta un annuncio vecchio rinnovato oggi") e Task 3.
2. **Fuso orario a cavallo della mezzanotte:** un annuncio rinnovato alle 00:30 di Roma, con `now` alle 22:45 UTC del giorno prima, è "di oggi". Test in Task 3.
3. **Prezzo mancante, zero o non numerico** (trattativa riservata): `price: null`, mai `0`. Test in Task 3.
4. **Risultati misti** (affitti, auto o altre categorie in una ricerca generica): ignorati senza errori e senza accendere l'avviso dell'adattatore. Test in Task 3.
5. **Ritorno indietro con risultati in cache:** nessun falso banner se tutte le card sono già note; `cardIds` deve leggere solo i link `.htm` degli annunci. Test in Task 3 (`cardIds`) e controllo manuale nello smoke test (Task 6).

---

## File

| File | Responsabilità |
|---|---|
| `src/shared/types.ts` | `Portal` + `'subito'`, `PORTALS`, `PORTAL_SITES`, `PORTAL_TAGS` |
| `src/shared/format.ts` | `joinList` (elenco "a, b e c") |
| `src/core/age.ts` | `DEFAULT_CALIBRATION.subito`, `LEARN_RATE_PER_DAY.subito` |
| `src/core/rules.ts`, `src/core/leads.ts` | testi di incertezza per Subito |
| `src/ui/sidepanel/App.tsx` | elenchi di portali con `joinList` |
| `src/adapters/subito/urls.ts` | `pageKind`, `isInterceptedUrl`, `listingIdFromHref` (senza zod) |
| `src/adapters/subito/schemas.ts` | schemi zod dei due formati di annuncio |
| `src/adapters/subito/index.ts` | `parseAds`, `parseNextData`, `parseApi`, `romeDay`, `subitoAdapter` |
| `src/content/payload-script.ts` | content script comune per i portali con bridge |
| `src/entrypoints/immobiliare.content.ts` | usa `runPayloadContentScript` |
| `src/entrypoints/subito.content.ts`, `subito-bridge.content.ts` | content script Subito |
| `wxt.config.ts` | permesso host e descrizione |
| `scripts/sanitize-fixture.mjs` | modalità `subito-search`, `subito-api` |
| `tests/unit/adapters/subito-builders.ts` | annunci sintetici per i test |
| `tests/e2e/fixture-page.ts`, `tests/e2e/subito.spec.ts` | pagina fixture ed e2e |

---

### Task 1: Subito nel core (portale, calibrazione, testi)

**Files:**
- Modify: `src/shared/types.ts:1-4`
- Modify: `src/shared/format.ts`
- Modify: `src/core/age.ts:5-29`
- Modify: `src/core/rules.ts:11-15`
- Modify: `src/core/leads.ts:8-10`
- Modify: `src/ui/sidepanel/App.tsx:19-24,159`
- Test: `tests/unit/shared/format.test.ts`, `tests/unit/core/age.test.ts`, `tests/unit/core/rules.test.ts`, `tests/unit/ui/sidepanel.test.tsx` (la colonna "Portale" dell'export usa già `PORTAL_SITES`: nessuna modifica)

**Interfaces:**
- Produces: `Portal` include `'subito'`; `PORTAL_SITES.subito === 'Subito.it'`; `PORTAL_TAGS.subito === 'Subito'`; `DEFAULT_CALIBRATION.subito: IdDate[]`; `LEARN_RATE_PER_DAY.subito === 120_000`; `joinList(items: string[], conj: 'e' | 'o'): string`.

- [ ] **Step 1: Test che falliscono**

In `tests/unit/shared/format.test.ts` aggiungi (importa `joinList` da `@/shared/format`):

```ts
describe('joinList', () => {
  it('unisce gli elementi con virgole e la congiunzione finale', () => {
    expect(joinList(['A'], 'e')).toBe('A');
    expect(joinList(['A', 'B'], 'e')).toBe('A e B');
    expect(joinList(['A', 'B', 'C'], 'o')).toBe('A, B o C');
  });
});
```

In `tests/unit/core/age.test.ts`, nel `describe` di `estimateCreatedAt` aggiungi:

```ts
  it('con la calibrazione di Subito colloca un ID noto alla sua data', () => {
    expect(estimateCreatedAt(630_881_728, DEFAULT_CALIBRATION.subito)).toBe(Date.UTC(2026, 0, 10));
  });
```

e in fondo al file un nuovo blocco:

```ts
describe('acceptLearnedPoint su Subito', () => {
  const pts = DEFAULT_CALIBRATION.subito; // ultimo punto: 664.395.700 il 13/10/2026
  const RATE = LEARN_RATE_PER_DAY.subito!;
  const at = (day: number) => Date.UTC(2026, 9, day);

  it('accetta un annuncio nuovo una settimana dopo', () => {
    expect(acceptLearnedPoint({ portalId: 665_250_000, createdAt: at(20) }, pts, RATE)).toBe(true);
  });
  it('rifiuta un annuncio vecchio rinnovato oggi', () => {
    expect(acceptLearnedPoint({ portalId: 650_000_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
});
```

(importa `LEARN_RATE_PER_DAY` da `@/core/age` se non già importato).

In `tests/unit/core/rules.test.ts`, dentro `describe('evaluate')`:

```ts
  it("su Subito l'età incerta non rimanda alla scheda", () => {
    const e = ev(listing({ key: 'subito:1', portal: 'subito', estimatedCreatedAt: daysAgo(125) }));
    expect(e.priority).toBe('verify');
    expect(e.reasons).toContain('Età stimata vicina alla soglia');
    expect(e.badgeText).toBe('◐ Età incerta · ~125 gg');
  });
```

In `tests/unit/ui/sidepanel.test.tsx`, sostituisci il test "con due portali li elenca entrambi" con:

```ts
  it('con più portali li elenca tutti', async () => {
    render(<App api={fakeApi([], { immobiliare: true, idealista: true, subito: true })} />);
    expect(await screen.findByText('Immobiliare.it, Idealista.it e Subito.it potrebbero essere cambiati: alcuni dati non sono stati letti.')).toBeTruthy();
  });
```

e nel test della lista vuota cambia il testo atteso in `'Nessun lead in questa scheda. Naviga su Immobiliare.it, Idealista.it o Subito.it per raccoglierne.'`.

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/shared/format.test.ts tests/unit/core/age.test.ts tests/unit/core/rules.test.ts tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL (`joinList` non esiste, `DEFAULT_CALIBRATION.subito` undefined, testi diversi).

- [ ] **Step 3: Implementazione**

`src/shared/types.ts`, righe 1-4:

```ts
export type Portal = 'immobiliare' | 'idealista' | 'subito';
export const PORTALS: Portal[] = ['immobiliare', 'idealista', 'subito'];
export const PORTAL_SITES: Record<Portal, string> = { immobiliare: 'Immobiliare.it', idealista: 'Idealista.it', subito: 'Subito.it' };
export const PORTAL_TAGS: Record<Portal, string> = { immobiliare: 'Immobiliare', idealista: 'Idealista', subito: 'Subito' };
```

`src/shared/format.ts`, in fondo:

```ts
/** "A", "A e B", "A, B e C". */
export function joinList(items: string[], conj: 'e' | 'o'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conj} ${items.at(-1)}`;
}
```

`src/core/age.ts`: aggiorna il commento e aggiungi la voce `subito` a `DEFAULT_CALIBRATION`, poi il ritmo:

```ts
/**
 * Coppie ID → data per portale.
 * Immobiliare: verificate sul sito il 2026-10-10.
 * Idealista: prima cattura sul Wayback Machine degli annunci di ogni fascia di ID
 * (CDX `url=www.idealista.it/immobile/{prefisso}&matchType=prefix&collapse=urlkey`),
 * quindi un limite superiore con pochi giorni di ritardo; l'ultimo punto è stato letto dal sito il 2026-10-13.
 * Subito: per finestre di pochi giorni, l'ID più alto catturato dal Wayback Machine sotto
 * `www.subito.it/appartamenti/` (CDX `matchType=prefix&from=…&to=…`), con la data della cattura:
 * limite superiore della creazione; escluse le finestre con meno di 150 catture. Gli ID sono un
 * contatore unico per tutto il sito. L'ultimo punto è stato letto dal sito il 2026-10-13.
 */
export const DEFAULT_CALIBRATION: Record<Portal, IdDate[]> = {
  immobiliare: [ /* invariato */ ],
  idealista: [ /* invariato */ ],
  subito: [
    { portalId: 601_602_407, createdAt: Date.UTC(2025, 4, 12) },
    { portalId: 608_659_595, createdAt: Date.UTC(2025, 6, 8) },
    { portalId: 615_809_896, createdAt: Date.UTC(2025, 8, 10) },
    { portalId: 624_462_677, createdAt: Date.UTC(2025, 10, 15) },
    { portalId: 630_881_728, createdAt: Date.UTC(2026, 0, 10) },
    { portalId: 638_471_742, createdAt: Date.UTC(2026, 2, 7) },
    { portalId: 653_902_986, createdAt: Date.UTC(2026, 6, 13) },
    { portalId: 660_221_521, createdAt: Date.UTC(2026, 8, 10) },
    { portalId: 663_604_784, createdAt: Date.UTC(2026, 9, 7) },
    { portalId: 664_395_700, createdAt: Date.UTC(2026, 9, 13) },
  ],
};

/** Ritmo medio di nuovi ID al giorno, per i portali che imparano dagli annunci di oggi. */
export const LEARN_RATE_PER_DAY: Partial<Record<Portal, number>> = { idealista: 8200, subito: 120_000 };
```

(lascia identici i punti di `immobiliare` e `idealista`: i commenti `/* invariato */` sopra indicano solo di non toccarli).

`src/core/rules.ts`, righe 11-15:

```ts
// Su Immobiliare la scheda contiene la data vera; su Idealista e Subito no.
const VERIFY_REASON: Record<Portal, string> = {
  immobiliare: "Età da verificare: apri l'annuncio",
  idealista: 'Età stimata vicina alla soglia',
  subito: 'Età stimata vicina alla soglia',
};
```

`src/core/leads.ts`, in `priorityLabel`:

```ts
  return priority === 'verify' && portal !== 'immobiliare' ? 'Età incerta' : PRIORITY_LABELS[priority];
```

`src/ui/sidepanel/App.tsx`: importa `joinList` da `@/shared/format` e `PORTALS` da `@/shared/types`, poi:

```ts
function warningText(portals: Portal[]): string {
  const sites = joinList(portals.map((p) => PORTAL_SITES[p]), 'e');
  return portals.length === 1
    ? `${sites} potrebbe essere cambiato: alcuni dati non sono stati letti.`
    : `${sites} potrebbero essere cambiati: alcuni dati non sono stati letti.`;
}
```

e alla riga 159 il testo della lista vuota diventa:

```tsx
`Nessun lead in questa scheda. Naviga su ${joinList(PORTALS.map((p) => PORTAL_SITES[p]), 'o')} per raccoglierne.`
```

- [ ] **Step 4: Verifica**

Run: `npm run typecheck` e `npm test`
Expected: PASS. Se il typecheck segnala altri `Record<Portal, …>` incompleti, aggiungi la voce `subito` con lo stesso valore di `idealista`.

- [ ] **Step 5: Commit**

```bash
git add src/shared src/core src/ui tests/unit
git commit -m "feat(core): Subito.it portal with ID calibration and uncertain-age texts"
```

---

### Task 2: URL di Subito e intercettazione nel bridge

**Files:**
- Create: `src/adapters/subito/urls.ts`
- Test: `tests/unit/adapters/subito-urls.test.ts`, `tests/unit/bridge/bridge.test.ts`

**Interfaces:**
- Produces: `pageKind(url: string): PageKind` (`'search' | 'other'`), `isInterceptedUrl(url: string): boolean`, `listingIdFromHref(href: string): number | null`.

- [ ] **Step 1: Test che falliscono**

`tests/unit/adapters/subito-urls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isInterceptedUrl, listingIdFromHref, pageKind } from '@/adapters/subito/urls';

describe('pageKind', () => {
  it('riconosce le ricerche in vendita di qualsiasi area e categoria', () => {
    expect(pageKind('https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/')).toBe('search');
    expect(pageKind('https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/?o=2')).toBe('search');
    expect(pageKind('https://www.subito.it/annunci-italia/vendita/immobili/')).toBe('search');
  });
  it('la scheda, gli affitti e le altre pagine sono "other"', () => {
    expect(pageKind('https://www.subito.it/appartamenti/monolocale-milano-653257640.htm')).toBe('other');
    expect(pageKind('https://www.subito.it/annunci-lombardia/affitto/appartamenti/milano/')).toBe('other');
    expect(pageKind('https://www.subito.it/')).toBe('other');
    expect(pageKind('https://www.immobiliare.it/annunci-lombardia/vendita/x/')).toBe('other');
  });
});

describe('isInterceptedUrl', () => {
  it('solo la ricerca di hades', () => {
    expect(isInterceptedUrl('https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30')).toBe(true);
    expect(isInterceptedUrl('https://hades.subito.it/v1/geo/regions/4/cities/8/towns/015146/zones')).toBe(false);
    expect(isInterceptedUrl('https://www.subito.it/v1/search/items')).toBe(false);
    expect(isInterceptedUrl('non un url')).toBe(false);
  });
});

describe('listingIdFromHref', () => {
  it("legge l'ID alla fine del percorso", () => {
    expect(listingIdFromHref('https://www.subito.it/appartamenti/bilocale-milano-664390119.htm')).toBe(664390119);
    expect(listingIdFromHref('/ville-singole-e-a-schiera/villa-como-650000001.htm?x=1')).toBe(650000001);
    expect(listingIdFromHref('https://www.subito.it/annunci-lombardia/vendita/appartamenti/')).toBeNull();
  });
});
```

In `tests/unit/bridge/bridge.test.ts`, dentro `describe('installBridge')`, aggiungi (importa `isInterceptedUrl` da `@/adapters/subito/urls`):

```ts
  it('inoltra la fetch cross-origin della ricerca di Subito', async () => {
    const { win, postMessage } = fakeWindow();
    installBridge(win, isInterceptedUrl);
    await win.fetch('https://hades.subito.it/v1/search/items?start=30');
    await win.fetch('https://hades.subito.it/v1/vouchers/banners');
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledTimes(1));
    expect(postMessage.mock.calls[0]![0]).toMatchObject({ kind: 'api', url: 'https://hades.subito.it/v1/search/items?start=30' });
  });
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/adapters/subito-urls.test.ts tests/unit/bridge/bridge.test.ts`
Expected: FAIL (modulo `@/adapters/subito/urls` mancante).

- [ ] **Step 3: Implementazione**

`src/adapters/subito/urls.ts`:

```ts
import type { PageKind } from '@/shared/types';

// Niente zod qui: il modulo è usato anche dal bridge nel contesto della pagina.
const BASE = 'https://www.subito.it';

function urlOf(url: string): URL | null {
  try {
    return new URL(url, BASE);
  } catch {
    return null;
  }
}

/** Solo le ricerche in vendita: la scheda non viene letta (nessun dato in più, payload RSC fragile). */
export function pageKind(url: string): PageKind {
  const u = urlOf(url);
  if (!u || u.hostname !== 'www.subito.it') return 'other';
  return /^\/annunci-[a-z-]+\/vendita\//.test(u.pathname) ? 'search' : 'other';
}

/** Chiamata che il sito fa da sé per la paginazione in SPA. */
export function isInterceptedUrl(url: string): boolean {
  const u = urlOf(url);
  return !!u && u.hostname === 'hades.subito.it' && u.pathname.startsWith('/v1/search/items');
}

export function listingIdFromHref(href: string): number | null {
  const m = /-(\d+)\.htm(?:[?#]|$)/.exec(href);
  return m ? Number(m[1]) : null;
}
```

- [ ] **Step 4: Verifica**

Run: `npx vitest run tests/unit/adapters/subito-urls.test.ts tests/unit/bridge/bridge.test.ts`
Expected: PASS. (Con "non un url" `new URL` risolve sul BASE: l'host è `www.subito.it`, quindi `false`.)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/subito/urls.ts tests/unit/adapters/subito-urls.test.ts tests/unit/bridge/bridge.test.ts
git commit -m "feat(subito): page kinds, intercepted search API and listing IDs"
```

---

### Task 3: Schemi e parser di Subito

**Files:**
- Create: `src/adapters/subito/schemas.ts`, `src/adapters/subito/index.ts`
- Create: `tests/unit/adapters/subito-builders.ts`
- Test: `tests/unit/adapters/subito.test.ts`

**Interfaces:**
- Consumes: `pageKind`, `isInterceptedUrl`, `listingIdFromHref` (Task 2); `PortalAdapter` (`src/adapters/types.ts`).
- Produces: `subitoAdapter: PortalAdapter & { parseNextData(json: unknown, url: string, now?: number): ParseResult; parseApi(url: string, json: unknown, now?: number): ParseResult; isInterceptedUrl; listingIdFromHref }`; `parseAds(list: unknown, format: 'next' | 'api', now: number): ParseResult`; `romeDay(ms: number): string`.

- [ ] **Step 1: Builder dei dati sintetici**

`tests/unit/adapters/subito-builders.ts`:

```ts
// Annunci sintetici con la forma verificata su Subito.it il 2026-10-13
// (__NEXT_DATA__ → props.pageProps.initialState.items; risposta di hades.subito.it/v1/search/items).
export const SEARCH_URL = 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/';
export const API_URL = 'https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30';
/** 13/10/2026 12:00 a Roma. */
export const NOW = Date.UTC(2026, 9, 13, 10, 0);

type Over = Record<string, unknown>;

const base = (id: number) => ({
  kind: 'AdItem',
  urn: `id:ad:00000000-0000-0000-0000-000000000000:list:${id}`,
  type: { key: 's', value: 'In vendita' },
  category: { id: '7', label: 'Appartamenti', parentId: '6', friendlyName: 'appartamenti' },
  subject: 'Bilocale in Via Esempio 1',
  body: 'Descrizione lunga del privato',
  images: [{ cdnBaseUrl: 'https://images.example/1' }],
  geo: {
    region: { id: '4', value: 'Lombardia' },
    city: { id: '8', value: 'Milano', shortName: 'MI' },
    town: { id: '015146', value: 'Milano' },
    zone: { id: '1', value: 'Città Studi' },
  },
  urls: { default: `https://www.subito.it/appartamenti/annuncio-${id}.htm` },
});

const feats = { '/price': '250000', '/size': '65', '/room': '2' };

export function nextAd(id = 664390119, over: Over = {}) {
  return {
    ...base(id),
    date: '2026-10-12 14:31:05',
    features: Object.fromEntries(Object.entries(feats).map(([uri, key]) => [uri, { uri, values: [{ key, value: key }] }])),
    advertiser: { name: 'Mario', type: 0, userId: '7029983', company: false },
    ...over,
  };
}

export function apiAd(id = 664304986, over: Over = {}) {
  return {
    ...base(id),
    dates: { display: '2026-10-12 20:53:01', expiration: '2027-10-12 20:53:01', display_iso8601: '2026-10-12T20:53:01.136+0200' },
    features: Object.entries(feats).map(([uri, key]) => ({ uri, values: [{ key, value: key }] })),
    advertiser: { user_id: '1', name: 'Mario', phone: '3331234567', company: false, type: 0, shop_id: null, shop_name: null },
    ...over,
  };
}

export const nextData = (originalList: unknown[], extra: Over = {}) => ({
  props: { pageProps: { initialState: { items: { total: originalList.length, originalList, galleryList: [], boostedItems: [], ...extra } } } },
});

export const apiResponse = (ads: unknown[]) => ({ count_all: ads.length, lines: ads.length, start: 30, ads });

/** Card con la struttura del DOM di Subito (classi con hash omesse). */
export const cardHtml = (id: number) =>
  `<article><a href="https://www.subito.it/appartamenti/annuncio-${id}.htm"><div><figure><img src="data:,"></figure></div><h2>Titolo</h2></a></article>`;
```

- [ ] **Step 2: Test che falliscono**

`tests/unit/adapters/subito.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { romeDay, subitoAdapter as A } from '@/adapters/subito';
import { API_URL, NOW, SEARCH_URL, apiAd, apiResponse, cardHtml, nextAd, nextData } from './subito-builders';

describe('parseNextData', () => {
  it("mappa i campi dell'annuncio", () => {
    const r = A.parseNextData(nextData([nextAd()]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations).toEqual([{
      portal: 'subito', portalId: 664390119, url: 'https://www.subito.it/appartamenti/annuncio-664390119.htm',
      title: 'Bilocale in Via Esempio 1', address: null, city: 'Milano', zone: 'Città Studi', typology: 'Appartamenti',
      surfaceM2: 65, rooms: 2, price: 250000, sellerType: 'private', portalCreatedAt: null, lastDrop: null, source: 'search',
    }]);
  });

  it('riconosce privati, agenzie e negozi', () => {
    const r = A.parseNextData(nextData([
      nextAd(1),
      nextAd(2, { advertiser: { name: 'Agenzia', type: 1, userId: '2', company: true } }),
      nextAd(3, { advertiser: { name: 'Shop', type: 2, userId: '3', company: true } }),
      nextAd(4, { advertiser: { name: '', type: 5, userId: '4', company: false } }),
    ]), SEARCH_URL, NOW);
    expect(r.observations.map((o) => o.sellerType)).toEqual(['private', 'agency', 'agency', 'unknown']);
  });

  it('ignora affitti e annunci non immobiliari senza errori', () => {
    const r = A.parseNextData(nextData([
      nextAd(1, { type: { key: 'u', value: 'In affitto' } }),
      { kind: 'AdItem', urn: 'id:ad:x:list:2', type: { key: 's' }, category: { id: '2', label: 'Auto', parentId: '1' } },
      nextAd(3),
    ]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.portalId)).toEqual([3]);
  });

  it('prezzo mancante, zero o non numerico diventa null', () => {
    const noPrice = (id: number, key?: string) =>
      nextAd(id, { features: key == null ? {} : { '/price': { uri: '/price', values: [{ key, value: key }] } } });
    const r = A.parseNextData(nextData([noPrice(1), noPrice(2, '0'), noPrice(3, 'Trattativa riservata')]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.price)).toEqual([null, null, null]);
  });

  it('locali "5+" diventano 5, valori non numerici null', () => {
    const rooms = (id: number, key: string) => nextAd(id, { features: { '/room': { uri: '/room', values: [{ key, value: key }] } } });
    const r = A.parseNextData(nextData([rooms(1, '5+'), rooms(2, 'n.d.')]), SEARCH_URL, NOW);
    expect(r.observations.map((o) => o.rooms)).toEqual([5, null]);
  });

  it('un annuncio malformato è un errore, gli altri vengono letti', () => {
    const r = A.parseNextData(nextData([{ ...nextAd(1), urn: 'senza-id' }, nextAd(2)]), SEARCH_URL, NOW);
    expect(r.errors).toHaveLength(1);
    expect(r.observations.map((o) => o.portalId)).toEqual([2]);
  });

  it('legge anche gli annunci in evidenza, senza doppioni', () => {
    const r = A.parseNextData(nextData([nextAd(1)], { galleryList: [nextAd(1), nextAd(2)], boostedItems: { 0: nextAd(3) } }), SEARCH_URL, NOW);
    expect(r.observations.map((o) => o.portalId)).toEqual([1, 2, 3]);
  });

  it('fuori dalle ricerche non legge nulla', () => {
    const r = A.parseNextData(nextData([nextAd()]), 'https://www.subito.it/appartamenti/annuncio-1.htm', NOW);
    expect(r).toEqual({ observations: [], errors: [] });
  });

  it('senza la lista degli annunci restituisce un errore', () => {
    expect(A.parseNextData({ props: {} }, SEARCH_URL, NOW).errors).toHaveLength(1);
  });
});

describe('parseApi', () => {
  it('legge la risposta di hades con features in array', () => {
    const r = A.parseApi(API_URL, apiResponse([apiAd()]), NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations[0]).toMatchObject({ portalId: 664304986, price: 250000, surfaceM2: 65, rooms: 2, sellerType: 'private' });
  });

  it('ignora le altre risposte', () => {
    expect(A.parseApi('https://hades.subito.it/v1/vouchers/banners', apiResponse([apiAd()]), NOW).observations).toEqual([]);
  });
});

describe('dati personali', () => {
  it('nessuna osservazione contiene nome, telefono o descrizione', () => {
    const r1 = A.parseNextData(nextData([nextAd()]), SEARCH_URL, NOW);
    const r2 = A.parseApi(API_URL, apiResponse([apiAd()]), NOW);
    const text = JSON.stringify([r1, r2]);
    expect(text).not.toContain('Mario');
    expect(text).not.toContain('3331234567');
    expect(text).not.toContain('Descrizione');
    expect(text).not.toContain('7029983');
  });
});

describe('newestId', () => {
  it("è l'ID più alto tra gli annunci rinnovati oggi, agenzie comprese", () => {
    const r = A.parseNextData(nextData([
      nextAd(664_000_001, { date: '2026-10-13 09:00:00' }),
      nextAd(664_000_009, { date: '2026-10-13 08:00:00', advertiser: { name: 'A', type: 1, userId: '1', company: true } }),
      nextAd(664_000_050, { date: '2026-10-12 23:00:00' }),
    ]), SEARCH_URL, NOW);
    expect(r.newestId).toBe(664_000_009);
  });

  it('manca se nessun annuncio è di oggi', () => {
    expect(A.parseNextData(nextData([nextAd(1, { date: '2026-10-01 10:00:00' })]), SEARCH_URL, NOW).newestId).toBeUndefined();
  });

  it("un annuncio vecchio rinnovato oggi diventa candidato (lo scarta poi acceptLearnedPoint)", () => {
    expect(A.parseNextData(nextData([nextAd(650_000_000, { date: '2026-10-13 07:00:00' })]), SEARCH_URL, NOW).newestId).toBe(650_000_000);
  });

  it("a mezzanotte vale il giorno di Roma, non quello UTC", () => {
    const lateUtc = Date.UTC(2026, 9, 12, 22, 45); // 00:45 del 13/10 a Roma
    expect(romeDay(lateUtc)).toBe('2026-10-13');
    const r = A.parseNextData(nextData([nextAd(7, { date: '2026-10-13 00:30:00' })]), SEARCH_URL, lateUtc);
    expect(r.newestId).toBe(7);
  });

  it("vale anche per l'API con dates.display", () => {
    expect(A.parseApi(API_URL, apiResponse([apiAd(9, { dates: { display: '2026-10-13 11:00:00' } })]), NOW).newestId).toBe(9);
  });
});

describe('card nel DOM', () => {
  it('trova card, ID e contenitore della foto', () => {
    document.body.innerHTML = `<div>${cardHtml(11)}${cardHtml(12)}<a href="/annunci-lombardia/vendita/appartamenti/">x</a></div>`;
    expect(A.cardIds(document)).toEqual([11, 12]);
    const card = A.cardFor(document, 12)!;
    expect(card.tagName).toBe('ARTICLE');
    expect(A.badgeHost(card).tagName).toBe('FIGURE');
    expect(A.cardFor(document, 99)).toBeNull();
  });
});
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/adapters/subito.test.ts`
Expected: FAIL (modulo `@/adapters/subito` mancante).

- [ ] **Step 4: Schemi**

`src/adapters/subito/schemas.ts`:

```ts
import { z } from 'zod';

// Gli oggetti zod scartano le chiavi non dichiarate: questa è la lista dei campi ammessi.
// Di advertiser restano solo company e type: nome, telefono, userId e negozio non escono mai.
// body (descrizione) e immagini non sono dichiarati.
const ValuesSchema = z.array(z.object({ key: z.string() }));
const GeoValueSchema = z.object({ value: z.string() }).nullish();

export const CommonAdSchema = z.object({
  urn: z.string().regex(/:list:\d+$/),
  type: z.object({ key: z.string() }),
  category: z.object({ label: z.string(), parentId: z.string().nullish() }),
  subject: z.string(),
  advertiser: z.object({ company: z.boolean(), type: z.number().nullish() }),
  geo: z.object({ town: GeoValueSchema, zone: GeoValueSchema }).nullish(),
  urls: z.object({ default: z.string() }),
});

/** Annuncio in __NEXT_DATA__: features indicizzate per uri, data di rinnovo in date. */
export const NextAdSchema = CommonAdSchema.extend({
  date: z.string().nullish(),
  features: z.record(z.string(), z.object({ values: ValuesSchema })).nullish(),
});

/** Annuncio nella risposta di hades: features in array, data di rinnovo in dates.display. */
export const ApiAdSchema = CommonAdSchema.extend({
  dates: z.object({ display: z.string() }).nullish(),
  features: z.array(z.object({ uri: z.string(), values: ValuesSchema })).nullish(),
});

export type CommonAd = z.infer<typeof CommonAdSchema>;
```

- [ ] **Step 5: Parser e adattatore**

`src/adapters/subito/index.ts`:

```ts
import type { z } from 'zod';
import type { PayloadKind, PortalAdapter } from '@/adapters/types';
import type { ListingObservation, ParseResult, SellerType } from '@/shared/types';
import { ApiAdSchema, NextAdSchema, type CommonAd } from './schemas';
import { isInterceptedUrl, listingIdFromHref, pageKind } from './urls';

type Json = Record<string, unknown> | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
/** boostedItems può essere un oggetto indicizzato invece di un array. */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : obj(v) ? Object.values(obj(v)!) : []);

type Format = 'next' | 'api';
type Normalized = { ad: CommonAd; features: Record<string, string | undefined>; day: string | null };

const IMMOBILI = '6';
const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Giorno "YYYY-MM-DD" a Roma: le date di Subito sono in ora locale italiana. */
export const romeDay = (ms: number) => ROME_DAY.format(ms);

const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ');

/** Solo immobili in vendita; il resto (affitti, auto, …) si ignora senza errore. */
function isRealEstateSale(raw: unknown): boolean {
  const r = obj(raw);
  return obj(r?.type)?.key === 's' && obj(r?.category)?.parentId === IMMOBILI;
}

/** "250000" → 250000, "5+" → 5; zero o testo → null. */
function intOf(s: string | undefined): number | null {
  const m = s == null ? null : /^(\d+)\+?$/.exec(s.trim());
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

function normalize(raw: unknown, format: Format): Normalized | string {
  if (format === 'next') {
    const p = NextAdSchema.safeParse(raw);
    if (!p.success) return issues(p.error);
    const { features, date, ...ad } = p.data;
    const f = Object.fromEntries(Object.entries(features ?? {}).map(([uri, x]) => [uri, x.values[0]?.key]));
    return { ad, features: f, day: date?.slice(0, 10) ?? null };
  }
  const p = ApiAdSchema.safeParse(raw);
  if (!p.success) return issues(p.error);
  const { features, dates, ...ad } = p.data;
  const f = Object.fromEntries((features ?? []).map((x) => [x.uri, x.values[0]?.key]));
  return { ad, features: f, day: dates?.display.slice(0, 10) ?? null };
}

function sellerTypeOf(adv: CommonAd['advertiser']): SellerType {
  if (adv.company) return 'agency';
  return adv.type === 0 ? 'private' : 'unknown';
}

function toObservation({ ad, features }: Normalized, portalId: number): ListingObservation {
  return {
    portal: 'subito',
    portalId,
    url: ad.urls.default,
    title: ad.subject,
    address: null,
    city: ad.geo?.town?.value ?? null,
    zone: ad.geo?.zone?.value ?? null,
    typology: ad.category.label,
    surfaceM2: intOf(features['/size']),
    rooms: intOf(features['/room']),
    price: intOf(features['/price']),
    sellerType: sellerTypeOf(ad.advertiser),
    portalCreatedAt: null,
    lastDrop: null,
    source: 'search',
  };
}

export function parseAds(list: unknown, format: Format, now: number): ParseResult {
  if (!Array.isArray(list)) return { observations: [], errors: [`${format}: ads not found`] };
  const out: ParseResult = { observations: [], errors: [] };
  const today = romeDay(now);
  const seen = new Set<number>();
  list.forEach((raw, i) => {
    if (!isRealEstateSale(raw)) return;
    const n = normalize(raw, format);
    if (typeof n === 'string') {
      out.errors.push(`ads[${i}]: ${n}`);
      return;
    }
    const portalId = Number(/:list:(\d+)$/.exec(n.ad.urn)![1]);
    if (seen.has(portalId)) return;
    seen.add(portalId);
    out.observations.push(toObservation(n, portalId));
    // Rinnovato oggi: candidato punto di calibrazione (acceptLearnedPoint scarta i vecchi rinnovati).
    if (n.day === today && (out.newestId == null || portalId > out.newestId)) out.newestId = portalId;
  });
  return out;
}

function parseNextData(json: unknown, url: string, now = Date.now()): ParseResult {
  if (pageKind(url) !== 'search') return { observations: [], errors: [] };
  const items = obj(obj(obj(obj(obj(json)?.props)?.pageProps)?.initialState)?.items);
  if (!Array.isArray(items?.originalList)) return { observations: [], errors: ['next: ads not found'] };
  // Gli annunci in evidenza hanno card in pagina come gli altri: servono anche a hasUnseenListings.
  return parseAds([...items.originalList, ...listOf(items.galleryList), ...listOf(items.boostedItems)], 'next', now);
}

function parseApi(url: string, json: unknown, now = Date.now()): ParseResult {
  return isInterceptedUrl(url) ? parseAds(obj(json)?.ads, 'api', now) : { observations: [], errors: [] };
}

const AD_LINK = 'article a[href$=".htm"]';

const adapter: PortalAdapter = {
  portal: 'subito',
  pageKind,
  parsePayload: (kind: PayloadKind, url: string, json: unknown) => (kind === 'next-data' ? parseNextData(json, url) : parseApi(url, json)),
  cardFor: (root, id) => root.querySelector<HTMLAnchorElement>(`article a[href$="-${id}.htm"]`)?.closest('article') ?? null,
  // Le classi del sito hanno un hash che cambia a ogni build: si usa la struttura, non le classi.
  badgeHost(card) {
    const img = card.querySelector('img');
    return img?.closest<HTMLElement>('figure') ?? img?.parentElement ?? card;
  },
  cardIds: (root) =>
    [...root.querySelectorAll<HTMLAnchorElement>(AD_LINK)]
      .map((a) => listingIdFromHref(a.getAttribute('href') ?? ''))
      .filter((id): id is number => id != null),
};

// Le funzioni in più restano esposte per i test dell'adattatore.
export const subitoAdapter = { ...adapter, parseNextData, parseApi, isInterceptedUrl, listingIdFromHref };
```

- [ ] **Step 6: Verifica**

Run: `npx vitest run tests/unit/adapters/subito.test.ts` e `npm run typecheck`
Expected: PASS. Se `romeDay` dà un formato diverso da `YYYY-MM-DD` (ICU ridotto), sostituisci il formatter con `formatToParts` e componi `${year}-${month}-${day}`.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/subito tests/unit/adapters/subito-builders.ts tests/unit/adapters/subito.test.ts
git commit -m "feat(subito): payload adapter for search __NEXT_DATA__ and hades API"
```

---

### Task 4: Content script di Subito e manifest

**Files:**
- Create: `src/content/payload-script.ts`
- Modify: `src/entrypoints/immobiliare.content.ts`
- Create: `src/entrypoints/subito.content.ts`, `src/entrypoints/subito-bridge.content.ts`
- Modify: `wxt.config.ts`

**Interfaces:**
- Consumes: `subitoAdapter`, `isInterceptedUrl` (Task 2-3); `createController`, `RouteWatcher`, `showBanner`, `FALLBACK_TEXT`, `isBridgeMessage`, `send` (esistenti).
- Produces: `runPayloadContentScript(ctx: ScriptContext, adapter: PortalAdapter): void`.

- [ ] **Step 1: Funzione comune**

`src/content/payload-script.ts`, con il corpo spostato da `immobiliare.content.ts`:

```ts
import type { PortalAdapter } from '@/adapters/types';
import { isBridgeMessage } from '@/bridge/bridge';
import { FALLBACK_TEXT, showBanner } from '@/content/banner';
import { createController } from '@/content/controller';
import { RouteWatcher } from '@/content/route-watcher';
import { send } from '@/shared/messages';

/** La parte del contesto WXT che serve qui. */
export interface ScriptContext {
  setInterval(handler: () => void, timeout?: number): number;
  onInvalidated(cb: () => void): () => void;
}

/**
 * Content script dei portali con bridge (Immobiliare, Subito): riceve i payload inoltrati dal
 * contesto della pagina, applica i badge e mostra il banner "ricarica" se dopo un cambio di rotta
 * non arrivano dati.
 */
export function runPayloadContentScript(ctx: ScriptContext, adapter: PortalAdapter): void {
  const controller = createController({ adapter, send, root: document, getUrl: () => location.href });
  const watcher = new RouteWatcher({
    getUrl: () => location.href,
    isRelevant: (url) => adapter.pageKind(url) !== 'other',
    timeoutMs: 5000,
    graceMs: 3000,
    onMissing: () => {
      // Il sito riusa i risultati già in cache (es. tornando indietro): se tutti gli annunci
      // in pagina sono già noti non manca nulla e il banner sarebbe un falso allarme.
      if (!controller.hasUnseenListings()) return;
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
}
```

`src/entrypoints/immobiliare.content.ts` diventa:

```ts
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { runPayloadContentScript } from '@/content/payload-script';

export default defineContentScript({
  matches: ['https://www.immobiliare.it/*'],
  runAt: 'document_start',
  main(ctx) {
    runPayloadContentScript(ctx, immobiliareAdapter);
  },
});
```

- [ ] **Step 2: Content script di Subito**

`src/entrypoints/subito-bridge.content.ts`:

```ts
import { isInterceptedUrl } from '@/adapters/subito/urls';
import { installBridge } from '@/bridge/bridge';

// La fetch verso hades.subito.it è del sito: il bridge ne legge solo la risposta.
export default defineContentScript({
  matches: ['https://www.subito.it/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installBridge(window, isInterceptedUrl);
  },
});
```

`src/entrypoints/subito.content.ts`:

```ts
import { subitoAdapter } from '@/adapters/subito';
import { runPayloadContentScript } from '@/content/payload-script';

export default defineContentScript({
  matches: ['https://www.subito.it/*'],
  runAt: 'document_start',
  main(ctx) {
    runPayloadContentScript(ctx, subitoAdapter);
  },
});
```

- [ ] **Step 3: Manifest**

In `wxt.config.ts`:

```ts
    description: 'Evidenzia gli annunci di privati maturi su Immobiliare.it, Idealista.it e Subito.it',
    permissions: ['sidePanel', 'alarms', 'clipboardWrite'],
    host_permissions: ['https://www.immobiliare.it/*', 'https://www.idealista.it/*', 'https://www.subito.it/*'],
```

- [ ] **Step 4: Verifica**

Run: `npm run typecheck`, `npm test`, poi `npm run test:e2e` (build + e2e esistenti di Immobiliare e Idealista)
Expected: tutto PASS; in `.output/chrome-mv3/manifest.json` ci sono due content script per `https://www.subito.it/*` (uno con `"world": "MAIN"`). Se `ctx` di WXT non è assegnabile a `ScriptContext`, allinea le firme di `ScriptContext` a quelle del tipo `ContentScriptContext` di WXT (stessi nomi di metodo).

- [ ] **Step 5: Commit**

```bash
git add src/content/payload-script.ts src/entrypoints wxt.config.ts
git commit -m "feat(subito): content scripts and host permission; shared payload content script"
```

---

### Task 5: Fixture reali di Subito (serve l'utente)

**Files:**
- Modify: `scripts/sanitize-fixture.mjs`
- Create: `tests/fixtures/subito/search-appartamenti.json`, `tests/fixtures/subito/api-page2.json`, `tests/fixtures/subito/search-altra-categoria.json`, `tests/unit/adapters/subito.fixtures.test.ts`
- Eventualmente modify: `src/adapters/subito/index.ts`, `src/adapters/subito/urls.ts`, `tests/unit/adapters/subito-builders.ts` (solo ciò che le fixture smentiscono)

**Interfaces:**
- Consumes: `subitoAdapter` (Task 3).

- [ ] **Step 1: Chiedi all'utente le pagine**: fermati e chiedi di navigare normalmente in Chrome (non con automazione: DataDome) e di salvare:
  1. `https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/` con Ctrl+S → "Pagina web, solo HTML" → `fixtures-raw/subito-search.html`. **Prima di salvare**, scorrere fino in fondo, così le card caricate pigramente sono nel DOM.
  2. Con DevTools → Network aperto (filtro `search/items`), cliccare "pagina 2"; sulla richiesta `items?…` → Response → copiare tutto in `fixtures-raw/subito-api.json`.
  3. Nella stessa scheda, cambiare categoria dai filtri del sito (es. "Ville singole e a schiera" o "Uffici e locali commerciali") **senza** ricaricare, e dire se in Network compare una richiesta `search/items` o una `_next/data/…json`. Poi salvare quella pagina con Ctrl+S → `fixtures-raw/subito-search-altra.html`.

  Attendi la conferma (e la risposta al punto 3) prima di proseguire.

- [ ] **Step 2: Verifica sui file grezzi**: in locale, senza commit:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs'; import { JSDOM } from 'jsdom';
for (const f of ['subito-search', 'subito-search-altra']) {
  const d = new JSDOM(readFileSync('fixtures-raw/'+f+'.html','utf8')).window.document;
  const items = JSON.parse(d.getElementById('__NEXT_DATA__').textContent).props.pageProps.initialState.items;
  const lists = { original: items.originalList, gallery: [].concat(items.galleryList ?? []), boosted: Object.values(items.boostedItems ?? {}) };
  const idOf = (x) => Number(/:list:(\d+)$/.exec(x?.urn ?? '')?.[1]);
  const cardIds = [...d.querySelectorAll('article a[href\$=\".htm\"]')].map((a) => Number(/-(\d+)\.htm/.exec(a.getAttribute('href'))?.[1]));
  const card = d.querySelector('article');
  const img = card?.querySelector('img');
  console.log(f, {
    counts: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.length])),
    galleryShape: lists.gallery[0] ? Object.keys(lists.gallery[0]).slice(0, 6) : null,
    cards: cardIds.length,
    cardsNotInOriginal: cardIds.filter((id) => !lists.original.some((x) => idOf(x) === id)).length,
    cardsInNoList: cardIds.filter((id) => !Object.values(lists).flat().some((x) => idOf(x) === id)).length,
    parentIds: [...new Set(items.originalList.map((x) => x.category?.parentId + ':' + x.category?.label))],
    rooms: [...new Set(items.originalList.map((x) => x.features?.['/room']?.values?.[0]?.key))],
    sellers: [...new Set(items.originalList.map((x) => x.advertiser?.company + '/' + x.advertiser?.type))],
    imgChain: img ? [img.parentElement?.tagName, img.parentElement?.parentElement?.tagName, img.closest('a') ? 'in-link' : 'no-link'] : null,
    hrefSample: card?.querySelector('a[href\$=\".htm\"]')?.getAttribute('href')?.replace(/[a-z-]+-(\d+)\.htm/, 'slug-\$1.htm'),
  });
}
const api = JSON.parse(readFileSync('fixtures-raw/subito-api.json','utf8'));
console.log('api', { ads: api.ads.length, parentIds: [...new Set(api.ads.map((x) => x.category?.parentId))], keys: Object.keys(api.ads[0]) });
"
```

Expected e correzioni:
- `cardsInNoList` = 0. Se > 0, ci sono card di annunci che non arrivano in nessuna lista: individua la lista mancante in `items` e aggiungila in `parseNextData`.
- `galleryShape` contiene `urn`/`subject` (stessa forma degli annunci). Se gli elementi sono incapsulati (es. `{ item: {...} }`), in `parseNextData` estrai `x.item ?? x`.
- `parentIds` è sempre `6:…` in entrambe le pagine e nell'API. Se l'API non ha `parentId`, sostituisci in `isRealEstateSale` il controllo con l'elenco degli `id` di categoria visti nelle fixture (es. `['7', …]`), come costante `REAL_ESTATE_CATEGORIES` con commento sulla fonte.
- `rooms`: valori numerici o `"5+"`. Se il formato è diverso, adegua `intOf`/il campo e il test "locali" in `subito.test.ts`.
- `sellers`: solo `false/0`, `true/1`, `true/2`. Un'altra combinazione → chiedi all'utente cosa rappresenta prima di mapparla.
- `imgChain`: se l'immagine non è in un `figure`, cambia `badgeHost` per restituire il contenitore della foto reale (es. `img.parentElement`) e allinea `cardHtml` in `subito-builders.ts` alla struttura vista; `hrefSample` deve finire con `-{id}.htm` (se ha parametri, `cardFor` deve usare `a[href*="-{id}.htm"]`).
- Se al punto 3 l'utente ha visto `_next/data/…json`: in `urls.ts` `isInterceptedUrl` accetta anche `www.subito.it` con percorso `/_next/data/` che contiene `/annunci-` e `/vendita/`; in `parseApi`, se `json.pageProps.initialState.items` esiste, usa la stessa lettura di `parseNextData` (estrai una funzione `parseItems(items, now)` comune). Aggiungi un test con quell'URL in `subito-urls.test.ts` e uno in `subito.test.ts`.

Riesegui `npm test` dopo ogni correzione.

- [ ] **Step 3: Sanitizzazione**: in `scripts/sanitize-fixture.mjs`:
  - estendi uso e tipi:

```js
// Uso: node scripts/sanitize-fixture.mjs <search|detail|api|idealista-search|idealista-detail|subito-search|subito-api> <input> <output>
```

```js
const KINDS = ['search', 'detail', 'api', 'idealista-search', 'idealista-detail', 'subito-search', 'subito-api'];
```

  - prima del ramo `if (kind.startsWith('idealista-'))`, aggiungi il ramo Subito, che termina con `process.exit(0)`:

```js
if (kind.startsWith('subito-')) {
  // Si tengono solo i campi letti dall'adattatore. Via e civico possono stare nel titolo e nello slug:
  // titolo "{Categoria} in Via Esempio N", URL "/{categoria}/annuncio-{id}.htm".
  const FEATURES = new Set(['/price', '/size', '/room', '/floor', '/bathrooms']);
  const geoOf = (g) => g && Object.fromEntries(['region', 'city', 'town', 'zone'].filter((k) => g[k]).map((k) => [k, { id: g[k].id, value: g[k].value }]));
  const urlOf = (u, id) => `https://www.subito.it/${new URL(u).pathname.split('/')[1]}/annuncio-${id}.htm`;
  const ad = (x, n, api) => {
    const id = /:list:(\d+)$/.exec(x.urn)?.[1];
    const out = {
      kind: x.kind, urn: `id:ad:00000000-0000-0000-0000-000000000000:list:${id}`,
      type: x.type && { key: x.type.key, value: x.type.value },
      category: x.category && { id: x.category.id, label: x.category.label, parentId: x.category.parentId },
      subject: `${x.category?.label ?? 'Immobile'} in Via Esempio ${n}`,
      advertiser: { company: x.advertiser?.company, type: x.advertiser?.type },
      geo: geoOf(x.geo),
      urls: { default: urlOf(x.urls.default, id) },
    };
    if (api) {
      out.dates = { display: x.dates?.display };
      out.features = (x.features ?? []).filter((f) => FEATURES.has(f.uri)).map((f) => ({ uri: f.uri, values: f.values.map((v) => ({ key: v.key })) }));
    } else {
      out.date = x.date;
      out.features = Object.fromEntries(Object.entries(x.features ?? {}).filter(([k]) => FEATURES.has(k)).map(([k, f]) => [k, { uri: k, values: f.values.map((v) => ({ key: v.key })) }]));
    }
    return out;
  };
  let out;
  if (kind === 'subito-search') {
    const { JSDOM } = await import('jsdom');
    const { document } = new JSDOM(readFileSync(input, 'utf8')).window;
    const items = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps.initialState.items;
    let n = 0;
    const list = (v) => (Array.isArray(v) ? v : Object.values(v ?? {})).map((x) => ad(x, ++n, false));
    out = { props: { pageProps: { initialState: { items: {
      total: items.total, originalList: list(items.originalList), galleryList: list(items.galleryList), boostedItems: list(items.boostedItems),
    } } } } };
  } else {
    const raw = JSON.parse(readFileSync(input, 'utf8'));
    out = { count_all: raw.count_all, lines: raw.lines, start: raw.start, ads: raw.ads.map((x, i) => ad(x, i + 1, true)) };
  }
  const text = JSON.stringify(out, null, 1);
  const suspicious = text.match(PHONE);
  if (suspicious) console.warn(`ATTENZIONE: possibili numeri di telefono, controlla prima del commit: ${suspicious.join(', ')}`);
  writeFileSync(output, `${text}\n`);
  console.log(`OK: ${output}`);
  process.exit(0);
}
```

  Se allo Step 2 hai aggiunto `x.item ?? x` per gli elementi incapsulati, applicalo anche qui in `list`.

Run:

```bash
node scripts/sanitize-fixture.mjs subito-search fixtures-raw/subito-search.html tests/fixtures/subito/search-appartamenti.json
node scripts/sanitize-fixture.mjs subito-api fixtures-raw/subito-api.json tests/fixtures/subito/api-page2.json
node scripts/sanitize-fixture.mjs subito-search fixtures-raw/subito-search-altra.html tests/fixtures/subito/search-altra-categoria.json
```

Expected: tre righe `OK: …` e nessun avviso di telefoni. Apri i file e controlla a occhio che non ci siano nomi, vie o testi liberi.

- [ ] **Step 4: Test sulle fixture**: `tests/unit/adapters/subito.fixtures.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { subitoAdapter as A } from '@/adapters/subito';

const read = (name: string) => readFileSync(`tests/fixtures/subito/${name}`, 'utf8');
const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/;
const SEARCH = 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/';
const API = 'https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30';

describe.each(['search-appartamenti.json', 'api-page2.json', 'search-altra-categoria.json'])('fixture %s', (name) => {
  it('non contiene dati personali', () => {
    const text = read(name);
    for (const k of ['"name"', '"phone"', '"user_id"', '"userId"', '"shop_name"', '"body"', '"images"']) expect(text).not.toContain(k);
    expect(text).not.toMatch(PHONE);
  });

  it('ha titoli e URL sintetici', () => {
    const text = read(name);
    const subjects = [...text.matchAll(/"subject": "([^"]*)"/g)].map((m) => m[1]);
    expect(subjects.length).toBeGreaterThan(0);
    for (const s of subjects) expect(s).toMatch(/ in Via Esempio \d+$/);
    for (const m of text.matchAll(/"default": "([^"]*)"/g)) expect(m[1]).toMatch(/^https:\/\/www\.subito\.it\/[a-z-]+\/annuncio-\d+\.htm$/);
  });
});

describe('adattatore sulle fixture reali', () => {
  it('legge la ricerca di appartamenti senza errori', () => {
    const r = A.parseNextData(JSON.parse(read('search-appartamenti.json')), SEARCH);
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
    expect(r.observations.some((o) => o.sellerType === 'private')).toBe(true);
    expect(r.observations.some((o) => o.sellerType === 'agency')).toBe(true);
    expect(r.observations.every((o) => o.sellerType !== 'unknown')).toBe(true);
    expect(r.observations.filter((o) => o.price != null).length).toBeGreaterThan(r.observations.length / 2);
  });

  it("legge la risposta dell'API senza errori", () => {
    const r = A.parseApi(API, JSON.parse(read('api-page2.json')));
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
  });

  it("legge un'altra categoria di immobili", () => {
    const r = A.parseNextData(JSON.parse(read('search-altra-categoria.json')), SEARCH);
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThan(0);
    expect(r.observations.some((o) => o.typology !== 'Appartamenti')).toBe(true);
  });
});
```

Run: `npx vitest run tests/unit/adapters/subito.fixtures.test.ts`
Expected: PASS. Se fallisce la lettura (non la privacy), la fixture smentisce lo schema: correggi `schemas.ts`/`index.ts` e i builder, non la fixture.

- [ ] **Step 5: Commit**

```bash
git add scripts/sanitize-fixture.mjs tests/fixtures/subito tests/unit/adapters src/adapters/subito
git commit -m "test(subito): sanitized real-site fixtures and JSON sanitizer"
```

---

### Task 6: E2E, smoke test e documentazione

**Files:**
- Modify: `tests/e2e/fixture-page.ts`
- Create: `tests/e2e/subito.spec.ts`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: fixture `tests/fixtures/subito/*.json` (Task 5), `cardHtml` struttura (Task 3/5).
- Produces: `buildSubitoSearchHtml(nextData: SubitoNextData): string`.

- [ ] **Step 1: Pagina fixture**: in fondo a `tests/e2e/fixture-page.ts` (la struttura della card deve essere quella di `cardHtml` in `tests/unit/adapters/subito-builders.ts`, come corretta allo Step 2 del Task 5):

```ts
type SubitoAd = { urn: string; subject: string; urls: { default: string } };
type SubitoNextData = { props: { pageProps: { initialState: { items: { originalList: SubitoAd[]; galleryList?: SubitoAd[]; boostedItems?: SubitoAd[] } } } } };

const subitoCard = (ad: SubitoAd) =>
  `<article><a href="${ad.urls.default}"><div><figure><img src="${GIF}" width="150" height="100"></figure></div><h2>${esc(ad.subject)}</h2></a></article>`;

export function buildSubitoSearchHtml(nextData: SubitoNextData): string {
  const { originalList, galleryList = [], boostedItems = [] } = nextData.props.pageProps.initialState.items;
  const cards = [...boostedItems, ...galleryList, ...originalList].map(subitoCard).join('');
  const json = JSON.stringify(nextData).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixture Subito</title></head><body>
<div id="list">${cards}</div>
<button id="next">Pagina 2</button>
<script id="__NEXT_DATA__" type="application/json">${json}</script>
<script>
document.getElementById('next').addEventListener('click', function () {
  fetch('https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30').then(function (r) { return r.json(); }).then(function (d) {
    document.getElementById('list').innerHTML = d.ads.map(function (a) {
      return '<article><a href="' + a.urls.default + '"><div><figure><img src="${GIF}"></figure></div><h2>x</h2></a></article>';
    }).join('');
    history.pushState({}, '', '/annunci-lombardia/vendita/appartamenti/milano/milano/?o=2');
  });
});
</script></body></html>`;
}
```

- [ ] **Step 2: Test e2e**: `tests/e2e/subito.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { buildSubitoSearchHtml } from './fixture-page';

const nextData = JSON.parse(readFileSync('tests/fixtures/subito/search-appartamenti.json', 'utf8'));
const api = readFileSync('tests/fixtures/subito/api-page2.json', 'utf8');
const html = buildSubitoSearchHtml(nextData);
const SEARCH = 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/';

type Ad = { advertiser: { company: boolean; type: number }; type: { key: string }; category: { parentId: string } };
const privateCount = (ads: Ad[]) => ads.filter((a) => !a.advertiser.company && a.advertiser.type === 0 && a.type.key === 's' && a.category.parentId === '6').length;
const items = nextData.props.pageProps.initialState.items;
const uniquePrivates = privateCount(
  [...new Map([...items.originalList, ...items.galleryList, ...items.boostedItems].map((a: Ad & { urn: string }) => [a.urn, a])).values()],
);

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: sito e API sono serviti dalle fixture.
  await context.route(/^https?:\/\/(?!(www|hades)\.subito\.it\/)/, (route) => route.abort());
  await context.route('https://www.subito.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/annunci-')) return route.fulfill({ contentType: 'text/html', body: html });
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('https://hades.subito.it/v1/search/items**', (route) =>
    route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: api }),
  );
});

test('Subito: badge solo sui privati', async ({ context }) => {
  expect(uniquePrivates).toBeGreaterThan(0);
  const page = await context.newPage();
  await page.goto(SEARCH);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(uniquePrivates);
});

test('Subito: la pagina 2 caricata in SPA aggiunge i badge senza banner', async ({ context }) => {
  const apiPrivates = privateCount(JSON.parse(api).ads);
  test.skip(apiPrivates === 0, 'la fixture API non contiene privati');
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await page.click('#next');
  await expect(page).toHaveURL(/\?o=2$/);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(apiPrivates);
  await page.waitForTimeout(6000); // oltre il timeout del RouteWatcher
  await expect(page.locator('[data-homeradar-banner]')).toHaveCount(0);
});

test("Subito: i lead compaiono nel pannello con l'etichetta del portale", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead .portal-tag', { hasText: 'Subito' }).first()).toBeVisible();
});
```

Prima di eseguire, verifica in `src/content/banner.ts` l'attributo o l'id con cui viene marcato il banner, e usa quello al posto di `[data-homeradar-banner]` se è diverso.

Run: `npm run test:e2e`
Expected: PASS per tutti gli spec (Immobiliare, Idealista, Subito). Il pannello mostra solo i lead con priorità nella scheda "Nuovi"? Se il test del pannello non trova lead "Subito" perché nessun privato della fixture supera la soglia di età, apri il pannello sulla vista che mostra tutti i lead come fa `idealista.spec.ts` e allinea l'asserzione a quella.

- [ ] **Step 3: Smoke test e documentazione**

In `docs/smoke-test.md` aggiungi una sezione "Subito.it" con questi controlli, nello stile delle sezioni esistenti:

```markdown
## Subito.it

- [ ] Ricerca `annunci-lombardia/vendita/appartamenti/milano/milano/`: badge sulle card dei privati, nessun badge sulle agenzie
- [ ] Pagina 2 (pulsante del sito): nuovi badge senza ricaricare, nessun banner "ricarica"
- [ ] Cambio categoria dai filtri (es. ville, uffici): badge anche lì
- [ ] Indietro dal browser alla pagina precedente: nessun falso banner
- [ ] Apertura di una scheda annuncio: nessun banner, nessun errore in console
- [ ] Pannello: lead con etichetta "Subito", età con "~"; vicino alla soglia "Età incerta"
- [ ] Export XLSX/CSV: colonna Portale = "Subito.it"; nessun nome o telefono del venditore
- [ ] Diagnostica: nessun avviso adattatore per Subito.it
```

In `CLAUDE.md`:
- prima riga descrittiva: "…su Immobiliare.it, Idealista.it e Subito.it…";
- in "Architettura", dopo il flusso Idealista:

```markdown
Flusso Subito: `bridge (MAIN world) → content script (ISOLATED) → adapter.parsePayload → background → …`, come Immobiliare (content script comune in `src/content/payload-script.ts`).
```

- nell'elenco, dopo `src/adapters/idealista/`:

```markdown
- `src/adapters/subito/`: funzioni pure su `__NEXT_DATA__` della ricerca (`initialState.items`) e sulle risposte di `hades.subito.it/v1/search/items` intercettate dal bridge. Schemi zod come whitelist: di `advertiser` solo `company`/`type` (il sito espone nome e telefono). Solo `type.key === 's'` e categoria figlia di Immobili (`parentId '6'`). La data di Subito è quella di rinnovo: l'età si stima dall'ID (`DEFAULT_CALIBRATION.subito`, più i punti appresi dagli annunci rinnovati oggi). La scheda annuncio non viene letta.
```

- in "Vincoli", la riga sui cambi di struttura cita anche `src/adapters/subito/schemas.ts`.

- [ ] **Step 4: Verifica finale**

Run: `npm run typecheck`, `npm test`, `npm run test:e2e`
Expected: tutto PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e docs/smoke-test.md CLAUDE.md
git commit -m "test(e2e): Subito badges, SPA pagination and panel; docs for the third portal"
```
