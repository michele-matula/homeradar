# HomeRadar — Specifica di design: ricerca e filtri nel pannello

- **Data:** 2026-10-15
- **Stato:** in revisione
- **Ambito:** punto 3 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`

## 1. Obiettivo

Oggi nel pannello si filtra solo per badge e per sito. Con qualche centinaio di lead non basta: l'agente deve poter restringere la lista a una zona, a un tipo di immobile e a una fascia di prezzo.

Successo: con qualche centinaio di lead, l'agente trova in pochi secondi "i trilocali in zona Navile sotto i 250 mila euro", li vede in ogni scheda con i conteggi aggiornati e li esporta.

## 2. Ambito

### Dentro

- Ricerca a testo libero su titolo, indirizzo, città, zona e tipologia.
- Fascia di prezzo con due campi "da" e "a" in migliaia di euro.
- Pulsante "Azzera filtri".
- I nuovi filtri si combinano con quelli esistenti (badge, sito), con l'ordinamento per scheda, con "Elimina tutti" e con l'export della vista corrente.

### Fuori

- Menu a tendina per città o zona: le zone hanno nomi diversi tra i portali (microzona di Immobiliare, zona di Subito, pezzo d'indirizzo di Idealista) e lo stesso quartiere comparirebbe più volte. La ricerca libera copre città e zona.
- Filtri salvati tra un'apertura e l'altra del pannello: un filtro dimenticato fa sembrare spariti dei lead.
- Filtri su m², locali o €/m²: non richiesti dalla roadmap; il €/m² rispetto alla zona è il punto 5.

### Vincoli

- Nessun cambio allo schema Dexie, al background o ai messaggi: si filtra nel pannello sulla lista già caricata (`api.listLeads()`).
- Nessun dato nuovo salvato: l'informativa non cambia e `ONBOARDING_VERSION` resta uguale.

## 3. Comportamento per l'agente

1. Sotto le schede c'è un campo "Cerca titolo, indirizzo, zona…" con una ✕ per svuotarlo, e sotto due campi "Prezzo da … a … k€".
2. Mentre scrive, la lista si aggiorna, senza attese. Anche i numeri sulle schede (Nuovi, Da contattare, Contattati, Scartati) seguono ricerca e prezzo, così l'agente vede subito in quale scheda stanno i lead della zona cercata.
3. I chip dei badge e dei siti continuano a funzionare come oggi e i loro conteggi tengono conto anche di ricerca e prezzo.
4. Con almeno un filtro attivo (ricerca, prezzo, badge diverso da "Tutti" o sito) compare "Azzera filtri", che li riporta tutti allo stato iniziale.
5. "Elimina tutti" e il messaggio "Nessun lead…" riportano i filtri attivi, per esempio `Elimina tutti «Alta, "navile", 150–250 k€» (12)`.
6. L'export esporta la vista corrente, nuovi filtri compresi.
7. Chiudendo il pannello i filtri si azzerano, come oggi badge e sito. L'ordinamento per scheda resta salvato come oggi.

## 4. Logica: `src/core/lead-filters.ts`

Modulo puro, senza React, testato con Vitest.

```ts
export interface LeadQuery {
  text: string;
  minPrice: number | null; // euro
  maxPrice: number | null; // euro
}
export const EMPTY_QUERY: LeadQuery;

