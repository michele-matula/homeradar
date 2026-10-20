# CasaDaPrivato.it Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quarto portale `casadaprivato`: lettura delle pagine di ricerca, giro «Cerca», badge, copertina, età stimata dall'ID, lead a trattativa riservata con filtro dedicato.

**Architecture:** Adattatore `readDocument` sul DOM come Idealista (nessun bridge), ricerche `immobili` per comune con categorie miste come Subito. Il portale entra in ogni `Record<Portal, …>`; il prezzo riservato è un segnale opzionale dell'osservazione che azzera `currentPrice` nel `LeadService`.

**Tech Stack:** WXT (MV3), TypeScript, React, Dexie, zod, Vitest (jsdom + fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-casadaprivato-design.md`

## Global Constraints

- Portale: id `casadaprivato`, tag «CasaDaPrivato», sito «CasaDaPrivato.it», acceso di default.
- Mai leggere `div.info > p` (descrizione) né nomi o telefoni; mai nelle fixture.
- Nessuna richiesta dell'estensione verso `www.casadaprivato.it`; la copertina solo da `static.casadaprivato.it`.
- Si leggono solo le card in `#property-listing` **prima** di `h2.similar-properties`; i vicini non si salvano, non contano, non hanno badge.
- Solo pagine `/annunci-vendita/…`; la scheda annuncio non si legge.
- Timestamp in ms epoch UTC. Testi dell'interfaccia in italiano.
- Fixture solo da `scripts/sanitize-fixture.mjs`; grezze in `fixtures-raw/` (ignorata).
- `ONBOARDING_VERSION` 7 → 8; `report-schema.ts` copiato identico in `worker/src/schema.ts`.
- Commit con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Card senza `mq` o senza `locali`** (terreni, box): campi `null`, nessun errore di parse. Test nel Task 3.
2. **Varianti del prezzo:** `€ 1.200.000`, «Trattativa Riservata» in maiuscole/minuscole diverse, `€ 0` → `price: null` **senza** `priceReserved`. Test nel Task 3.
3. **Lazy-load già avvenuto:** dopo il caricamento la libreria della pagina può mettere l'URL vero in `src` e togliere `data-src`; la copertina si legge da `data-src`, poi da `src`, sempre filtrata dal server ammesso (`/images/no-thumb.svg` resta fuori). Test nel Task 3.
4. **Nomi di comune difficili:** apostrofi, accenti, più parole, nomi bilingui (`Sant'Egidio del Monte Albino` → `sant_egidio_del_monte_albino`). Test nel Task 4.
5. **Titolo senza indirizzo** («Terreno Agricolo/Coltura da Privato a Aquara») → `address: null`, città letta; titolo fuori schema → osservazione con `city: null`, non un errore. Test nel Task 3.

---

### Task 1: Registrazione del portale

Aggiunge `casadaprivato` dappertutto dove il tipo `Portal` è esaustivo. Non c'è ancora l'adattatore: le ricerche del giro restano vuote per questo portale fino al Task 4.

**Files:**
- Modify: `src/shared/types.ts:3-6` (`Portal`, `PORTALS`, `PORTAL_SITES`, `PORTAL_TAGS`), `src/shared/types.ts:248` (`DEFAULT_SETTINGS.enabledPortals`)
- Modify: `src/core/age.ts` (`DEFAULT_CALIBRATION.casadaprivato` + commento sulla fonte; **niente** in `LEARN_RATE_PER_DAY`)
- Modify: `src/core/cover.ts` (`COVER_HOSTS.casadaprivato: (h) => h === 'static.casadaprivato.it'`)
- Modify: `src/core/rules.ts:14` (`VERIFY_REASON.casadaprivato: 'Età stimata vicina alla soglia'`)
- Modify: `src/core/sweep.ts:13-15` (`PAUSE_MS.casadaprivato`: `[100, 200]` in FAST, `[4_000, 10_000]` altrimenti)
- Modify: `src/core/searches.ts:7-9` (`BUILDERS.casadaprivato`: modulo provvisorio che restituisce `[]`, sostituito nel Task 4), `:23` (`estimateMinutes` con tutti i `PORTALS` accesi, via `Object.fromEntries`)
- Modify: `src/core/backup.ts:39` (`PORTAL_DOMAINS.casadaprivato: 'casadaprivato.it'`), `:106` (`casadaprivato: z.boolean().optional()`)
- Modify: `src/shared/report-schema.ts:8,24` (enum con `'casadaprivato'`, `enabledPortals` `.max(4)`); copia identica in `worker/src/schema.ts`
- Modify: `src/ui/sidepanel/SettingsView.tsx:41-48` (`PORTAL_HELP.casadaprivato`)
- Modify: `wxt.config.ts:4,16` (`'https://www.casadaprivato.it/*'` in `PORTAL_HOSTS`; descrizione con CasaDaPrivato.it)
- Test: `tests/unit/core/age.test.ts`, `tests/unit/core/cover.test.ts`, `tests/unit/core/settings.test.ts`, `tests/unit/core/searches.test.ts`, `tests/unit/core/backup.test.ts`, `tests/unit/core/report.test.ts`

**Interfaces:**
- Produces: `Portal` include `'casadaprivato'`; `DEFAULT_CALIBRATION.casadaprivato: IdDate[]`; `isCoverUrl('casadaprivato', url)`.

- [ ] **Step 1: Test che falliscono**

```ts
// age.test.ts
it('CasaDaPrivato: ID recenti a ottobre 2026, ID vecchi prima del trasloco del 2018', () => {
  const pts = DEFAULT_CALIBRATION.casadaprivato;
  const recent = estimateCreatedAt(424_000, pts)!;
  expect(recent).toBeGreaterThanOrEqual(Date.UTC(2026, 9, 1));
  expect(recent).toBeLessThanOrEqual(Date.UTC(2026, 9, 20));
  expect(estimateCreatedAt(152_000, pts)!).toBeLessThan(Date.UTC(2018, 2, 12));
  expect(estimateCreatedAt(15_000, pts)!).toBeGreaterThan(Date.UTC(2010, 0, 1));
});
// cover.test.ts
expect(isCoverUrl('casadaprivato', 'https://static.casadaprivato.it/images/properties/mediumthumbs/1/a.jpg')).toBe(true);
expect(isCoverUrl('casadaprivato', 'https://www.casadaprivato.it/images/no-thumb.svg')).toBe(false);
// settings.test.ts: impostazioni salvate senza la chiave → acceso
expect(validateSettings({ enabledPortals: { immobiliare: true, idealista: true, subito: false } as never }).enabledPortals.casadaprivato).toBe(true);
// searches.test.ts: estimateMinutes resta invariato qui (il modulo provvisorio non dà ricerche); cambia nel Task 4
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/age.test.ts tests/unit/core/cover.test.ts tests/unit/core/settings.test.ts`
Expected: FAIL (`casadaprivato` non esiste)

- [ ] **Step 3: Implementa**

Calibrazione, in quest'ordine (commento: «`Last-Modified` della copertina su `static.casadaprivato.it`, letta il 2026-10-20 su annunci della provincia di Salerno: caricamento della foto, quindi limite superiore della creazione; inviluppo inferiore. Gli ID fino a ~152 000 hanno foto del 12–13 marzo 2018 (trasloco del sito): l'estrapolazione li porta prima del 2018. Nessuna data sul sito: niente apprendimento, aggiornare a mano prima di un rilascio»):

