# HomeRadar — Specifica di design: ripubblicazioni

- **Data:** 2026-10-16
- **Stato:** in revisione
- **Ambito:** punto 7 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`, `2026-10-16-stesso-immobile-design.md`

## 1. Obiettivo

Chi toglie e ripubblica un annuncio ottiene un ID nuovo e una data di creazione azzerata: l'annuncio vecchio sembra nuovo e perde il segnale di anzianità, che è il cuore di HomeRadar. Spesso la ripubblicazione arriva con un prezzo più basso, ed è proprio il venditore che l'agente cerca.

HomeRadar riconosce sullo stesso portale un annuncio non più visto e ricomparso con un nuovo ID, e lo unisce alla ripubblicazione nello stesso lead del punto 6: età del primo annuncio, storico prezzi della catena (compreso il ribasso alla ripubblicazione), stato e note condivisi, etichetta "Ripubblicato". Se sbaglia, l'agente separa l'annuncio con "Separa", come nel punto 6.

Successo: l'annuncio ripubblicato mostra l'età vera e l'eventuale ribasso; se l'agente aveva già lavorato quel venditore, lo vede subito; un'unione sbagliata si annulla senza perdere nulla.

## 2. Ambito

### Dentro

- Riconoscimento automatico delle ripubblicazioni sullo stesso portale e delle catene di più ripubblicazioni.
- Catene combinate con i gruppi tra portali del punto 6.
- Età e storico prezzi ereditati; ribasso alla ripubblicazione.
- Etichetta "Ripubblicato" nel pannello e nel badge delle card; riga "Annuncio precedente" nelle Fonti.
- Pulizia automatica per gruppo, così l'annuncio precedente resta finché la ripubblicazione è viva.
- Export e informativa aggiornati.

### Fuori

- Sapere se un annuncio è davvero stato tolto dal portale: richiederebbe di interrogarlo (vincolo del progetto). "Sparito" vuol dire "non più visto dall'agente".
- Unione manuale di due annunci non riconosciuti.
- Effetto di "Ripubblicato" sulla priorità: è un'etichetta; contano già età e ribasso ereditati.
- Filtro "Ripubblicati" nel pannello: le ripubblicazioni riconosciute saranno poche e salgono già in cima per priorità. Si valuta dopo il pilota.

### Vincoli

- Nessuna richiesta verso i portali; nessun dato nuovo letto dai portali.
- Catene e gruppi si calcolano in memoria a ogni lettura: nessun identificativo salvato, nessuna nuova tabella, nessuna `version(7)` dello schema Dexie. Si salvano solo le coppie separate, nella tabella `splits` del punto 6.
- Il formato dei record e del backup non cambia.

## 3. Comportamento per l'agente

- Un privato su Immobiliare aveva l'annuncio A1 (online da 300 giorni, 300.000 €); lo toglie e lo ripubblica come A2 a 270.000 €. Quando l'agente vede A2, il lead mostra "Online da 300 gg", "Ribassato del 10%", la pillola "Ripubblicato"; il badge della card dice `● Alta · 300 gg · −10% · ripubblicato`.
- Se l'agente aveva messo A1 su "Contattato" con una nota, il lead di A2 è "Contattato" con quella nota.
- Il titolo e "Apri" del lead portano ad A2, l'annuncio vivo.
- Nelle **Fonti** compare la riga "Annuncio precedente · visto fino al 12/09" con prezzo, m², età, "Apri" (sul portale può non esistere più) e "Separa".
- "Separa" sull'annuncio precedente lo stacca: torna un lead a sé con una copia di stato, note e richiamo; i due non si riuniscono più.

## 4. Riconoscimento (`src/core/same-property.ts`)

Modulo puro, senza accesso al database.

### 4.1 Coppia di ripubblicazione

Un annuncio vecchio `o` e uno nuovo `n` formano una coppia se valgono tutte:

| Criterio | Regola |
|---|---|
| Portale | uguale |
| ID | `n.portalId > o.portalId` (gli ID sono contatori crescenti su tutti e tre i portali) |
| Tempi | `o.lastSeenAt < n.firstSeenAt`: mai visti insieme. Nessun limite massimo all'intervallo |
| Candidati | città, m² e prezzo presenti; città uguale (normalizzata con `normalize` di `lead-filters.ts`), come nel punto 6 |
| m² | `|o − n| ≤ max(3, 5% del minore)` (costanti del punto 6) |
| Locali | uguali, oppure mancanti su almeno uno dei due |
| Tipologia, zona, indirizzo | ciascuno uguale (normalizzato) quando è presente su tutti e due |
| Prezzo | `n ≥ o × (100 − 20)/100` e `n ≤ o × (100 + 5)/100`, con il prezzo attuale di ciascun annuncio |
| Separazione | la coppia non è in `splits` |

Nuove costanti esportate: `REPOST_MAX_DROP_PERCENT = 20`, `REPOST_MAX_RISE_PERCENT = 5`. Il confronto del prezzo si fa con interi, come `close` del punto 6.

Se l'annuncio vecchio ricompare dopo il nuovo (`o.lastSeenAt` supera `n.firstSeenAt`), la coppia non vale più: i due convivono, quindi non è una ripubblicazione. L'unione si scioglie da sola alla lettura successiva.

### 4.2 Catene

1. Si calcolano tutte le coppie del portale.
2. **Riduzione transitiva:** si toglie la coppia `o → n` se esiste un `m` con `o → m` e `m → n`. Così A1 → A2 → A3 resta una catena di due passi e il prezzo si controlla passo per passo (due ribassi del 15% in due ripubblicazioni sono riconosciuti).
3. **Ambiguità:** se dopo la riduzione un annuncio ha due o più successori, o due o più predecessori, tutte le coppie che lo toccano cadono. Nel dubbio non si unisce: per esempio due appartamenti uguali nello stesso stabile tolti e un solo annuncio nuovo.
4. Le coppie rimaste formano catene lineari. La **testa** di una catena è l'annuncio con l'ID più alto; un annuncio senza coppie è la testa di sé stesso.

### 4.3 Gruppi

Il confronto tra portali del punto 6 (sezioni 4.1–4.3 della sua specifica: `compatible`, al massimo un annuncio per portale, ogni coppia compatibile) si applica alle sole **teste**. Il gruppo finale contiene, per ogni testa, tutta la sua catena. Una catena senza gemelli su altri portali è un gruppo da sola, se ha almeno due annunci.

Il confronto tra portali con la testa, e non con l'annuncio precedente, è voluto: dopo un ribasso del 15% alla ripubblicazione, l'annuncio Idealista allo stesso prezzo nuovo è compatibile con A2 e non con A1.

Il risultato non dipende dall'ordine degli annunci in ingresso.

### 4.4 Interfaccia

```ts
export interface ListingGroup {
  /** Tutte le chiavi del gruppo, in ordine. */
  keys: string[];
  /**
   * Una catena per testa, in ordine di prima chiave; ogni catena va dall'annuncio più vecchio alla testa.
   * Un annuncio senza ripubblicazioni è una catena di un solo elemento.
   */
  chains: string[][];
}
/** Gruppi di 2 o più annunci; gli annunci che restano soli non compaiono. Gruppi in ordine di prima chiave. */
export function groupListings(listings: ListingRecord[], splits: SplitPair[]): ListingGroup[];
```

`groupListings` cambia tipo di ritorno: i chiamanti (`buildLeadViews`, `dueRecallCount`, `purge`) leggono `keys`; `lead-groups.ts` usa `chains` per le teste, gli annunci precedenti (tutti gli elementi di una catena tranne l'ultimo) e lo storico unito.

### 4.5 Separazione

"Separa" usa il meccanismo del punto 6: salva una coppia in `splits` tra l'annuncio separato e ciascun altro membro del gruppo. Separare un anello in mezzo (A2 in A1 → A2 → A3) salva anche A2–A1 e A2–A3; A1 e A3 restano compatibili tra loro e si uniscono in una catena A1 → A3, senza A2. È il comportamento voluto: l'agente ha detto che A2 non c'entra, non che A1 e A3 siano immobili diversi.

## 5. Lead unito (`src/core/lead-groups.ts`, `src/core/rules.ts`)

### 5.1 Tipi

```ts
export interface LeadSource {
  listing: ListingRecord;
  evaluation: Evaluation;
  prices: PriceSnapshot[];
  /** Vero per un annuncio sostituito da una ripubblicazione sullo stesso portale. */
  previous: boolean;
}