export function normalize(s: string): string;
export function matchesText(lead: LeadView, text: string): boolean;
export function parseThousands(input: string): number | null | 'invalid';
export function inPriceRange(lead: LeadView, min: number | null, max: number | null): boolean;
export function applyQuery(leads: LeadView[], q: LeadQuery): LeadView[];
export function isEmptyQuery(q: LeadQuery): boolean;
export function describeQuery(q: LeadQuery): string[]; // parti del tag, es. ['"navile"', '150–250 k€']
```

### Ricerca a testo

- `normalize`: minuscole; accenti rimossi (NFD e rimozione dei segni diacritici); ogni carattere che non è lettera o cifra diventa spazio; spazi compressi e tolti agli estremi. Così "Città" trova "citta" e "Sant'Ambrogio" trova "sant ambrogio".
- La query normalizzata si divide in parole. Un lead passa se **ogni** parola compare, come sottostringa, in almeno uno dei campi normalizzati: `title`, `address`, `city`, `zone`, `typology` (i `null` si ignorano). Le parole possono stare in campi diversi: "bologna navile" trova un lead con città Bologna e zona Navile.
- Query vuota o di soli spazi e simboli: passano tutti.

### Fascia di prezzo

- `parseThousands`: input tolto agli estremi; vuoto → `null`; numero non negativo con al massimo una virgola o un punto decimale ("150", "150,5", "150.5") → valore × 1000 arrotondato all'euro; altro → `'invalid'`.
- Un campo `'invalid'` non filtra (vale `null` nella `LeadQuery`) e nel pannello è segnato come errato (`aria-invalid`, bordo rosso).
- `inPriceRange`: con entrambi gli estremi `null` passano tutti. Con almeno un estremo impostato, i lead con `currentPrice == null` sono esclusi. Gli estremi sono inclusi. Se `min > max` si scambiano.

### Tag dei filtri

`describeQuery` produce le parti da aggiungere al tag già esistente (badge, siti):

- testo non vuoto: `"<testo come scritto, tolto agli estremi>"`;
- prezzo: `150–250 k€`, `da 150 k€`, `fino a 250 k€`, con i valori in migliaia formattati in italiano (`150,5`).

## 5. Pannello: `src/ui/sidepanel/App.tsx`

### Stato

- `text: string`, `minInput: string`, `maxInput: string` (quello che l'agente scrive); la `LeadQuery` si ricava con `parseThousands`.
- Solo stato React, nessun `localStorage`.

### Ordine dei filtri

1. `applyQuery(leads, query)` sull'intera lista;
2. `groupByStatus` → conteggi delle schede;
3. sito e badge come oggi (con i rispettivi conteggi sui chip);
4. `sortLeadsBy` con l'ordinamento della scheda.

### Interfaccia

- Riga di ricerca sotto le schede: `input type="search"` con `SearchIcon`, `aria-label="Cerca nei lead"`, ✕ visibile solo con testo (`aria-label="Svuota ricerca"`).
- Riga prezzo: "Prezzo da [ ] a [ ] k€", due `input` con `inputmode="decimal"` e `aria-label` "Prezzo minimo in migliaia di euro" / "Prezzo massimo in migliaia di euro".
- "Azzera filtri" (pulsante leggero) visibile se `!isEmptyQuery(query) || filter !== 'all' || portals.length > 0`, o se un campo prezzo contiene un valore non valido; svuota testo e prezzo e riporta badge e siti a "Tutti".
- `filterTag` = badge, siti, poi `describeQuery(query)`, separati da virgola.
- La conferma di "Elimina tutti" si annulla anche quando cambiano testo o prezzo (si aggiunge la query alle dipendenze dell'effetto che oggi la azzera).
- `ExportBar` riceve già `visible`; il suggerimento diventa "Esporta la vista corrente (N)".
- Stile in `styles.css` coerente con `field` e `chip` già presenti; il pannello è stretto, quindi i due campi prezzo stanno su una riga sola.

## 6. Test

- `tests/unit/core/lead-filters.test.ts`: normalizzazione di accenti e apostrofi; più parole in AND su campi diversi; ricerca per tipologia; campi `null`; query vuota; `parseThousands` con interi, virgola, punto, vuoto, negativo, testo; prezzo con solo minimo, solo massimo, estremi inclusi, `min > max`, lead senza prezzo; `describeQuery`.
- `tests/unit/ui/sidepanel.test.tsx`: la ricerca cambia lista e conteggi delle schede; il prezzo esclude i lead senza prezzo; "Elimina tutti" riporta testo e prezzo nel tag ed elimina solo i visibili; "Azzera filtri" compare e ripristina tutto; un prezzo non valido è segnato e non filtra.

## 7. Documentazione

- `docs/smoke-test.md`: voce manuale per ricerca, prezzo, conteggi, "Azzera filtri" ed export filtrato.
- `docs/roadmap.md`: riga del punto 3 a "fatto" con il link alla PR.
- `CLAUDE.md`: una riga su `src/core/lead-filters.ts` nella sezione Architettura.
