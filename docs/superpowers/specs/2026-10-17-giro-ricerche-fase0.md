# Giro delle ricerche — Fase 0: verifica sul campo

Riferimento: `2026-10-17-giro-ricerche-design.md` §3.

Verifica fatta il 2026-10-17 con Claude in Chrome nel Chrome dell'utente, a ritmo lento (6-18 s tra i caricamenti): 10 pagine su Immobiliare, 2 su Idealista, 3 su Subito. **Nessuna verifica di DataDome comparsa.** Comuni: Treviglio (BG), Cassano d'Adda (MI), Bergamo (BG, città grande), Cantù (CO, accento).

## Immobiliare.it

- **URL:** `https://www.immobiliare.it/vendita-<categoria>/<slug-comune>/?criterio=privateFirst&pag=<n>` (pagina 1 senza `pag`).
  - `?criterio=privateFirst` è l'ordinamento "privati prima" e vale per tutte le categorie. `/da-privati/` è solo un alias per le case: su `/vendita-terreni/<comune>/da-privati/` risponde "pagina non presente".
  - Il cambio di categoria dai filtri del sito è navigazione SPA (dati via XHR); il caricamento diretto dell'URL ha `__NEXT_DATA__` con `count`, `maxPages`, `currentPage`, `results[25]`.
- **Slug del comune:** minuscole, accenti tolti, apostrofo e spazi diventano `-`: `treviglio`, `cassano-d-adda`, `cantu`, `bergamo`. Senza provincia. Omonimi: non verificato.
- **Categorie** (radio "Tipologia" nei filtri): Case - Appartamenti (`vendita-case`), Nuove costruzioni, Garage - Posti auto (`vendita-garage`), Palazzi - Edifici, Uffici - Coworking (`vendita-uffici`), Negozi - Locali commerciali (`vendita-negozi`), Magazzini - Depositi, Capannoni (`vendita-capannoni`), Terreni (`vendita-terreni`). Verificati per caricamento: case, garage, negozi, uffici, capannoni, terreni. Magazzini e palazzi: percorso non verificato.
- **Tipologie viste** (`typology.name`): garage → "Garage - Box", "Posto auto"; negozi → "Negozi - Locali commerciali", "Negozio", "Laboratorio"; uffici → "Ufficio - Studio", "Ufficio"; capannoni → "Capannone"; terreni → "Terreno edificabile", "Terreno agricolo", "Terreno residenziale", "Terreno non edificabile".
- **Ordinamento:** privati rigorosamente prima, poi solo agenzie, in tutti i casi visti.

| Comune | Categoria | Annunci | Pagine | Privati |
|---|---|---|---|---|
| Treviglio | case | 441 | 18 | 11 (tutti in pag. 1) |
| Treviglio | garage | 51 | 3 | 9 |
| Treviglio | negozi | 82 | 4 | 5 |
| Treviglio | uffici | 37 | 2 | 0 |
| Treviglio | capannoni | 30 | 2 | 2 |
| Cassano d'Adda | case | 271 | 11 | 7 |
| Cantù | terreni | 45 | 2 | 2 |
| Bergamo | case | 1855 | 75 | 51-75 (pag. 1-2 tutte private, pag. 4 solo agenzie) |

## Idealista.it

- **URL:** `https://www.idealista.it/vendita-<categoria>/<slug-comune>-<slug-provincia>/?ordine=da-privati-asc`, pagine successive `…/lista-<n>.htm?ordine=da-privati-asc`.
- **Slug:** `treviglio-bergamo`, `cassano-d-adda-milano` (apostrofo → `-`, provincia per nome intero). Province con nome composto (es. Monza e della Brianza): non verificato.
- **Categorie** (link in pagina): `vendita-case`, `vendita-nuove_costruzioni`, `vendita-uffici`, `vendita-negozi` ("Locali o capannoni"), `vendita-garage`, `vendita-terreni`, `vendita-cantine`, `vendita-edifici`.
- **30 annunci per pagina**, privati prima.

| Comune | Categoria | Annunci | Privati |
|---|---|---|---|
| Treviglio | case | 366 | 7 (pag. 1) |
| Cassano d'Adda | negozi | 62 | 1 (pag. 1) |

- Il titolo della card non è sempre "<tipologia> in <indirizzo>": sui locali compare anche "Locale a Cassano d'Adda". Da verificare il parser di `parse.ts` sulle card non residenziali.

## Subito.it

- **URL:** `https://www.subito.it/annunci-<regione>/vendita/immobili/<slug-provincia>/<slug-comune>/?advt=0&o=<n>`.
  - La categoria generica **`immobili`** comprende tutte le categorie: **una sola ricerca per comune**. La categoria del singolo annuncio è nel payload.
  - **`advt=0` = solo privati** (filtro "Inserzionista" del sito): con il filtro Treviglio passa da 171 a 20 annunci, tutti privati, compresi i `boostedItems`.
- **Slug:** `bergamo/treviglio`, `milano/cassano-d-adda`. In `__NEXT_DATA__` `search.geo.town` ha `id` = `istat` = codice ISTAT del comune (`015059`) e `friendlyName` = slug; `geo.city` ha la sigla ISTAT della provincia (`015`) e lo slug (`milano`).
- **Categorie viste** (`category.id:label`): `7` Appartamenti, `29` Ville singole e a schiera, `31` Garage e box, `30` Terreni e rustici, Uffici e Locali commerciali (id non annotato).

| Comune | Annunci (tutti) | Privati (`advt=0`) | Pagine |
|---|---|---|---|
| Treviglio | 171 | 20 | 1 |
| Cassano d'Adda | — | 5 | 1 |

## Conseguenze sul design

1. **Condizione di fine su Immobiliare e Idealista:** basta la **prima pagina che contiene un'agenzia** (l'ordinamento mette i privati rigorosamente prima). Nei comuni medi quasi tutto si chiude in **una pagina**.
2. **Subito:** una sola ricerca per comune per tutte le categorie; filtro `advt=0`; fine a `totalPages`.
3. **Numero di caricamenti per comune:** Immobiliare 6 (case, garage, negozi, uffici, capannoni, terreni), Idealista 5 (case, uffici, negozi, garage, terreni), Subito 1. Per 10 comuni medi circa 60 + 50 + 10 = **120 caricamenti**, più le pagine extra delle città grandi.
4. Con 120 caricamenti alternati e pause di 4-10 s, il giro dura circa 15-20 minuti, ai limiti di quanto concordato; su Idealista sarebbe un caricamento ogni 15-20 s per un quarto d'ora. Da qui la proposta: le categorie **non residenziali** (pochi privati) si cercano **per provincia** su Immobiliare e Idealista, tenendo solo gli annunci dei comuni scelti; la categoria **case** per comune. Per 10 comuni in una provincia si scende a circa 10 + 5 pagine per portale per le categorie non residenziali.

## Ancora da verificare

- Prova di ritmo in finestra ridotta a icona (build di prova).
- Pagina di verifica di DataDome (non comparsa): forma da catturare quando capita.
- Slug degli omonimi e delle province con nome composto.
- URL per provincia su Idealista e categorie magazzini/palazzi su Immobiliare.
- Fixture delle pagine non residenziali (Ctrl+S, `fixtures-raw/giro/`) per verificare schemi e parser.
