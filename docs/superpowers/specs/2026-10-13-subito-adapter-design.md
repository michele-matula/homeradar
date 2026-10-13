# HomeRadar — Specifica di design: adattatore Subito.it

- **Data:** 2026-10-13
- **Stato:** in revisione
- **Ambito:** terzo portale, Subito.it (immobili in vendita, tutte le categorie). Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`, `2026-10-13-idealista-adapter-design.md`

## 1. Obiettivo

Far funzionare HomeRadar anche su **Subito.it**, con lo stesso comportamento che ha su Immobiliare.it e Idealista.it: riconoscere gli annunci di privati, costruirne lo storico prezzi in locale, segnalare i lead (anzianità ≥ soglia oppure ribassi) e gestirli dal pannello laterale.

Successo: su una ricerca di immobili in vendita su Subito i privati ricevono il badge e compaiono nel pannello con l'etichetta "Subito", con età stimata coerente; cambiando pagina (paginazione SPA) i nuovi annunci arrivano senza ricaricare. Su Immobiliare e Idealista nulla cambia.

## 2. Ambito

### Dentro

- Subito.it, **tutte le categorie di Immobili in vendita** (appartamenti, ville, loft/mansarde, uffici e locali, terreni, box, …): pagine di ricerca, comprese le pagine successive caricate in SPA
- Riconoscimento privato/agenzia, prezzo, tipologia (categoria), superficie, locali, comune, zona
- Età stimata dall'ID con calibrazione iniziale e apprendimento automatico
- Badge sulle card, etichetta "Subito" nel pannello e nell'export
- Avviso dell'adattatore per portale e banner "ricarica" di riserva

### Fuori

- Lettura della **scheda annuncio**: non aggiunge dati rispetto alla ricerca (nessuna data di pubblicazione, nessun ribasso) e usa il payload RSC dell'App Router, fragile
- Filtro per portale nel pannello
- Unione dello stesso immobile pubblicato su più portali
- Filtro dei prezzi incoerenti (es. 850 € tra le vendite): possibile miglioria futura
- I rinnovi dell'annuncio come segnale
- Affitti

## 3. Vincoli (invariati)

- **Nessuna richiesta HTTP dell'estensione** verso Subito: il bridge inoltra solo `__NEXT_DATA__` e le risposte che il sito stesso ha già scaricato. Niente crawling.
- Si salvano **solo annunci di privati**; mai nomi o telefoni del venditore. Su Subito l'oggetto `advertiser` contiene `name` (anche per i privati) e, nella risposta API, `phone`: gli schemi zod ammettono solo `company` e `type`. Non si legge `body` (descrizione).
- Repository pubblico: le fixture passano da `scripts/sanitize-fixture.mjs`.
- Timestamp in ms epoch UTC.

## 4. Dati disponibili su Subito.it (verificati il 2026-10-13, da utente loggato)

- **Ricerca** (es. `/annunci-lombardia/vendita/appartamenti/milano/milano/`): Next.js *pages router*. `__NEXT_DATA__` → `props.pageProps.initialState.items` con `originalList` (30 annunci), `galleryList`, `boostedItems`, `total`, `totalPages`.
- **Annuncio in `__NEXT_DATA__`:** `kind: "AdItem"`, `urn` `"id:ad:{uuid}:list:{listId}"`, `type {key: "s", value: "In vendita"}`, `category {id, label, parentId: "6", friendlyName}`, `subject`, `body`, `date` `"2026-10-13 15:16:38"` (ora di Roma), `features` come **oggetto** indicizzato per uri (`/price`, `/size`, `/room`, `/floor`, `/bathrooms`, …; ciascuno con `values[0].key`), `advertiser {name, type, userId, company}`, `geo {region, city (provincia), town (comune), zone?}`, `urls.default` (`https://www.subito.it/appartamenti/{slug}-{id}.htm`).
- **Paginazione (`?o=2`) in SPA:** il sito chiama con `fetch` `https://hades.subito.it/v1/search/items?…`. Risposta `{count_all, lines, start, filters, checknew, ads}`; ogni annuncio ha `dates {display, expiration, display_iso8601, …}`, `features` come **array** di `{uri, values}`, `category` come `{key, value, macrocategory_id}` (non `{id, label, parentId}`), `advertiser {user_id, name, phone, company, type, shop_id, shop_name}`.
- **Venditore:** privato = `company: false, type: 0`; agenzia = `company: true, type: 1`; esiste anche `company: true, type: 2` (negozi "Impresa+").
- **Nessuna data di pubblicazione.** `date`/`dates.display` è la data dell'ultimo **rinnovo**: annunci con ID vecchi (641M, 650M) compaiono con la data di oggi e l'ordinamento predefinito segue questa data. `expiration` = display + 1 anno. La scheda mostra la stessa data ("Ieri alle 10:45 · ID …").
- **Nessun ribasso dichiarato** né in ricerca, né nell'API, né nella scheda.
- **Scheda** `/{categoria}/{slug}-{id}.htm`: App Router (RSC `self.__next_f`), nessun `__NEXT_DATA__`; il nome del venditore è nel DOM.
- **Card nel DOM:** `article` con classi CSS-module con hash (cambiano a ogni build), contiene `a[href$="-{id}.htm"]`.
- Tra le vendite di privati compaiono prezzi da affitto (850 €, 1.100 €).
- Sito protetto da DataDome (`dd.subito.it`): le fixture le salva l'utente.

