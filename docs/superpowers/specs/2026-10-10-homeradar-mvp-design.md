# HomeRadar — Specifica di design MVP

- **Data:** 2026-10-10
- **Stato:** in revisione
- **Ambito:** MVP per pilota gratuito, solo Immobiliare.it

## 1. Obiettivo

Le agenzie immobiliari cercano nuovi mandati tra gli annunci dei **privati** che restano online a lungo senza vendere o che abbassano il prezzo. Oggi l'agente lo verifica a mano, annuncio per annuncio.

HomeRadar è un'estensione Chrome che, **mentre l'agente naviga Immobiliare.it**, riconosce gli annunci di privati, ne costruisce lo storico prezzi in locale, evidenzia quelli "maturi" e permette di gestirli come lead ed esportarli in Excel/CSV.

### Obiettivo dell'MVP

Validare l'utilità del tool con **3–5 agenzie pilota**, gratuitamente. Successo: gli agenti del pilota trovano più annunci "maturi" in meno tempo rispetto al lavoro manuale e continuano a usare il tool dopo le prime settimane.

### Utente

Il singolo agente immobiliare, sul proprio browser. Nessuna condivisione dei dati tra colleghi nell'MVP.

## 2. Ambito

### Dentro l'MVP

- Un solo portale: **Immobiliare.it**, sezione vendita
- Lettura passiva delle pagine aperte dall'agente: **risultati di ricerca** e **dettaglio annuncio**
- Riconoscimento del venditore privato, stima e misura dell'anzianità, rilevamento dei ribassi
- Badge sulle card dei risultati
- Pannello laterale con lista lead, stati, note, storico prezzi
- Export **XLSX** e **CSV**
- Impostazioni: soglia giorni, ribasso minimo
- Report diagnostico copiabile per il pilota

### Fuori dall'MVP (previsto dall'architettura)

- Altri portali (es. Idealista): nuovo adattatore
- "Aggiorna le mie ricerche" assistito: da valutare **dopo parere legale**
- Rilevamento ripubblicazioni e prezzo fuori mercato
- Sincronizzazione Google Sheets / CRM, backend, condivisione in agenzia
- Licenze, pagamenti, account, scheda pubblica sul Chrome Web Store

### Esclusi in ogni fase

- Crawling automatico o pianificato in background
- Chiamate alle API del portale fatte dall'estensione (si leggono solo le risposte delle richieste che il sito fa già da sé)
- Raccolta automatica di dati personali del venditore (nome, telefono)

## 3. Vincoli legali e privacy

Il rischio principale del progetto è legale, non tecnico. Le scelte che lo riducono:

- **Avviata dall'utente:** l'estensione elabora solo pagine che l'agente apre di sua iniziativa.
- **Solo locale:** i dati restano nell'IndexedDB del browser dell'agente; nessun server.
- **Minimizzazione:** si salvano solo annunci di privati; l'adattatore copia solo campi in lista di ammissione. **Telefoni e nomi presenti nel JSON del portale vengono scartati.**
- **Note libere:** l'agente può annotare a mano ciò che vuole; la responsabilità del dato inserito è sua.
- **Indirizzo completo** (via e civico) salvato: è pubblico nell'annuncio e utile all'agente; va dichiarato nell'informativa.
- **Conservazione:** annunci non rivisti da 90 giorni e rimasti in stato "nuovo" vengono cancellati automaticamente.
- **Da fare prima di un lancio commerciale:** parere legale su termini d'uso del portale, diritto sui generis sulle banche dati (Direttiva 96/9/CE), GDPR e contatto commerciale dei privati (incluso Registro delle Opposizioni), policy del Chrome Web Store. Informativa privacy per gli utenti del pilota.

## 4. Dati disponibili su Immobiliare.it (verificati il 2026-10-10)

Il sito è un'applicazione Next.js: i dati sono in `<script id="__NEXT_DATA__">` come JSON.

