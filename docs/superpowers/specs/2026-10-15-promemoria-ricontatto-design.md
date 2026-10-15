# HomeRadar — Specifica di design: promemoria di ricontatto

- **Data:** 2026-10-15
- **Stato:** in revisione
- **Ambito:** punto 4 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`

## 1. Obiettivo

Lo stato "Contattato" non dice quando richiamare. L'agente deve poter fissare un giorno di ricontatto su un lead e, aprendo il browser, sapere subito chi va richiamato oggi.

Successo: guardando l'icona dell'estensione l'agente vede quanti richiami ha da fare oggi (o in ritardo); aprendo il pannello li trova in una scheda dedicata, in ordine di data, e li chiude o li sposta con un clic.

## 2. Ambito

### Dentro

- Data di ricontatto (solo giorno) su un lead, con scorciatoie "Domani", "Tra 3 giorni", "Tra 1 settimana", "Tra 1 mese".
- Pulsante "Fatto" che chiude il richiamo; "Sposta…" per cambiarne la data.
- Scheda "Richiami" nel pannello, con i richiami scaduti, di oggi e futuri.
- Ordinamento "Richiamo più vicino" nelle altre schede.
- Numero dei richiami da fare sull'icona dell'estensione, aggiornato anche a mezzanotte.
- Richiamo nel backup e colonna "Richiamo" nell'export.
- Informativa aggiornata (`ONBOARDING_VERSION` 2).

### Fuori

- Notifiche di sistema di Chrome (nuovo permesso, più invadenti): basta il numero sull'icona.
- Orario del richiamo: l'agente ragiona per giorni.
- Richiami ricorrenti e storico dei richiami fatti.

### Vincoli

- Tutto in locale; nessun permesso nuovo (`alarms` c'è già).
- Schema Dexie cambiato solo con una nuova `version(5)`.

## 3. Dato e schema

`LeadState` riceve:

```ts
/** Giorno del ricontatto: mezzanotte locale in ms epoch; null se non c'è un richiamo. */
recallAt: number | null;
```

Dexie `version(5)`: `leadStates: 'listingKey, status, recallAt'`. La migrazione imposta `recallAt = null` sui record esistenti senza toccare `updatedAt`. I record con `null` non entrano nell'indice (comportamento di IndexedDB), quindi l'indice contiene solo i lead con un richiamo.

Lo stato di default di un lead senza record (`LeadService.listLeads`) e quello creato dall'importazione per un annuncio nuovo hanno `recallAt: null`.

## 4. Logica pura: `src/core/recall.ts`

- `startOfLocalDay(ms: number): number` — mezzanotte locale del giorno di `ms`.
- `addDays(dayMs: number, n: number): number` — somma giorni di calendario (via `Date#setDate`), così il cambio dell'ora legale non sposta la data.
- `recallStatus(recallAt: number | null, now: number): { kind: 'overdue' | 'today' | 'upcoming'; days: number } | null` — `days` è la distanza in giorni di calendario (positiva) da oggi; `null` se non c'è richiamo.
- `isDue(recallAt: number | null, now: number): boolean` — vero per oggi o un giorno passato.
- `RECALL_SHORTCUTS: { label: string; days: number }[]` — Domani (1), Tra 3 giorni (3), Tra 1 settimana (7), Tra 1 mese (30).
- `formatRecallDate(dayMs)` — "gio 17 ott" per l'etichetta; `recallLabel(status)` — "scaduto da 2 giorni", "scaduto ieri", "oggi", "domani", "tra 3 giorni".

## 5. Regole nel servizio

`LeadService.setLeadState(key, patch)` accetta anche `recallAt?: number | null`. Un valore numerico viene normalizzato con `startOfLocalDay`. Le regole, applicate in quest'ordine dopo il cambio di stato:

1. Se lo stato risultante è "Scartato", `recallAt` diventa `null` (anche se il lead aveva un richiamo).
2. Un `recallAt` numerico chiesto insieme a, o su, un lead "Scartato" è un errore: `Impossibile impostare un richiamo su un lead scartato`.
3. Un `recallAt` numerico su un lead "Nuovo" lo porta a "Da contattare" (aggiorna `statusChangedAt`). Così un lead con un richiamo non è mai "Nuovo" e la pulizia automatica, che elimina solo i "Nuovo" non visti da tempo, non lo tocca.
4. Ogni cambio effettivo di `recallAt` aggiorna `updatedAt`, così all'importazione di un backup il richiamo segue la regola "vince il lead modificato più di recente".

"Fatto" è `recallAt: null`.

`LeadService.dueRecallCount(now)`: conta via indice i record con `recallAt < addDays(startOfLocalDay(now), 1)`, escludendo per sicurezza quelli "Scartato".

`purge` salta anche i lead con un richiamo: un lead rimesso a mano su "Nuovo" conserva il richiamo e non viene cancellato.

## 6. Messaggi

`setLeadState` in `src/shared/messages.ts`, il router e `api.ts` accettano anche `recallAt?: number | null`. Dopo `setLeadState` il router chiama il nuovo hook `recallsChanged()`, che nel background aggiorna il segnale sull'icona (il pannello si aggiorna già da sé). Anche `leadsChanged()`, chiamato dopo eliminazioni e importazione, aggiorna il segnale.

## 7. Icona dell'estensione

`actionBadge` (`src/core/action-badge.ts`) riceve anche `due: number`. Precedenza:

