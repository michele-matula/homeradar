# HomeRadar — Specifica di design: misura del pilota

- **Data:** 2026-10-17
- **Stato:** in revisione
- **Ambito:** punto 8 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`, `2026-10-15-onboarding-informativa-design.md`

## 1. Obiettivo

Il criterio di successo del pilota è "gli agenti trovano più lead in meno tempo e continuano a usare il tool dopo le prime settimane". Oggi non è misurato, e gli errori delle estensioni installate si scoprono solo se l'agente copia il report diagnostico e lo manda.

HomeRadar invia ogni giorno, in automatico, un report di statistiche d'uso anonime e di errori a un Cloudflare Worker del gestore del pilota. Il gestore li consulta in una pagina admin protetta da password, insieme ai feedback che gli agenti scrivono dalle impostazioni.

Successo: senza chiedere nulla agli agenti, il gestore vede chi usa HomeRadar, quanto e con che risultati, e si accorge di un adattatore rotto entro un giorno. Nessun dato degli annunci lascia il browser.

### Decisione che cambia la roadmap

La roadmap diceva "nessuna telemetria automatica: è l'agente a decidere cosa inviare". Il 2026-10-17 si è deciso diversamente: **invio automatico attivo per tutti, dichiarato nell'informativa e disattivabile** dalle impostazioni. Resta valido che nel report non ci sono dati degli annunci. La riga del punto 8 in `docs/roadmap.md` va aggiornata di conseguenza.

## 2. Ambito

### Dentro

- Contatori d'uso locali (giorni d'uso, passaggi di stato, richiami, note, export).
- Report giornaliero automatico verso il Worker, con codice pilota, interruttore e stato dell'invio.
- Ripulitura dei messaggi d'errore prima dell'invio.
- Feedback a testo libero dalle impostazioni, con coda se la rete manca.
- Worker Cloudflare con D1: ricezione, codici pilota, pulizia, pagina admin.
- Informativa, report copiato, smoke test e guida al deploy aggiornati.

### Fuori

- Email o notifiche di avviso al gestore.
- Grafici nella pagina admin (bastano tabella e striscia di attività).
- Domande periodiche agli agenti (es. voto settimanale).
- Durata delle sessioni o tempo passato nel pannello.
- Cancellazione dei dati di un'installazione dalla pagina admin: si fa con un comando SQL descritto nella guida.

## 3. Estensione

### 3.1 Contatori d'uso (`src/core/usage.ts`, puro)

Salvati in `meta.usage`, fuori dal backup come `meta.diagnostics`.

```ts
interface UsageStats {
  browsingDays: string[];   // 'AAAA-MM-GG' locali, giorni con almeno un ingest accettato
  panelDays: string[];      // giorni con il pannello aperto
  statusChanges: Partial<Record<LeadStatus, number>>;
  recallsSet: number;       // richiami impostati o spostati (non quelli tolti)
  notesWritten: number;     // salvataggi di una nota diversa dalla precedente e non vuota
  exports: { xlsx: number; csv: number };
}
```

- Il giorno è la data locale del momento (`localDay(ts)`). Gli elenchi sono ordinati, senza doppioni, al massimo gli ultimi 400 giorni.
- `statusChanges` conta solo un passaggio reale: lo stesso stato salvato di nuovo non conta. Un cambio di stato su un gruppo (punto 6) conta **una volta**, non una per annuncio.
- Lo stesso vale per richiami e note sul gruppo: una scrittura dell'agente vale uno.
- `firstActiveDay` e `lastActiveDay` non si salvano: si ricavano dall'unione dei due elenchi.

**Dove si contano:**

- `browsingDays`: nel router, su `ingest` accettato (portale attivo, informativa confermata) con almeno un'osservazione.
- `panelDays`: nuovo messaggio `trackUsage { event: 'panelOpen' }` mandato dal pannello al montaggio.
- `statusChanges`, `recallsSet`, `notesWritten`: in `LeadService.setLeadState`, confrontando con lo stato precedente del principale.
- `exports`: `trackUsage { event: 'export', format }` da `ExportBar` dopo il download.

La scrittura su `meta.usage` passa da una transazione come `updateDiag`. Un errore nei contatori non deve mai far fallire l'operazione dell'agente: si registra in `recordError` e si va avanti.

### 3.2 Report (`src/core/report.ts`, puro)

```ts
interface UsageReport {
  formatVersion: 1;
  installId: string;          // UUID v4, creato alla prima necessità, in meta.install
  pilotCode: string;
  version: string;            // versione dell'estensione
  sentAt: number;             // ms epoch UTC
  timezoneOffset: number;     // Date.getTimezoneOffset() al momento dell'invio
  enabledPortals: Portal[];
  usage: UsageStats & { firstActiveDay: string | null; lastActiveDay: string | null };
  leads: {
    total: number;
    byPortal: Record<Portal, number>;
    byPriority: Record<Priority, number>;
    newLast7Days: number;
  };
  technical: {
    counters: Record<string, number>;   // quelli di meta.diagnostics
    adapterWarning: Portal[];
    errors: { at: number; message: string }[];   // ultimi 20, ripuliti
  };
}
```

- `buildReport(input, now)` riceve i dati già letti (usage, diagnostics, `LeadView[]`, impostazioni, versione, ID, codice) e non tocca né Dexie né Chrome.
- `leads` conta i `LeadView` come li mostra il pannello: un gruppo vale uno; `byPortal` usa il portale del principale; `byPriority` la valutazione del gruppo; `newLast7Days` i lead il cui annuncio più vecchio è stato visto la prima volta negli ultimi 7 giorni.
- Lo schema zod `UsageReportSchema` sta in `src/shared/report-schema.ts`. Il client lo usa per validare prima dell'invio (un report non valido è un bug: si registra l'errore e non si invia). Il Worker ne ha una copia (§4.2).

**Ripulitura (`sanitizeError(message)`):** si applica solo al report inviato; il report copiato dall'agente resta com'è.

1. URL (`https?://…`, `chrome-extension://…`) → `<url>`; percorsi di file (`C:\…`, `/Users/…`, `/home/…`) → `<path>`.
2. Testi tra virgolette (`'…'`, `"…"`, `«…»`, `` `…` ``) → `<testo>`.
3. Sequenze di 4 o più cifre, anche con separatori `.` o `,` interni (es. `250.000`) → `#`.
4. Troncato a 200 caratteri.