## 5. Architettura

Flusso Subito: `bridge (MAIN) → content script (ISOLATED) → subitoAdapter.parsePayload → background → IndexedDB → side panel`, come Immobiliare.

### Componenti

- `src/adapters/subito/urls.ts` (senza zod, usato anche dal bridge):
  - `pageKind(url)`: `search` per i percorsi `/annunci-{area}/vendita/…`; tutto il resto, **scheda compresa**, è `other` (così il RouteWatcher non attende dati sulla scheda).
  - `isInterceptedUrl(url)`: host `hades.subito.it`, percorso che inizia con `/v1/search/items`.
  - `listingIdFromHref(href)`: ID da `-{id}.htm` finale.
- `src/adapters/subito/schemas.ts`: schemi zod per l'annuncio nei due formati (`NextAdSchema` con `features` oggetto e `date`; `ApiAdSchema` con `features` array e `dates.display`). `advertiser` ammette solo `company` e `type`. Nessun campo `body`.
- `src/adapters/subito/index.ts`: `subitoAdapter`.
  - `parsePayload('next-data', url, json)`: legge `items.originalList` (e `galleryList`/`boostedItems` se le loro card sono in pagina, vedi §9) solo se `pageKind(url) === 'search'`.
  - `parsePayload('api', url, json)`: legge `ads` se `isInterceptedUrl(url)`.
  - `cardFor(root, id)`: `article` che contiene `a[href$="-{id}.htm"]`.
  - `badgeHost(card)`: contenitore della foto, individuato per struttura/tag (non per classe con hash); selettore fissato sulla fixture.
  - `cardIds(root)`: ID dei link `article a[href$=".htm"]`.
- `src/entrypoints/subito-bridge.content.ts` (MAIN, `document_start`, `installBridge(window, isInterceptedUrl)`) e `src/entrypoints/subito.content.ts` (ISOLATED, controller + RouteWatcher + MutationObserver), come quelli di Immobiliare. Nel piano si valuta l'estrazione di una funzione comune ai due content script "payload".
- `wxt.config.ts`: `host_permissions` aggiunge `https://www.subito.it/*` (non serve hades: la fetch è del sito); descrizione "…su Immobiliare.it, Idealista.it e Subito.it".
- `src/shared/types.ts`: `Portal` aggiunge `'subito'`; `PORTALS`, `PORTAL_SITES` (`Subito.it`), `PORTAL_TAGS` (`Subito`). Diagnostica, avviso per portale ed export funzionano senza altre modifiche.

## 6. Mappatura dei dati

### Filtri

Un annuncio viene letto solo se `type.key === 's'` (in vendita) **e** la macrocategoria è Immobili (`'6'`): `category.parentId` in `__NEXT_DATA__`, `category.macrocategory_id` nell'API. Gli altri vengono ignorati senza contare come errori. Un annuncio che non rispetta lo schema è un errore (conta per l'avviso dell'adattatore).

### Tipo di venditore

