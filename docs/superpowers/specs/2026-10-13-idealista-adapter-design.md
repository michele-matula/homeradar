# HomeRadar — Specifica di design: adattatore Idealista.it

- **Data:** 2026-10-13
- **Stato:** in revisione
- **Ambito:** secondo portale, Idealista.it (sezione vendita). Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`

## 1. Obiettivo

Far funzionare HomeRadar anche su **Idealista.it**, con lo stesso comportamento che ha su Immobiliare.it: riconoscere gli annunci di privati, costruirne lo storico prezzi in locale, segnalare i lead (anzianità ≥ soglia oppure ribassi) e gestirli dal pannello laterale.

È il primo passo verso il supporto dei portali più diffusi, **uno alla volta**, per poter fare test reali su ciascuno prima di passare al successivo. Per questo il lavoro rende generico il punto di aggancio dei portali (adattatore, card, calibrazione), così che il terzo portale non richieda altre modifiche al core.

Successo: su una ricerca di Idealista i privati ricevono il badge e compaiono nel pannello con l'etichetta "Idealista", con età stimata e ribassi coerenti con il sito. Su Immobiliare nulla cambia.

## 2. Ambito

### Dentro

- Idealista.it, sezione **vendita**: pagine di ricerca (incluse le pagine `lista-N.htm` e gli ordinamenti `?ordine=`) e scheda annuncio `/immobile/{id}/`
- Riconoscimento privato/agenzia, prezzo, ribasso, tipologia, superficie, locali, indirizzo/zona/città
- Età stimata dall'ID con calibrazione iniziale e apprendimento automatico
- Badge sulle card, etichetta del portale nel pannello, colonna "Portale" nell'export
- Avviso dell'adattatore per portale

### Fuori

- Filtro per portale nel pannello (quando arriverà il terzo portale)
- Unione dello stesso immobile pubblicato su più portali: restano lead distinti
- Statistiche di Idealista (visite, contatti, preferiti): possibile segnale futuro
- Affitti, come su Immobiliare

## 3. Vincoli (invariati rispetto all'MVP)

- **Nessuna richiesta HTTP dell'estensione** verso Idealista. Si legge solo il DOM che la pagina ha già mostrato all'agente. Niente crawling.
- Si salvano **solo annunci di privati**; mai nomi o telefoni del venditore. Sulla scheda di Idealista il nome del privato compare in `.professional-name`: l'adattatore non legge mai quel nodo, né i blocchi di contatto o la descrizione.
- Repository pubblico: le fixture passano da `scripts/sanitize-fixture.mjs`.
- Timestamp in ms epoch UTC.

## 4. Dati disponibili su Idealista.it (verificati il 2026-10-13)

- Pagine **renderizzate lato server**: niente `__NEXT_DATA__` e nessun JSON degli annunci negli script o nelle variabili globali. La paginazione ricarica la pagina (`/vendita-case/milano-milano/lista-2.htm`); non è una SPA e non ci sono XHR dei risultati da intercettare.
- **Card di ricerca:** `article.item` con:
  - `data-element-id`: ID numerico dell'annuncio
  - `data-is-professional-ad`: `"false"` = privato, `"true"` = agenzia
  - link `a.item-link[href="/immobile/{id}/"]`, testo "Trilocale in Via X, 27, Zona, Milano" (tipologia + " in " + indirizzo, zona, città)
  - `.item-price` "285.000€"
  - `.item-detail` (es. "3 locali", "90 m²", "2º piano con ascensore", "Box compreso")
  - `.pricedown > .pricedown_price` (prezzo precedente, "645.000 €") e `.pricedown_icon` ("3%")
  - `.item-description` (testo libero: **non letto**)
  - Le pubblicità sono `article.adv` senza `data-element-id`.
- **Scheda** `/immobile/{id}/`: prezzo in `.info-data-price`, stesso markup `.pricedown`, titolo nella stessa forma, "Annuncio aggiornato il 11 ottobre" (data di aggiornamento senza anno).
- **Nessuna data di pubblicazione** né di ribasso, neanche da utente loggato. Da loggato il riquadro statistiche (caricato dal sito stesso, `/ajax/detailstatsview/{id}/`) mostra solo aggiornamento, visite, contatti, preferiti.
- "Da privati" è un **ordinamento** (`?ordine=da-privati-asc`), non un filtro; "più recenti" è `?ordine=pubblicazione-desc`.
- **ID crescenti nel tempo**, circa 250.000 al mese (vedi §7).
- Sito protetto da DataDome: dopo pochi caricamenti automatici ravvicinati ha risposto "Al momento non siamo disponibili". Le verifiche sul sito vero si fanno a mano.

## 5. Architettura

Flusso Idealista: `content script (ISOLATED) → adapter.readDocument → background → IndexedDB → side panel`. Nessun bridge: la pagina non viene modificata, se non per aggiungere i badge.

Flusso Immobiliare: invariato (`bridge (MAIN) → content script → adapter.parsePayload → …`).

### Interfaccia dell'adattatore (`src/adapters/types.ts`)

```ts
interface PortalAdapter {
  portal: Portal;
  pageKind(url: string): PageKind;
  // Lettura: un adattatore implementa una o entrambe le modalità.
  parsePayload?(kind: 'next-data' | 'api', url: string, json: unknown): ParseResult; // Immobiliare
  isInterceptedUrl?(url: string): boolean;                                           // solo con bridge
  readDocument?(doc: Document, url: string): ParseResult;                            // Idealista
  // DOM delle card
  cardFor(root: ParentNode, portalId: number): HTMLElement | null;
  badgeHost(card: HTMLElement): HTMLElement;   // contenitore in cui appendere il badge
  cardIds(root: ParentNode): number[];         // ID delle card presenti in pagina
}
```

L'adattatore di Immobiliare porta qui i selettori oggi presenti in `badges.ts` e `controller.ts` (`li` con `a[href*="/annunci/{id}/"]`, `.nd-slideshow__content`) e rinomina `parseNextData`/`parseIntercepted` in `parsePayload`.

### Componenti

- `src/adapters/idealista/urls.ts`: `pageKind`, `listingIdFromHref`, `isNewestFirst(url)` (prima pagina di `?ordine=pubblicazione-desc`). Ricerca = percorsi `/vendita-…/`; scheda = `/immobile/{id}/`; tutto il resto, affitti compresi, è `other`.
- `src/adapters/idealista/parse.ts`: funzioni pure su `Document`/`Element`. Estrae solo i campi elencati in §4; un campo non riconosciuto diventa `null`, una card senza ID o senza flag privato/agenzia valido diventa errore o `sellerType: 'unknown'`.
  - Privato: `data-is-professional-ad="false"`; agenzia: `"true"`; altro: `unknown`.
  - Sulla scheda il tipo di venditore si ricava dallo stesso attributo se presente, altrimenti dal blocco inserzionista, senza leggerne il testo; il selettore esatto si fissa sulla fixture.
  - `portalCreatedAt` sempre `null`; `lastDrop.date` sempre `null`.
  - Prezzo non numerico ("su richiesta") → `price: null`, come su Immobiliare.
- `src/adapters/idealista/index.ts`: `idealistaAdapter`.
- `src/content/controller.ts`: oltre a `handle(kind, url, payload)`, espone `scan()`, che chiama `adapter.readDocument(document, url)` e invia solo le osservazioni non ancora inviate per l'URL corrente (un `Set` di ID per URL, azzerato al cambio di URL). `hasUnseenListings` usa `adapter.cardIds`.
- `src/content/badges.ts`: `renderBadge(root, ev, adapter)` usa `adapter.cardFor` e `adapter.badgeHost`; stile invariato.
- `src/entrypoints/idealista.content.ts`: `matches: ['https://www.idealista.it/*']`, `runAt: 'document_idle'`. Esegue `scan()` all'avvio e, con il MutationObserver con debounce già usato per Immobiliare, ad ogni cambiamento del DOM (che riapplica anche i badge). Nessun RouteWatcher e nessun banner "ricarica": non è una SPA.
- `wxt.config.ts`: `host_permissions` aggiunge `https://www.idealista.it/*`; descrizione "…su Immobiliare.it e Idealista.it".