Gli indici brevi (`result[3]`) e i percorsi dei campi (`price.value`) restano.

**Cosa non parte mai:** titoli, indirizzi, città, zone, prezzi, m², ID e URL degli annunci, testo delle note, date di ricontatto, soglie delle impostazioni, contenuto del backup.

### 3.3 Invio (`src/background/reporter.ts`)

**Condizioni, tutte necessarie:**

- `REPORT_URL` non vuota. Viene da `import.meta.env.WXT_REPORT_URL` al momento della build: chi compila il repository pubblico senza `.env` non manda nulla.
- informativa confermata nella versione corrente;
- `settings.reportingEnabled`;
- `settings.pilotCode` non vuoto;
- per gli invii automatici, `codeRejected` falso.

**Momenti:**

- allarme `report` con `periodInMinutes: 1440`, creato all'avvio se manca;
- all'avvio del worker, se da più di 20 ore non c'è stato né un invio riuscito né un tentativo (`lastSentAt` e `lastAttemptAt`): Chrome riaccende il worker di continuo, e un tentativo fallito non deve ripetersi a ogni risveglio;
- pulsante "Invia ora" (messaggio `sendReportNow`), che ignora `codeRejected` e la regola delle 20 ore.

Due invii contemporanei (allarme e avvio) si evitano con un lucchetto in memoria; se il worker si riavvia nel mezzo, il peggio è un doppio invio, innocuo perché idempotente.

**Esiti** (`fetch` POST JSON, timeout 15 s con `AbortController`), salvati in `meta.reporting`:

```ts
interface ReportingStatus {
  lastSentAt: number | null;
  lastAttemptAt: number | null;
  lastError: 'network' | 'server' | 'rejected' | 'invalid' | null;
  codeRejected: boolean;
}
```

| Risposta | Effetto |
|---|---|
| 2xx | `lastSentAt = now`, `lastError = null`, `codeRejected = false` |
| 401 / 403 | `codeRejected = true`, `lastError = 'rejected'`; nessun nuovo tentativo automatico finché il codice cambia (salvare un codice diverso azzera `codeRejected`) o finché l'agente preme "Invia ora" |
| altri 4xx | `lastError = 'invalid'`, errore in `recordError` con lo stato HTTP; si riprova all'allarme successivo |
| 5xx, timeout, rete | `lastError = 'server'` o `'network'`; si riprova all'allarme successivo o al prossimo avvio |

