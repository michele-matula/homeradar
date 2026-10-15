# HomeRadar — Specifica di design: onboarding e informativa privacy

- **Data:** 2026-10-15
- **Stato:** in revisione
- **Ambito:** punto 2 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md` (§3 Vincoli legali e privacy)

## 1. Obiettivo

La specifica MVP richiede un'informativa per gli utenti del pilota, e l'indirizzo completo salvato va dichiarato. Senza spiegazioni, i badge con età stimata (Idealista, Subito) rischiano di essere fraintesi. In più, il backup settimanale può aprire la finestra "Salva con nome" di Chrome (scoperto con lo smoke test del 2026-10-15) e l'agente deve sapere perché.

Successo: un agente che installa HomeRadar capisce in un minuto cosa fa e cosa salva, conferma prima che venga salvato qualsiasi dato e legge i badge senza chiedere.

## 2. Ambito

### Dentro

- Schermata di benvenuto e informativa, con conferma obbligatoria: finché l'agente non conferma, l'estensione non legge né salva nulla dai portali.
- Conferma legata alla versione dell'informativa: se un aggiornamento cambia cosa viene salvato, si chiede di nuovo.
- La schermata compare in una scheda all'installazione, nel pannello laterale finché manca la conferma, e si può rivedere dalle impostazioni.
- Avviso sul portale e segnale sull'icona dell'estensione finché manca la conferma.
- Legenda dei badge con le soglie attuali dell'agente.

### Fuori

- Canale di contatto o feedback: lo decide il punto 8 della roadmap. Per ora "Per domande, rivolgiti a chi ti ha fornito HomeRadar".
- Testo legale definitivo: il parere legale resta da fare prima del lancio commerciale. Questa è un'informativa in linguaggio semplice per il pilota.

### Vincoli

- Tutto in locale; nessun nuovo permesso nel manifest (`tabs.create` su una pagina dell'estensione non lo richiede).
- La conferma non viaggia nel file di backup: ogni installazione conferma per conto suo.
- Il `LeadService` resta l'unico scrittore su Dexie.

## 3. Comportamento per l'agente

### Prima installazione

1. Chrome installa l'estensione e si apre una scheda con la schermata di benvenuto.
2. L'agente legge e preme "Ho capito, inizia". La scheda resta aperta e mostra: "HomeRadar è attivo: apri una ricerca su Immobiliare.it, Idealista.it o Subito.it", con il suggerimento di fissare l'icona di HomeRadar nella barra di Chrome.
3. Da quel momento l'estensione lavora come oggi.

Se l'agente chiude la scheda senza confermare:

- aprendo un portale compare l'avviso "HomeRadar non è ancora attivo: leggi e conferma l'informativa per iniziare" con il pulsante "Apri", che riapre la scheda di benvenuto; l'avviso compare una volta per caricamento di pagina e si chiude con ✕;
- l'icona dell'estensione mostra un pallino nel colore del marchio con il suggerimento "HomeRadar: conferma l'informativa per iniziare";
- aprendo il pannello laterale compare la stessa schermata al posto della lista; il pulsante Impostazioni è nascosto.

Dopo la conferma, una scheda del portale già aperta riprende a lavorare alla lettura successiva senza ricaricare: su Idealista alla prossima scansione delle card, su Immobiliare e Subito al prossimo payload (es. pagina successiva dei risultati), perché i dati della pagina già caricata arrivano una volta sola. Per questo, dopo il clic su "Apri", l'avviso diventa "Dopo aver confermato, ricarica la pagina" con il pulsante "Ricarica". Se il pannello è aperto mentre l'agente conferma nella scheda, passa da solo alla lista dei lead.

### Aggiornamento con informativa cambiata

Se una nuova versione dell'estensione alza la versione dell'informativa:

- all'aggiornamento si apre la scheda di benvenuto, con in cima il riquadro "Cosa è cambiato";
- finché l'agente non riconferma, l'estensione si ferma come alla prima installazione; gli annunci già salvati restano, si sospendono solo le nuove letture.

Un aggiornamento che non alza la versione non apre nulla.

### Impostazioni: blocco "Informativa e guida"

Pulsante "Rivedi informativa": apre la stessa schermata nel pannello in sola lettura, senza pulsante di conferma; al suo posto "Confermata il GG/MM/AAAA" e "Chiudi", che torna alle impostazioni.

## 4. Testo della schermata

Una pagina che si scorre, in quest'ordine. `{minAgeDays}` e `{retentionDays}` sono i valori attuali delle impostazioni.

**Benvenuto in HomeRadar**
Su Immobiliare.it, Idealista.it e Subito.it HomeRadar riconosce gli annunci pubblicati da privati e li segnala, così trovi prima i proprietari da contattare. Lavora solo sulle pagine che apri tu: non visita i portali da solo e non fa ricerche al posto tuo.

**Cosa salva**
- Gli annunci di privati che vedi nelle ricerche: titolo, indirizzo completo (via e civico, come pubblicato nell'annuncio), città e zona, tipologia, m², locali, prezzo e link.
- Lo storico dei prezzi, per riconoscere i ribassi.
- Lo stato che dai a ogni lead e le tue note. Le note le scrivi tu: non inserire dati personali che non ti servono.

**Cosa non salva mai**
- Gli annunci di agenzie.
- Nomi e numeri di telefono dei venditori, anche quando il portale li mostra.

**Dove restano i dati**
- Solo nel tuo browser, su questo computer. Non vengono inviati a nessun server, nemmeno a chi ha creato HomeRadar.
- Gli annunci rimasti in stato "Nuovo" che non rivedi da {retentionDays} giorni vengono cancellati da soli, anche se hanno note: per tenerli cambia lo stato. Puoi cambiare il periodo nelle impostazioni.
- Una volta a settimana HomeRadar salva un backup nella cartella Download/HomeRadar. Se Chrome è impostato per chiedere dove salvare i file, in quel momento vedrai la finestra di salvataggio: confermala. Il backup si può spegnere nelle impostazioni.
- Puoi cancellare tutto in qualsiasi momento: Impostazioni → Azzera archivio annunci.

**Come leggere i badge** (esempi visivi con lo stesso aspetto dei badge sulle pagine)
- **● Alta**: online da almeno {minAgeDays} giorni e ribassato.
- **● Media**: solo una delle due condizioni.
- **◐ Da verificare / Età incerta**: l'età è vicina alla soglia e non è certa.
- **Privato**: annuncio di un privato senza segnali particolari.
- **~120 gg**: età stimata. Idealista e Subito non pubblicano la data dell'annuncio, quindi HomeRadar la stima; su Immobiliare l'età è esatta.
- **−8%**: ribasso rispetto al prezzo più alto visto.

**In fondo**
"Per domande, rivolgiti a chi ti ha fornito HomeRadar", poi il pulsante **"Ho capito, inizia"**.

**Riquadro "Cosa è cambiato"**: solo quando l'agente aveva confermato una versione precedente. Elenca le voci di `ONBOARDING_CHANGES` per le versioni successive a quella confermata. Con la versione 1 l'elenco è vuoto e il riquadro non compare mai.

**Quando alzare la versione:** solo se cambia cosa viene salvato o come viene usato (es. date di ricontatto, punto 4; raggruppamenti tra portali, punto 6). Le correzioni di testo e la legenda non la alzano.

## 5. Architettura

### `src/core/onboarding.ts` (puro)

- `ONBOARDING_VERSION = 1`.
- `ONBOARDING_CHANGES: Record<number, string[]>`: voci di "Cosa è cambiato" per versione (vuoto alla versione 1).
- `needsOnboarding(acceptedVersion: number | null, current = ONBOARDING_VERSION): boolean`: vero se mai confermato o confermato su una versione precedente.
- `changesSince(acceptedVersion: number | null): string[]`: voci delle versioni successive a quella confermata; vuoto se mai confermato.

### Tipi condivisi (`src/shared/types.ts`)

- `OnboardingStatus { acceptedVersion: number | null; acceptedAt: number | null; current: number }`.
- `PortalState = 'active' | 'off' | 'onboarding'`.

### `LeadService`

- `onboardingStatus(): Promise<OnboardingStatus>`: dal record `meta.onboarding` (`{ version, acceptedAt }`); se manca, `acceptedVersion` e `acceptedAt` sono `null`.
- `acceptOnboarding(): Promise<OnboardingStatus>`: salva `{ version: ONBOARDING_VERSION, acceptedAt: now }`.
- Schema Dexie invariato (`meta` è chiave/valore). Il file di backup non contiene `meta.onboarding`: lo schema di `backup.ts` ammette solo i campi dichiarati.

### Messaggi e router

Nuove richieste:

- `getOnboardingStatus` → `OnboardingStatus`.
- `acceptOnboarding` → `OnboardingStatus`; dopo il salvataggio chiama gli hook `onboardingChanged()` e aggiorna il segnale sull'icona.
- `getPortalState { portal }` → `PortalState`: `'onboarding'` se serve la conferma, altrimenti `'off'` se il portale è spento, altrimenti `'active'`. Sostituisce il `getSettings` usato oggi da `isPortalEnabled` nei content script.
- `openOnboarding` → apre la scheda di benvenuto (hook `openOnboarding()` del background).

Controllo: finché `needsOnboarding` è vero, `ingest` (restituisce `[]`) e `parseStatus` (restituisce `null`) vengono scartati, come per i portali spenti. Le altre richieste passano, compresa l'importazione di un backup (la avvia l'agente).

### Content script

- `src/shared/messages.ts`: `isPortalEnabled(portal)` diventa `portalState(portal): Promise<PortalState>`.
- `src/content/controller.ts`: `isPortalEnabled` diventa `portalState: () => Promise<PortalState>`. A ogni lettura: `'active'` legge; `'off'` come oggi (niente lettura, via i badge); `'onboarding'` niente lettura, via i badge e `onOnboardingNeeded()` (iniettata) che mostra l'avviso. L'avviso si mostra al massimo una volta per controller, cioè per caricamento di pagina.
- `src/content/banner.ts`: `showBanner(doc, text, action?)` con `action = { label, onClick }`; senza `action` resta "Ricarica" come oggi. Avviso di onboarding: testo come in §3, pulsante "Apri" che invia `openOnboarding` e sostituisce l'avviso con "HomeRadar: dopo aver confermato, ricarica la pagina" e il pulsante "Ricarica" (§3).

### Background

- `runtime.onInstalled`: con `reason === 'install'` apre `onboarding.html` con `tabs.create`; con `reason === 'update'` la apre solo se `needsOnboarding`. Un errore va nel diagnostico.
- Segnale sull'icona: funzione pura `actionBadge({ onboarding, warning })` in `src/core/` che restituisce testo, colore e titolo. Precedenze: onboarding (pallino `●` nel colore del marchio, titolo "HomeRadar: conferma l'informativa per iniziare") > avviso dei portali (`!` ambra, titolo "HomeRadar") > nulla. Un solo punto del background la applica: all'avvio del service worker, dopo `acceptOnboarding` e quando cambia l'avviso dei portali (l'hook `setWarning` di oggi passa da qui).
- `onboardingChanged()`: invia `{ type: 'onboardingChanged' }` a tutte le pagine dell'estensione, come `leadsChanged`.

### Interfaccia

- `src/ui/onboarding/Onboarding.tsx`: componente condiviso. Props: `api`, `mode: 'confirm' | 'review'`, `onDone()`. Legge stato e impostazioni dal background; mostra il testo di §4 con le soglie attuali, il riquadro "Cosa è cambiato" se `changesSince` non è vuoto, e in fondo il pulsante di conferma (`confirm`) oppure la data di conferma e "Chiudi" (`review`). Dopo la conferma in modalità `confirm` mostra il messaggio "HomeRadar è attivo…" (§3).
- Legenda: esempi resi con lo stesso aspetto dei badge sulle pagine. Lo stile oggi è inline in `src/content/badges.ts`: colori e forme passano in un modulo condiviso usato da badge e legenda, così non si duplicano.
- `src/entrypoints/onboarding/` (pagina WXT non elencata, `index.html` + `main.tsx`): monta `Onboarding` in modalità `confirm` a tutta pagina, con il logo e lo stile del pannello.
- `src/ui/sidepanel/App.tsx`: all'avvio legge lo stato; se serve la conferma mostra `Onboarding` (`confirm`) al posto della lista e nasconde il pulsante Impostazioni. Ascolta `onboardingChanged` per passare alla lista. Una terza vista `'guide'` mostra `Onboarding` in modalità `review`.
- `src/ui/sidepanel/SettingsView.tsx`: blocco "Informativa e guida" con il pulsante "Rivedi informativa".
- `src/ui/sidepanel/api.ts`: `getOnboardingStatus`, `acceptOnboarding`, `onOnboardingChanged`.

## 6. Gestione degli errori

Nel dubbio l'estensione resta ferma.

| Caso | Comportamento |
|---|---|
| Content script: lo stato del portale non si legge (background irraggiungibile) | Nessuna lettura, come oggi quando fallisce la lettura delle impostazioni |
| Pannello: lo stato non si legge | "Errore: …" con il pulsante "Riprova"; la lista non si mostra |
| La conferma non va a buon fine | Messaggio d'errore; il pulsante resta per riprovare |
| La scheda non si apre all'installazione | Errore nel diagnostico; avviso sul portale e segnale sull'icona guidano comunque l'agente |
| `openOnboarding` dall'avviso fallisce | Nessun effetto visibile oltre all'errore nel diagnostico; il pannello resta un'alternativa |

## 7. Strategia di test

1. **Unit `onboarding.ts`:** `needsOnboarding` (mai confermato, versione corrente, versione precedente); `changesSince`.
2. **Unit `LeadService`:** stato iniziale, conferma con data; il file di backup non contiene la conferma.
3. **Unit router:** senza conferma `ingest` e `parseStatus` vengono scartati e non si salva nulla; le altre richieste passano; `getPortalState` nei tre casi; dopo `acceptOnboarding` tutto funziona e gli hook vengono chiamati.
4. **Unit controller:** con `'onboarding'` non legge, toglie i badge e mostra l'avviso una sola volta; dopo il passaggio ad `'active'` riprende alla lettura successiva; `'off'` invariato.
5. **Unit banner:** pulsante personalizzato; senza `action` resta "Ricarica".
6. **Unit `actionBadge`:** le tre combinazioni e le precedenze.
7. **Unit UI:** `Onboarding` (soglie dalle impostazioni, riquadro solo con voci, conferma ed errore, modalità `review` con la data); `App` (schermata al posto della lista senza Impostazioni, passaggio alla lista su `onboardingChanged`, errore con "Riprova"); `SettingsView` ("Rivedi informativa").
8. **E2E (Playwright):** all'installazione si apre la scheda di benvenuto; prima della conferma la pagina di prova mostra l'avviso e nessun badge; dopo la conferma nella scheda compaiono i badge. I test esistenti confermano l'informativa all'inizio tramite una funzione condivisa.
9. **Smoke test manuale** (in `docs/smoke-test.md`): installazione su un profilo pulito con apertura della scheda; avviso sul portale e pulsante "Apri"; conferma e badge senza ricaricare; pannello prima e dopo la conferma; "Rivedi informativa".

## 8. Rischi noti

| Rischio | Mitigazione |
|---|---|
| L'agente chiude la scheda senza leggere e pensa che l'estensione non funzioni | Avviso sul portale con "Apri", pallino sull'icona, schermata nel pannello |
| Il testo diverge dal comportamento reale (nuovi dati salvati senza aggiornare l'informativa) | Regola in §4 su quando alzare la versione; nota in `CLAUDE.md` |
| L'informativa viene scambiata per un parere legale | È dichiarata come informativa del pilota; parere legale prima del lancio commerciale (spec MVP §3) |
