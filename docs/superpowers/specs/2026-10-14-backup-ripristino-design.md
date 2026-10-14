# HomeRadar — Specifica di design: backup e ripristino

- **Data:** 2026-10-14
- **Stato:** in revisione
- **Ambito:** punto 1 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`

## 1. Obiettivo

I dati di HomeRadar vivono solo nell'IndexedDB del browser dell'agente. Un cambio di PC, una reinstallazione dell'estensione o la pulizia dei dati di Chrome cancellano stati, note, storico prezzi e calibrazione: il valore accumulato in settimane di navigazione. L'export XLSX/CSV non si può reimportare.

Successo: esportato il backup su un PC e importato su un altro, l'agente ritrova gli stessi lead con stati, note, storico prezzi ed età. Senza che l'agente ci pensi, esiste sempre un backup di al massimo circa una settimana prima.

## 2. Ambito

### Dentro

- Backup automatico settimanale nella cartella `Download/HomeRadar/`, con rotazione su 4 file, attivo di default e disattivabile
- Esportazione manuale del backup dalle impostazioni
- Importazione di un backup che **unisce** i dati a quelli presenti, senza cancellare nulla
- Data di ultima modifica sul lead (`updatedAt`) per risolvere i conflitti
- Stato del backup nelle impostazioni (ultimo backup riuscito, ultimo tentativo automatico fallito)

### Fuori

- Importazione che sostituisce tutto il contenuto del database
- Sincronizzazione tra dispositivi, cloud, Google Drive
- Cifratura del file di backup
- Backup del diagnostico (contatori ed errori)

### Vincoli

- Tutto in locale: nessun server, nessuna richiesta di rete.
- `LeadService` resta l'unico scrittore su Dexie.
- Lo schema zod del file è la lista dei campi ammessi: ciò che non è dichiarato viene scartato.
- Timestamp sempre in ms epoch UTC.
- Il file contiene indirizzi e note dell'agente: è un dato personale dell'agente, va dichiarato nell'informativa (punto 2 della roadmap).

## 3. Comportamento per l'agente

### Backup automatico

- Un allarme giornaliero `backup` controlla se il backup è dovuto: backup automatico attivo, ultimo backup riuscito più vecchio di 7 giorni (o mai fatto), almeno un annuncio nel database.
- Il file si chiama `HomeRadar/homeradar-backup-N.json` con `N` da 1 a 4, sovrascritto a rotazione (`conflictAction: 'overwrite'`). Più file e non uno solo: un database rovinato sovrascriverebbe l'unico backup buono.
- Con il database vuoto non si fa alcun backup: un browser appena pulito non sovrascrive i backup buoni con un file vuoto.
- Il backup conta come riuscito solo quando il download risulta completato; solo allora avanza lo slot.
- Chrome mostra il download nella sua barra dei download: è voluto, informa l'agente.

### Impostazioni: blocco "Backup"

- Interruttore "Backup automatico settimanale" (impostazione `autoBackup`, default attivo), con tooltip come le altre voci.
- "Ultimo backup: 12/10 alle 09:30" oppure "Ultimo backup: mai".
- Se l'ultimo tentativo automatico è fallito: "Ultimo backup automatico non riuscito".
- **Esporta backup ora**: scarica `homeradar-backup-AAAA-MM-GG.json` dal pannello (stessa via di download dell'export XLSX). Conta come ultimo backup riuscito; non usa né avanza gli slot automatici.
- **Importa backup**: selettore di file `.json`. Al termine, riepilogo: "Importati 120 annunci nuovi, 34 aggiornati, 210 già presenti". In caso di errore, il messaggio della sezione 7.

### Limite noto

Un annuncio eliminato dopo la creazione di un backup ricompare se si reimporta quel backup. È la conseguenza dell'unione che non cancella mai nulla; l'agente può eliminarlo di nuovo.

### Permessi

Il manifest aggiunge `downloads` e `offscreen`. `downloads` mostra all'installazione l'avviso "Gestire i download". Per chi ha già l'estensione installata, Chrome la disattiva all'aggiornamento finché l'agente non accetta il nuovo permesso: prima del pilota non è un problema.

## 4. Formato del file

```json
{
  "format": "homeradar-backup",
  "formatVersion": 1,
  "createdAt": 1760428800000,
  "extensionVersion": "0.1.0",
  "settings": { "minAgeDays": 120, "minDropPercent": 0, "retentionDays": 90, "autoBackup": true, "enabledPortals": { "immobiliare": true, "idealista": true, "subito": true } },
  "listings": [ /* ListingRecord */ ],
  "priceSnapshots": [ /* PriceSnapshot senza id */ ],
  "leadStates": [ /* LeadState con updatedAt */ ],
  "calibration": [ /* CalibrationPoint */ ]
}
```

- `priceSnapshots` non contiene l'`id`: è una chiave locale autoincrementale del database.
- `settings` è assente se nel browser le impostazioni non sono mai state salvate.
- Il JSON è senza indentazione: il file può contenere migliaia di annunci.
- `formatVersion` cresce solo con cambi incompatibili del formato; l'importazione accetta le versioni fino a quella supportata.

## 5. Architettura

### `src/core/backup.ts` (puro)

- `BackupFileSchema`: schema zod del file. Ogni record è validato campo per campo (stessi tipi di `src/shared/types.ts`); i campi non dichiarati vengono scartati. `leadStates[].updatedAt` è facoltativo (in sua assenza vale `statusChangedAt`).
- `parseBackup(json: unknown): BackupFile`: valida e lancia errori con i messaggi della sezione 7.
- `buildBackup(data, now, extensionVersion): BackupFile`.
- `mergeBackup(current, incoming): { writes, summary }`: applica le regole della sezione 6 e restituisce i record da scrivere e i conteggi `{ added, updated, unchanged }` degli annunci.

### `src/core/auto-backup.ts`

- `isBackupDue(status, settings, listingCount, now): boolean`.
- `runAutoBackup(deps)`: dipendenze iniettate (`exportBackup`, `createBlobUrl`, `download`, `waitForDownload`, `recordBackup`, `recordFailure`). Sceglie lo slot, scarica, attende il completamento e registra l'esito. Testabile senza Chrome.

### `LeadService`

- `exportBackup(extensionVersion): Promise<BackupFile>`: legge tutte le tabelle in un'unica transazione di sola lettura.
- `importBackup(json: unknown): Promise<ImportSummary>`: `parseBackup`, poi `mergeBackup` e scrittura in **un'unica transazione** `rw` su `listings`, `priceSnapshots`, `leadStates`, `calibration`, `meta`. O tutto o niente.
- `backupStatus(): Promise<BackupStatus>`: `{ lastAt: number | null; lastAutoFailedAt: number | null; nextSlot: number }`, dal record `meta.backup`.
- `recordBackup(at, slotUsed?)`, `recordBackupFailure(at, message)`: aggiornano `meta.backup`; il fallimento va anche negli errori del diagnostico, senza dati degli annunci.
- `setLeadState` aggiorna `updatedAt` a ogni cambio di stato o di note; `ingest` crea i nuovi stati con `updatedAt = now`.

### Schema Dexie

`version(4)`: nessun nuovo indice; la migrazione imposta `updatedAt = statusChangedAt` su tutti i `leadStates` esistenti. `LeadState` in `src/shared/types.ts` aggiunge `updatedAt: number`.

### Impostazioni

`Settings` aggiunge `autoBackup: boolean`, default `true`; `validateSettings` lo verifica come booleano.

### Documento offscreen

`src/entrypoints/offscreen/` (pagina non elencata di WXT), creato con motivo `BLOBS`. Riceve il JSON del backup, crea un `Blob` e risponde con l'URL `blob:`. Il service worker non può creare URL `blob:`, e gli URL `data:` hanno un limite di circa 2 MB che un database grande supera. Il background chiude il documento offscreen al termine del download.

### Background

- Nuovo allarme `backup`, creato come `purge` (`periodInMinutes: 24 * 60`, primo controllo dopo pochi minuti dall'avvio). Al suono: `runAutoBackup` con le dipendenze reali (`chrome.offscreen`, `chrome.downloads.download` con `saveAs: false`, `chrome.downloads.onChanged`).
- Se `autoBackup` è spento l'allarme scatta ma `isBackupDue` restituisce `false`.

### Messaggi e router

- `{ type: 'exportBackup' }` → `BackupFile`; il router registra il backup manuale con `recordBackup(now)`.
- `{ type: 'importBackup'; backup: unknown }` → `ImportSummary`; poi `hooks.leadsChanged()`.
- `{ type: 'getBackupStatus' }` → `BackupStatus`.

### Pannello

`SettingsView` aggiunge il blocco "Backup"; `api.ts` aggiunge `exportBackup`, `importBackup`, `getBackupStatus`. Il file importato è letto nel pannello (`File.text()` e `JSON.parse`) e inviato al background; un JSON non leggibile dà subito il messaggio di file non valido.

## 6. Regole di unione

| Dato | Assente nel browser | Già presente |
|---|---|---|
| Annuncio (`listings`, chiave `key`) | aggiunto (`added`) | `firstSeenAt` = minimo, `lastSeenAt` e `seenCount` = massimo; gli altri campi dalla versione con `lastSeenAt` più alto (a parità, il browser). `updated` se cambia qualcosa, altrimenti `unchanged` |
| Storico prezzi | aggiunto | unione senza doppioni: uguali se coincidono `listingKey`, `at`, `price`, `source` |
| Stato del lead | aggiunto | vince l'`updatedAt` più alto; a parità resta il browser |
| Punto di calibrazione (`[portal+portalId]`) | aggiunto | resta il browser |
| Impostazioni | importate solo se `meta.settings` non esiste | non toccate |

- Stati e snapshot riferiti ad annunci assenti dal file vengono scartati.
- Un annuncio importato senza stato riceve lo stato `new` come in `ingest`.
- Un annuncio conta come `updated` anche se cambiano solo il suo stato o il suo storico prezzi.
- L'unione non applica la conservazione: gli annunci importati vecchi vengono valutati dalla pulizia periodica come gli altri.

## 7. Gestione degli errori

Principio: un'importazione fallita non cambia nulla; un backup automatico fallito non disturba l'agente.

| Caso | Comportamento |
|---|---|
| File non JSON o senza `format: "homeradar-backup"` | "Il file non è un backup di HomeRadar"; nessuna scrittura |
| `formatVersion` maggiore di quello supportato | "Backup creato da una versione più recente di HomeRadar: aggiorna l'estensione" |
| Record non conformi allo schema | Rifiuto dell'intero file: "Backup non valido (tabella annunci)", con il nome della prima tabella non valida |
| Errore Dexie o quota durante l'importazione | Transazione annullata, banner di errore del pannello, dati invariati |
| Backup automatico fallito (download interrotto, offscreen non disponibile) | `recordBackupFailure`, errore nel diagnostico, `lastAt` e slot invariati, nuovo tentativo al prossimo allarme; nelle impostazioni "Ultimo backup automatico non riuscito" |
| Esportazione manuale fallita | Messaggio di errore nelle impostazioni; ultimo backup invariato |

## 8. Strategia di test

1. **Unit `backup.ts`:** schema (campi estranei scartati, versione futura rifiutata, `format` errato, tabella non valida con il suo nome, `updatedAt` mancante); `mergeBackup` a tabella di casi, una riga per ogni regola della sezione 6 compresi parità, orfani, snapshot doppi e impostazioni.
2. **Unit `auto-backup.ts`:** `isBackupDue` (mai fatto, meno di 7 giorni, più di 7 giorni, database vuoto, `autoBackup` spento); rotazione 1→2→3→4→1; slot e `lastAt` aggiornati solo a download completato; fallimento registrato.
3. **Integrazione `LeadService` (fake-indexeddb):** esporta → svuota → importa dà un database equivalente; unione su database non vuoto; transazione annullata su errore di scrittura; migrazione `version(4)`; `setLeadState` aggiorna `updatedAt`.
4. **Router:** `exportBackup` registra il backup, `importBackup` emette `leadsChanged`, `getBackupStatus`.
5. **E2E (Playwright):** dalle impostazioni, esporta backup, elimina tutti i lead, importa il file: i lead tornano con stati e note.
6. **Smoke test manuale** (aggiunto a `docs/smoke-test.md`): backup automatico reale in `Download/HomeRadar/`; comportamento con l'opzione di Chrome "Chiedi dove salvare ogni file" attiva; importazione su un profilo Chrome pulito.

## 9. Rischi noti

| Rischio | Mitigazione |
|---|---|
| Con "Chiedi dove salvare ogni file" attivo Chrome potrebbe aprire la finestra di salvataggio a ogni backup automatico | Verifica nello smoke test; se accade, indicazione nell'onboarding (punto 2 della roadmap) |
| Il nuovo permesso `downloads` disattiva l'estensione già installata all'aggiornamento | Rilascio prima del pilota; nessun utente esistente |
| Annunci eliminati ricompaiono reimportando un backup vecchio | Limite dichiarato; riepilogo dell'importazione visibile |
| Il file di backup contiene indirizzi e note | Resta sul PC dell'agente; dichiarato nell'informativa |