Non ci sono ritentativi ravvicinati.

**Spegnimento:** con `reportingEnabled` falso non parte nessun report (nemmeno con "Invia ora", che è disattivato).

### 3.4 Feedback

- Coda in `meta.feedbackQueue`: `{ id: string (UUID), text: string, createdAt: number, version: string }[]`, al massimo 20 elementi. Se è piena, il pannello rifiuta il nuovo messaggio con un avviso.
- Messaggio `sendFeedback { text }`: valida (testo ripulito dagli spazi, da 1 a 2000 caratteri), accoda, poi prova subito a svuotare la coda. Risponde `'sent' | 'queued'`.
- La coda si svuota in ordine, dopo ogni report e a ogni `sendFeedback`, verso `POST /feedback`.
  - Un elemento esce dalla coda con un 2xx, oppure con un 400 (corpo rifiutato: tenerlo bloccherebbe gli altri; l'errore va in `recordError`).
  - 403 e 429 fermano lo svuotamento e lasciano gli elementi in coda.
- Il feedback è un'azione esplicita: **parte anche con `reportingEnabled` spento**. Richiede `REPORT_URL` e il codice pilota; senza, il campo è disattivato con la spiegazione.
- Il testo del feedback non si ripulisce: lo scrive l'agente, che vede l'avviso di non inserire nomi o telefoni di privati.

### 3.5 Impostazioni e dati

- `Settings` guadagna `pilotCode: string` (default `''`) e `reportingEnabled: boolean` (default `true`).
  - `validateSettings` normalizza il codice: maiuscole, spazi tolti; un codice che non rispetta `^[A-Z0-9-]{4,32}$` si rifiuta con un messaggio.
  - Le due chiavi entrano in `SettingsSchema` di `backup.ts` come facoltative: i backup vecchi restano validi. Il formato del file non cambia in modo incompatibile, quindi `BACKUP_FORMAT_VERSION` resta.
- `meta.install` (`{ id }`), `meta.usage`, `meta.reporting`, `meta.feedbackQueue` stanno fuori dal backup.
  - Su un PC nuovo si crea un nuovo ID d'installazione; il codice pilota torna con il backup delle impostazioni.
  - "Azzera tutto" non tocca questi dati: cancella solo gli annunci, come oggi.
- Nessuna nuova versione dello schema Dexie: `meta` è una tabella chiave/valore già esistente.
- `wxt.config.ts`: l'origine di `REPORT_URL` si aggiunge a `host_permissions` solo se la variabile è impostata.

### 3.6 Interfaccia

**Scheda "Pilota"** nelle impostazioni, prima di "Assistenza":

- campo **Codice pilota**, salvato con le altre impostazioni;
- interruttore **Invia statistiche d'uso anonime** (attivo), con InfoTip: cosa parte (giorni d'uso, numero di lead per portale e priorità, passaggi di stato, export, errori tecnici) e cosa non parte mai (annunci, indirizzi, prezzi, note);
- riga di stato:
  - "Ultimo invio: oggi alle 10:32" / "il 03/11 alle 10:32";
  - "Codice non riconosciuto: controlla il codice che hai ricevuto";
  - "Ultimo tentativo non riuscito (nessuna connessione): si riprova da solo";
  - "Invio spento";
  - "Inserisci il codice pilota per attivare l'invio";
- pulsanti **Invia ora** e **Mostra cosa viene inviato**. Il secondo apre un riquadro con il JSON del prossimo report, già ripulito (messaggio `previewReport`).
- Se `REPORT_URL` è vuota, la scheda dice "Invio non configurato in questa versione" e i controlli sono disattivati.

**Scheda "Feedback":**

- area di testo con il conteggio "N/2000";
- avviso "Non scrivere nomi o telefoni dei privati";
- pulsante **Invia**;
- esito: "Inviato, grazie" oppure "Salvato: verrà inviato appena possibile"; se ci sono messaggi in coda, "N messaggi in attesa di invio".

**Informativa** (`src/ui/onboarding/`):

- nuovo punto nella sezione dei dati: "Ogni giorno HomeRadar invia al gestore del pilota statistiche d'uso anonime (giorni d'uso, numero di lead, passaggi di stato, export) e gli errori tecnici, con il codice pilota della tua agenzia. Non invia mai annunci, indirizzi, prezzi, note o nomi. Puoi spegnere l'invio dalle impostazioni."
- La frase "i dati restano sul tuo browser" diventa "annunci, stati e note restano sul tuo browser".
- Campo facoltativo **Codice pilota** prima della conferma.
- `ONBOARDING_VERSION = 5`, con la voce `5` in `ONBOARDING_CHANGES` che riassume il nuovo invio.