## 6. Modello dati

### Tipi

- `Portal = 'immobiliare' | 'idealista'`. Le chiavi `listingKey` (`portale:id`) esistenti restano valide.
- `CalibrationPoint` aggiunge `portal: Portal`.
- `ListingObservation.lastDrop.date`: `number | null`. Nel `ListingRecord` `lastDrop.date` è sempre valorizzata e `PriceDrop` aggiunge `dateEstimated: boolean` (`false` per Immobiliare).
- Messaggio `parseStatus`: aggiunge `portal: Portal`; `source` ammette anche `'dom'`.

### Data del ribasso senza data

Risolta da `LeadService.ingest`:
- se il record precedente ha un `lastDrop` con lo stesso `fromPrice` e `toPrice`, si conserva la sua data;
- altrimenti la data è la mezzanotte UTC del giorno corrente, con `dateEstimated: true`.

Così le visite successive non creano snapshot "dichiarati" duplicati e `dropCount` resta corretto.

### Migrazione IndexedDB (Dexie)

- **v2:** nuova tabella `calibration` con chiave `[portal+portalId]`; l'upgrade copia i punti di `idCalibration` con `portal: 'immobiliare'`.
- **v3:** rimozione di `idCalibration`.
- Annunci, snapshot, stati e note non vengono toccati.

