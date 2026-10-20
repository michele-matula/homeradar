# HomeRadar — Specifica di design: copertina nei lead

- **Data:** 2026-10-20
- **Stato:** in revisione
- **Ambito:** funzione nuova prima del pilota (Salerno). Spec di riferimento: `2026-10-10-homeradar-mvp-design.md`, `2026-10-16-stesso-immobile-design.md`, `2026-10-16-ripubblicazioni-design.md`

## 1. Obiettivo

L'agente riconosce un immobile soprattutto dalla foto: titolo e prezzo spesso non bastano per ricordare di quale si tratta. Ogni lead del pannello mostra la foto di copertina dell'annuncio, presa dal sito del portale come la vede l'agente nella ricerca.

Successo: nel pannello quasi tutti i lead hanno una miniatura riconoscibile; quando la foto non c'è o non si carica il lead resta leggibile come oggi; nessuna richiesta nuova verso pagine o API dei portali.

## 2. Ambito

### Dentro

- Lettura dell'URL della copertina sui tre portali, nel caricamento della pagina e nella paginazione SPA.
- Un campo nuovo nell'annuncio salvato (`coverUrl`), nel backup e nelle fixture.
- Miniatura nel lead del pannello, con ripiego sugli altri annunci dello stesso immobile e su un riquadro neutro.
- Vincolo del progetto riformulato in `CLAUDE.md`; informativa aggiornata.

### Fuori

- Copia locale delle foto (scaricarle e salvarle in IndexedDB): si valuta dopo il pilota, solo se gli agenti vogliono vedere la foto anche degli annunci spariti.
- Più foto per annuncio, galleria, ingrandimento.
- Foto nell'export CSV/XLSX e nei badge delle card (sulla card la foto c'è già).
- Qualunque dato delle foto nel report del pilota.

### Vincoli

- Nessuna richiesta dell'estensione verso pagine e API dei portali. Il pannello carica la copertina dai server delle immagini dei portali, solo per i lead salvati e solo quando il lead è visibile.
- Si salva solo l'URL, mai l'immagine.
- Un URL che non è di un server immagini noto viene scartato: il pannello non carica mai indirizzi arbitrari presi dalla pagina.
- Un errore nella lettura della copertina non fa mai perdere l'annuncio: la copertina diventa `null`.

## 3. Verifiche fatte (2026-10-20)

Su ricerche reali dei privati a Monza e a Salerno (zona del pilota), con richieste dirette ai server delle immagini senza referer e con referer estraneo.

| Portale | Dove sta | Server | Esito |
|---|---|---|---|
| Immobiliare | `realEstate.properties[0].photo.urls.small` (= `multimedia.photos[0]`), stessa forma in `__NEXT_DATA__` e in `/api-next/search-list/listings/`; manca la chiave `photo` se non ci sono foto | `pwm.im-cdn.it` | 320×240, ~7–16 KB, 200, cache 1 anno. Salerno: 23 privati su 25 con foto |
| Idealista | card `picture.item-multimedia img[src]`; `src` presente anche prima del caricamento (lazy); senza foto `picture.item-multimedia_no-pictures` senza `img` | `img4.idealista.it` | 480×360, 10–65 KB, 200, cache 1 anno. Salerno: 29 su 30 |
| Subito | `images[0].cdnBaseUrl` in `__NEXT_DATA__`, `images[0].cdn_base_url` nell'API `hades` | `images.sbito.it` | Serve `?rule=…` (senza: 400); `rule=vertical-mini-card-1x-auto` ~6–10 KB in AVIF, cache 60 giorni. Salerno: 25 su 31 |

Su tutti e tre: nessun cookie, nessuna intestazione DataDome, risposta identica senza referer. Non verificabile oggi: se l'URL resta valido dopo la rimozione dell'annuncio (la foto di un annuncio Idealista vecchio è ancora servita).

## 4. Comportamento per l'agente