**Report copiato:** `formatDiagnostics` aggiunge le righe "Uso" (giorni di navigazione e di pannello, passaggi di stato, export) e "Invio" (ultimo invio o ultimo errore). Resta il ripiego senza rete.

## 4. Worker (`worker/`)

### 4.1 Struttura

- Pacchetto separato (`worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`): le dipendenze di Cloudflare non entrano nell'estensione.
- TypeScript senza framework; `zod` per la validazione.
- Test con `@cloudflare/vitest-pool-workers` e D1 locale: `npm --prefix worker test`.
- Migrazioni in `worker/migrations/`.
- `ADMIN_PASSWORD` è un segreto (`wrangler secret put`); non compare mai nel repository.

### 4.2 Dati (D1)

```sql
CREATE TABLE pilots (
  code TEXT PRIMARY KEY,
  agency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE reports (
  install_id TEXT NOT NULL,
  code TEXT NOT NULL,
  day TEXT NOT NULL,            -- AAAA-MM-GG UTC di ricezione
  version TEXT NOT NULL,
  payload TEXT NOT NULL,        -- JSON validato
  received_at INTEGER NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
```

Lo schema del report sta in `worker/src/schema.ts`, copia di `src/shared/report-schema.ts`. Un test dell'estensione confronta i due file e fallisce se divergono.

### 4.3 Endpoint

| Metodo e percorso | Comportamento |
|---|---|
| `POST /report` | Corpo al massimo 64 KB, JSON valido per lo schema → 400 altrimenti. Codice inesistente o disattivato → 403. Upsert su `(install_id, giorno UTC)` → 204. |
| `POST /feedback` | Corpo `{ id, installId, pilotCode, version, text, createdAt }`, al massimo 8 KB, testo da 1 a 2000 caratteri → 400 altrimenti. Codice non valido → 403. Oltre 30 feedback ricevuti nelle ultime 24 ore per quel codice → 429. `INSERT OR IGNORE` su `id` → 204. |
| `GET /admin` | Panoramica (§4.4). |
| `GET /admin/install/:id` | Dettaglio di un'installazione. |
| `GET /admin/feedback` | Elenco dei feedback. |
| `GET /admin/pilots`, `POST /admin/pilots` | Elenco, creazione, disattivazione e riattivazione dei codici. |
| altro | 404 |