```ts
casadaprivato: [
  { portalId: 214_000, createdAt: Date.UTC(2019, 2, 20) },
  { portalId: 289_000, createdAt: Date.UTC(2020, 8, 18) },
  { portalId: 329_000, createdAt: Date.UTC(2022, 4, 11) },
  { portalId: 339_000, createdAt: Date.UTC(2022, 9, 21) },
  { portalId: 400_300, createdAt: Date.UTC(2025, 5, 10) },
  { portalId: 404_700, createdAt: Date.UTC(2025, 8, 2) },
  { portalId: 422_500, createdAt: Date.UTC(2026, 8, 15) },
  { portalId: 423_250, createdAt: Date.UTC(2026, 8, 30) },
  { portalId: 424_240, createdAt: Date.UTC(2026, 9, 19) },
],
```

`PORTAL_HELP.casadaprivato`: «Legge gli annunci delle ricerche che apri su CasaDaPrivato.it, dove pubblicano solo privati. Il portale mostra solo la data dell'ultimo aggiornamento: l'età è stimata (indicata con «~»). Gli annunci a trattativa riservata compaiono senza prezzo. Con «Cerca» legge anche le ricerche della tua zona.»

- [ ] **Step 4: Typecheck e test completi**

Run: `npm run typecheck && npm test && npm --prefix worker test`
Expected: PASS. Aggiorna i test esistenti che elencano i tre portali (forma di `enabledPortals`, report, backup) aggiungendo `casadaprivato`; non cambiare altri valori attesi.