| Dato | Risultati di ricerca | Dettaglio annuncio |
|---|---|---|
| ID, prezzo, m², locali, tipologia, zona | ✅ | ✅ |
| Privato / agenzia | ✅ | ✅ |
| Ultimo ribasso (prezzo originale, attuale, %, data) | ✅ | ✅ |
| Data di creazione / aggiornamento | ❌ | ✅ |
| Storico prezzi completo | ❌ | ❌ |

Percorsi e regole:

- **Risultati:** `props.pageProps.dehydratedState.queries[0].state.data.results[]` (25 per pagina); ogni elemento ha `realEstate` con `id`, `price`, `properties[0]`, `advertiser`.
- **Dettaglio** (`/annunci/{id}/`): `props.pageProps.detailData.realEstate`, con `createdAt` e `updatedAt` in secondi Unix.
- **Privato:** `advertiser.agency` assente e `advertiser.supervisor.type === "user"`. Agenzie: `advertiser.agency.type` = `"agency"` o `"constructor"`.
- **Ribasso:** `price.loweredPrice` = `{ originalPrice, currentPrice, discountPercentage, priceDecreasedBy, date: "gg/mm/aaaa", passedDays }`. Prezzi e percentuale sono stringhe formattate (`"€ 249.000"`, `"5,6"`) da convertire. Contiene **solo l'ultimo ribasso**.
- **`/da-privati/` è un ordinamento, non un filtro:** prima i privati, poi le agenzie. Il riconoscimento va fatto annuncio per annuncio.
- **ID crescenti nel tempo:** l'ID dell'annuncio cresce con la data di creazione, quindi permette di stimare l'età dai soli risultati di ricerca.
- **Navigazione interna:** cambiando filtro, ordinamento o pagina il sito non ricarica la pagina; `__NEXT_DATA__` resta quello iniziale. I nuovi risultati arrivano da una XHR a `/api-next/search-list/listings/`.

**Rischio noto non verificato:** non sappiamo se `createdAt` si azzera quando un privato toglie e ripubblica l'annuncio. In quel caso l'età risulterebbe sottostimata.

## 5. Architettura

Approccio: **lettura del JSON + intercettazione delle risposte del sito**, con **modalità di riserva** automatica (sola lettura al caricamento + invito a ricaricare).

```
 Pagina Immobiliare.it
 ┌───────────────────────────────────────────┐
 │ ① Ponte pagina (MAIN world)               │  __NEXT_DATA__ al caricamento +
 │                                           │  risposte XHR /api-next/search-list/...
 └──────────────┬────────────────────────────┘
                │ JSON grezzo (window.postMessage)
 ┌──────────────▼────────────────────────────┐
 │ ② Content script (ISOLATED world)         │
 │    → ③ Adattatore Immobiliare             │  JSON → osservazioni normalizzate
 │    ← disegna i badge sulle card           │
 └──────────────┬────────────────────────────┘
                │ osservazioni (runtime messaging)
 ┌──────────────▼────────────────────────────┐
 │ ④ Background (service worker)             │  unico scrittore del DB
 │    → ⑤ Motore regole lead                 │
 │    → IndexedDB (Dexie)                    │
 └──────────────┬────────────────────────────┘
 ┌──────────────▼────────────────────────────┐
 │ ⑥ Pannello laterale (React)               │  lista lead, stati, note,
 │                                           │  impostazioni, export
 └───────────────────────────────────────────┘
```

### Componenti

1. **Ponte pagina** (MAIN world): unico codice che gira nel contesto del sito. Legge `__NEXT_DATA__` al caricamento e intercetta le risposte XHR/fetch degli URL noti, inoltrando il JSON grezzo al content script. Nessuna logica di business; non effettua mai richieste proprie.
2. **Content script**: riceve i payload, li passa all'adattatore, invia le osservazioni al background, riceve le valutazioni e disegna i badge abbinando le card tramite i link `/annunci/{id}/`. Rileva il cambio di rotta senza payload intercettato e attiva la modalità di riserva.
3. **Adattatore Immobiliare**: funzioni pure. Riconosce il tipo di pagina, valida il JSON con schemi **zod**, produce oggetti normalizzati copiando **solo campi ammessi**. Interfaccia comune `PortalAdapter`, per aggiungere portali senza toccare il resto.
4. **Background**: unico punto di scrittura su IndexedDB (evita conflitti tra schede). Applica le osservazioni, aggiunge snapshot, ricalcola i lead, esegue la pulizia periodica, serve i dati al pannello.
5. **Motore regole**: funzione pura `(annuncio, storico, impostazioni, oggi) → { priorità, motivi }`.
6. **Pannello laterale** (React, Side Panel API): lista lead per stato, note, storico, impostazioni, export, report diagnostico.

