# HomeRadar — Specifica di design: quarto portale CasaDaPrivato.it

- **Data:** 2026-10-20
- **Stato:** in revisione
- **Ambito:** punto 9 di `docs/roadmap.md`. Spec di riferimento: `2026-10-13-idealista-adapter-design.md` (adattatore sul DOM), `2026-10-13-subito-adapter-design.md` (età dall'ID, categorie miste), `2026-10-17-giro-ricerche-design.md`, `2026-10-20-copertina-lead-design.md`

## 1. Perché

Il pilota è in provincia di Salerno. Confronto del 2026-10-20 su Salerno, Battipaglia e Cava de' Tirreni (tutte le pagine dei privati di ogni portale, solo case, stesso immobile se prezzo e m² sono entro il 5%): **44 dei 73 annunci di CasaDaPrivato con prezzo (circa il 60%) non sono su Immobiliare, Idealista o Subito**. Altri 28 sono a trattativa riservata e non si possono confrontare. In provincia gli annunci sono 648. Senza questo portale gli agenti del pilota perdono una parte rilevante dei privati della loro zona.

Successo: con un clic su «Cerca» il giro legge anche CasaDaPrivato per i comuni della zona; i privati compaiono nel pannello con l'etichetta del portale, l'età stimata con il «~», la copertina quando c'è; gli annunci a trattativa riservata compaiono con la scritta «Trattativa riservata» e si possono isolare con un filtro. Navigando il sito a mano, le card ricevono il badge. Sugli altri tre portali nulla cambia.

## 2. Obiettivi, non obiettivi, cose da evitare

### Obiettivi

- Quarto portale `casadaprivato` (etichetta «CasaDaPrivato», sito «CasaDaPrivato.it»), **acceso di default** come gli altri, anche per chi ha già l'estensione installata (oggi `settings.ts` fa già nascere acceso un portale nuovo).
- Lettura delle **sole pagine di ricerca** di vendita (`/annunci-vendita/…`), quelle che l'agente apre o che il giro naviga.
- Giro delle ricerche: una ricerca `immobili` per comune, categorie scelte filtrate dalla pagina.
- Badge sulle card, copertina, età stimata dall'ID.
- Annunci a trattativa riservata come lead, con filtro dedicato nel pannello.

### Non obiettivi

- Lettura della scheda annuncio (né per dati né per età).
- Affitti, stanze, nuove costruzioni come sezione a parte (le nuove costruzioni che compaiono nella ricerca `immobili` si trattano come le altre card).
- Apprendimento automatico della calibrazione dell'età (vedi §6): il sito non mostra nessuna data di creazione.
- Ribassi «dichiarati» dal sito: non ne sono stati trovati. I ribassi si vedono solo dallo storico osservato, come per Subito.

### Da evitare (sarebbe un fallimento anche se funziona)

- Leggere o salvare la **descrizione** della card (`div.info > p`): i privati ci scrivono nomi e telefoni. Mai, nemmeno nelle fixture.
- Qualsiasi richiesta dell'estensione verso `www.casadaprivato.it` (pagine o API). Unica eccezione, come per gli altri portali, la copertina caricata dal pannello dal server delle immagini.
- Mostrare «Trattativa riservata» su un lead che ha un prezzo noto e attuale.

## 3. Vincoli (invariati)

Quelli di `CLAUDE.md`: niente crawling (il giro parte solo da «Cerca», una scheda, pause, si ferma a ogni problema), solo privati, mai nomi o telefoni, fixture solo da `scripts/sanitize-fixture.mjs`, timestamp in ms UTC. Il sito è fatto solo di privati: ogni card è `sellerType: 'private'`.

## 4. Il sito (verificato il 2026-10-20)

- **HTML lato server**, nessun JSON di stato (`__NEXT_DATA__`, `__INITIAL_STATE__`), nessun DataDome, Cloudflare o reCAPTCHA visti; script di pubblicità e CMP (clickio). Adattatore in modalità `readDocument`, senza bridge, come Idealista.
- **URL di ricerca:** `https://www.casadaprivato.it/annunci-vendita/immobili/<provincia>-<comune>`, pagine successive `/pagina-N`. Provincia intera: `<provincia>-provincia`. Slug del comune con il **trattino basso** al posto di spazi e apostrofi: `salerno-cava_de_tirreni`, `salerno-nocera_inferiore`. Uno slug sbagliato dà la pagina «Pagina non trovata».
- **Ordine:** quello predefinito («Più rilevante», nessun parametro) è per **ID decrescente**, cioè dal più nuovo. `?sort=data-desc` ordina per data di aggiornamento: non si usa.
- **15 card per pagina**; nessun link alla pagina successiva sull'ultima. Una pagina oltre l'ultima (`/pagina-99`) e uno slug sbagliato danno entrambi «Pagina non trovata!» con il testo «La pagina che stai cercando non è presente sul nostro sito…», che `page-problem.ts` riconosce già come `notFound`.
- **Elenco:** le card stanno in `#property-listing`. Se il comune ha meno di 15 annunci propri, nello **stesso contenitore**, dopo un `h2.similar-properties` («Immobili e case simili nelle vicinanze di <comune>»), seguono annunci di **comuni vicini** (Acerno: 2 propri + 13 vicini; Atrani: nessuno proprio, 15 vicini, e l'intestazione dice comunque «15 annunci di case», quindi il contatore in testa non è affidabile). Senza annunci vicini la sezione manca (Aquara, 5 propri). Nessuna card in evidenza o sponsorizzata vista.
- **Volumi** (2026-10-20, tutte le categorie): Salerno 85 annunci (6 pagine), Battipaglia 19 (2), Cava de' Tirreni 14 (1); provincia 648 (~43 pagine).
- **Card:** `div.item` che contiene `div.price`, dentro `#property-listing` e **prima** di `h2.similar-properties`.
  - link `h3 a[href="/<tipologia>/<slug>-<id>"]` (titolo nel testo, es. «Quadrilocale da Privato a Salerno, Via …»); l'ID è il numero finale, presente anche in `.bookmark[data-target-id]`;
  - `div.price > span`: `€ 190.000` oppure il testo **«Trattativa Riservata»**; visti anche prezzi assurdi su case (`€ 98`, `€ 400`);
  - `ul.amenities li`: `4 locali` (anche `5+`), `95 mq`;
  - `small.subtitle`: «Appartamento in vendita»;
  - `.image img.lazyload[data-src]`: copertina `https://static.casadaprivato.it/images/properties/mediumthumbs/<id>/<hash>.jpg`; `src` è `/images/no-thumb.svg`; molte card hanno `data-src` vuoto (nessuna foto);
  - `div.info > p`: estratto della descrizione, **da non leggere**.
- **Categoria** dal primo segmento del link: `appartamenti`, `case-indipendenti`, `ville-singole-e-a-schiera`, `attici-mansarde`, `rustici-casali`, `altro-residenziale`, `palazzi-stabili` → case (`residential`); `immobili-attivita-commerciali` → commerciale; `terreni` → terreni; `box-garage-posti-auto` → box. Un segmento sconosciuto lascia la categoria `null` (la decide la ricerca, come oggi). La tipologia salvata è il segmento stesso o `small.subtitle`: scelta del builder.
- **Server delle immagini:** `static.casadaprivato.it` (IIS), risponde 200 senza referrer e senza cookie.
- **Date:** le card non ne hanno; la scheda mostra solo «Aggiornato al …» (rinnovo). Gli ID sono sequenziali (~15 mila i più vecchi, ~424 mila il 2026-10-20).

## 5. Architettura

Segue Idealista per la lettura e Subito per giro ed età. Componenti:

- `src/adapters/casadaprivato/`: `urls.ts` (`pageKind`: `search` per `/annunci-vendita/…`, altrimenti non letto), `parse.ts` (card → `ListingObservation`, `hasNextPage`, `cardIds`), `search-urls.ts` (`searches`, `pageUrl`), `index.ts` (`PortalAdapter`). La pagina chiude la ricerca solo se c'è `#property-listing` (come Idealista), così «Pagina non trovata» e pagine strane non contano come «fine». **Gli annunci dei comuni vicini (dopo `h2.similar-properties`) non si leggono affatto**, come le card suggerite `.geo-reach-card` di Idealista: non si salvano, non contano come visti, non ricevono badge. Un comune senza annunci propri dà quindi una pagina con `results: 0`, che chiude la ricerca come «completa» (non è un errore e non ferma il portale). Gli annunci vicini vengono letti quando il loro comune è nella zona dell'agente.
- `src/entrypoints/casadaprivato.content.ts`: come `idealista.content.ts` (scan, `checkProblem`, `MutationObserver` per il lazy-load).
- `src/shared/types.ts`: `Portal`, `PORTALS`, `PORTAL_SITES`, `PORTAL_TAGS`; e ovunque esiste un `Record<Portal, …>` (pause del giro, `COVER_HOSTS`, calibrazione, `BUILDERS`, schemi del backup, `estimateMinutes`).
- `wxt.config.ts`: `https://www.casadaprivato.it/*` in `PORTAL_HOSTS`; per la copertina vale quanto già fatto per gli altri server delle immagini.
- `src/content/page-problem.ts`: la regola `notFound` esistente copre già il testo di CasaDaPrivato; basta un test sulla fixture.
- `src/core/cover.ts`: `casadaprivato: (h) => h === 'static.casadaprivato.it'`; l'URL viene da `data-src`, mai da `src`.
- Sanitizer: nuovo tipo `casadaprivato-search` in `scripts/sanitize-fixture.mjs` che **toglie il `p` della descrizione**, anonimizza titoli e indirizzi, sostituisce le copertine con URL finti dello stesso server; `fixtures-privacy.test.ts` esteso alle nuove fixture (nessun numero di telefono, nessuna descrizione).

### Giro delle ricerche

- Una ricerca per comune: `key: casadaprivato|comune:<istat>|immobili`, `mixedCategories: true`, categorie della zona; si tengono solo le scelte (`acceptObservation`), gli scartati contano comunque come visti per «non più visto» (come Subito).
- `isLastPage`: CasaDaPrivato si comporta come Subito (tutti privati): la ricerca finisce a pagina vuota o senza pagina successiva, o al tetto esistente (10 per ricerca, 60 per portale). I tetti bastano: Salerno città sono 6 pagine, la provincia intera ~43; nessuna zona realistica del pilota li raggiunge, quindi gli annunci più vecchi (in fondo, perché l'ordine è dal più nuovo) si leggono sempre. Non serve un ordine dal più vecchio (non esiste: «Meno recente» è per data di aggiornamento).
- Pause: come Immobiliare/Subito (4–10 s) salvo indicazioni contrarie dalla prova reale.
- Slug: una funzione propria (`cdpSlug`): minuscole, senza accenti, spazi e apostrofi → `_`, trattini mantenuti; provincia dal nome della provincia con la stessa regola. Eccezioni in una tabella come `PROVINCE_SLUGS`. Per il pilota contano i comuni della provincia di Salerno: il builder verifica sul sito un campione di nomi con apostrofo, trattino o più parole (es. Cava de' Tirreni, San Cipriano Picentino, Capaccio Paestum, Sant'Egidio del Monte Albino). Le province con nomi composti (Reggio Emilia, Pesaro e Urbino, Bolzano/Bozen, Monza e Brianza, Barletta-Andria-Trani) si controllano a campione; una sbagliata dà «Pagina non trovata» e la ricerca viene saltata, senza danni.
- Stima dei minuti (`estimateMinutes`) con tutti e quattro i portali.

## 6. Età

Nessuna data di creazione disponibile: età **stimata dall'ID**, con il «~», come Idealista e Subito, da `DEFAULT_CALIBRATION.casadaprivato`.

Calibrazione iniziale (2026-10-20): la data `Last-Modified` della copertina, letta su una ventina di annunci della provincia di Salerno, è il caricamento della foto, quindi un limite superiore della creazione. Si usa l'inviluppo inferiore (a ID più alto, data non precedente):

| ID | creato entro |
|---|---|
| 214 000 | 2019-03-20 |
| 289 000 | 2020-09-18 |
| 329 000 | 2022-05-11 |
| 339 000 | 2022-10-21 |
| 400 300 | 2025-06-10 |
| 404 700 | 2025-09-02 |
| 422 500 | 2026-09-15 |
| 423 250 | 2026-09-30 |
| 424 240 | 2026-10-19 |

Tolto il punto 230 000 → 2020-08-17: un mese prima di 289 000 vorrebbe dire ~59 mila ID in un mese, contro i ~2–4 mila al mese degli altri tratti (foto probabilmente ricaricata); l'interpolazione tra 214 000 e 289 000 rispetta comunque quel limite. Tutti gli ID fino a ~152 000 hanno foto del 12–13 marzo 2018 (probabile trasloco del sito): per loro si sa solo «prima di marzo 2018». Il primo punto della tabella resta 214 000; sotto, `estimateCreatedAt` estrapola all'indietro, il che dà comunque età di molti anni, corrette per lo scopo (lead da anzianità). Il builder può aggiungere un punto «≤ 152 000 → 2018-03-12» se l'estrapolazione desse date dopo il 2018 per ID sotto 152 000 (scelta del builder; documentarla nel commento di `DEFAULT_CALIBRATION`). Il builder può raffinare la tabella con il Wayback Machine (CDX, come per Idealista), mai con richieste dell'estensione.

**Nessun apprendimento automatico** (`LEARN_RATE_PER_DAY` senza CasaDaPrivato): la pagina non mostra date, e l'annuncio più nuovo di un comune può avere settimane. La calibrazione si aggiorna a mano prima di un rilascio (aggiungere il punto in `docs/smoke-test.md`). Ritmo recente: ~1.700–1.900 ID al mese.

## 7. Trattativa riservata e prezzi assurdi

Decisioni dell'utente:

- Un annuncio a trattativa riservata **è un lead** come gli altri, con prezzo `null`.
- Nel pannello (card del lead e righe delle altre fonti in `LeadItem.tsx`), al posto del prezzo compare **«Trattativa riservata»**, per **ogni lead senza prezzo**, di qualsiasi portale (oggi «Prezzo n.d.», raro sugli altri portali).
- Il filtro per fascia di prezzo li **esclude** (com'è già `inPriceRange`).
- Nuovo filtro **«Solo trattativa riservata»** nel pannello: mostra solo i lead senza prezzo; si combina con ricerca a testo, filtri per badge e portale, ordinamento; l'export della vista corrente lo rispetta; compare nel tag dei filtri attivi (`describeQuery`). Con una fascia di prezzo impostata le due cose si escludono: scelta del builder se disattivare l'una quando si attiva l'altra (proposta: attivare «solo trattativa riservata» svuota la fascia).
- Senza prezzo il lead non ha €/m² rispetto alla zona, non viene unito ad annunci di altri portali e non mostra ribassi; se il prezzo compare più avanti, da lì si comporta come gli altri.

Mia scelta (confermata dall'utente): se un annuncio **con un prezzo passa a trattativa riservata**, il lead mostra «Trattativa riservata» e il vecchio prezzo resta nello storico. Oggi `service.ts` fa `currentPrice: o.price ?? prev?.currentPrice`: va distinto il prezzo **assente perché il portale dice "riservato"** (azzera `currentPrice`) dal prezzo **non letto** (tiene il precedente, come oggi per gli altri portali). Il modo (es. un campo `priceReserved` su `ListingObservation`) è del builder; se il campo arriva al record salvato, aggiornare gli schemi di `backup.ts`.

Prezzi assurdi (mia scelta, accettata dall'utente): il prezzo si mostra com'è scritto. Il €/m² della zona li scarta già (`MIN_PER_M2 = 300` in `market.ts`). Per lo stesso immobile (`same-property.ts`) si ignorano i prezzi sotto 10.000 € per tutti i portali (il gruppo non si forma su quel prezzo).

## 8. Informativa, report, impostazioni

- **Informativa:** CasaDaPrivato.it tra i portali; alzare `ONBOARDING_VERSION` (7 → 8) e aggiungere la voce in `ONBOARDING_CHANGES` («HomeRadar ora legge anche le ricerche di CasaDaPrivato.it, …»). Legenda dei badge invariata (il «~» vale anche qui).
- **Impostazioni:** il riquadro dei portali attivi mostra il quarto portale; il backup accetta `enabledPortals.casadaprivato`.
- **Report del pilota:** `report-schema.ts` aggiunge `casadaprivato` all'enum `portal` (e `enabledPortals` fino a 4); il file va copiato identico in `worker/src/schema.ts`. **Il Worker va ridistribuito prima di consegnare la nuova estensione**, altrimenti rifiuta i report con il portale nuovo (annotarlo in `docs/pilot-reporting.md`). Cambiando il contenuto del report l'informativa si aggiorna comunque (sopra).

## 9. Test

- **Fixture** (catturate dal builder in Chrome durante il lavoro, `outerHTML` della pagina salvato in `fixtures-raw/`, poi sanificate; se lo strumento non riesce a portare fuori la pagina intera, si chiede all'utente di salvarla con «Salva con nome»): ricerca `immobili` di un comune con trattativa riservata, card senza foto e categorie miste; un'ultima pagina; un comune con pochi annunci propri e la sezione dei vicini (es. Acerno); un comune senza annunci propri (es. Atrani); «Pagina non trovata».
- **Unitari:** annunci dei comuni vicini esclusi (Acerno: 2 osservazioni; Atrani: 0 osservazioni e `page.results === 0`), parse delle card (prezzo, riservata, m², locali `5+`, categoria dal link, copertina da `data-src`, nessun testo della descrizione nell'osservazione), `hasNextPage`, `cdpSlug` sui nomi difficili, `searches`/`pageUrl`, calibrazione (età di un ID recente e di uno sotto 152 000), `page-problem`, prezzo riservato che azzera `currentPrice` e prezzo non letto che lo mantiene, filtro «solo trattativa riservata» e `describeQuery`, soglia dei 10.000 € in `same-property`, schema del report e del backup con il portale nuovo, privacy delle fixture.
- **E2E:** pagina fixture locale con badge sulle card e lead nel pannello con «Trattativa riservata»; giro con un comune CasaDaPrivato in build `WXT_SWEEP_FAST`.
- **Prova reale** prima del rilascio (in `docs/smoke-test.md`): giro su Salerno, Battipaglia, Cava de' Tirreni con i quattro portali.

## 10. Documentazione

`CLAUDE.md` (flusso CasaDaPrivato, adattatore, slug), `docs/smoke-test.md` (ricattura fixture, verifica calibrazione), `docs/pilot-reporting.md` (ordine di deploy del Worker), `docs/roadmap.md` (punto 9 fatto, link alla PR).

## 11. Lasciato al builder

Struttura interna dei file dell'adattatore, nome e forma del segnale «prezzo riservato», tipologia salvata, testo esatto della voce dell'informativa e del filtro, interazione tra fascia di prezzo e «solo trattativa riservata», punto sotto 152 000 nella calibrazione, pause del giro dopo la prova reale.