- [ ] **Step 5: Commit**

```bash
git add -A src worker/src/schema.ts wxt.config.ts tests
git commit -m "feat(casadaprivato): registra il quarto portale"
```

---

### Task 2: Fixture e sanitizer

**Files:**
- Create (ignorati): `fixtures-raw/casadaprivato-salerno.html` (pagina 1 di Salerno), `fixtures-raw/casadaprivato-salerno-ultima.html` (ultima pagina, oggi `/pagina-6`), `fixtures-raw/casadaprivato-acerno.html`, `fixtures-raw/casadaprivato-atrani.html`, `fixtures-raw/casadaprivato-notfound.html` (`/annunci-vendita/immobili/salerno-comuneinesistente`)
- Modify: `scripts/sanitize-fixture.mjs` (tipo `casadaprivato-search`)
- Create: `tests/fixtures/casadaprivato/search-salerno.html`, `search-salerno-ultima.html`, `search-acerno.html`, `search-atrani.html`, `notfound.html`
- Create: `tests/unit/adapters/casadaprivato.fixtures.test.ts` (solo il blocco privacy in questo task)

- [ ] **Step 1: Cattura le pagine grezze**

`curl -sL -A "<user agent di Chrome>" <url> -o fixtures-raw/<file>` per i 5 URL, con 5 secondi tra una richiesta e l'altra. Controllo: `grep -c 'class="price"'` > 0 sulle quattro ricerche, «Pagina non trovata» nell'ultima. Se `curl` non riceve le card, usa Chrome; se non riesce nemmeno così, chiedi all'utente di salvarle con «Salva con nome».

- [ ] **Step 2: Test di privacy che fallisce**

```ts
describe.each(['search-salerno.html', 'search-salerno-ultima.html', 'search-acerno.html', 'search-atrani.html', 'notfound.html'])('fixture %s', (name) => {
  it('non contiene descrizioni, script né indirizzi reali', () => {
    const text = read(name);
    const doc = parse(name);
    expect(text).not.toContain('<script');
    expect(doc.querySelectorAll('div.item p')).toHaveLength(0);
    for (const a of doc.querySelectorAll('div.item h3 a')) expect(a.textContent).toMatch(/da Privato a [^,]+(, Via Esempio \d+)?$/);
    for (const a of doc.querySelectorAll('div.item a[href]')) expect(a.getAttribute('href')).toMatch(/^\/[a-z-]+\/annuncio-\d+$/);
  });
});
```

- [ ] **Step 3: Verifica che fallisca**

Run: `npx vitest run tests/unit/adapters/casadaprivato.fixtures.test.ts`
Expected: FAIL (fixture assenti)

- [ ] **Step 4: Implementa `casadaprivato-search` nel sanitizer**

Lista dei campi ammessi: ricostruisce l'HTML invece di ripulire quello vero. Per ogni `div.item` con `div.price` di `#property-listing`, nell'ordine e con `h2.similar-properties` al suo posto: `<div class="item col-md-12"><div class="image"><a href="/<segmento>/annuncio-<id>"></a><img class="lazyload" src="/images/no-thumb.svg" data-src="<copertina finta o vuoto>"></div><div class="price"><span><testo del prezzo></span></div><div class="info"><h3><a href="/<segmento>/annuncio-<id>"><titolo></a></h3><small class="subtitle"><sottotitolo></small><ul class="amenities"><li>…</li></ul></div></div>`. Il titolo diventa `<tipologia> da Privato a <comune>`, più `, Via Esempio N` se l'originale aveva un indirizzo. La copertina finta è `https://static.casadaprivato.it/images/properties/mediumthumbs/<id>/<n in 32 cifre esadecimali>.jpg`, solo se `data-src` non era vuoto. Si tengono `h1.page-title`, il primo `h2` (contatore) e i link di paginazione `/annunci-vendita/…/pagina-N`. Senza `#property-listing` (pagina inesistente) si tengono solo `h1` e il primo paragrafo del messaggio. `<title>`: «Fixture CasaDaPrivato — ricerca». Avviso se compare `PHONE`, come gli altri tipi. Aggiorna la riga `// Uso:`.