- `company: false` e `type: 0` → `private`
- `company: true` → `agency`
- altrimenti → `unknown` (accende l'avviso)

### Campi

| `ListingObservation` | Subito |
|---|---|
| `portalId` | numero finale di `urn` (`…:list:{id}`) |
| `url` | `urls.default` |
| `title` | `subject` |
| `typology` | `category.label` (`category.value` nell'API) |
| `price` | `/price` `values[0].key` numerico; assente, non numerico o 0 → `null` |
| `surfaceM2` | `/size` `values[0].key` numerico, altrimenti `null` |
| `rooms` | `/room` `values[0].key` se numerico (formato esatto, es. "5+", da fissare sulla fixture), altrimenti `null` |
| `city` | `geo.town.value` |
| `zone` | `geo.zone.value`, altrimenti `null` |
| `address` | `null` (nessun campo dedicato; il titolo libero non viene analizzato) |
| `portalCreatedAt` | `null` |
| `lastDrop` | `null` (i ribassi li ricava `rules.ts` dagli snapshot osservati) |
| `source` | `'search'` |

La data di rinnovo non si salva: serve solo a `newestId` (§7) ed è letta come giorno `YYYY-MM-DD` (ora di Roma; primi 10 caratteri di `date` o di `dates.display`), confrontato con il giorno corrente a Roma.

## 7. Età e regole

Le regole dei lead non cambiano. Su Subito l'età è sempre stimata ("~"). L'incertezza vicino alla soglia si comporta come su Idealista: etichetta "Età incerta" e motivo "Età stimata vicina alla soglia" (la scheda non mostra la data vera). In `rules.ts` Subito si aggiunge accanto al caso Idealista.

### Calibrazione iniziale

Gli ID di Subito sono un contatore unico per tutto il sito, circa **120.000 al giorno**. `DEFAULT_CALIBRATION.subito`: per ogni finestra di pochi giorni, l'ID più alto catturato dal Wayback Machine sotto `www.subito.it/appartamenti/` (CDX `url=www.subito.it/appartamenti/&matchType=prefix&from=…&to=…&fl=timestamp,original`), con la data della cattura: è un limite superiore della data di creazione. Escluse le finestre con meno di 150 catture. L'ultimo punto è stato letto dal sito il 2026-10-13.

| ID | data |
|---|---|
| 601.602.407 | 2025-05-12 |
| 608.659.595 | 2025-07-08 |
| 615.809.896 | 2025-09-10 |
| 624.462.677 | 2025-11-15 |
| 630.881.728 | 2026-01-10 |
| 638.471.742 | 2026-03-07 |
| 653.902.986 | 2026-07-13 |
| 660.221.521 | 2026-09-10 |
| 663.604.784 | 2026-10-07 |
| 664.395.700 | 2026-10-13 |

Il commento nel codice riporta fonte e metodo.

### Apprendimento automatico

- `LEARN_RATE_PER_DAY.subito = 120_000`.
- `ParseResult.newestId` = ID più alto tra gli annunci letti (privati e agenzie) con **data di rinnovo uguale a oggi**, su qualsiasi pagina di ricerca e ordinamento. Se nessuno è di oggi, `newestId` è assente.
- `acceptLearnedPoint` invariata: il punto vale solo se supera tutti gli ID noti e il ritmo è tra 0,5× e 2× quello atteso, così un annuncio vecchio rinnovato oggi viene scartato.

## 8. Test

### Fixture (salvate dall'utente, poi sanificate)

1. Pagina di ricerca appartamenti in vendita, salvata come HTML completo (`__NEXT_DATA__` + card).
2. Risposta di `hades.subito.it/v1/search/items` passando a pagina 2 (DevTools → Network → risposta).
3. Pagina di ricerca di un'altra categoria in vendita (es. ville o uffici).

`scripts/sanitize-fixture.mjs` aggiunge:
- `subito-search`: estrae `__NEXT_DATA__` tenendo solo i campi di §6 più `type`, `category`, `date`, `geo`; rimuove `advertiser.name`/`userId`, `body`, `images`; `subject` diventa "{Categoria} in Via Esempio N"; lo slug degli URL diventa `annuncio-{id}.htm`. Ripulisce le card del DOM (script, immagini, testi, attributi non necessari) come per Idealista, con gli stessi URL anonimi.
- `subito-api`: stessa pulizia sulla risposta API, rimuovendo anche `phone`, `user_id`, `shop_id`, `shop_name`, `checknew`.

### Unitari (Vitest)

- `urls`: `pageKind` (ricerca, scheda → `other`, altro), `isInterceptedUrl`, `listingIdFromHref`.
- Parse `next-data` e `api` sulle fixture: conteggi, tipi di venditore, filtri vendita/Immobili, campi mappati.
- Nessuna osservazione contiene nome, telefono o descrizione del venditore (test su un annuncio sintetico che li contiene).
- `newestId` solo da annunci rinnovati oggi.
- Stima dell'età con `DEFAULT_CALIBRATION.subito`.
- `rules.ts`: testo "Età stimata vicina alla soglia" per Subito.
- Bridge: la fetch verso `hades.subito.it/v1/search/items` viene inoltrata, le altre no.

### E2E (Playwright)

Come `idealista.spec.ts`: la fixture servita come `www.subito.it` mostra i badge sui privati e i lead "Subito" nel pannello; una paginazione simulata con la risposta API aggiunge i nuovi lead.

## 9. Punti da verificare sulle fixture

- Se le card di `galleryList`/`boostedItems` compaiono in pagina: in tal caso vanno lette anche quelle, altrimenti `hasUnseenListings` mostrerebbe un falso banner.
- Se cambiando filtri o categoria il sito usa `/_next/data/{buildId}/….json` invece di hades: in tal caso il bridge intercetta anche quell'URL (stessa forma di `pageProps`).
- `category.parentId` per le altre categorie di Immobili e formato di `/room`.
- Selettore di `badgeHost`.

## 10. Documentazione

- `docs/smoke-test.md`: sezione Subito (ricerca, pagina 2, cambio categoria, ritorno indietro senza falso banner, badge, pannello, export).
- `CLAUDE.md`: flusso Subito, dove stanno schemi e selettori, nessuna lettura della scheda.