### Stack

WXT (Manifest V3) · TypeScript · React · Dexie (IndexedDB) · zod · SheetJS (XLSX) · Vitest · fake-indexeddb · Playwright.

## 6. Modello dati

### `listings`: solo annunci di privati

| Campo | Descrizione |
|---|---|
| `key` | `"immobiliare:<id>"` (portale + ID) |
| `portal`, `portalId`, `url` | identificazione |
| `title`, `address`, `city`, `zone` | indirizzo completo incluso |
| `typology`, `surfaceM2`, `rooms` | dati dell'immobile |
| `currentPrice` | ultimo prezzo osservato (numero, euro) |
| `portalCreatedAt` | data di creazione reale (da dettaglio), altrimenti `null` |
| `estimatedCreatedAt` | data stimata dall'ID |
| `lastDrop` | `{ fromPrice, toPrice, percent, date }` dichiarato dal portale, oppure `null` |
| `firstSeenAt`, `lastSeenAt`, `seenCount` | osservazioni dell'agente |

### `priceSnapshots`: storico prezzi

- `{ listingKey, price, at, source: "observed" | "declared" }`
- Un record alla prima osservazione e poi **solo quando il prezzo cambia**.
- Se il portale dichiara un ribasso, si registrano snapshot `declared`: prezzo originale (data sconosciuta, prima del ribasso) e prezzo attuale alla data del ribasso.

### `leadStates`: lavoro dell'agente

- `{ listingKey, status: "new" | "to_contact" | "contacted" | "discarded", notes, statusChangedAt }`
- Separata dai dati calcolati: i ricalcoli non toccano mai stato e note.

### `settings`

- `minAgeDays` (predefinito 120), `minDropPercent` (predefinito 0, cioè qualsiasi ribasso), `retentionDays` (90).

### `idCalibration`

- Coppie `{ portalId, createdAt }` raccolte dalle pagine di dettaglio. La stima dell'età interpola linearmente tra le coppie più vicine. Si parte con coppie predefinite ricavate dalla verifica del 2026-10-10: `128416572 → 2026-04-20`, `131597836 → 2026-08-06`, `133428292 → 2026-10-10`. Fuori dall'intervallo calibrato si estrapola dalle due coppie più vicine.

### Conservazione

Alla pulizia periodica si eliminano gli annunci (con snapshot) con `lastSeenAt` più vecchio di `retentionDays` e stato `new`. Gli altri restano finché l'agente non li elimina.

## 7. Regole dei lead

**Requisito:** venditore privato. Agenzie e costruttori non sono mai valutati.

**Segnale A, anzianità:** `età = oggi − (portalCreatedAt ?? estimatedCreatedAt)`; attivo se `età ≥ minAgeDays`.
- Data reale: motivo "Online da 173 gg".
- Data stimata: "Online da ~170 gg".
- Se l'età è **stimata** e cade nell'intervallo `[minAgeDays − 15, minAgeDays + 15)`, il segnale A è **incerto**: non conta come attivo e l'annuncio è marcato **"da verificare"**, che invita ad aprire il dettaglio. Sopra `minAgeDays + 15` la stima attiva A normalmente.

**Segnale B, ribassi:** `calo = (prezzo massimo noto − prezzo attuale) / prezzo massimo noto`, dove il massimo considera snapshot osservati e dichiarati; attivo se `calo > 0` e `calo ≥ minDropPercent`.
- Motivo: "Ribassato del 5,6% (249.000 → 235.000 €) il 21/09".
- Più ribassi osservati: "2 ribassi, −9,2% totale".

**Priorità:** lead se **A oppure B**.

