# HomeRadar — Specifica di design: giro delle ricerche con un clic

- **Data:** 2026-10-17
- **Stato:** in revisione
- **Spec di riferimento:** `2026-10-10-homeradar-mvp-design.md` (§2 "Aggiorna le mie ricerche assistito", §3 vincoli legali)

## 1. Obiettivo

Oggi l'agente deve navigare ogni giorno su Immobiliare, Idealista e Subito perché HomeRadar veda gli annunci. È la parte meno vendibile del prodotto: troppo lavoro manuale.

Con questa funzione l'agente imposta una volta la sua zona di lavoro (comuni e categorie). Ogni mattina apre il pannello e preme **Cerca**: l'estensione apre le ricerche in una finestra a parte ridotta a icona, le legge con il codice che esiste già e aggiorna i lead. L'agente vede l'avanzamento e, alla fine, un riepilogo.

Successo: un clic al giorno; il giro finisce in 10-15 minuti mentre l'agente usa il PC; i lead sono gli stessi (o quasi) che troverebbe navigando a mano.

## 2. Ambito

### Dentro

- Zona di lavoro nelle Impostazioni e nell'onboarding: comuni (da elenco ISTAT incluso nell'estensione) e categorie.
- Pulsante **Cerca** nel pannello che avvia il giro; **Ferma** per interromperlo.
- Orchestratore nel background: finestra ridotta a icona, una scheda, navigazione per URL con pause, condizione di fine, tetti, blocchi.
- Avanzamento e riepilogo nel pannello.
- Categoria normalizzata degli immobili (residenziale, commerciale, terreno, box), anche per la navigazione manuale.
- Segnale "non più visto" dopo 3 giri completi di fila senza l'annuncio.
- Nuova informativa, contatori del report del pilota, fase 0 di verifica sul campo.

### Fuori