- [ ] **Step 5: Genera le fixture e verifica**

Run: `node scripts/sanitize-fixture.mjs casadaprivato-search fixtures-raw/casadaprivato-salerno.html tests/fixtures/casadaprivato/search-salerno.html` (e gli altri quattro), poi `npx vitest run tests/unit/adapters/casadaprivato.fixtures.test.ts tests/unit/adapters/fixtures-privacy.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/sanitize-fixture.mjs tests/fixtures/casadaprivato tests/unit/adapters/casadaprivato.fixtures.test.ts
git commit -m "test(fixture): pagine di ricerca di CasaDaPrivato sanificate"
```

---

### Task 3: Adattatore

**Files:**
- Create: `src/adapters/casadaprivato/urls.ts`, `src/adapters/casadaprivato/parse.ts`, `src/adapters/casadaprivato/index.ts`
- Modify: `src/shared/types.ts` (`ListingObservation.priceReserved?: boolean`, commento: «il portale dichiara il prezzo riservato ("Trattativa Riservata" su CasaDaPrivato): azzera il prezzo salvato»)
- Create: `tests/unit/adapters/casadaprivato-builders.ts`, `tests/unit/adapters/casadaprivato.test.ts`
- Modify: `tests/unit/adapters/casadaprivato.fixtures.test.ts`

**Interfaces:**
- Consumes: `coverOrNull` (`src/core/cover.ts`), `parseEuro` (`src/adapters/immobiliare/format.ts`), `categoryFromTypology` (`src/core/category.ts`).
- Produces:
  - `urls.ts`: `BASE = 'https://www.casadaprivato.it'`; `pageKind(url: string): PageKind` (`'search'` se il percorso inizia con `/annunci-vendita/`, altrimenti `'other'`); `listingIdFromHref(href: string): number | null` (numero finale del percorso); `categoryFromPath(href: string): PropertyCategory | null`.
  - `parse.ts`: `ownCards(root: ParentNode): Element[]`; `parseSearch(root: ParentNode, url: string): ParseResult`; `hasNextPage(root: ParentNode, url: string): boolean`; `parseTitle(title: string): { typology: string | null; city: string | null; address: string | null }`.
  - `index.ts`: `casadaprivatoAdapter: PortalAdapter`.

Mappa `categoryFromPath` (primo segmento): `appartamenti`, `case-indipendenti`, `ville-singole-e-a-schiera`, `attici-mansarde`, `rustici-casali`, `altro-residenziale`, `palazzi-stabili` → `residential`; `immobili-attivita-commerciali` → `commercial`; `terreni` → `land`; `box-garage-posti-auto` → `garage`; altro → `null` (allora `categoryFromTypology(typology)`).

- [ ] **Step 1: Builder sintetici**

`casadaprivato-builders.ts` con `card(o: { id?, path?, title?, price?, amenities?: string[], dataSrc?: string | null, src?: string }): string` sulla struttura del §4 della spec, che include sempre `<p>${DESCRIPTION}</p>` (con `DESCRIPTION` = testo con un numero di telefono finto `333 123 4567`), `similarHeading(comune)` e `searchBody(cards: string[], pager?: number[])` con `#property-listing`.

- [ ] **Step 2: Test unitari che falliscono**