| Condizione | Priorità | Badge |
|---|---|---|
| A e B | Alta (rosso) | `● Alta · 173 gg · −5,6%` |
| solo A o solo B | Media (arancio) | `● Media · ~170 gg` |
| A incerto, senza B | Da verificare (blu) | `◐ Da verificare · ~112 gg` |
| A incerto, con B | Media (arancio), con indicazione "età da verificare" | `● Media · ~125 gg · −3%` |
| privato senza segnali | nessuna (grigio) | `Privato · 45 gg` |
| agenzia | — | nessun badge |

**Ordinamento nel pannello:** priorità, poi età decrescente.

**Ricalcolo:** a ogni nuova osservazione, al cambio delle impostazioni e all'apertura del pannello (l'età cresce anche senza nuove visite).

## 8. Interfaccia

- **Badge sulle card:** sovrapposto all'angolo in alto a sinistra della foto. Nessuna azione sulla card; lo stato si gestisce dal pannello.
- **Pannello laterale:**
  - schede per stato: Nuovi, Da contattare, Contattati, Scartati, con conteggi
  - per ogni lead: priorità, titolo e prezzo, motivi, numero di visite, mini-grafico dello storico prezzi, selettore dello stato, campo note, link all'annuncio
  - in fondo: **Esporta XLSX** e **CSV** della vista corrente
  - Impostazioni: soglie, conservazione, "Copia report diagnostico"
- **Icona estensione:** indicatore di avviso quando l'adattatore rileva dati non riconosciuti.

### Colonne dell'export

Priorità · Stato · Indirizzo · Città/Zona · Tipologia · m² · Locali · Prezzo attuale · Prezzo massimo noto · Calo % · Data ultimo ribasso · Online da (giorni) · Età stimata (sì/no) · Prima visita · Ultima visita · Note · URL.

## 9. Gestione errori

Principio: **meglio nessun badge che un badge sbagliato.**

| Caso | Comportamento |
|---|---|
| JSON non conforme allo schema | Dato scartato, nessun badge, avviso sull'icona e banner "Immobiliare.it potrebbe essere cambiato"; errore registrato nel diagnostico |
| Cambio rotta senza risposta intercettata entro pochi secondi | Modalità di riserva: banner "Ricarica la pagina per analizzare questi risultati" |
| Card senza ID abbinabile | Ignorata |
| Errore IndexedDB / quota | Banner nel pannello; export sempre disponibile |
| Service worker inattivo | Riattivato dai messaggi; un nuovo tentativo dal content script |

**Report diagnostico:** versione, contatori d'uso, ultimi errori. **Nessun dato degli annunci.**

## 10. Strategia di test

1. **Unit (Vitest):**
   - adattatore su fixture JSON reali, **ripulite da telefoni e nomi prima del commit**
   - motore regole a tabella di casi
   - stima dell'età da ID
   - logica degli snapshot
   - mappatura delle colonne di export
2. **Integrazione:** background + Dexie con `fake-indexeddb`.
3. **End-to-end (Playwright):** estensione caricata su pagine fixture servite in locale, mai sul sito reale, per badge, pannello ed export.
4. **Smoke test manuale** sul sito reale prima di ogni rilascio al pilota: ricerca, cambio filtro, dettaglio, export.

## 11. Distribuzione del pilota

Installazione **non in elenco** (unlisted) sul Chrome Web Store, oppure pacchetto da caricare manualmente. Nessun account né licenza.

## 12. Rischi noti

| Rischio | Mitigazione |
|---|---|
| Contestazione legale del portale | Uso avviato dall'utente, solo locale, minimizzazione; parere legale prima del lancio commerciale |
| Cambi di struttura del portale | Adattatore isolato, schemi zod, fixture, modalità di riserva, avviso visibile |
| `createdAt` azzerato alla ripubblicazione | Accettato per l'MVP; il rilevamento delle ripubblicazioni è previsto dopo |
| Stima dell'età imprecisa | Indicata con "~" e stato "da verificare"; calibrazione continua dai dettagli aperti |
| Scarso uso nel pilota → storico povero | Il ribasso dichiarato dal portale dà valore fin dal primo giorno |