export interface LeadView {
  // … campi del punto 6
  /** Storico prezzi della catena del principale, in ordine di tempo. */
  prices: PriceSnapshot[];
  /** Vero se il lead contiene almeno un annuncio precedente. */
  reposted: boolean;
}
```

### 5.2 Principale

Si sceglie solo tra le teste, con le regole del punto 6 (priorità, età, visto più di recente, chiave). Titolo, indirizzo, prezzo e link del lead sono quelli di un annuncio vivo. La valutazione usata per l'ordine del principale è quella della testa con lo storico della sua catena (5.3).

### 5.3 Valutazione

- **Membri per la valutazione:** `evaluateGroup` riceve un membro per annuncio per l'età e, per il ribasso, un membro per catena: la testa con lo storico di tutta la catena (snapshot di tutti gli annunci della catena, in ordine di tempo, più i prezzi attuali e i `lastDrop.fromPrice` degli annunci precedenti come prezzi noti). Il prezzo attuale è quello della testa.
- **Età:** regola del punto 6, il membro più vecchio tra quelli con il segnale A. L'annuncio precedente porta l'età vera; su Immobiliare anche esatta.
- **Ribasso:** dalla catena, quindi 300.000 → 270.000 € alla ripubblicazione è un ribasso del 10% e conta in `dropCount`.
- **Badge:** `· N portali` conta i **portali distinti** (oggi conta i membri; con una catena sarebbe sbagliato). Se il gruppo contiene annunci precedenti si aggiunge `· ripubblicato` in fondo. Esempi: `● Alta · 300 gg · −10% · ripubblicato`, `● Media · 200 gg · 2 portali · ripubblicato`.
- **Priorità:** regole invariate.
- La valutazione di un annuncio precedente nelle Fonti è quella sua, da solo, come per le altre fonti del punto 6.

### 5.4 Stato

Invariato rispetto al punto 6: `mergeGroupState` su tutti i membri, compresi i precedenti; le scritture vanno su tutti i membri. Il lavoro fatto sull'annuncio precedente passa quindi alla ripubblicazione.

### 5.5 Badge delle card

Come nel punto 6 (`withGroups` di `ingest`): la card della ripubblicazione mostra la valutazione del gruppo.

## 6. Effetti sulle funzioni esistenti

- **Pulizia automatica (`purge`):** oggi decide per annuncio. Diventa per gruppo: un annuncio vecchio (`lastSeenAt` sotto la soglia) e non lavorato si cancella solo se tutti i membri del suo gruppo sono vecchi e non lavorati. L'annuncio precedente, che non si vede più per definizione, resta finché la ripubblicazione è viva. Vale anche per i gruppi tra portali del punto 6, e chiude il caso minore "la pulizia di un membro separato dimentica la separazione" quando il membro è ancora in un gruppo.
- **Numero sull'icona dei richiami:** `dueRecallCount` usa `keys` dei gruppi: una catena conta una volta.
- **Mediana di zona:** riceve il principale di ogni lead, quindi l'annuncio precedente non si conta.
- **Filtri del pannello:** il filtro per portale e la ricerca a testo considerano tutte le fonti, compresi i precedenti (come nel punto 6). Il filtro "Su più portali" passa solo con 2 o più **portali distinti**: una catena sullo stesso portale non basta.
- **Eliminazione:** il lead elimina tutti i membri, compresi i precedenti; la conferma li conta ("Elimina 3 annunci?").

## 7. Pannello (`LeadItem`)

- Pillola "Su N portali" con N = portali distinti, solo se N ≥ 2. Nuova pillola "Ripubblicato" se `reposted`.
- Etichette dei portali: un'etichetta per portale distinto.
- "Fonti (N)" con N = numero di annunci, compresi i precedenti. La riga di un annuncio precedente ha l'etichetta del portale seguita da "Annuncio precedente · visto fino al {data di `lastSeenAt`}", poi prezzo, m², età, "Apri" e "Separa" (nome accessibile `Separa annuncio precedente {portale}`).
- Lo storico prezzi del lead è quello della catena del principale.

## 8. Export

- Nuova colonna **Ripubblicato** ("sì" o vuoto), dopo **Online da (giorni)**/**Età stimata**, prima di **Prima visita**.
- **Altri URL:** comprende gli URL degli annunci precedenti.
- **Portale:** portali distinti.
- **Prezzo massimo noto**, **Calo %**: della valutazione del gruppo, quindi con lo storico della catena.

## 9. Informativa

Cambia l'uso dei dati (unione di annunci dello stesso portale) e l'annuncio precedente resta salvato più a lungo:

- Testo: HomeRadar riconosce un annuncio tolto e ripubblicato sullo stesso portale confrontando città, superficie, locali, tipologia, zona, indirizzo e prezzo, e ne mantiene età, storico prezzi, stato e note; l'annuncio precedente resta salvato finché la ripubblicazione resta nell'archivio.
- Legenda dei badge: "· ripubblicato".
- `ONBOARDING_VERSION` passa a 4, con la voce in `ONBOARDING_CHANGES`.

## 10. Test

- **`same-property`:** coppia semplice; catena di tre con riduzione transitiva; prezzo ai limiti (−20% sì, −20,1% no, +5% sì, oltre no); annunci visti insieme (nessuna coppia) e annuncio vecchio ricomparso dopo il nuovo; ID più basso; tipologia, zona o indirizzo diversi, e presenti su uno solo (coppia valida); locali mancanti; portali diversi (nessuna coppia di ripubblicazione); due successori e due predecessori (nessuna unione); separazione di una coppia e di un anello in mezzo; catena insieme a un gemello su un altro portale confrontato con la testa; gemello compatibile solo con l'annuncio precedente (non unito); ordine d'ingresso indifferente.
- **`rules`:** età dal precedente; ribasso alla ripubblicazione con storico unito; badge con portali distinti e "· ripubblicato".
- **`lead-groups`:** principale sempre una testa; `prices` della catena; `previous` e `reposted`; stato del precedente lavorato ereditato.
- **Service:** pulizia per gruppo (precedente conservato, gruppo tutto vecchio cancellato, gruppo lavorato conservato); richiami contati una volta; separazione dell'annuncio precedente; badge di `ingest` con "ripubblicato".
- **Export e filtri:** colonna "Ripubblicato", "Altri URL" con i precedenti, "Su più portali" non attivo per una catena sullo stesso portale.
- **e2e:** intestazione del CSV con "Ripubblicato".
- **Smoke test:** nuovo punto in `docs/smoke-test.md`. Su una pagina reale una ripubblicazione non si provoca: si verifica con un backup di prova. Si esporta il backup, si duplica nel file un annuncio privato già visto cambiando `portalId`, `key` e `url` verso un ID più basso, `firstSeenAt` e `lastSeenAt` a una data anteriore al `firstSeenAt` dell'originale il prezzo del 10% più alto e, se c'è, `portalCreatedAt` più vecchio di qualche mese; si reimporta il file (profilo di prova, mai sul profilo di lavoro). Il lead dell'originale deve mostrare "Ripubblicato", il ribasso del 10%, la riga "Annuncio precedente" e il badge "· ripubblicato" sulla card.