```ts
it('legge una card di privato', () => {
  const o = parseSearch(doc([card({ id: 424125, path: 'appartamenti', title: 'Quadrilocale da Privato a Salerno, Via Esempio 1', price: '€ 190.000', amenities: ['4 locali', '95 mq'] })]), URL).observations[0]!;
  expect(o).toMatchObject({ portal: 'casadaprivato', portalId: 424125, url: 'https://www.casadaprivato.it/appartamenti/annuncio-424125', typology: 'Quadrilocale', city: 'Salerno', address: 'Via Esempio 1', zone: null, category: 'residential', rooms: 4, surfaceM2: 95, price: 190000, sellerType: 'private', portalCreatedAt: null, lastDrop: null, source: 'search' });
  expect(o.priceReserved).toBeUndefined();
  expect(JSON.stringify(o)).not.toContain('333');
});
it('trattativa riservata: prezzo null e priceReserved', () => {
  for (const p of ['Trattativa Riservata', 'trattativa riservata']) expect(first(card({ price: p }))).toMatchObject({ price: null, priceReserved: true });
});
it('€ 0 e prezzi grandi', () => {
  expect(first(card({ price: '€ 0' }))).toMatchObject({ price: null });
  expect(first(card({ price: '€ 0' })).priceReserved).toBeUndefined();
  expect(first(card({ price: '€ 1.200.000' })).price).toBe(1_200_000);
});
it('5+ locali, nessuna superficie, nessun indirizzo', () => {
  expect(first(card({ path: 'terreni', title: 'Terreno Agricolo/Coltura da Privato a Aquara', amenities: ['5+ locali'] }))).toMatchObject({ rooms: 5, surfaceM2: null, address: null, city: 'Aquara', category: 'land' });
});
it('titolo fuori schema: city null, nessun errore', () => {
  const r = parseSearch(doc([card({ title: 'Villa sul mare' })]), URL);
  expect(r.errors).toEqual([]);
  expect(r.observations[0]!.city).toBeNull();
});
it('copertina da data-src, poi da src, solo dal server ammesso', () => {
  const cdn = 'https://static.casadaprivato.it/images/properties/mediumthumbs/1/a.jpg';
  expect(first(card({ dataSrc: cdn })).coverUrl).toBe(cdn);
  expect(first(card({ dataSrc: null, src: cdn })).coverUrl).toBe(cdn);
  expect(first(card({ dataSrc: '' })).coverUrl).toBeNull();
});
it('ignora i comuni vicini dopo h2.similar-properties', () => {
  const r = parseSearch(doc([card({ id: 1 }), similarHeading('Acerno'), card({ id: 2 })]), URL);
  expect(r.observations.map((o) => o.portalId)).toEqual([1]);
  expect(casadaprivatoAdapter.cardIds(doc([card({ id: 1 }), similarHeading('Acerno'), card({ id: 2 })]))).toEqual([1]);
  expect(casadaprivatoAdapter.cardFor(doc([similarHeading('X'), card({ id: 2 })]), 2)).toBeNull();
});
it('pagina e fine ricerca', () => {
  expect(casadaprivatoAdapter.readDocument!(doc([card()], [2, 3]), URL).page).toEqual({ results: 1, privates: 1, lastPage: false });
  expect(casadaprivatoAdapter.readDocument!(doc([card()], []), `${URL}/pagina-6`).page!.lastPage).toBe(true);
  expect(casadaprivatoAdapter.readDocument!(docWithoutListing(), URL).page).toBeUndefined();
  expect(casadaprivatoAdapter.pageKind('https://www.casadaprivato.it/appartamenti/x-1')).toBe('other');
});
```

Sulle fixture: `search-salerno.html` → 15 osservazioni, nessun errore, almeno una con `priceReserved`, almeno una con `coverUrl`, almeno una non residenziale; `search-acerno.html` → solo gli annunci prima della sezione dei vicini (tutti con `city` Acerno) e `page.results` uguale al loro numero; `search-atrani.html` → 0 osservazioni e `page: { results: 0, privates: 0, lastPage: true }`; `search-salerno-ultima.html` → `lastPage: true`; `notfound.html` → nessuna `page` e `pageProblem(doc) === 'notFound'`.

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/adapters/casadaprivato.test.ts tests/unit/adapters/casadaprivato.fixtures.test.ts`
Expected: FAIL (modulo assente)

- [ ] **Step 4: Implementa**

`ownCards`: `div.item` con `div.price` dentro `#property-listing`, esclusi quelli preceduti nel documento da `#property-listing h2.similar-properties` (`compareDocumentPosition`). Titolo: `/^(.+?) da Privato a ([^,]+)(?:,\s*(.+))?$/`. Locali: `/^(\d+)\+?\s+local/i`; superficie: `/^([\d.]+)\s*mq\b/i`. `hasNextPage`: c'è un link con `/pagina-${n + 1}`, dove `n` viene dall'URL (1 se manca). `readDocument` restituisce `page` solo se c'è `#property-listing`, con `results` = `privates` = numero di card proprie. `badgeHost`: `.image` della card, altrimenti la card. Commento in testa al file come Idealista: si leggono solo i nodi elencati, mai `div.info > p`.

