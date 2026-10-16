# HomeRadar — Specifica di design: stesso immobile su più portali

- **Data:** 2026-10-16
- **Stato:** in revisione
- **Ambito:** punto 6 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`, `2026-10-16-prezzo-zona-design.md`

## 1. Obiettivo

Un privato pubblica spesso la stessa casa su Immobiliare, Idealista e Subito. Oggi diventano tre lead separati: l'agente la vede tre volte, rischia di contattare due volte lo stesso venditore e la mediana di zona del punto 5 la conta più volte.

HomeRadar riconosce da solo gli annunci di portali diversi che descrivono lo stesso immobile e li mostra come un solo lead con più fonti, l'età più vecchia e l'etichetta "Su N portali", che è anche un segnale di motivazione del venditore. Se sbaglia, l'agente separa il gruppo con un clic e quella coppia non viene più unita.

Successo: lo stesso immobile visto su due o tre portali compare una volta sola nel pannello, con stato e note condivisi; sulle card dei portali il badge mostra l'età del gruppo (su Idealista e Subito, l'età vera presa da Immobiliare quando c'è); un'unione sbagliata si annulla senza perdere nulla.

## 2. Ambito

### Dentro

- Riconoscimento automatico, con tolleranze strette, degli annunci di portali diversi che descrivono lo stesso immobile.
- Lead unito nel pannello: più fonti, età più vecchia, priorità del gruppo, stato e note condivisi.
- Separazione di un annuncio dal gruppo, ricordata per sempre.
- Badge delle card dei portali calcolato sul gruppo, con "· N portali".
- Mediana di zona del punto 5 senza doppioni.
- Filtro "Su più portali", export con una riga per lead unito, informativa aggiornata.

### Fuori

- Annunci dello stesso portale (ripubblicazioni): punto 7.
- Unione manuale di due lead che l'estensione non ha riconosciuto.
- Effetto della presenza su più portali sulla priorità: è un'etichetta, le regole di priorità non cambiano.
- Confronto per zona, tipologia o indirizzo: i portali li scrivono in modo diverso.

### Vincoli

- Nessuna richiesta verso i portali; nessun dato nuovo letto dai portali.
- I gruppi si calcolano in memoria a ogni lettura, come la mediana di zona: nessun identificativo di gruppo salvato. Si salvano solo le coppie separate dall'agente.
- Stato, note e richiamo restano salvati per singolo annuncio: il formato dei record esistenti non cambia.

## 3. Comportamento per l'agente

- Nel pannello, l'immobile pubblicato su Immobiliare e Idealista compare una volta, con le etichette "Immobiliare · Idealista" e la pillola "Su 2 portali".
- Sotto il lead, l'elenco **Fonti** (chiuso di default) mostra una riga per portale con prezzo, m², età ("~" se stimata), link "Apri" e pulsante **"Separa"**.
- Cambiare stato, note o richiamo sul lead unito vale per tutte le fonti.
- Eliminare il lead unito elimina tutte le sue fonti; la conferma dice quante sono.
- "Separa" stacca quella fonte dal gruppo: torna un lead a sé, con una copia di stato, note e richiamo del gruppo. Le due non si riuniranno più.
- Sulla card di Idealista di un immobile già visto su Immobiliare, il badge mostra l'età e la priorità del gruppo e finisce con "· 2 portali".

## 4. Riconoscimento (`src/core/same-property.ts`)

Modulo puro, senza accesso al database.

### 4.1 Candidati

Entrano nel confronto solo gli annunci con città, m² e prezzo. Gli altri restano lead a sé. Gli annunci si dividono per città normalizzata (`normalize` di `lead-filters.ts`); si confrontano solo quelli della stessa città.

### 4.2 Coppia compatibile

Due annunci `a` e `b` sono compatibili se valgono tutte:

| Criterio | Regola |
|---|---|
| Portale | diverso |
| m² | `|a − b| ≤ max(3, 5% del minore)` |
| Prezzo | `|a − b| ≤ 5% del minore` |
| Locali | uguali, oppure mancanti su almeno uno dei due |
| Separazione | la coppia non è tra quelle separate dall'agente |

Le soglie sono costanti esportate (`SURFACE_TOLERANCE_PERCENT = 5`, `SURFACE_TOLERANCE_M2 = 3`, `PRICE_TOLERANCE_PERCENT = 5`).

### 4.3 Gruppo

Dalle coppie compatibili si ricavano le componenti connesse. Una componente è un gruppo valido se:

1. ha al massimo un annuncio per portale (quindi 2 o 3 annunci);
2. ogni coppia al suo interno è compatibile (non basta un collegamento a catena).

Se una componente non è valida, i suoi annunci restano tutti lead a sé: nel dubbio non si unisce. Esempio: un annuncio Immobiliare compatibile con due annunci Idealista.

Il risultato non dipende dall'ordine degli annunci in ingresso.

### 4.4 Interfaccia

```ts
export interface SplitPair { a: string; b: string; at: number } // a < b, chiavi di listing
export function splitPair(x: string, y: string, at: number): SplitPair;
/** Gruppi di 2–3 chiavi; gli annunci che restano soli non compaiono. */
export function groupListings(listings: ListingRecord[], splits: SplitPair[]): string[][];
```

## 5. Dati

### 5.1 Coppie separate

Nuova tabella Dexie `splits` in `version(6)`: chiave `[a+b]`, indici `a` e `b` (per cancellare le coppie di un annuncio). Nessuna migrazione dei dati esistenti.

- "Separa" di un annuncio `k` da un gruppo salva una coppia tra `k` e ciascun altro membro.
- Eliminazione di annunci (singola, "Elimina tutti", pulizia automatica): si cancellano anche le coppie che li contengono.

### 5.2 Backup

- Il file contiene il nuovo campo facoltativo `splits` (schema zod `{ a, b, at }`, chiavi stringa, `at` numero).
- Importazione: le coppie si uniscono a quelle presenti, senza cancellare nulla; una coppia già presente resta com'è.
- `BACKUP_FORMAT_VERSION` resta 1: il campo è aggiunto e facoltativo, un file senza `splits` resta valido e una versione precedente lo scarta.

## 6. Lead unito

### 6.1 `LeadView`

```ts
export interface LeadSource {
  listing: ListingRecord;
  evaluation: Evaluation;
  prices: PriceSnapshot[];
}