- Cron giornaliero (`scheduled`): cancella i `reports` con `received_at` più vecchio di 180 giorni. I feedback restano.
- Le risposte degli endpoint pubblici non contengono dettagli interni (solo stato e un breve codice d'errore).

### 4.4 Pagina admin

- **Autenticazione:** Basic Auth su tutto `/admin*`. Password confrontata con `ADMIN_PASSWORD` a tempo costante; nome utente ignorato; 401 con `WWW-Authenticate`.
- **Sicurezza:**
  - i POST sono accettati solo se l'intestazione `Origin` coincide con l'origine del Worker (difesa CSRF), altrimenti 403;
  - ogni valore è escapato in HTML;
  - le pagine si servono con `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'` e `Cache-Control: no-store`;
  - nessun JavaScript.
- **Panoramica:** una riga per installazione (ultimo report di ognuna) con:
  - agenzia, codice, versione, ultimo invio;
  - giorni d'uso negli ultimi 7 e 30 giorni e in totale (unione di `browsingDays` e `panelDays`);
  - striscia di 30 quadratini per l'attività degli ultimi 30 giorni;
  - totale dei passaggi a "Contattato", export totali, lead totali e di priorità Alta;
  - portali con avviso e numero di errori nell'ultimo report.

  Le righe senza invii da più di 3 giorni sono evidenziate; ordinamento per agenzia.
- **Dettaglio installazione:** una riga per giorno ricevuto (lead totali, Alta, contattati, export, errori), poi gli errori dell'ultimo report e il JSON completo dell'ultimo report.
- **Feedback:** dal più recente, con data, agenzia, codice, versione e testo (gli a capo restano).
- **Codici pilota:** tabella con codice, agenzia, stato, data di creazione e installazioni collegate. Modulo di creazione: nome dell'agenzia più codice facoltativo; se vuoto, si genera `XXXX-XXXX` con caratteri senza ambiguità (niente `0/O`, `1/I`). Pulsanti Disattiva e Riattiva.

### 4.5 Guida al deploy (`docs/pilot-reporting.md`)

1. `npx wrangler login`
2. `npx wrangler d1 create homeradar-pilot` e copia dell'ID in `wrangler.toml`
3. `npx wrangler d1 migrations apply homeradar-pilot --remote`
4. `npx wrangler secret put ADMIN_PASSWORD`
5. `npx wrangler deploy`
6. nel `.env` della radice (ignorato da git): `WXT_REPORT_URL=https://<worker>/`, poi `npm run zip`
7. creazione dei codici pilota da `/admin/pilots` e consegna alle agenzie
8. come cancellare i dati di un'installazione o di un codice (comandi SQL)
9. come provare tutto in locale con `wrangler dev` e `WXT_REPORT_URL=http://localhost:8787/`

## 5. Test

**Estensione (Vitest):**

- `usage.ts`: giorno locale, doppioni, limite a 400 giorni, passaggio reale contro stato ripetuto, gruppo che conta uno.
- `report.ts`:
  - forma e validazione del report;
  - conteggi per gruppo, portale del principale, priorità del gruppo, `newLast7Days`;
  - `sanitizeError` con messaggi veri dei tre adattatori (zod con valori "received"), del backup e con percorsi Windows;
  - un test di proprietà: nessun numero di 4 o più cifre, nessun URL, nessuna virgoletta nel JSON degli errori del report;
  - nessun titolo o indirizzo delle fixture presente nel JSON del report.
- `reporter.ts` con `fetch` finta:
  - condizioni di invio (URL vuota, informativa mancante, interruttore spento, codice vuoto);
  - esiti 2xx/401/403/400/500/timeout;
  - regola delle 20 ore e "Invia ora";
  - `codeRejected` azzerato dal cambio di codice;
  - coda dei feedback: ordine, 400 che scarta, 403/429 che fermano, limite di 20, invio con interruttore spento.
- `LeadService.setLeadState` aggiorna i contatori senza far fallire la scrittura se `meta.usage` non si scrive.
- `validateSettings` e backup: codice normalizzato o rifiutato; backup senza le chiavi nuove ancora valido.
- Pannello: schede Pilota e Feedback (stati, pulsanti disattivati, conteggio), `trackUsage` all'apertura e all'export.
- Informativa: nuovo testo, campo codice, voce `5` delle novità.
- Confronto tra `src/shared/report-schema.ts` e `worker/src/schema.ts`.

**Worker (vitest-pool-workers):**

- `/report`: 204 e upsert dello stesso giorno, 400 (JSON non valido, troppo grande), 403 (codice sconosciuto o disattivato).
- `/feedback`: 204, duplicato ignorato, 400, 403, 429.
- `/admin*`: 401 senza password o con password sbagliata; POST con `Origin` diverso → 403; escape dei valori (un nome d'agenzia con `<script>`); generazione del codice.
- `scheduled`: cancella solo i report oltre 180 giorni.

**Smoke test** (`docs/smoke-test.md`), con `wrangler dev` in locale:

- informativa v5 e campo codice;
- invio con codice valido, poi la riga in `/admin`;
- codice sbagliato → "Codice non riconosciuto";
- Worker spento → errore di rete, poi invio riuscito alla riaccensione con "Invia ora";
- feedback senza rete in coda, poi inviato;
- interruttore spento → nessun report, il feedback parte lo stesso;
- "Mostra cosa viene inviato" senza dati degli annunci.

## 6. Rischi

| Rischio | Mitigazione |
|---|---|
| Un messaggio d'errore porta con sé un dato dell'annuncio | Ripulitura con regole conservative e test di proprietà; anteprima visibile all'agente |
| L'URL pubblico del Worker viene usato da terzi | Solo codici pilota attivi; limiti di dimensione e di feedback |
| L'agente non inserisce il codice | Nessun invio, scheda Pilota che lo segnala; il gestore lo vede dall'assenza nella panoramica |
| Il worker di Chrome si spegne durante l'invio | Invio idempotente, nuovo tentativo all'allarme successivo |
| Fuso orario dell'agente diverso da UTC | I giorni d'uso sono locali e calcolati dal client; il giorno UTC serve solo come chiave della riga |