- [ ] **Step 5: Verifica che passino**

Run: `npx vitest run tests/unit/adapters/casadaprivato.test.ts tests/unit/adapters/casadaprivato.fixtures.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/casadaprivato src/shared/types.ts tests/unit/adapters
git commit -m "feat(casadaprivato): adattatore sulle pagine di ricerca"
```

---

### Task 4: Ricerche del giro

**Files:**
- Create: `src/adapters/casadaprivato/search-urls.ts`
- Modify: `src/core/searches.ts` (al posto del modulo provvisorio del Task 1)
- Modify: `src/core/sweep.ts:87-89` (`isLastPage`: i portali di soli privati non si fermano a `privates < results`)
- Test: `tests/unit/adapters/casadaprivato-urls.test.ts`, `tests/unit/core/searches.test.ts`, `tests/unit/core/sweep.test.ts`

**Interfaces:**
- Consumes: `ComuneInfo`, `normalize` (`src/core/lead-filters.ts`).
- Produces: `cdpSlug(name: string): string`; `searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[]`; `pageUrl(first: string, page: number): string`.

- [ ] **Step 1: Test che falliscono**

```ts
it('slug con il trattino basso', () => {
  expect(cdpSlug("Cava de' Tirreni")).toBe('cava_de_tirreni');
  expect(cdpSlug("Sant'Egidio del Monte Albino")).toBe('sant_egidio_del_monte_albino');
  expect(cdpSlug('Capaccio Paestum')).toBe('capaccio_paestum');
  expect(cdpSlug('Salerno')).toBe('salerno');
});
it('una ricerca immobili per comune', () => {
  expect(searches([cava], ['residential'])).toEqual([{
    portal: 'casadaprivato', key: 'casadaprivato|comune:065037|immobili', label: "Cava de' Tirreni · Immobili", categories: ['residential'], mixedCategories: true,
    url: 'https://www.casadaprivato.it/annunci-vendita/immobili/salerno-cava_de_tirreni',
  }]);
});
it('pagine successive', () => {
  expect(pageUrl('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno', 1)).toBe('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno');
  expect(pageUrl('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno', 3)).toBe('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno/pagina-3');
});
// sweep.test.ts: una pagina CasaDaPrivato piena non chiude la ricerca; una senza pagina successiva o vuota sì
// searches.test.ts: estimateMinutes → { searches: 4, minutes: 1 } per Cassano e { searches: 40, minutes: 9 } per l'area di 10 comuni
```

(`cava = comuneInfo('065037')!`.)

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/adapters/casadaprivato-urls.test.ts tests/unit/core/searches.test.ts tests/unit/core/sweep.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementa**

`cdpSlug`: `normalize(name.split('/')[0]!).replace(/ /g, '_')`. Provincia: `CDP_PROVINCE_SLUGS[sigla] ?? cdpSlug(province.name)`, tabella vuota con il commento «province che CasaDaPrivato scrive diversamente (verificare sul sito)». In `sweep.ts` una costante `ALL_PRIVATE: Portal[] = ['subito', 'casadaprivato']` al posto di `portal !== 'subito'`.

- [ ] **Step 4: Verifica sul sito**

In Chrome, solo le pagine di ricerca: apri gli URL di `searches()` per Cava de' Tirreni, Sant'Egidio del Monte Albino, San Cipriano Picentino, Capaccio Paestum, Nocera Inferiore; ognuno deve mostrare `h1.page-title` «… a <comune>», non «Pagina non trovata». Una differenza diventa un'eccezione (per i comuni, una tabella `CDP_COMUNE_SLUGS` per codice ISTAT) con il suo test.

- [ ] **Step 5: Verifica che passino**

Run: `npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adapters/casadaprivato/search-urls.ts src/core/searches.ts src/core/sweep.ts tests/unit
git commit -m "feat(casadaprivato): ricerche per comune nel giro"
```

---

### Task 5: Content script ed E2E

**Files:**
- Create: `src/entrypoints/casadaprivato.content.ts` (come `idealista.content.ts`: `matches: ['https://www.casadaprivato.it/*']`, `portalState('casadaprivato')`, `checkProblem` dopo 2,5 s, `MutationObserver` con debounce di 300 ms)
- Create: `tests/e2e/casadaprivato.spec.ts`
- Modify: `tests/e2e/sweep.spec.ts` (un giro con il solo CasaDaPrivato acceso)