- Ogni lead del pannello ha a sinistra del titolo una miniatura 96×72 (rapporto 4:3, ritaglio centrato). Un clic sulla miniatura apre l'annuncio principale, come «Apri».
- La foto si carica solo quando il lead entra nella parte visibile del pannello.
- Lead con più annunci (stesso immobile su più portali, ripubblicazioni): si mostra la copertina del principale; se manca o non si carica, quella degli altri annunci vivi, poi quella degli annunci precedenti.
- Nessuna foto disponibile o tutte in errore: riquadro neutro con l'icona di una casa, stessa misura, così la lista non si sposta.
- I lead già salvati prendono la copertina la prossima volta che compaiono in una ricerca (navigando o con «Cerca»). Fino ad allora mostrano il riquadro neutro.

## 5. Design

### 5.1 Server ammessi: `src/core/cover.ts` (nuovo, puro)

- `isCoverUrl(portal, url): boolean`: solo `https:`, host per portale: Immobiliare `pwm.im-cdn.it`; Idealista `img<n>.idealista.it` (`/^img\d*\.idealista\.it$/`); Subito `images.sbito.it`. URL non analizzabile → `false`.
- `coverOrNull(portal, url: unknown): string | null`: stringa che passa `isCoverUrl` oppure `null`. Usata dagli adapter e dal backup.
- `SUBITO_COVER_RULE = 'vertical-mini-card-1x-auto'` e `subitoCover(base: string): string` che aggiunge `?rule=…` alla base.

### 5.2 Adapter

- **Immobiliare** (`schemas.ts`, `index.ts`): nello schema della proprietà `photo: z.object({ urls: z.object({ small: z.string() }) }).nullish().catch(null)`. `coverUrl = coverOrNull('immobiliare', properties[0].photo?.urls.small)`. Il `catch` garantisce che una forma inattesa della foto non scarti la proprietà.
- **Idealista** (`parse.ts`): `card.querySelector('picture.item-multimedia img')?.getAttribute('src')`, passato a `coverOrNull`. Il selettore non tocca `.professional-name`.
- **Subito** (`schemas.ts`, `index.ts`): `images: z.array(z.object({ cdnBaseUrl: z.string().optional(), cdn_base_url: z.string().optional() }).passthrough()).optional().catch(undefined)`; dalla prima immagine la base (una delle due grafie), `coverUrl = coverOrNull('subito', subitoCover(base))`.
- `ListingObservation.coverUrl: string | null` (`src/shared/types.ts`).

### 5.3 Annuncio salvato

- `ListingRecord.coverUrl: string | null`. Campo non indicizzato: nessuna `version()` nuova dello schema Dexie. I record esistenti non lo hanno: chi lo legge tratta `undefined` come `null`.
- In `LeadService.ingest`: `coverUrl: o.coverUrl ?? prev?.coverUrl ?? null` (una lettura senza foto non cancella la copertina nota, come per gli altri campi).

### 5.4 Backup (`src/core/backup.ts`)

- `ListingSchema`: `coverUrl: z.string().nullable().optional()`, poi nel `transform` `coverUrl: coverOrNull(l.portal, l.coverUrl)`: un URL di un server non ammesso diventa `null`, non fa fallire l'importazione.
- Unione: `coverUrl: newer.coverUrl ?? older.coverUrl ?? null`, dove `older` è l'altro dei due record.
- Aggiunta compatibile: `BACKUP_FORMAT_VERSION` resta 1. I backup vecchi si importano con copertina `null`.

### 5.5 Gruppi (`src/core/lead-groups.ts`)

- `LeadView.covers: string[]`: copertine del gruppo in ordine di preferenza, senza `null` e senza doppioni: principale, poi `others` non `previous` nell'ordine in cui sono, poi i `previous`.

### 5.6 Pannello

- `src/ui/sidepanel/Cover.tsx` (nuovo): riceve `covers` e `href`. Stato interno: indice della foto in prova. `<img loading="lazy" referrerPolicy="no-referrer" decoding="async" alt="">` dentro un link all'annuncio (`target="_blank" rel="noreferrer"`, `aria-label="Apri l'annuncio"`); `onError` passa alla successiva; finite le foto, o con lista vuota, riquadro neutro con `HouseIcon` (nuova in `Icons.tsx`). Quando `covers` cambia si riparte dalla prima.
- `LeadItem.tsx`: `lead__head` e `lead__meta` vanno in una riga con la miniatura a sinistra (`lead__body`); il resto del lead non cambia.
- `styles.css`: miniatura 96×72, `object-fit: cover`, bordo arrotondato come le altre card, colore di fondo neutro anche in tema scuro. A larghezze molto strette del pannello (sotto 300 px) la miniatura scende a 72×54.
- Il pannello è una pagina dell'estensione: la CSP predefinita di MV3 non limita `img-src`, non servono permessi nuovi.