### Diagnostica

- `Diagnostics.adapterWarning` diventa `Partial<Record<Portal, boolean>>`. Un valore booleano salvato in precedenza viene letto come `{ immobiliare: valore }`.
- Il `parseStatus` di un portale aggiorna solo il suo avviso. L'icona "!" dell'estensione è accesa se almeno un portale ha l'avviso.
- Contatore per le letture DOM: `domScans`.
- Il report diagnostico elenca gli avvisi per portale.

## 7. Età e regole

Le regole dei lead **non cambiano** (spec MVP §7): privato e (età ≥ soglia oppure ribasso); Alta = entrambi, Media = uno, "Da verificare" = età stimata entro ±15 giorni dalla soglia. Su Idealista l'età è sempre stimata ("~").

Il motivo "Età da verificare: apri l'annuncio" vale solo per Immobiliare, dove la scheda contiene la data vera. Su Idealista, dove la scheda non aiuta, il testo diventa "Età stimata vicina alla soglia". `evaluate` lo sceglie in base a `listing.portal`.

### Calibrazione iniziale

`DEFAULT_CALIBRATION` in `src/core/age.ts` diventa `Record<Portal, CalibrationPoint[]>`. Immobiliare mantiene i suoi 3 punti. Idealista riceve i punti seguenti, ricavati dal Wayback Machine (data della prima cattura degli annunci in ciascuna fascia di ID; è un limite superiore della data di creazione, con ritardo di pochi giorni) e dal sito il 2026-10-13:

| ID | data |
|---|---|
| 33.000.000 | 2025-06-16 |
| 34.000.000 | 2025-10-30 |
| 35.000.000 | 2026-03-05 |
| 36.000.000 | 2026-06-13 |
| 37.000.000 | 2026-10-05 |
| 37.142.000 | 2026-10-13 |

Il commento nel codice riporta fonte e metodo (query CDX per prefisso di ID, `collapse=urlkey`).

`estimateCreatedAt(portalId, points)` resta invariata e riceve solo i punti del portale dell'annuncio.

### Apprendimento automatico

Sulla prima pagina di `?ordine=pubblicazione-desc` di Idealista, l'ID più alto in pagina è candidato come punto "creato oggi" (mezzanotte UTC). La funzione pura `acceptLearnedPoint(candidate, points)` lo accetta solo se:
1. il suo ID è maggiore dell'ID di tutti i punti noti per Idealista;
2. la sua data è di almeno **1 giorno** successiva a quella dell'ultimo punto noto (quindi al massimo un punto al giorno);
3. il ritmo rispetto all'ultimo punto, `(ID nuovo − ID ultimo) / giorni`, è compreso tra **0,5×** e **2×** il ritmo di riferimento di **8.200 ID al giorno**.

La regola 3 scarta i comuni piccoli, dove l'annuncio più recente può avere settimane. Il candidato viaggia nel `ParseResult` (`calibrationHint`) e lo salva il `LeadService` nella stessa transazione dell'ingest. Su Immobiliare l'apprendimento resta quello attuale (date vere dalle schede).

### Limite noto

Non sappiamo se Idealista assegna un nuovo ID quando un annuncio viene ripubblicato. Se succede, l'età viene sottostimata: si perdono lead, non se ne creano di falsi.

## 8. Interfaccia