- [ ] **Step 1: E2E che falliscono**

`casadaprivato.spec.ts`, con `www.casadaprivato.it` servito dalle fixture e ogni altro host abortito:
- su `search-acerno.html` i badge sono tanti quanti le card prima di `h2.similar-properties` e nessuno dopo;
- su `search-salerno.html` il pannello mostra un lead con `.portal-tag` «CasaDaPrivato» e almeno un lead con il testo «Trattativa riservata» (questa riga passa solo dopo il Task 7: scrivila ora con `test.fixme` e togli `fixme` nel Task 7).

`sweep.spec.ts`: zona `Salerno` (ISTAT `065116`, provincia `SA`), solo `casadaprivato` acceso; `/annunci-vendita/immobili/salerno-salerno` → `search-salerno-ultima.html` (nessuna pagina successiva); il giro termina «completato» con privati > 0.

- [ ] **Step 2: Verifica che falliscano**

Run: `npm run test:e2e -- casadaprivato sweep`
Expected: FAIL (nessun content script)

- [ ] **Step 3: Implementa il content script**

- [ ] **Step 4: Verifica che passino**

Run: `npm run test:e2e`
Expected: PASS (tranne il `fixme`)

- [ ] **Step 5: Commit**

```bash
git add src/entrypoints/casadaprivato.content.ts tests/e2e
git commit -m "feat(casadaprivato): content script con badge e giro"
```

---

### Task 6: Prezzo riservato nel servizio e soglia dello stesso immobile

**Files:**
- Modify: `src/core/service.ts:130` (`currentPrice`)
- Modify: `src/core/same-property.ts:44-47` (`MIN_COMPARABLE_PRICE = 10_000` esportata; sotto, `candidate()` restituisce `null`)
- Test: `tests/unit/core/service.ingest.test.ts`, `tests/unit/core/same-property.test.ts`

**Interfaces:**
- Consumes: `ListingObservation.priceReserved` (Task 3).

- [ ] **Step 1: Test che falliscono**

```ts
it('un prezzo che diventa riservato azzera il prezzo attuale e resta nello storico', async () => {
  await service.ingest([obs({ portal: 'casadaprivato', price: 200_000 })]);
  await service.ingest([obs({ portal: 'casadaprivato', price: null, priceReserved: true })]);
  const rec = await db.listings.get(key);
  expect(rec!.currentPrice).toBeNull();
  expect((await db.priceSnapshots.toArray()).map((s) => s.price)).toContain(200_000);
});
it('un prezzo non letto tiene quello precedente', async () => {
  await service.ingest([obs({ price: 200_000 })]);
  await service.ingest([obs({ price: null })]);
  expect((await db.listings.get(key))!.currentPrice).toBe(200_000);
});
// same-property.test.ts
it('prezzi sotto 10.000 € non uniscono annunci', () => {
  // due annunci di portali diversi, stessa città, 95 m², 4 locali, € 400: nessun gruppo
});
it('un lead riservato torna normale quando compare il prezzo', async () => { /* riservato, poi 180_000: currentPrice 180_000 */ });
```

(Usa gli helper di `tests/unit/core/helpers.ts` già usati da questi file.)

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.ingest.test.ts tests/unit/core/same-property.test.ts`
Expected: FAIL sul primo e sul terzo

- [ ] **Step 3: Implementa**

`currentPrice: o.priceReserved ? null : o.price ?? prev?.currentPrice ?? null`. `ListingRecord` non cambia, quindi gli schemi di `backup.ts` non cambiano.

- [ ] **Step 4: Verifica che passino**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/service.ts src/core/same-property.ts tests/unit/core
git commit -m "feat(lead): trattativa riservata azzera il prezzo; niente stesso immobile sotto 10.000 €"
```

---

### Task 7: Pannello: «Trattativa riservata» e filtro

