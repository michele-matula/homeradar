# HomeRadar — Specifica di design: prezzo al m² rispetto alla zona

- **Data:** 2026-10-16
- **Stato:** in revisione
- **Ambito:** punto 5 di `docs/roadmap.md`. Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`

## 1. Obiettivo

I privati che chiedono più del mercato sono quelli che non vendono e che più probabilmente accettano un'agenzia. L'agente oggi non ha modo di accorgersene senza fare i conti a mano.

HomeRadar calcola la mediana del prezzo al m² degli annunci di privati già raccolti nella stessa zona e, quando un lead la supera di almeno il 10%, lo segnala nel pannello: "+18% su Navigli".

Successo: scorrendo i lead, l'agente vede a colpo d'occhio quali privati sono sopra il mercato della zona, sa su quanti annunci si basa il confronto e può ordinarli per scarto ed esportarli.

## 2. Ambito

### Dentro

- Mediana €/m² per zona (città + zona) con ripiego sulla città, calcolata dagli annunci di privati salvati.
- Etichetta "sopra mercato" sul lead nel pannello, con spiegazione del confronto.
- Ordinamento "Sopra mercato".
- Due colonne nell'export.
- Una riga nella legenda dell'informativa.

### Fuori

- Annunci di agenzia nel campione: si salverebbero dati di annunci non privati (vincolo del progetto). Se al pilota il campione risulta troppo scarso, se ne riparla.
- Divisione per tipologia o per fascia di metratura: con un campione di soli privati le fasce resterebbero quasi sempre sotto la soglia minima.
- Segnale nel badge sulle card del portale.
- Effetto sulla priorità: la priorità resta legata a fatti (età, ribassi); questo è una stima su un campione parziale.
- Segnale "sotto mercato": non è il caso d'uso; il valore calcolato c'è ma non si mostra.

### Vincoli

- Indicazione, non valutazione: il campione è solo ciò che l'agente ha visto. Il testo lo dichiara.
- Nessun dato nuovo salvato: il confronto si calcola in memoria a ogni lettura dei lead. Nessun cambio allo schema Dexie, al formato di backup o ai messaggi.
- Nessuna richiesta verso i portali.

## 3. Comportamento per l'agente

1. Sotto le ragioni del lead (età, ribassi) compare un'etichetta "+18% su Navigli" quando il €/m² del lead supera di almeno il 10% la mediana di confronto. Se il confronto è con la città: "+18% su Bologna".
2. Accanto all'etichetta, la nota informativa (`InfoTip`) dice: "Mediana dei privati visti in zona Navigli (Milano): 4.200 €/m² su 7 annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto." Per la città: "Mediana dei privati visti a Bologna: … su 12 annunci. …".
3. Nel menu di ordinamento c'è "Sopra mercato": prima i lead con lo scarto più alto. I lead senza confronto vanno in fondo, come per gli altri criteri.
4. Nell'export: "Sopra mercato %" (lo scarto arrotondato all'intero, solo se ≥ 10, altrimenti vuoto) e "Confronto mercato" (es. "Navigli (Milano), 7 annunci, 4.200 €/m²"; vuoto se non c'è confronto o lo scarto è sotto il 10%).
5. Le soglie non si cambiano dalle impostazioni.

## 4. Calcolo

Modulo puro `src/core/market.ts`.

### Annunci validi per il campione

Un `ListingRecord` entra nel campione se:

- `currentPrice` non è null e `surfaceM2` è ≥ 20;
- `currentPrice / surfaceM2` è compreso tra 300 e 30.000 €/m² (estremi inclusi);
- `city` non è null né vuota dopo la normalizzazione.

Contano tutti i lead salvati, qualunque stato (anche "Scartato": è comunque un prezzo della zona). Tutti sono privati per costruzione.

### Chiavi

- `cityKey = normalize(city)`
- `zoneKey = cityKey + '|' + normalize(zone)`, solo se `zone` normalizzata non è vuota.

`normalize` è quella di `src/core/lead-filters.ts` (minuscole, senza accenti, punteggiatura → spazio). I portali sono uniti: "Navigli" di Immobiliare e "Navigli" di Subito sono la stessa zona.

### Confronto di un lead

Per ogni lead con €/m² valido (stesse regole del campione):

1. Mediana dei valori della sua zona **escluso il lead stesso**. Se i valori restanti sono almeno 5 (`MIN_ZONE_SAMPLE`), il confronto è con la zona.
2. Altrimenti mediana della città escluso il lead; se i valori restanti sono almeno 8 (`MIN_CITY_SAMPLE`), il confronto è con la città.
3. Altrimenti nessun confronto (`null`).

I lead senza €/m² valido non hanno confronto.

Mediana: valore centrale dei valori ordinati; con un numero pari, media dei due centrali.

`deltaPercent = (€/m² lead / mediana − 1) × 100`, senza arrotondare (si arrotonda solo in visualizzazione).

Si mostra come "sopra mercato" se `deltaPercent ≥ 10` (`ABOVE_MARKET_PERCENT`).

### Tipo

```ts
export interface MarketComparison {
  scope: 'zone' | 'city';
  /** Nome come lo scrive il portale del lead (zona o città). */
  label: string;
  /** Città del lead, per il testo della zona. */
  city: string;
  medianPerM2: number;
  sampleSize: number;
  deltaPercent: number;
}
```

`LeadView` riceve `market: MarketComparison | null`.

### Funzione

`compareToMarket(listings: ListingRecord[]): Map<string, MarketComparison>` (chiave = `listing.key`): costruisce in un passaggio le liste di €/m² per zona e per città, ordinate, poi per ogni lead calcola la mediana escludendo il proprio valore (una occorrenza). Costo O(n log n), trascurabile per qualche migliaio di annunci.

### Dove si chiama

`LeadService.listLeads()` chiama `compareToMarket` sull'elenco completo dei listing e assegna `market` a ogni `LeadView` (`null` se assente). Così la mediana non dipende dai filtri del pannello. È l'unico punto del codice che costruisce `LeadView`; i builder dei test ricevono `market: null` come valore predefinito.

## 5. Pannello

- `LeadItem`: se `market` e `deltaPercent ≥ 10`, una riga/etichetta "+18% su {label}" con `InfoTip` col testo del §3.2. Formato dei numeri come nel resto del pannello (separatore delle migliaia italiano, €/m² arrotondato all'intero).
- `core/leads.ts`: nuova chiave di ordinamento `above_market` con etichetta "Sopra mercato", valore `market?.deltaPercent`, verso decrescente. Il valore considerato è lo scarto anche se sotto il 10%, così l'ordine è coerente anche tra lead senza etichetta; i lead senza confronto restano in fondo. `sortPrefs` accetta la nuova chiave senza cambi (usa `SORT_KEYS`).

## 6. Export

`EXPORT_COLUMNS` riceve, dopo "Calo %": "Sopra mercato %" e "Confronto mercato", come descritto in §3.4. Cambia il file esportato (non il backup).

## 7. Informativa

Nella sezione "Come leggere i badge" di `src/ui/onboarding/Onboarding.tsx` si aggiunge una riga con l'etichetta di esempio "+18% su Navigli": "€/m² sopra la mediana degli annunci di privati che hai visto nella stessa zona (o città, se in zona sono pochi). È un'indicazione, non una valutazione."

`ONBOARDING_VERSION` non si alza: non cambia cosa si salva né come si usa (il confronto è calcolato in memoria e resta nel browser) e, per la regola in `onboarding.ts`, la legenda non la alza.

## 8. Errori e casi limite

- Lead con prezzo o superficie mancanti o fuori soglia: nessun confronto, nessun errore.
- Zona presente ma città assente: nessun confronto (la zona da sola è ambigua tra città).
- Tutti i valori della zona uguali: mediana = quel valore, scarto 0, nessuna etichetta.
- Lead duplicato su più portali (punto 6 non ancora fatto): conta più volte nel campione. Accettato per ora; il punto 6 potrà deduplicare.

## 9. Test

- `tests/unit/core/market.test.ts`: mediana pari e dispari; esclusione del lead stesso (anche con valori duplicati); soglia zona 5 / città 8 e ripiego; esclusione per superficie, €/m² fuori intervallo, città mancante; zone uguali tra portali con scritture diverse (maiuscole, accenti); `deltaPercent` corretto.
- `listLeads()` (test del service): `market` presente e calcolato sull'archivio completo.
- `core/leads.ts`: ordinamento `above_market` con valori mancanti in fondo.
- `core/export.ts`: le due colonne, vuote sotto il 10%.
- Componente `LeadItem` (`tests/unit/ui/`): etichetta e nota presenti solo da +10%, assenti con `market: null`.
- `docs/smoke-test.md`: punto manuale con almeno 6 annunci di privati nella stessa zona per vedere l'etichetta, la nota e l'ordinamento.
