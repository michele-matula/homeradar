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

## 3. Fase 0: verifica sul campo (prima del piano)

Alcuni dati non si conoscono e vanno verificati a mano su una zona vera del pilota (3-4 comuni, almeno uno con apostrofo o accento e uno con omonimi in altre province). L'agente o lo sviluppatore naviga **a mano** (DataDome) e annota per ogni portale:

1. URL della ricerca per comune per ognuna delle 4 categorie, con:
   - Immobiliare: ordinamento "privati prima" (`/da-privati/`) e parametro di pagina (`?pag=N`);
   - Idealista: `?ordine=da-privati-asc` e pagina (`lista-N.htm`);
   - Subito: filtro privati nell'URL, se esiste, e pagina (`?o=N`); percorso per categoria con regione, provincia e comune.
2. Regola che trasforma il nome del comune nello slug dell'URL (minuscole, accenti, apostrofi, omonimi; per Idealista e Subito anche provincia e regione).
3. Quante pagine servono prima che finiscano i privati, per categoria.
4. Aspetto della pagina di verifica di DataDome, se compare (salvata in `fixtures-raw/` e ripulita con `scripts/sanitize-fixture.mjs`).
5. Se un comune piccolo ha zero risultati o il portale reindirizza a un'altra località (comune non riconosciuto).

**Prova di ritmo:** una build di prova, non rilasciata, apre 20 pagine per portale in una finestra ridotta a icona con le pause previste. Si annota se DataDome reagisce e se Chrome rallenta il caricamento nelle finestre ridotte a icona.

I risultati della fase 0 aggiornano questa specifica nelle parti marcate **[fase 0]** prima di scrivere il piano. Valuta anche l'alternativa della ricerca per **provincia** filtrando i comuni in locale (meno combinazioni, più pagine), da scegliere sui numeri.

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

### URL di ricerca

Per ogni portale `src/adapters/<portale>/search-urls.ts`, funzione pura:

```ts
searchUrl(comune: ComuneInfo, category: PropertyCategory, page: number): string
```

Ordinamento "privati prima" (Immobiliare, Idealista) o filtro privati (Subito) sempre applicato. Percorsi e slug: **[fase 0]**. Test con esempi verificati a mano sul sito.

## 5. Orchestratore del giro

### Moduli

- `src/core/sweep.ts`, logica pura senza Chrome:
  - `buildPlan(area, enabledPortals)`: le combinazioni `{ portal, comune, category }`;
  - stato del giro (`SweepState`) e transizioni: `nextStep(state)`, `onPageRead(state, report)`, `onTimeout(state)`, `onStop(state)`;
  - alternanza dei portali: a ogni passo si sceglie il portale successivo che ha ancora combinazioni aperte (Immobiliare, Idealista, Subito, Immobiliare, …);
  - condizione di fine di una combinazione, tetti, completezza, contatori;
  - `pauseMs(portal, random)`: pausa casuale nell'intervallo del portale.
- `src/background/sweep-runner.ts`, cablaggio Chrome: finestra, scheda, navigazione, timer, eventi; persiste lo stato in `chrome.storage.session`.

### Svolgimento

1. Il pannello invia `startSweep`. Il background rifiuta se: informativa da confermare, nessun comune, nessun portale attivo, giro già in corso.
2. `browser.windows.create({ url, state: 'minimized', focused: false, type: 'normal' })`; si ricordano `windowId` e `tabId`.
3. Per ogni passo: `browser.tabs.update(tabId, { url: searchUrl(...) })`, poi si attende `pageRead` dalla scheda del giro o il timeout.
4. Il content script, dopo aver letto la pagina (payload o DOM) e inviato `ingest` come oggi, invia:
   ```ts
   { type: 'pageRead'; portal: Portal; url: string; results: number; privates: number; lastPage: boolean; blocked: boolean }
   ```
   `results` = annunci letti (agenzie comprese), `privates` = di privati, `lastPage` dall'adapter (paginazione del payload o del DOM). Il router passa `pageRead` all'orchestratore con `sender.tab.id`: messaggi da altre schede sono ignorati. Le pagine aperte a mano dall'agente si comportano come oggi.
