# Giro delle ricerche — Fase 0: verifica sul campo

Scheda da compilare a mano. Riferimento: `2026-10-17-giro-ricerche-design.md` §3.

## Regole

- Naviga **a mano**, in Chrome normale, con calma (almeno 5-10 secondi tra una pagina e l'altra). Niente strumenti di automazione: DataDome.
- Puoi tenere HomeRadar acceso: legge come sempre.
- Se compare una verifica ("non sei un robot", "Al momento non siamo disponibili"): **salva la pagina** (punto D) prima di risolverla, annota dopo quante pagine e quanto tempo è comparsa, poi fermati con quel portale per oggi.
- Gli URL vanno copiati **interi** dalla barra degli indirizzi.

## A. Comuni scelti

Scegli 3-4 comuni della zona di un agente del pilota, se possibile con:
- un comune grande (molti annunci);
- un comune piccolo (pochi o zero annunci);
- un comune con apostrofo o accento (es. "Sant'Angelo Lodigiano", "Cantù");
- se c'è nella zona, un comune con lo stesso nome di un altro in un'altra provincia (es. "Peglio", che esiste sia in provincia di Como sia di Pesaro e Urbino).

| # | Comune | Provincia | Regione |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |

## B. URL per portale, comune e categoria

Per ogni portale: cerca il comune 1, imposta la categoria, imposta l'ordinamento "privati prima" (Immobiliare: "Da privati"; Idealista: "Privati prima") o il filtro privati (Subito: "Privati"), poi copia l'URL della **pagina 1** e della **pagina 2**. Per i comuni 2-4 basta l'URL della pagina 1 della categoria Residenziale.

Categorie: **Residenziale** (case, appartamenti, ville) · **Commerciale** (negozi, uffici, capannoni, laboratori) · **Terreni** · **Box** (box, garage, posti auto). Se un portale divide una categoria in più ricerche (es. "Uffici" e "Negozi" separati), annota tutte le ricerche.

### Immobiliare.it

| Comune | Categoria | URL pagina 1 | URL pagina 2 |
|---|---|---|---|
| 1 | Residenziale | | |
| 1 | Commerciale | | |
| 1 | Terreni | | |
| 1 | Box | | |
| 2 | Residenziale | | — |
| 3 | Residenziale | | — |
| 4 | Residenziale | | — |

### Idealista.it

| Comune | Categoria | URL pagina 1 | URL pagina 2 |
|---|---|---|---|
| 1 | Residenziale | | |
| 1 | Commerciale | | |
| 1 | Terreni | | |
| 1 | Box | | |
| 2 | Residenziale | | — |
| 3 | Residenziale | | — |
| 4 | Residenziale | | — |

### Subito.it

Prima prova se esiste il filtro "Privati" e se compare nell'URL. Prova anche la categoria generica "Immobili" in vendita (tutte le categorie insieme), se il sito la offre.

- Filtro privati nell'URL? (sì/no, parametro): 
- Categoria "Immobili" generica in vendita? (sì/no, URL): 

| Comune | Categoria | URL pagina 1 | URL pagina 2 |
|---|---|---|---|
| 1 | Residenziale | | |
| 1 | Commerciale | | |
| 1 | Terreni | | |
| 1 | Box | | |
| 2 | Residenziale | | — |
| 3 | Residenziale | | — |
| 4 | Residenziale | | — |

## C. Quante pagine

Per il comune 1, categoria Residenziale e Commerciale: scorri le pagine finché finiscono i privati (Immobiliare, Idealista: compaiono solo agenzie) o finiscono le pagine (Subito con filtro). Il pannello di HomeRadar aiuta a contare i privati.

| Portale | Categoria | Annunci totali (dal sito) | Pagine con privati | Privati circa |
|---|---|---|---|---|
| Immobiliare | Residenziale | | | |
| Immobiliare | Commerciale | | | |
| Idealista | Residenziale | | | |
| Idealista | Commerciale | | | |
| Subito | Residenziale | | | |
| Subito | Commerciale | | | |

Annota anche: i privati sono **davvero tutti prima** delle agenzie, o se ne trovano sparsi dopo la prima pagina di sole agenzie?

- Immobiliare: 
- Idealista: 

## D. Pagine da salvare

Con Ctrl+S → "Pagina web, solo HTML", in `fixtures-raw/giro/` (cartella ignorata da git; le ripulisce lo sviluppatore):

- `immobiliare-commerciale.html`, `immobiliare-box.html`, `immobiliare-terreni.html` (pagina 1 di ciascuna, comune 1)
- `idealista-commerciale.html`, `idealista-box.html`, `idealista-terreni.html`
- `subito-commerciale.html`, `subito-box.html`, `subito-terreni.html`
- `immobiliare-ultima-privati.html`, `idealista-ultima-privati.html`: la prima pagina con solo agenzie (serve per la condizione di fine)
- `<portale>-verifica.html`: la pagina di verifica di DataDome, se compare
- `<portale>-comune-inesistente.html`: cosa mostra il portale per un comune scritto male nell'URL (es. cambia una lettera dello slug nell'URL del comune 2 e premi Invio)

## E. Note libere

Reindirizzamenti strani, comuni non trovati, annunci "in asta", pagine lente, qualsiasi cosa sembri utile:

- 