### 5.7 Fixture e sanitizer

- `scripts/sanitize-fixture.mjs` non cancella più la copertina, la sostituisce con un URL finto sul server ammesso, numerato per annuncio:
  - Immobiliare: tiene `photo: { urls: { small: 'https://pwm.im-cdn.it/image/<n>/xxs-c.jpg' } }` solo sulla proprietà, senza `caption` né `multimedia`; `n` è il numero progressivo dell'annuncio nella fixture.
  - Idealista: lascia nella card un solo `<picture class="item-multimedia"><img src="https://img4.idealista.it/blur/480_360_mq/0/id.pro.it.image.master/00/00/00/<n>.jpg"></picture>`; le card senza foto restano `item-multimedia_no-pictures`.
  - Subito: `images: [{ cdnBaseUrl | cdn_base_url: 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/00/00000000-0000-0000-0000-<n con 12 cifre>' }]`, solo la prima immagine, con la grafia della sorgente.
- Le fixture si ricatturano sulla zona del pilota (Salerno) con la procedura di `docs/smoke-test.md` e passano dal sanitizer. Nessuna modifica a mano.

### 5.8 Vincolo, informativa e documenti

- `CLAUDE.md`, vincolo: «Mai richieste HTTP dell'estensione verso le pagine e le API del portale (DataDome; rischio legale). Il pannello può mostrare la copertina dei lead salvati dai server delle immagini dei portali (`src/core/cover.ts`).» Più una riga sull'architettura di `cover.ts`.
- Informativa: `ONBOARDING_VERSION` 7, voce in `ONBOARDING_CHANGES[7]`: «HomeRadar ora salva il link della foto di copertina degli annunci e la mostra nel pannello: la foto si carica dai server delle immagini del portale quando apri il pannello, non viene copiata sul tuo computer.» In «Cosa salva» si aggiunge «link della foto di copertina» all'elenco dei dati dell'annuncio; in «Dove restano i dati» una voce sul caricamento della foto dai server delle immagini dei portali.
- `docs/smoke-test.md`: un passo per controllare le miniature su un lead per portale.

## 6. Errori e casi limite

| Caso | Comportamento |
|---|---|
| Annuncio senza foto | `coverUrl: null`, riquadro neutro |
| Forma della foto cambiata dal portale | Lo schema la scarta (`catch`), l'annuncio si salva comunque, `coverUrl: null` o quella già nota |
| URL su un server non ammesso | `null`; se il portale cambia server, le copertine nuove spariscono senza errori finché non si aggiorna `cover.ts` |
| Foto rimossa dal server (annuncio tolto) | `onError` passa alla copertina successiva del gruppo, poi al riquadro neutro |
| Pannello offline | come sopra; il resto del lead funziona |
| Backup da una versione precedente | si importa, `coverUrl: null` |

## 7. Test

- `tests/unit/core/cover.test.ts`: host ammessi e no, `http:`, URL non valido, `subitoCover`.
- Adapter, sulle fixture ricatturate: ogni privato con foto ha `coverUrl` del server giusto; quelli senza foto `null`; Subito sia `__NEXT_DATA__` sia API; Immobiliare sia pagina sia API. Un caso in linea con la foto di forma inattesa: annuncio letto, `coverUrl: null`.
- `service`: la copertina nota resta se una lettura successiva non la porta; una nuova la sostituisce.
- `backup`: andata e ritorno con `coverUrl`; file vecchio senza campo; URL non ammesso → `null`; unione che tiene la copertina se il record più recente non l'ha.
- `lead-groups`: ordine e doppioni di `covers`.
- `Cover.tsx` (jsdom): ripiego su `onError`, riquadro neutro con lista vuota, `referrerPolicy` e `loading`.
- e2e: le fixture di ricerca portano a lead con `<img>` nel pannello; le richieste verso i server delle immagini sono bloccate nel test (`page.route`), così si prova anche il riquadro neutro.
- Prova a mano sul pilota: un giro su Salerno, miniature visibili per i tre portali.