5. Gli `ingest` che arrivano dalla scheda del giro portano all'orchestratore gli ID visti e il `sweepScope` della combinazione corrente (§7).
6. Dopo ogni pagina, pausa `pauseMs` e passo successivo. Finite le combinazioni, la finestra si chiude, si calcolano "non più visto" (§7) e riepilogo, si salva l'esito.

### Fine di una combinazione

- Immobiliare, Idealista (ordinamento "privati prima"): alla prima pagina con `privates === 0`, oppure `lastPage`.
- Subito con filtro privati: `lastPage` o `results === 0`. Senza filtro (**[fase 0]**): come gli altri, ma l'ordinamento è per data, quindi la combinazione finisce solo a `lastPage`.
- Tetto: `MAX_PAGES_PER_PORTAL` per portale e per giro **[fase 0]**; raggiunto il tetto, le combinazioni aperte di quel portale chiudono come **incomplete**.

Una combinazione è **completa** se è finita per la condizione di fine, senza blocchi, timeout o tetto.

### Ritmo

- Pausa casuale tra un caricamento e il successivo, intervallo per portale (indicativo 4-10 s; minimo più alto per Idealista) **[fase 0]**.
- La pausa e il timeout si azzerano o riducono solo in una build di test (variabile `WXT_SWEEP_TEST_TIMING`), mai nella build del pilota.

### Errori e interruzioni

| Caso | Comportamento |
|---|---|
| `pageRead` con `blocked: true` | Portale fermato per questo giro (combinazioni aperte incomplete), si prosegue con gli altri; esito "bloccato" con messaggio per l'agente |
| Nessun `pageRead` entro `PAGE_TIMEOUT_MS` (45 s) | Pagina in errore, combinazione incompleta; due errori di fila sullo stesso portale lo fermano per il giro |
| Pulsante Ferma | Giro "interrotto", finestra chiusa, dati già letti restano |
| Finestra chiusa dall'agente (`windows.onRemoved`) | Giro "interrotto" |
| Service worker riavviato a metà | All'avvio, se `storage.session` ha un giro in corso: segnato interrotto, finestra chiusa se esiste; nessuna ripresa |
| Portale spento a metà giro | Le combinazioni restanti di quel portale si saltano (incomplete) |
| Comune non riconosciuto dal portale (zero risultati o reindirizzamento) **[fase 0]** | Combinazione completa con zero annunci; nell'esito, avviso "Treviglio non trovato su Subito" |

### Riconoscimento del blocco

Nel content script, funzione pura per portale `isBlockedPage(root, url)`: iframe della verifica DataDome (`captcha-delivery`), testo "Al momento non siamo disponibili" su Idealista, altre forme **[fase 0]**. Testata su fixture ripulite. Su una pagina bloccata il content script invia solo `pageRead` con `blocked: true`.

## 6. Pannello: avanzamento e riepilogo

Scheda "Ricerca" in cima alla vista dei lead, sopra le linguette.

- **A riposo:** "Ultimo giro: oggi alle 8:42 · completo", numero di comuni e categorie, pulsante **Cerca**. Se oggi il giro non è stato fatto, il pulsante è in evidenza. Senza comuni: "Imposta la tua zona →" verso le Impostazioni. Esito parziale o bloccato dell'ultimo giro spiegato in una riga.
- **In corso:** durata, barra per combinazioni completate sul totale, combinazione corrente ("Treviglio · Commerciale"), per portale pagine lette e privati letti, "Finora: N nuovi · M ribassi", pulsante **Ferma**. La lista dei lead si aggiorna durante il giro.
- **Finito:** "Giro completato · 11 min" (oppure "completato in parte" con motivo per portale), "N nuovi · M ribassi · K non più visti", pulsante **Vedi i nuovi** (linguetta Nuovi, filtro "da questo giro") e **Chiudi**.

Messaggi: `startSweep`, `stopSweep`, `getSweepStatus` (richieste); `SWEEP_CHANGED` (dal background al pannello a ogni pagina e a fine giro). Il pannello parla solo tramite `api.ts`.

Riepilogo: `LeadService.sweepSummary(startedAt)` conta gli annunci con `firstSeenAt >= startedAt` (nuovi), i ribassi registrati da `startedAt` e gli annunci diventati "non più visti" in questo giro.