**Files:**
- Modify: `src/core/lead-filters.ts` (`LeadQuery.reservedOnly?: boolean`; `applyQuery`, `isEmptyQuery`, `describeQuery`)
- Modify: `src/ui/sidepanel/LeadItem.tsx:39,92` («Prezzo n.d.» → «Trattativa riservata»)
- Modify: `src/ui/sidepanel/App.tsx` (stato `reservedOnly`, pulsante nella riga `.price`, `resetFilters`, dipendenze dell'effetto a riga 177)
- Test: `tests/unit/core/lead-filters.test.ts`, test del pannello in `tests/unit/ui/` che già coprono il filtro prezzo
- Modify: `tests/e2e/casadaprivato.spec.ts` (togli `fixme`)

**Interfaces:**
- Produces: `LeadQuery { text: string; minPrice: number | null; maxPrice: number | null; reservedOnly?: boolean }`.

- [ ] **Step 1: Test che falliscono**

```ts
it('solo trattativa riservata: i lead senza prezzo', () => {
  expect(keys(applyQuery(leads, { ...EMPTY_QUERY, reservedOnly: true }))).toEqual([/* chiavi dei lead con currentPrice null */]);
  expect(isEmptyQuery({ ...EMPTY_QUERY, reservedOnly: true })).toBe(false);
  expect(describeQuery({ ...EMPTY_QUERY, reservedOnly: true })).toEqual(['trattativa riservata']);
});
// UI: attivando «Solo trattativa riservata» i campi del prezzo si svuotano; scrivere un prezzo disattiva il pulsante;
// «Azzera filtri» lo spegne; la card di un lead senza prezzo mostra «Trattativa riservata».
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/lead-filters.test.ts tests/unit/ui`
Expected: FAIL

- [ ] **Step 3: Implementa**

Pulsante `btn btn--sm` con `aria-pressed`, testo «Solo trattativa riservata», dopo il campo «k€» e prima di «Azzera filtri». Nessuna fascia di prezzo con il pulsante attivo: attivarlo svuota `minInput`/`maxInput`, modificare un campo del prezzo lo spegne. Rientra in `anyFilter` tramite `isEmptyQuery`.

- [ ] **Step 4: Verifica che passino**

Run: `npm test && npm run test:e2e -- casadaprivato`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/lead-filters.ts src/ui/sidepanel tests
git commit -m "feat(pannello): trattativa riservata al posto del prezzo e filtro dedicato"
```

---

### Task 8: Informativa e documentazione

**Files:**
- Modify: `src/core/onboarding.ts` (`ONBOARDING_VERSION = 8`; `ONBOARDING_CHANGES[8]`)
- Modify: `src/ui/onboarding/Onboarding.tsx:92,116,197` (CasaDaPrivato.it tra i portali; l'età stimata vale anche per CasaDaPrivato)
- Modify: `CLAUDE.md` (introduzione, flusso CasaDaPrivato, voce `src/adapters/casadaprivato/`, slug con `_`, giro), `docs/smoke-test.md` (ricattura delle fixture, aggiornamento della calibrazione prima di un rilascio, giro reale su Salerno, Battipaglia e Cava de' Tirreni con i quattro portali), `docs/pilot-reporting.md` (il Worker va ridistribuito **prima** della nuova estensione), `docs/roadmap.md` (punto 9 «fatto» al merge)
- Test: `tests/unit/core/onboarding.test.ts`, `tests/e2e/onboarding.spec.ts` se controllano versione o testi

- [ ] **Step 1: Test che falliscono**

```ts
expect(ONBOARDING_VERSION).toBe(8);
expect(changesSince(7)).toEqual([ONBOARDING_CHANGES[8]![0]]);
expect(ONBOARDING_CHANGES[8]![0]).toContain('CasaDaPrivato.it');
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/onboarding.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementa**

Voce: «HomeRadar ora legge anche le ricerche di CasaDaPrivato.it, dove pubblicano solo privati. Salva gli stessi dati degli altri portali, mai nomi, telefoni o descrizioni; l'età è stimata (indicata con «~») e gli annunci a trattativa riservata compaiono senza prezzo.»

- [ ] **Step 4: Verifica completa**

Run: `npm run typecheck && npm test && npm --prefix worker test && npm run test:e2e && npm run build`
Expected: tutto PASS, build in `.output/chrome-mv3` con `casadaprivato.content` nel manifest.

- [ ] **Step 5: Commit**

```bash
git add src/core/onboarding.ts src/ui/onboarding CLAUDE.md docs tests
git commit -m "docs(casadaprivato): informativa v8, CLAUDE.md e checklist"
```