- **Badge sulle card Idealista:** stesso componente, colori e testi di Immobiliare, in alto a sinistra sulla foto. `badgeHost` restituisce il contenitore della foto dentro `article.item` (anche quando c'è il segnaposto "nessuna foto"); il selettore esatto si fissa sulla fixture. Nessun badge su agenzie e pubblicità.
- **Pannello laterale:**
  - etichetta neutra del portale ("Immobiliare" / "Idealista") sulla riga del titolo di ogni lead, con uno stile diverso dai badge di priorità;
  - lista vuota: "Naviga su Immobiliare.it o Idealista.it per raccoglierne.";
  - banner dell'avviso con il nome del sito: "Idealista.it potrebbe essere cambiato: alcuni dati non sono stati letti." (se riguarda entrambi i siti, li elenca);
  - ribasso con data stimata: "Ribassato del 3% (645.000 → 625.000 €) rilevato il 13/10".
- **Export XLSX/CSV:** nuova colonna "Portale" ("Immobiliare.it" / "Idealista.it") subito dopo la colonna dello stato.

## 9. Gestione errori

- Card con struttura inattesa: errore nel `ParseResult` e card saltata; sopra il 20% di errori, o con un venditore `unknown`, si attiva l'avviso del portale (stessa soglia di Immobiliare).
- Pagina di ricerca senza nessuna `article.item` riconosciuta ma con card presenti: avviso del portale.
- La lettura del DOM non deve mai lanciare eccezioni verso la pagina; gli errori vanno nella diagnostica.
- Pagine di blocco di DataDome o di errore del sito: nessuna card, nessun avviso.

## 10. Strategia di test

### Fixture

Le salva l'utente navigando normalmente (Ctrl+S, "Pagina web, solo HTML") in `fixtures-raw/`:
1. ricerca `?ordine=da-privati-asc` con privati, agenzie, almeno un ribasso e una pubblicità;
2. scheda di un privato con ribasso.

`scripts/sanitize-fixture.mjs` riceve le modalità `idealista-search` e `idealista-detail`. Usando jsdom:
- tiene solo le card `article` (o il blocco principale della scheda);
- rimuove script, stili, immagini, descrizioni, `.professional-name`, i blocchi di contatto e i telefoni;
- sostituisce indirizzo e civico con "Via Esempio N", mantenendo tipologia, zona e città;
- conserva il controllo "possibili numeri di telefono".

Il risultato va in `tests/fixtures/idealista/`.

### Unitari (Vitest + jsdom)

- `adapters/idealista`: URL e `pageKind` (ricerca, `lista-2.htm`, `?ordine=`, scheda, affitti → `other`), `isNewestFirst`; card privato, agenzia, flag assente → `unknown`, pubblicità ignorata, ribasso, prezzo su richiesta; scheda. Test che nessun valore dell'osservazione contenga il testo di `.professional-name` o della descrizione.
- Fixture reali sanitizzate (come `immobiliare.fixtures.test.ts`).
- `core/age`: calibrazione separata per portale; `acceptLearnedPoint` (accetta il caso Milano; rifiuta ID non maggiore, stessa data, ritmo fuori intervallo).
- `core/rules`: testo "Da verificare" diverso per Idealista.
- `core/service`: ribasso senza data conservato tra visite senza snapshot duplicati; punto appreso salvato sotto `idealista`.
- `core/db`: migrazione da un DB v1 popolato (calibrazione copiata, annunci intatti).
- `content`: `scan()` del documento, nessuna nuova ingestione di card già inviate, badge su card Idealista.
- Diagnostica: avviso per portale, lettura del vecchio booleano.
- Export: colonna "Portale". Pannello: etichetta del portale, banner con il nome del sito.
- I test esistenti di Immobiliare restano verdi; si adattano solo le firme.

### E2E (Playwright)

Pagina locale costruita dalla fixture di ricerca Idealista: badge solo sui privati; il lead compare nel pannello con l'etichetta "Idealista".

### Smoke test

Nuova sezione "Idealista.it" in `docs/smoke-test.md`: ricerca da privati, pagina 2, scheda, ordinamento "più recenti" (punto di calibrazione appreso, visibile nel report diagnostico), export con colonna Portale, nessun errore in console. `CLAUDE.md` aggiornato con il secondo adattatore.

## 11. Rischi noti

- **DataDome:** l'estensione non fa richieste, ma i test manuali vanno fatti con navigazione normale.
- **Cambi di HTML:** il DOM è più fragile del JSON; l'avviso per portale e le fixture lo rendono visibile in fretta.
- **Precisione dell'età:** ±1–2 settimane; la fascia "Da verificare" copre il caso vicino alla soglia, ma su Idealista non esiste una scheda che la confermi.
- **Ripubblicazioni:** vedi §7.