Esito salvato in `meta.sweep`: solo l'ultimo giro (inizio, fine, esito generale `'completed' | 'partial' | 'stopped' | 'interrupted'`, per portale pagine, privati, esito `'complete' | 'capped' | 'blocked' | 'error' | 'skipped'`, avvisi sui comuni, contatori del riepilogo). Fuori dal backup.

## 7. "Non più visto"

### Dato

Su `ListingRecord`:

- `category: PropertyCategory` (§8);
- `sweepScope: string | null`: ultima combinazione del giro in cui è stato visto, `"<portale>|<istat>|<categoria>"`;
- `missedSweeps: number`: giri completi consecutivi della sua combinazione in cui non è stato visto;
- `missingSince: number | null`: inizio del primo di quei giri.

`MISSING_SWEEPS = 3`: con `missedSweeps >= 3` l'annuncio è "non più visto".

### Regola (`src/core/sweep.ts`, pura)

A fine giro, `missingUpdates(listings, completeScopes, seenKeysByScope, startedAt)`:

- annuncio visto nel giro: `missedSweeps = 0`, `missingSince = null`, `sweepScope` aggiornato;
- annuncio con `sweepScope` in una combinazione **completa** e non visto: `missedSweeps + 1`; `missingSince = startedAt` se era null;
- combinazione incompleta o annuncio senza `sweepScope`: nessun cambiamento.

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
  - **Subito:** categoria dell'annuncio dal payload (`category.id` in `__NEXT_DATA__`, `category.key` nell'API), con una tabella **[fase 0]**;
  - **Immobiliare:** categoria dal percorso della ricerca (`/vendita-case/`, …) **[fase 0]**, confermata da `typology.name`;
  - **Idealista:** categoria dal percorso della ricerca, confermata dalla tipologia nel titolo della card.
  - `pageKind` deve riconoscere come `search` i percorsi di tutte le categorie in vendita **[fase 0]**.
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
  - `missingUpdates`: visto, non visto in combinazione completa, incompleta, senza `sweepScope`, soglia a 3, ricomparsa;
  - `search-urls.ts` dei tre portali su esempi della fase 0;
  - `comuni.ts`: ricerca per prefisso con accenti e apostrofi;
  - `category.ts` e categorie negli adapter, su fixture non residenziali;
  - `isBlockedPage` su fixture di verifica DataDome;
  - migrazione `version(7)`; `market.ts` e `same-property.ts` con le categorie; `lead-groups.ts` con "non più visto"; schemi del backup e del report.
- **E2E (Playwright):** build con `WXT_SWEEP_TEST_TIMING`; `context.route` serve pagine finte per i tre portali. Casi: giro completo con avanzamento e riepilogo nel pannello; arresto alla pagina senza privati; un portale che risponde con la verifica (fermato, gli altri proseguono, esito parziale); finestra chiusa (interrotto); Ferma.
- **`docs/smoke-test.md`:** un giro vero a mano su una zona piccola prima del rilascio.

## 12. Rilascio

1. Fase 0, aggiornamento della specifica, piano.
2. Rilascio a 1-2 agenti volontari del pilota su una zona piccola; due settimane di osservazione nel report (giri bloccati, durata, pagine).
3. Rilascio a tutto il pilota.
4. Prima di un lancio commerciale: parere legale con questa funzione tra le domande.

## 13. Rischi

| Rischio | Mitigazione |
|---|---|
| DataDome blocca o mette captcha all'agente | Una scheda, pause casuali, alternanza dei portali, tetti, arresto al primo segnale; prova di ritmo in fase 0; rilascio graduale |
| Contestazione legale dei portali | Avvio solo dal clic dell'agente, dati solo in locale, minimizzazione invariata; parere legale prima del lancio commerciale |
| Chrome rallenta le finestre ridotte a icona | Verificato in fase 0; timeout generoso; in alternativa finestra normale non in primo piano |
| Slug dei comuni sbagliati | Regole dalla fase 0, test con casi difficili, avviso "comune non trovato" nell'esito |
| Area troppo grande: tetto sempre raggiunto | Esito "completato in parte" chiaro; "non più visto" non scatta; valutare la ricerca per provincia |
| Falsi "non più visto" | Solo combinazioni complete, 3 giri di fila, avviso senza cambio di stato |