1. informativa da confermare → "●" (colore del marchio), come oggi;
2. `due > 0` → il numero (`99+` oltre 99) su `RECALL_COLOR = '#dc2626'`; titolo "HomeRadar: 3 richiami da fare" (1: "1 richiamo da fare"), con in coda " · un portale ha cambiato struttura, vedi il pannello" se c'è anche l'avviso;
3. avviso dei portali → "!" (arancione), come oggi;
4. nessun segnale.

Nel background, `refreshActionBadge` legge anche `service.dueRecallCount(Date.now())` e viene chiamata:

- all'avvio del worker (come oggi);
- su `hooks.leadsChanged` (nuovo) oltre che su avviso e informativa;
- dall'allarme `recall`, creato per scattare alla prossima mezzanotte locale + 1 minuto (`when`, non periodico). A ogni scatto aggiorna il segnale e ricrea l'allarme sulla mezzanotte successiva, così resta allineato anche al cambio dell'ora legale. All'avvio del worker l'allarme si crea se manca. Se il PC dormiva, Chrome fa scattare l'allarme al risveglio.

## 8. Pannello

### Schede

Il tipo della scheda diventa `Tab = 'recall' | LeadStatus`. "Richiami" è la prima a sinistra. Il contatore della scheda mostra i richiami da fare (oggi o scaduti) in rosso se sono più di zero, altrimenti il numero totale dei richiami in grigio. All'apertura il pannello parte da "Richiami" se ci sono richiami da fare, altrimenti da "Nuovo" come oggi.

### Scheda "Richiami"

- Contiene tutti i lead con `recallAt`, di qualsiasi stato, raggruppati sotto le intestazioni **Scaduti**, **Oggi**, **Prossimi** (un gruppo vuoto non si mostra). In ogni gruppo l'ordine è per data e, a parità, per priorità.
- Ricerca, fascia di prezzo, badge e sito filtrano anche qui; l'export esporta la vista corrente.
- Nascosti: il menu "Ordina per" (l'ordine per data è il senso della scheda) ed "Elimina tutti" (cancellerebbe lead di stati diversi).
- Vuota: "Nessun richiamo. Imposta una data di ricontatto su un lead con «Richiama…»." (con filtri attivi, il solito "Nessun lead «…» in questa scheda").

### Altre schede

Nuovo criterio d'ordinamento `recall` "Richiamo più vicino" in `SORT_KEYS` (`src/core/leads.ts`): crescente per `recallAt`, i lead senza richiamo in fondo.

### Riga del richiamo in `LeadItem`

Non compare sui lead "Scartato".

- **Senza richiamo:** pulsante piccolo "Richiama…" che apre una riga con un `<input type="date">` e le quattro scorciatoie. Scegliere una data o una scorciatoia salva subito e chiude la riga.
- **Con richiamo:** etichetta "Richiamo gio 17 ott · scaduto da 2 giorni" (rossa), "· oggi" (ambra), "· tra 3 giorni" (neutra); accanto i pulsanti **"Fatto"** e **"Sposta…"**, che apre la stessa riga di data e scorciatoie.
- La card di un lead con richiamo scaduto ha il bordo sinistro rosso, con precedenza sul colore della priorità.

Il pannello manda il giorno scelto come mezzanotte locale (`startOfLocalDay` / `addDays` da oggi); il servizio lo normalizza comunque.

## 9. Backup ed export

- `LeadStateSchema` in `src/core/backup.ts`: `recallAt: num.nullable().optional()`, trasformato in `null` se manca. I backup già fatti restano importabili. `BACKUP_FORMAT_VERSION` non cambia: l'aggiunta è compatibile; una build precedente che importasse un backup nuovo scarterebbe solo il richiamo (nessuna build precedente è in uso).
- Un lead "Scartato" letto dal file non porta un richiamo (`recallAt` diventa `null`).
- L'unione non cambia: vince l'`updatedAt` più recente, che il richiamo aggiorna (regola 4).
- Export XLSX/CSV: colonna "Richiamo" dopo "Stato", data `gg/mm/aaaa`, vuota se non c'è richiamo.

## 10. Informativa

- `ONBOARDING_VERSION = 2`.
- `ONBOARDING_CHANGES[2]`: "HomeRadar ora salva la data di ricontatto che imposti su un lead: resta sul tuo browser, come stati e note."
- Nella sezione "cosa salva": aggiungere le date di ricontatto accanto a stati e note.
- Nella legenda: il numero rosso sull'icona indica i richiami da fare oggi o in ritardo.

## 11. Test

Vitest:

- `recall.ts`: `startOfLocalDay`, `addDays` a cavallo del cambio dell'ora legale (con `TZ=Europe/Rome`), `recallStatus` per scaduto/oggi/futuro e i giorni, `isDue`, `recallLabel`.
- `service`: le quattro regole di §5; `dueRecallCount` (oggi, ieri, domani, scartato escluso); migrazione v4 → v5 su fake-indexeddb (record esistenti con `recallAt: null` e `updatedAt` invariato); `purge` non elimina un lead con richiamo.
- `action-badge`: precedenze, `99+`, singolare/plurale e coda dell'avviso nel titolo.
- `backup`: file senza `recallAt` → `null`; andata e ritorno con un richiamo; unione con `updatedAt`.
- `export`: colonna "Richiamo".
- `leads`: ordinamento `recall`; raggruppamento Scaduti/Oggi/Prossimi.

Smoke test manuali da aggiungere a `docs/smoke-test.md`: impostare un richiamo con una scorciatoia e con il calendario; un lead "Nuovo" passa a "Da contattare"; numero sull'icona con un richiamo di oggi; "Fatto" e "Sposta…"; passaggio a "Scartato" che toglie il richiamo; riconferma dell'informativa dopo l'aggiornamento; backup e ripristino con un richiamo.