export interface LeadView {
  listing: ListingRecord;     // annuncio principale
  evaluation: Evaluation;     // del gruppo
  state: LeadState;           // del gruppo
  prices: PriceSnapshot[];    // del principale
  market: MarketComparison | null;
  others: LeadSource[];       // le altre fonti del gruppo, senza il principale; vuoto se non c'è gruppo
}
```

Il codice che legge `listing` continua a funzionare. Le chiavi del gruppo sono `[listing.key, ...others.map((o) => o.listing.key)]` (helper `leadKeys` in `leads.ts`, insieme a `leadPortals`). `Evaluation` non cambia forma.

La costruzione dei lead (valutazioni, gruppi, principale, stato del gruppo, mercato) passa in un modulo puro `src/core/lead-groups.ts`; `listLeads` legge il database e lo chiama.

### 6.2 Principale

Il membro con la priorità più alta; a parità quello con l'età maggiore; poi quello visto più di recente (`lastSeenAt`); poi la chiave in ordine alfabetico. Titolo, indirizzo, prezzo e link del lead sono i suoi.

### 6.3 Valutazione del gruppo

Nuova funzione pura `evaluateGroup` in `rules.ts`, con le regole di priorità di oggi applicate ai fatti del gruppo:

- **Età:** quella del membro più vecchio tra quelli con il segnale A (se nessuno lo ha, del membro più vecchio), con il suo `ageEstimated` e `ageUncertain`.
- **Segnale A (anzianità):** presente se lo è su almeno un membro.
- **Segnale B (ribasso):** presente se lo è su almeno un membro; `dropPercent`, `dropCount` e `maxKnownPrice` vengono dal membro con il ribasso maggiore.
- **Priorità:** Alta con A e B, Media con uno dei due, Da verificare/Età incerta se nessuno dei due e l'età del gruppo è incerta, altrimenti nessuna. Un'età vecchia su Idealista e un ribasso su Immobiliare fanno quindi un lead Alta.
- **Motivi:** composti come oggi dall'età e dal ribasso scelti.
- **Badge:** come oggi, più `· N portali` in fondo.

Per farlo, `evaluate` si divide in funzioni interne (fatti dell'età, fatti del ribasso, composizione di priorità, motivi e badge) e `evaluateGroup(target, members, settings, now)` riceve annunci e storici dei membri e riusa le stesse funzioni. L'età del gruppo è quella del membro più vecchio tra quelli con il segnale A; se nessuno lo ha, del membro più vecchio. Per un lead senza gruppo `evaluateGroup` non si chiama e nulla cambia.

### 6.4 Stato del gruppo

- **Stato, richiamo e date:** quelli del membro *lavorato* (stato diverso da "Nuovo", note o richiamo) con `updatedAt` più recente; se nessuno è lavorato, del più recente. Un gemello visto per la prima volta dopo il lavoro dell'agente ha uno stato "Nuovo" più recente, ma non lo copre.
- **Note:** se tutti i membri con note hanno lo stesso testo, quel testo. Se sono diverse, le note di ciascun membro precedute dal portale e separate da ` · ` (il campo note è su una riga): `Immobiliare: … · Idealista: …`. Nessuna nota sparisce dalla vista; al primo salvataggio dell'agente il testo mostrato diventa la nota di tutti i membri.

### 6.5 Scritture

- Il messaggio `setLeadState` riceve `listingKeys: string[]` (il metodo del servizio accetta una chiave o un elenco) e, in una transazione, applica la modifica allo stato del gruppo (6.4) con le regole di oggi e scrive lo stesso stato completo su tutti i membri, così non restano stati diversi. `updatedAt` avanza se la modifica cambia qualcosa o se un membro aveva uno stato diverso.
- `deleteListings` riceve già più chiavi: il pannello passa le chiavi del gruppo.
- Nuovo messaggio `splitListing { listingKey, fromKeys }`: prima scrive su tutti i membri lo stato del gruppo (stato, note unite, richiamo e date del membro più recente), così un annuncio entrato nel gruppo dopo l'ultima modifica non torna a "Nuovo"; poi salva le coppie.

### 6.6 Visibilità

Il lead unito compare secondo la regola di oggi applicata a valutazione e stato del gruppo (priorità, stato diverso da "Nuovo" o richiamo). La priorità del gruppo non è mai più bassa di quella di un membro.

### 6.7 Badge delle card

Dopo la transazione di `ingest` il servizio legge gli annunci e le coppie separate, calcola i gruppi e, per ogni annuncio dell'osservazione che sta in un gruppo, restituisce la valutazione del gruppo con `listingKey` e `portalId` dell'annuncio della card. Il content script non cambia.

## 7. Effetti sulle funzioni esistenti

- **Filtri del pannello:** il filtro per portale passa se il gruppo ha almeno una fonte su uno dei portali scelti. La ricerca a testo cerca nei campi di tutte le fonti. La fascia di prezzo usa il prezzo del principale. Il filtro di priorità usa la priorità del gruppo.
- **Filtro "Su più portali":** nuova pillola nella riga dei portali, combinabile con le altre, con il conteggio dei lead con 2 o più fonti.
- **Ordinamenti:** usano `listing` (il principale) ed `evaluation` (del gruppo), come oggi.
- **Mediana di zona:** `compareToMarket` riceve un annuncio per gruppo, il principale; il confronto risultante vale per il lead unito.
- **Pulizia automatica:** resta per singolo annuncio. Le fonti di un lead lavorato hanno tutte lo stato copiato, quindi non vengono cancellate.
- **Numero sull'icona dei richiami:** conta oggi i `leadStates` con richiamo; con un gruppo conterebbe ogni fonte. Il conteggio passa alle chiavi distinte del gruppo: `dueRecallCount` calcola i gruppi tra gli annunci con richiamo scaduto e conta un gruppo una volta.

## 8. Pannello (`LeadItem`)

- Etichette di tutte le fonti al posto della singola etichetta del portale; pillola "Su N portali" con 2 o più fonti.
- Pulsante "Fonti (N)" che apre l'elenco delle fonti: portale, prezzo, m², età, "Apri", "Separa". Con una sola fonte non compare.
- Il titolo apre l'annuncio principale.
- Conferma di eliminazione: "Elimina 3 annunci?" per un lead unito.

## 9. Export

- Una riga per lead unito.
- **Portale:** tutti i siti, separati da virgola.
- **URL:** del principale. Nuova colonna **Altri URL**, subito dopo, con gli altri separati da spazio.
- **Online da (giorni)** ed **Età stimata:** del gruppo. Gli altri campi dell'annuncio sono del principale.

## 10. Informativa

Cambia l'uso dei dati (unione tra portali) e si salva un dato nuovo (coppie separate):

- Testo: HomeRadar unisce gli annunci dello stesso immobile su portali diversi confrontando città, superficie, locali e prezzo; le separazioni decise dall'agente restano salvate sul browser.
- Legenda dei badge: "· 3 portali".
- `ONBOARDING_VERSION` passa a 3, con la voce in `ONBOARDING_CHANGES`.

## 11. Test

- **`same-property`:** soglie al limite (m² ±3 e ±5%, prezzo ±5%), locali mancanti su uno, stesso portale mai unito, città diverse, annunci senza m² o prezzo, caso ambiguo lasciato separato, catena non valida, gruppo di tre, coppia separata, ordine d'ingresso indifferente.
- **`rules`:** `evaluateGroup` (A da un membro e B da un altro = Alta, età del membro più vecchio, badge con "· N portali").
- **Service:** `listLeads` con gruppi (principale, stato del più recente, note unite, visibilità), scrittura su tutto il gruppo, eliminazione del gruppo, separazione, pulizia ed eliminazione che cancellano le coppie, mediana senza doppioni, badge di `ingest` con la valutazione del gruppo, conteggio dei richiami per gruppo.
- **Db:** migrazione a `version(6)` da un database v5 con dati.
- **Backup:** esportazione e importazione con `splits`, file senza `splits`, unione senza duplicati.
- **Export e filtri:** righe con "Altri URL", filtro per portale e "Su più portali".
- **Smoke test:** nuovi punti in `docs/smoke-test.md`: stesso immobile cercato su due portali, badge con "· 2 portali", separazione, export.