- **Qualunque avvio automatico** (all'apertura del browser, ad orario, periodico): il giro parte solo dal clic dell'agente. Scelta voluta per tenere l'uso "avviato dall'utente".
- Filtri di ricerca oltre comuni e categorie (prezzo, superficie, locali): si filtra nel pannello.
- Quartieri o zone sotto il comune.
- Affitti: si resta sulla sola vendita.
- Ripresa di un giro interrotto; notifiche di sistema; segnale sull'icona durante il giro.
- Cambio automatico dello stato di un lead "non più visto".

### Vincoli

- **Mai richieste HTTP dell'estensione verso i portali.** Il giro fa solo navigazioni di una scheda, come l'agente; i dati arrivano dal bridge e dai content script esistenti. Niente `fetch` alle API, niente iframe, niente documento offscreen sui portali.
- Una sola scheda, mai caricamenti in parallelo; pause casuali; arresto immediato del portale alla prima verifica di DataDome, senza ritentare.
- Si salvano sempre e solo annunci di privati; nessun nome o telefono (gli adapter non cambiano su questo).
- Timestamp in ms epoch UTC.

## 3. Fase 0: verifica sul campo

Fatta il 2026-10-17: risultati, numeri e URL in `2026-10-17-giro-ricerche-fase0.md`. In sintesi:

- Immobiliare e Idealista ordinano i privati **rigorosamente prima** delle agenzie; nei comuni medi i privati di una categoria stanno in una pagina.
- Subito ha una ricerca unica per tutte le categorie (`immobili`) e un filtro solo privati (`advt=0`).
- Una ricerca per comune e per categoria costerebbe circa 12 caricamenti per comune: per le categorie non residenziali si cerca **per provincia** (§4).

Restano da verificare, come **prime attività del piano** (marcate **[da verificare]** in questa specifica):

1. **Prova di ritmo:** una build di prova, non rilasciata, fa un giro vero su una zona di 10 comuni in una finestra ridotta a icona. Si annota se DataDome reagisce, la durata e se Chrome rallenta il caricamento nelle finestre ridotte a icona.
2. URL per provincia su Idealista; slug di omonimi e province con nome composto.
3. Fixture ripulite delle pagine non residenziali dei tre portali e, quando capita, della pagina di verifica di DataDome.

## 4. Zona di lavoro

### Dato

```ts
export type PropertyCategory = 'residential' | 'commercial' | 'land' | 'garage';
export const PROPERTY_CATEGORIES: PropertyCategory[] = ['residential', 'commercial', 'land', 'garage'];

export interface ComuneRef {
  istat: string;      // codice ISTAT, 6 cifre
  name: string;       // "Treviglio"
  province: string;   // sigla, "BG"
}

export interface SearchArea {
  comuni: ComuneRef[];
  categories: PropertyCategory[];
}
```

`Settings.searchArea: SearchArea`, predefinito `{ comuni: [], categories: [...PROPERTY_CATEGORIES] }`. Entra negli schemi delle impostazioni di `backup.ts` (facoltativo all'importazione: i file vecchi prendono il predefinito).

### Elenco dei comuni

- `src/shared/comuni.json`: comuni ISTAT con codice, nome, sigla e nome della provincia, nome della regione (circa 8.000 righe). Generato da `scripts/generate-comuni.mjs` a partire dal file pubblico ISTAT, scaricato a mano; lo script non fa richieste in rete.
- `src/core/comuni.ts`: ricerca per prefisso senza accenti per il campo con suggerimenti, e `comuneInfo(istat)` per provincia e regione usate negli URL.

### Interfaccia

- Impostazioni, nuova sezione "La tua zona": campo con suggerimenti ("Trev…" → "Treviglio (BG)"), comuni scelti come etichette rimovibili; quattro caselle delle categorie, tutte selezionate di default. Almeno una categoria resta selezionata.
- Onboarding: dopo la conferma dell'informativa, passo "La tua zona" con gli stessi campi e "Salta, lo faccio dopo".

### Ricerche del giro

Una **ricerca** è un URL di partenza su un portale, con la sua paginazione. Per ogni portale `src/adapters/<portale>/search-urls.ts` (funzioni pure) dichiara le ricerche e costruisce gli URL:

```ts
interface SearchSpec {
  portal: Portal;
  key: string;                 // stabile, es. "immobiliare|comune:016219|case", "immobiliare|prov:016|negozi"
  place: { kind: 'comune'; comune: ComuneInfo } | { kind: 'province'; province: ProvinceInfo; comuni: ComuneInfo[] };
  category: PropertyCategory | null;   // null = più categorie (Subito "immobili")
  url(page: number): string;
}
searchesFor(area: SearchArea): SearchSpec[]
```

Ricerche per portale, solo per le categorie scelte dall'agente:

| Portale | Residenziale | Commerciale | Box | Terreni |
|---|---|---|---|---|
| Immobiliare | `vendita-case`, per comune | `vendita-negozi`, `vendita-uffici`, `vendita-capannoni`, per provincia | `vendita-garage`, per provincia | `vendita-terreni`, per provincia |
| Idealista | `vendita-case`, per comune | `vendita-negozi`, `vendita-uffici`, per provincia | `vendita-garage`, per provincia | `vendita-terreni`, per provincia |
| Subito | una ricerca `immobili` per comune per tutte le categorie | | | |

**Decisione del 2026-10-18 (dopo la prova di ritmo), sostituisce la tabella sopra:** le ricerche per provincia leggono pagine intere di privati di altri comuni. Tutte le ricerche sono **per comune**. Di default la zona ha solo la categoria **Residenziale**; Commerciale, Terreni e Box si attivano nelle impostazioni, con un avviso sulla durata stimata (circa 14 s a ricerca). Immobiliare: `vendita-case` per le case; `vendita-negozi`, `vendita-uffici`, `vendita-capannoni` per il commerciale; `vendita-garage`; `vendita-terreni`. Idealista: `vendita-case`; `vendita-negozi`, `vendita-uffici`; `vendita-garage`; `vendita-terreni`. Subito: una ricerca `immobili` per comune che tiene **tutte** le categorie, senza pagine in più. Non servono più `byProvince` né il filtro per comune prima di `ingest`. Slug di provincia: tabella delle eccezioni (Monza e Brianza = `monza-brianza`, verificato).

URL (verificati in fase 0):

- **Immobiliare:** `https://www.immobiliare.it/vendita-<cat>/<slug-comune>/?criterio=privateFirst`, pagine `&pag=<n>`; per provincia `/<slug-provincia>-provincia/` (es. `bergamo-provincia`).
- **Idealista:** `https://www.idealista.it/vendita-<cat>/<slug-comune>-<slug-provincia>/?ordine=da-privati-asc`, pagine `…/lista-<n>.htm?ordine=da-privati-asc`; per provincia **[da verificare]**.
- **Subito:** `https://www.subito.it/annunci-<slug-regione>/vendita/immobili/<slug-provincia>/<slug-comune>/?advt=0`, pagine `&o=<n>`.
- **Slug:** minuscole, accenti tolti, apostrofi e spazi → `-` (`cassano-d-adda`, `cantu`). Omonimi e province composte **[da verificare]**; l'elenco dei comuni può portare uno slug esplicito per portale dove la regola non basta.

Le ricerche **per provincia** leggono anche privati di comuni non scelti: l'orchestratore li **scarta prima di `ingest`** (§5), confrontando la città dell'annuncio (normalizzata) con i comuni scelti di quella provincia. Nel database entrano solo annunci dei comuni scelti.

Test con gli URL verificati in fase 0.

## 5. Orchestratore del giro

### Moduli

- `src/core/sweep.ts`, logica pura senza Chrome:
  - `buildPlan(area, enabledPortals)`: le ricerche (`SearchSpec`, §4) dei portali attivi;
  - stato del giro (`SweepState`) e transizioni: `nextStep(state)`, `onPageRead(state, report)`, `onTimeout(state)`, `onStop(state)`;
  - alternanza dei portali: a ogni passo si sceglie il portale successivo che ha ancora ricerche aperte (Immobiliare, Idealista, Subito, Immobiliare, …);
  - condizione di fine di una ricerca, tetti, completezza, contatori;
  - `acceptObservation(search, obs)`: per le ricerche per provincia, solo gli annunci dei comuni scelti;
  - `pauseMs(portal, random)`: pausa casuale nell'intervallo del portale.
- `src/background/sweep-runner.ts`, cablaggio Chrome: finestra, scheda, navigazione, timer, eventi; persiste lo stato in `chrome.storage.session`.

### Svolgimento

1. Il pannello invia `startSweep`. Il background rifiuta se: informativa da confermare, nessun comune, nessun portale attivo, giro già in corso.
2. `browser.windows.create({ url, state: 'minimized', focused: false, type: 'normal' })`; si ricordano `windowId` e `tabId`.
3. Per ogni passo: `browser.tabs.update(tabId, { url: search.url(page) })`, poi si attende `pageRead` dalla scheda del giro o il timeout.
4. Il content script, dopo aver letto la pagina (payload o DOM) e inviato `ingest` come oggi, invia:
   ```ts
   { type: 'pageRead'; portal: Portal; url: string; results: number; privates: number; lastPage: boolean; blocked: boolean; notFound: boolean }
   ```
   `results` = annunci letti (agenzie comprese), `privates` = di privati, `lastPage` dall'adapter (paginazione del payload o del DOM). Il router passa `pageRead` all'orchestratore con `sender.tab.id`: messaggi da altre schede sono ignorati. Le pagine aperte a mano dall'agente si comportano come oggi.
5. Gli `ingest` che arrivano dalla scheda del giro passano prima dall'orchestratore: `acceptObservation` scarta gli annunci di comuni non scelti (ricerche per provincia), gli altri vanno a `LeadService` con il `sweepScope` della ricerca corrente (§7) e i loro ID si registrano come visti.
6. Dopo ogni pagina, pausa `pauseMs` e passo successivo. Finite le ricerche, la finestra si chiude, si calcolano "non più visto" (§7) e riepilogo, si salva l'esito.

Per `pageRead` di una ricerca per provincia, `privates` conta tutti i privati della pagina (anche dei comuni scartati): serve alla condizione di fine.

### Fine di una ricerca

- Immobiliare, Idealista (ordinamento "privati prima", verificato rigoroso in fase 0): alla **prima pagina che contiene almeno un'agenzia** (`privates < results`), oppure `lastPage`, oppure `results === 0`.
- Subito (`advt=0`, solo privati): `lastPage` o `results === 0`.
- Tetto: `MAX_PAGES_PER_SEARCH = 10` per ricerca e `MAX_PAGES_PER_PORTAL = 60` per portale e per giro, da confermare con la prova di ritmo **[da verificare]**; raggiunto un tetto, la ricerca (o le ricerche aperte del portale) chiudono come **incomplete**.

Una ricerca è **completa** se è finita per la condizione di fine, senza blocchi, timeout o tetto.

Stima (fase 0) per 10 comuni in una provincia, tutte le categorie: Immobiliare circa 10 pagine di case + 5 ricerche per provincia, Idealista circa 10 + 4, Subito circa 10. Circa **40 caricamenti**, 5-7 minuti.

### Ritmo

- Pausa casuale tra un caricamento e il successivo, intervallo per portale (iniziale 4-10 s; Idealista almeno 8 s tra due suoi caricamenti) **[da verificare]** con la prova di ritmo.
- La pausa e il timeout si azzerano o riducono solo in una build di test (variabile `WXT_SWEEP_TEST_TIMING`), mai nella build del pilota.

### Errori e interruzioni

| Caso | Comportamento |
|---|---|
| `pageRead` con `blocked: true` | Portale fermato per questo giro (ricerche aperte incomplete), si prosegue con gli altri; esito "bloccato" con messaggio per l'agente |
| Nessun `pageRead` entro `PAGE_TIMEOUT_MS` (45 s) | Pagina in errore, ricerca incompleta; due errori di fila sullo stesso portale lo fermano per il giro |
| Pulsante Ferma | Giro "interrotto", finestra chiusa, dati già letti restano |
| Finestra chiusa dall'agente (`windows.onRemoved`) | Giro "interrotto" |
| Service worker riavviato a metà | All'avvio, se `storage.session` ha un giro in corso: segnato interrotto, finestra chiusa se esiste; nessuna ripresa |
| Portale spento a metà giro | Le ricerche restanti di quel portale si saltano (incomplete) |
| Comune o provincia non riconosciuti dal portale: pagina "non presente" (Immobiliare, verificato) o reindirizzamento | Il content script invia `pageRead` con `notFound: true`; ricerca incompleta; nell'esito, avviso "Treviglio non trovato su Subito" |

### Riconoscimento del blocco

Nel content script, funzione pura per portale `isBlockedPage(root, url)`: iframe della verifica DataDome (`captcha-delivery`), testo "Al momento non siamo disponibili" su Idealista, altre forme **[da verificare]** (la verifica non è comparsa in fase 0). Testata su fixture ripulite. Su una pagina bloccata il content script invia solo `pageRead` con `blocked: true`.

## 6. Pannello: avanzamento e riepilogo

Scheda "Ricerca" in cima alla vista dei lead, sopra le linguette.

- **A riposo:** "Ultimo giro: oggi alle 8:42 · completo", numero di comuni e categorie, pulsante **Cerca**. Se oggi il giro non è stato fatto, il pulsante è in evidenza. Senza comuni: "Imposta la tua zona →" verso le Impostazioni. Esito parziale o bloccato dell'ultimo giro spiegato in una riga.
- **In corso:** durata, barra per ricerche completate sul totale, ricerca corrente ("Treviglio · Case", "Provincia di Bergamo · Negozi"), per portale pagine lette e privati letti, "Finora: N nuovi · M ribassi", pulsante **Ferma**. La lista dei lead si aggiorna durante il giro.
- **Finito:** "Giro completato · 11 min" (oppure "completato in parte" con motivo per portale), "N nuovi · M ribassi · K non più visti", pulsante **Vedi i nuovi** (linguetta Nuovi, filtro "da questo giro") e **Chiudi**.

Messaggi: `startSweep`, `stopSweep`, `getSweepStatus` (richieste); `SWEEP_CHANGED` (dal background al pannello a ogni pagina e a fine giro). Il pannello parla solo tramite `api.ts`.

Riepilogo: `LeadService.sweepSummary(startedAt)` conta gli annunci con `firstSeenAt >= startedAt` (nuovi), i ribassi registrati da `startedAt` e gli annunci diventati "non più visti" in questo giro.

Esito salvato in `meta.sweep`: solo l'ultimo giro (inizio, fine, esito generale `'completed' | 'partial' | 'stopped' | 'interrupted'`, per portale pagine, privati, esito `'complete' | 'capped' | 'blocked' | 'error' | 'skipped'`, avvisi sui comuni, contatori del riepilogo). Fuori dal backup.

## 7. "Non più visto"

### Dato

Su `ListingRecord`:

- `category: PropertyCategory` (§8);
- `sweepScope: string | null`: `key` dell'ultima ricerca del giro in cui è stato visto (es. `"immobiliare|prov:016|negozi"`);
- `missedSweeps: number`: giri consecutivi in cui la sua ricerca è stata completa e lui non è stato visto;
- `missingSince: number | null`: inizio del primo di quei giri.

`MISSING_SWEEPS = 3`: con `missedSweeps >= 3` l'annuncio è "non più visto".

### Regola (`src/core/sweep.ts`, pura)

A fine giro, `missingUpdates(listings, completeScopes, seenKeysByScope, startedAt)`:

- annuncio visto nel giro: `missedSweeps = 0`, `missingSince = null`, `sweepScope` aggiornato;
- annuncio con `sweepScope` di una ricerca **completa** e non visto: `missedSweeps + 1`; `missingSince = startedAt` se era null;
- ricerca incompleta, ricerca non più nel piano (comune o categoria tolti dalla zona) o annuncio senza `sweepScope`: nessun cambiamento.

Gli annunci visti solo navigando a mano non hanno `sweepScope` e non vengono mai segnati. Se un annuncio "non più visto" ricompare (giro o navigazione manuale), il conteggio torna a 0. `LeadService.applySweepResult(...)` scrive gli aggiornamenti in una transazione.

### Gruppi (`lead-groups.ts`)

- Il gruppo è "non più visto" solo se lo sono tutti i suoi annunci principali (non `previous`); `LeadView.missingSince` = il più recente.
- Tra i principali si preferisce come primo un annuncio non "non più visto".
- Su un gruppo misto, il portale sparito mostra "non più su <Portale>".

### Pannello

- Etichetta "Non più visto dal 15/10" sulla riga del lead. Lo stato non cambia da solo.
- Filtro "Non più visti" insieme agli altri filtri.
- Pulizia automatica invariata.

## 8. Categorie degli immobili

- `category: PropertyCategory` su `ListingObservation` e `ListingRecord`; `typology` resta il testo del portale.
- `src/core/category.ts`: `categoryFromTypology(text): PropertyCategory | null` con una tabella di parole (box, garage, posto auto, terreno, negozio, ufficio, capannone, laboratorio, locale commerciale, …) e `resolveCategory(fromSearch, typology)`: vince la tipologia se riconosciuta, altrimenti la categoria della ricerca, altrimenti `'residential'`.
- Adapter:
  - **Subito:** categoria dell'annuncio dal payload (`category.id` in `__NEXT_DATA__`, `category.key` nell'API): `7` Appartamenti e `29` Ville → residenziale, `31` Garage e box → box, `30` Terreni e rustici → terreno, Uffici e Locali commerciali → commerciale (id **[da verificare]**);
  - **Immobiliare:** categoria dal percorso della ricerca (`vendita-case` → residenziale; `vendita-negozi`, `vendita-uffici`, `vendita-capannoni` → commerciale; `vendita-garage` → box; `vendita-terreni` → terreno), confermata da `typology.name` (in fase 0: "Garage - Box", "Posto auto", "Negozio", "Laboratorio", "Ufficio - Studio", "Capannone", "Terreno edificabile", "Terreno agricolo", …);
  - **Idealista:** categoria dal percorso della ricerca (`vendita-negozi` = "locali o capannoni"), confermata dalla tipologia nel titolo della card. In fase 0 sui locali compare anche il titolo "Locale a <comune>": il parser del titolo va esteso **[da verificare]** su fixture.
  - `pageKind` deve riconoscere come `search` i percorsi di tutte le categorie in vendita, anche quelli per provincia: le espressioni attuali (`/^\/vendita-[a-z-]+\//`) li coprono già su Immobiliare e Idealista; Subito `/annunci-<regione>/vendita/` pure.
  - Gli schemi zod e i parser vanno verificati sulle pagine non residenziali (fixture nuove ripulite): campi mancanti come locali o superficie restano `null`.
- `market.ts`: confronto €/m² solo tra annunci della stessa categoria, e solo per `residential` e `commercial`.
- `same-property.ts`: due annunci sono compatibili solo con la stessa categoria.
- `rules.ts`: invariato.
- Pannello: filtri per categoria accanto ai filtri per portale, con conteggi, scelta ricordata come le altre preferenze.
- Export: colonna "Categoria".

## 9. Database e backup

- `db.ts`: `version(7)` con migrazione sui `listings`: `category = categoryFromTypology(typology) ?? 'residential'`, `sweepScope = null`, `missedSweeps = 0`, `missingSince = null`. Nessun nuovo indice salvo necessità del piano.
- `backup.ts`: i quattro campi nuovi facoltativi nello schema dei listing (con gli stessi predefiniti all'importazione), `searchArea` facoltativa nelle impostazioni. Cambio compatibile: `BACKUP_FORMAT_VERSION` invariata.
- `meta.sweep` fuori dal backup.

## 10. Informativa e report del pilota

- `ONBOARDING_VERSION` 5 → 6. Il testo sostituisce "non visita i portali da solo" con: quando premi **Cerca**, HomeRadar apre in una finestra a parte le ricerche dei comuni che hai scelto e le legge come faresti tu; non parte mai da solo. Aggiunge: i portali possono chiedere una verifica se vedono molte pagine di fila, e HomeRadar in quel caso si ferma.
- `ONBOARDING_CHANGES[6]`: giro con un clic, zona di lavoro, categorie, "non più visto".
- `usage.ts`: contatori `sweepsStarted`, `sweepsCompleted`, `sweepsPartial`, `sweepsStopped`, per portale `sweepPages` e `sweepBlocked`, durata totale. Nessun dato degli annunci, nessun comune.
- `report-schema.ts` aggiornato e ricopiato in `worker/src/schema.ts`; testo dell'informativa sul report aggiornato.
- `docs/privacy-pilota.md`: aggiornata; tra i punti aperti per il legale il giro con un clic.

## 11. Test

- **Unit (Vitest):**
  - `sweep.ts`: piano, alternanza dei portali, condizione di fine per portale, tetti, completezza, blocco, timeout, due errori di fila, stop, riavvio del worker, pause nell'intervallo;
  - `missingUpdates`: visto, non visto in ricerca completa, ricerca incompleta, ricerca tolta dal piano, senza `sweepScope`, soglia a 3, ricomparsa;
  - `search-urls.ts` dei tre portali sugli URL verificati in fase 0 (comune, provincia, slug con apostrofo e accento); `acceptObservation` per le ricerche per provincia;
  - `comuni.ts`: ricerca per prefisso con accenti e apostrofi;
  - `category.ts` e categorie negli adapter, su fixture non residenziali;
  - `isBlockedPage` su fixture di verifica DataDome;
  - migrazione `version(7)`; `market.ts` e `same-property.ts` con le categorie; `lead-groups.ts` con "non più visto"; schemi del backup e del report.
- **E2E (Playwright):** build con `WXT_SWEEP_TEST_TIMING`; `context.route` serve pagine finte per i tre portali. Casi: giro completo con avanzamento e riepilogo nel pannello; arresto alla pagina senza privati; un portale che risponde con la verifica (fermato, gli altri proseguono, esito parziale); finestra chiusa (interrotto); Ferma.
- **`docs/smoke-test.md`:** un giro vero a mano su una zona piccola prima del rilascio.

## 12. Rilascio

1. Fase 0 (fatta), piano; nel piano, prima la prova di ritmo e le verifiche rimaste (§3).
2. Rilascio a 1-2 agenti volontari del pilota su una zona piccola; due settimane di osservazione nel report (giri bloccati, durata, pagine).
3. Rilascio a tutto il pilota.
4. Prima di un lancio commerciale: parere legale con questa funzione tra le domande.

## 13. Rischi

| Rischio | Mitigazione |
|---|---|
| DataDome blocca o mette captcha all'agente | Una scheda, pause casuali, alternanza dei portali, tetti, arresto al primo segnale; prova di ritmo come prima attività del piano; rilascio graduale |
| Contestazione legale dei portali | Avvio solo dal clic dell'agente, dati solo in locale, minimizzazione invariata; parere legale prima del lancio commerciale |
| Chrome rallenta le finestre ridotte a icona | Misurato nella prova di ritmo; timeout generoso; in alternativa finestra normale non in primo piano |
| Slug dei comuni sbagliati | Regole dalla fase 0, test con casi difficili, avviso "comune non trovato" nell'esito |
| Area troppo grande o provincia con molti privati: tetto sempre raggiunto | Esito "completato in parte" chiaro; "non più visto" non scatta per quelle ricerche; tetti rivisti con i dati del pilota |
| Ricerca per provincia: città dell'annuncio scritta diversamente dal nome ISTAT | Confronto su testo normalizzato; casi visti in fase 0 coincidono ("Cassano d'Adda"); annunci non riconosciuti scartati, mai salvati |
| Falsi "non più visto" | Solo ricerche complete, 3 giri di fila, avviso senza cambio di stato |
