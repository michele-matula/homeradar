# Giro delle ricerche con un clic — Piano di implementazione

> **Per chi esegue (agente):** SUB-SKILL OBBLIGATORIA: usa superpowers:subagent-driven-development (consigliata) o superpowers:executing-plans per eseguire il piano un task alla volta. I passi usano le caselle (`- [ ]`) per tenere traccia dell'avanzamento.

**Obiettivo:** l'agente imposta una volta comuni e categorie; ogni mattina preme **Cerca** nel pannello e HomeRadar apre da solo le ricerche dei tre portali in una finestra ridotta a icona, le legge con il codice esistente e aggiorna i lead, mostrando avanzamento e riepilogo.

**Architettura:** un orchestratore nel background (`src/background/sweep-runner.ts`, cablaggio Chrome) guida una sola scheda in una finestra ridotta a icona sugli URL costruiti da `src/core/searches.ts`; bridge, content script e adapter leggono le pagine come oggi e mandano `ingest` più un nuovo messaggio `pageRead`. La logica del giro è pura in `src/core/sweep.ts`; "non più visto" è puro in `src/core/missing.ts`; la categoria dell'immobile è pura in `src/core/category.ts`.

**Tecnologie:** WXT 0.21 (MV3), React 19, TypeScript 7, Dexie 4, zod 4, Vitest 5 (jsdom + fake-indexeddb), Playwright.

**Specifica:** `docs/superpowers/specs/2026-10-17-giro-ricerche-design.md` (con i dati verificati in `docs/superpowers/specs/2026-10-17-giro-ricerche-fase0.md`). Chi esegue legge anche la specifica.

## Vincoli globali

- **Mai richieste HTTP dell'estensione verso i portali.** Il giro fa solo navigazioni di una scheda (`browser.tabs.update` / `browser.windows.create`); nessun `fetch`, iframe o documento offscreen sui portali.
- Il giro parte **solo** dal clic su **Cerca**: nessun allarme, nessun avvio all'apertura del browser.
- Una sola scheda, mai caricamenti in parallelo; pausa casuale tra i caricamenti; un portale si ferma alla prima verifica di DataDome, senza ritentare.
- Si salvano solo annunci di privati; mai nomi o telefoni (gli schemi zod restano la lista dei campi ammessi).
- Le ricerche per provincia scartano **prima di `ingest`** gli annunci dei comuni non scelti.
- Timestamp in ms epoch UTC.
- Schema Dexie: si aggiunge `version(7)` con migrazione; le versioni esistenti non si toccano.
- Se cambia la forma di un record salvato si aggiornano gli schemi di `src/core/backup.ts` (campi nuovi facoltativi: `BACKUP_FORMAT_VERSION` resta 1).
- Testi dell'interfaccia e commenti in italiano, nello stile del codice esistente.
- Costanti (valori iniziali, da rivedere con il Task 1): `MAX_PAGES_PER_SEARCH = 10`, `MAX_PAGES_PER_PORTAL = 60`, `PAGE_TIMEOUT_MS = 45_000`, pause Immobiliare e Subito 4-10 s, Idealista 8-14 s, `MISSING_SWEEPS = 3`, `MAX_COMUNI = 30`.
- I contatori del giro per il report del pilota passano dai contatori tecnici esistenti (`bumpCounter`, campo `technical.counters` del report): **nessun cambio** di `report-schema.ts` né del Worker. (Semplificazione rispetto alla spec §10, che prevedeva un cambio dello schema.)

## Attenzione in revisione

Casi che la spec implica ma che nessun test di "percorso felice" tocca; ognuno ha un test nel task indicato.

1. **L'agente naviga a mano in un'altra scheda mentre il giro è in corso**: `ingest` e `pageRead` delle altre schede si comportano come oggi e non avanzano né sporcano il giro (Task 12, test "ignora le altre schede").
2. **La pagina del giro non risponde mai** (content script non iniettato, portale spento a metà, rete lenta): dopo `PAGE_TIMEOUT_MS` la ricerca è in errore, il giro prosegue, due errori di fila fermano il portale (Task 10 e Task 12).
3. **Doppio clic su Cerca / service worker riavviato a metà**: il secondo avvio è rifiutato con "Giro già in corso"; al riavvio del worker un giro rimasto in `storage.session` è chiuso come interrotto e la finestra chiusa (Task 12).
4. **Ricerca per provincia con annuncio senza città riconosciuta** (titolo Idealista non previsto): l'annuncio è scartato, mai salvato (Task 8, `acceptObservation`).
5. **Zona cambiata tra un giro e l'altro** (comune o categoria tolti): gli annunci della ricerca tolta non diventano mai "non più visti" (Task 11, `missingUpdates`).

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `scripts/ritmo/*` (nuovo) | Estensione di prova, non rilasciata, per la prova di ritmo (Task 1) |
| `src/core/category.ts` (nuovo) | Categoria dalla tipologia del portale |
| `src/core/comuni.ts` + `src/shared/comuni.json` + `scripts/generate-comuni.mjs` (nuovi) | Elenco ISTAT, ricerca per prefisso, slug |
| `src/adapters/<portale>/search-urls.ts` (nuovi) | Ricerche del giro e URL di pagina per portale |
| `src/core/searches.ts` (nuovo) | Piano delle ricerche, URL di pagina, filtro degli annunci per ricerca |
| `src/content/page-problem.ts` (nuovo) | Riconoscimento della verifica DataDome e della pagina inesistente |
| `src/core/sweep.ts` (nuovo) | Stato del giro puro: passi, fine ricerca, tetti, esito |
| `src/core/missing.ts` (nuovo) | "Non più visto" puro |
| `src/background/sweep-runner.ts` (nuovo) | Orchestratore con dipendenze iniettate (finestra, timer, storage) |
| `src/ui/sidepanel/ZoneEditor.tsx`, `SweepCard.tsx`, `src/ui/onboarding/ZoneStep.tsx` (nuovi) | Interfaccia |
| `src/shared/types.ts`, `messages.ts`, `src/core/{service,router,db,backup,settings,market,same-property,lead-groups,leads,export,onboarding}.ts`, adapter, controller, content script, `background.ts`, `App.tsx`, `SettingsView.tsx`, `LeadItem.tsx`, `Onboarding.tsx`, `wxt.config.ts` | Modifiche |

---

### Task 1: Prova di ritmo (estensione di prova)

Verifica, prima di scrivere il motore vero, se DataDome reagisce a un giro reale fatto da un'estensione in una finestra ridotta a icona e se Chrome rallenta quei caricamenti. Verifica anche gli URL per provincia su Idealista e alcuni slug non ancora visti. **Richiede l'utente**: chi esegue prepara i file, poi si ferma e chiede all'utente di caricare l'estensione e premere il pulsante.

**File:**
- Crea: `scripts/ritmo/manifest.json`, `scripts/ritmo/background.js`, `scripts/ritmo/popup.html`, `scripts/ritmo/popup.js`, `scripts/ritmo/urls.txt`, `scripts/ritmo/README.md`
- Modifica: `docs/superpowers/specs/2026-10-17-giro-ricerche-fase0.md` (risultati)

**Interfacce:** nessuna verso il codice dell'estensione; i numeri trovati aggiornano le costanti del Task 10.

- [ ] **Passo 1: Scrivi il manifest**

`scripts/ritmo/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "HomeRadar - prova di ritmo",
  "version": "0.0.1",
  "description": "Prova non rilasciata: apre una lista di ricerche in una finestra ridotta a icona e misura tempi e blocchi.",
  "permissions": ["scripting", "storage"],
  "host_permissions": ["https://www.immobiliare.it/*", "https://www.idealista.it/*", "https://www.subito.it/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" }
}
```

- [ ] **Passo 2: Scrivi il background**

`scripts/ritmo/background.js`:

```js
// Prova di ritmo: una scheda, una finestra ridotta a icona, una pagina alla volta con pause casuali.
// Non fa richieste proprie: solo navigazioni, come farebbe l'agente.
const PAUSE = { 'www.immobiliare.it': [4000, 10000], 'www.idealista.it': [8000, 14000], 'www.subito.it': [4000, 10000] };
const TIMEOUT_MS = 45000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let running = false;

// Tiene sveglio il service worker durante la prova.
let keepAlive = null;

function waitComplete(tabId) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); resolve(false); }, TIMEOUT_MS);
    function l(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(l); resolve(true); }
    }
    chrome.tabs.onUpdated.addListener(l);
  });
}

// Eseguita nella pagina: conta annunci e privati senza leggere nomi o telefoni.
function inspect() {
  const text = document.body ? document.body.innerText : '';
  const blocked = !!document.querySelector('iframe[src*="captcha-delivery.com"]') || /Al momento non siamo disponibili/i.test(text);
  const notFound = /La pagina che stai cercando non è presente/i.test(text);
  let results = null, privates = null, pages = null;
  const nd = document.getElementById('__NEXT_DATA__');
  try {
    if (nd && location.hostname === 'www.immobiliare.it') {
      const d = JSON.parse(nd.textContent).props.pageProps.dehydratedState.queries[0].state.data;
      results = d.results.length; privates = d.results.filter((r) => !r.realEstate.advertiser?.agency).length; pages = d.maxPages;
    } else if (nd && location.hostname === 'www.subito.it') {
      const it = JSON.parse(nd.textContent).props.pageProps.initialState.items;
      results = it.originalList.length; privates = it.originalList.filter((x) => !(x.item || x).advertiser?.company).length; pages = it.totalPages;
    } else if (location.hostname === 'www.idealista.it') {
      const cards = [...document.querySelectorAll('article.item[data-element-id]:not(.geo-reach-card)')];
      results = cards.length; privates = cards.filter((a) => a.dataset.isProfessionalAd === 'false').length;
    }
  } catch (e) { /* forma inattesa: restano null */ }
  return { title: document.title, blocked, notFound, results, privates, pages };
}

async function run(urls) {
  running = true;
  keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  const out = [];
  await chrome.storage.local.set({ results: out, running: true });
  const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false, type: 'normal' });
  const tabId = win.tabs[0].id;
  for (const url of urls) {
    if (!running) break;
    const host = new URL(url).hostname;
    const started = Date.now();
    await chrome.tabs.update(tabId, { url });
    const complete = await waitComplete(tabId);
    await sleep(1500);
    let info = { error: 'timeout' };
    if (complete) {
      try { info = (await chrome.scripting.executeScript({ target: { tabId }, func: inspect }))[0].result; }
      catch (e) { info = { error: String(e) }; }
    }
    out.push({ at: new Date(started).toISOString(), url, ms: Date.now() - started, ...info });
    await chrome.storage.local.set({ results: out });
    if (info.blocked) break;
    const [min, max] = PAUSE[host] || [5000, 10000];
    await sleep(min + Math.random() * (max - min));
  }
  await chrome.windows.remove(win.id).catch(() => {});
  clearInterval(keepAlive);
  running = false;
  await chrome.storage.local.set({ running: false });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'start' && !running) run(msg.urls);
  if (msg.type === 'stop') running = false;
});
```

- [ ] **Passo 3: Scrivi il popup**

`scripts/ritmo/popup.html`:

```html
<!doctype html>
<html lang="it"><head><meta charset="utf-8"><title>Prova di ritmo</title>
<style>body{font:12px system-ui;width:560px;margin:8px}textarea{width:100%;height:120px}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:2px 4px;vertical-align:top}.b{color:#b00;font-weight:700}</style>
</head><body>
<p>Un URL per riga. Premi <b>Avvia</b>: si apre una finestra ridotta a icona. Non chiuderla.</p>
<textarea id="urls"></textarea>
<p><button id="start">Avvia</button> <button id="stop">Ferma</button> <button id="copy">Copia risultati (JSON)</button> <span id="state"></span></p>
<table id="out"></table>
<script src="popup.js"></script>
</body></html>
```

`scripts/ritmo/popup.js`:

```js
const $ = (id) => document.getElementById(id);
fetch(chrome.runtime.getURL('urls.txt')).then((r) => r.text()).then((t) => { if (!$('urls').value) $('urls').value = t.trim(); });
$('start').onclick = () => chrome.runtime.sendMessage({ type: 'start', urls: $('urls').value.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('https://')) });
$('stop').onclick = () => chrome.runtime.sendMessage({ type: 'stop' });
$('copy').onclick = async () => navigator.clipboard.writeText(JSON.stringify((await chrome.storage.local.get('results')).results ?? [], null, 1));
async function render() {
  const { results = [], running } = await chrome.storage.local.get(['results', 'running']);
  $('state').textContent = running ? `in corso: ${results.length} pagine` : `ferma: ${results.length} pagine`;
  $('out').innerHTML = results.map((r) => `<tr class="${r.blocked ? 'b' : ''}"><td>${r.at.slice(11, 19)}</td><td>${r.ms} ms</td><td>${r.error ?? (r.blocked ? 'VERIFICA' : r.notFound ? 'non trovata' : `${r.privates}/${r.results} priv. · ${r.pages ?? '?'} pag.`)}</td><td>${r.url.replace('https://www.', '')}</td></tr>`).join('');
}
render();
setInterval(render, 1000);
```

- [ ] **Passo 4: Scrivi la lista degli URL**

`scripts/ritmo/urls.txt`: un giro realistico per 10 comuni della Bassa Bergamasca (provincia di Bergamo), con le ricerche previste dalla spec §4, in ordine alternato tra i portali, più le verifiche rimaste (province su Idealista, una provincia composta). Comuni: Treviglio, Caravaggio, Brignano Gera d'Adda, Calvenzano, Casirate d'Adda, Arcene, Pontirolo Nuovo, Fara Gera d'Adda, Canonica d'Adda, Castel Rozzone.

```text
https://www.immobiliare.it/vendita-case/treviglio/?criterio=privateFirst
https://www.idealista.it/vendita-case/treviglio-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/treviglio/?advt=0
https://www.immobiliare.it/vendita-case/caravaggio/?criterio=privateFirst
https://www.idealista.it/vendita-case/caravaggio-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/caravaggio/?advt=0
https://www.immobiliare.it/vendita-case/brignano-gera-d-adda/?criterio=privateFirst
https://www.idealista.it/vendita-case/brignano-gera-d-adda-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/brignano-gera-d-adda/?advt=0
https://www.immobiliare.it/vendita-case/calvenzano/?criterio=privateFirst
https://www.idealista.it/vendita-case/calvenzano-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/calvenzano/?advt=0
https://www.immobiliare.it/vendita-case/casirate-d-adda/?criterio=privateFirst
https://www.idealista.it/vendita-case/casirate-d-adda-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/casirate-d-adda/?advt=0
https://www.immobiliare.it/vendita-case/arcene/?criterio=privateFirst
https://www.idealista.it/vendita-case/arcene-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/arcene/?advt=0
https://www.immobiliare.it/vendita-case/pontirolo-nuovo/?criterio=privateFirst
https://www.idealista.it/vendita-case/pontirolo-nuovo-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/pontirolo-nuovo/?advt=0
https://www.immobiliare.it/vendita-case/fara-gera-d-adda/?criterio=privateFirst
https://www.idealista.it/vendita-case/fara-gera-d-adda-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/fara-gera-d-adda/?advt=0
https://www.immobiliare.it/vendita-case/canonica-d-adda/?criterio=privateFirst
https://www.idealista.it/vendita-case/canonica-d-adda-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/canonica-d-adda/?advt=0
https://www.immobiliare.it/vendita-case/castel-rozzone/?criterio=privateFirst
https://www.idealista.it/vendita-case/castel-rozzone-bergamo/?ordine=da-privati-asc
https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/castel-rozzone/?advt=0
https://www.immobiliare.it/vendita-negozi/bergamo-provincia/?criterio=privateFirst
https://www.idealista.it/vendita-negozi/bergamo-provincia/?ordine=da-privati-asc
https://www.immobiliare.it/vendita-uffici/bergamo-provincia/?criterio=privateFirst
https://www.idealista.it/vendita-uffici/bergamo-provincia/?ordine=da-privati-asc
https://www.immobiliare.it/vendita-capannoni/bergamo-provincia/?criterio=privateFirst
https://www.idealista.it/vendita-garage/bergamo-provincia/?ordine=da-privati-asc
https://www.immobiliare.it/vendita-garage/bergamo-provincia/?criterio=privateFirst
https://www.idealista.it/vendita-terreni/bergamo-provincia/?ordine=da-privati-asc
https://www.immobiliare.it/vendita-terreni/bergamo-provincia/?criterio=privateFirst
https://www.idealista.it/vendita-case/monza-monza-brianza/?ordine=da-privati-asc
https://www.immobiliare.it/vendita-case/monza-brianza-provincia/?criterio=privateFirst
```

- [ ] **Passo 5: Scrivi il README e committa**

`scripts/ritmo/README.md`:

```markdown
# Prova di ritmo (non rilasciata)

Estensione minima per misurare un giro vero prima del motore di HomeRadar: una finestra ridotta a icona, una scheda,
una pagina alla volta con pause casuali (Immobiliare e Subito 4-10 s, Idealista 8-14 s). Non fa richieste proprie.

1. Chrome → `chrome://extensions` → Modalità sviluppatore → «Carica estensione non pacchettizzata» → questa cartella.
2. Clic sull'icona «HomeRadar - prova di ritmo» → controlla la lista → **Avvia**. Non chiudere la finestra ridotta a icona.
3. A fine giro → **Copia risultati (JSON)** e incolla nella conversazione.
4. Rimuovi l'estensione di prova.

Una riga rossa «VERIFICA» vuol dire che il portale ha chiesto una verifica: la prova si ferma lì.
```

```bash
git add scripts/ritmo
git commit -m "chore(ritmo): estensione di prova per misurare il giro"
```

- [ ] **Passo 6: Fermati e chiedi all'utente di eseguire la prova**

Messaggio all'utente (in italiano): spiega i 4 passi del README e chiedi di incollare il JSON dei risultati. **Non proseguire finché non arrivano.**

- [ ] **Passo 7: Registra i risultati e decidi le costanti**

Aggiungi in fondo a `docs/superpowers/specs/2026-10-17-giro-ricerche-fase0.md` una sezione `## Prova di ritmo (data)` con: durata totale, ms medi per portale, eventuali verifiche (dopo quante pagine e quanto tempo), privati/annunci per ricerca, URL non trovati (slug sbagliati, in particolare `bergamo-provincia` su Idealista e Monza e Brianza). Regole di decisione:

- nessuna verifica e caricamenti sotto i 10 s → costanti del piano invariate;
- verifica su un portale → raddoppia l'intervallo di pausa di quel portale nel Task 10 e annotalo;
- `vendita-*/bergamo-provincia/` non trovato su Idealista → nel Task 8 Idealista cerca anche le categorie non residenziali **per comune** (stesso schema di URL di `vendita-case`, con il percorso della categoria);
- slug di province composte non trovati → annota la forma giusta (se la si trova a mano) per la tabella `PROVINCE_SLUGS` del Task 8.

```bash
git add docs/superpowers/specs/2026-10-17-giro-ricerche-fase0.md
git commit -m "docs(spec): risultati della prova di ritmo"
```

---

### Task 2: Categoria dell'immobile negli adapter

**File:**
- Crea: `src/core/category.ts`, `tests/unit/core/category.test.ts`
- Modifica: `src/shared/types.ts` (tipi categoria, `ListingObservation.category`), `src/adapters/immobiliare/index.ts`, `src/adapters/subito/index.ts`, `src/adapters/idealista/parse.ts`, `tests/unit/core/helpers.ts`, test degli adapter con oggetti attesi completi

**Interfacce:**
- Produce: `type PropertyCategory = 'residential' | 'commercial' | 'land' | 'garage'`, `PROPERTY_CATEGORIES`, `CATEGORY_LABELS`, `ListingObservation.category: PropertyCategory | null`, `categoryFromTypology(typology: string | null | undefined): PropertyCategory | null`, `parseTitle` che riconosce anche "Locale a <comune>".

- [ ] **Passo 1: Aggiungi i tipi**

In `src/shared/types.ts`, sotto `PageKind`:

```ts
/** Categoria normalizzata dell'immobile: il confronto con il mercato e lo stesso immobile valgono solo dentro una categoria. */
export type PropertyCategory = 'residential' | 'commercial' | 'land' | 'garage';
export const PROPERTY_CATEGORIES: PropertyCategory[] = ['residential', 'commercial', 'land', 'garage'];
export const CATEGORY_LABELS: Record<PropertyCategory, string> = { residential: 'Residenziale', commercial: 'Commerciale', land: 'Terreni', garage: 'Box' };
```

In `ListingObservation`, dopo `typology`:

```ts
  /** Categoria riconosciuta dalla tipologia; null se la tipologia non la dice. */
  category: PropertyCategory | null;
```

In `tests/unit/core/helpers.ts`, nell'oggetto di `obs()`, dopo `typology: 'Appartamento',` aggiungi `category: 'residential',`.

- [ ] **Passo 2: Scrivi il test che fallisce**

`tests/unit/core/category.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { categoryFromTypology } from '@/core/category';

describe('categoryFromTypology', () => {
  it.each([
    ['Appartamento', 'residential'], ['Villa', 'residential'], ['Attico - Mansarda', 'residential'], ['Rustico - Casale', 'residential'],
    ['Ville singole e a schiera', 'residential'], ['Appartamenti', 'residential'], ['Bilocale', 'residential'], ['Loft', 'residential'],
    ['Garage - Box', 'garage'], ['Posto auto', 'garage'], ['Garage e box', 'garage'], ['Box', 'garage'],
    ['Negozi - Locali commerciali', 'commercial'], ['Negozio', 'commercial'], ['Laboratorio', 'commercial'], ['Ufficio - Studio', 'commercial'],
    ['Ufficio', 'commercial'], ['Capannone', 'commercial'], ['Locale', 'commercial'], ['Locale o capannone', 'commercial'],
    ['Uffici e Locali commerciali', 'commercial'], ['Magazzini - Depositi', 'commercial'],
    ['Terreno edificabile', 'land'], ['Terreno agricolo', 'land'], ['Terreni e rustici', 'land'],
  ] as const)('%s → %s', (typology, expected) => {
    expect(categoryFromTypology(typology)).toBe(expected);
  });

  it('null se la tipologia manca o non dice la categoria', () => {
    expect(categoryFromTypology(null)).toBeNull();
    expect(categoryFromTypology(undefined)).toBeNull();
    expect(categoryFromTypology('')).toBeNull();
    expect(categoryFromTypology('Altro')).toBeNull();
  });
});
```

- [ ] **Passo 3: Verifica che fallisca**

Run: `npx vitest run tests/unit/core/category.test.ts`
Expected: FAIL, "Failed to resolve import '@/core/category'".

- [ ] **Passo 4: Implementa**

`src/core/category.ts`:

```ts
import { normalize } from '@/core/lead-filters';
import type { PropertyCategory } from '@/shared/types';

// Parole della tipologia come la scrivono i portali, su testo normalizzato (minuscole, senza accenti né punteggiatura).
// Prima le categorie non residenziali: "Terreni e rustici" è un terreno, "Rustico - Casale" una casa.
// "locale" da solo è un locale commerciale; "bilocale" e simili restano case perché la parola è un'altra.
const RULES: [RegExp, PropertyCategory][] = [
  [/\b(box|garage|posto auto|posti auto|autorimessa)\b/, 'garage'],
  [/\b(terreno|terreni)\b/, 'land'],
  [/\b(negozi|negozio|uffici|ufficio|locale|locali|capannone|capannoni|laboratorio|laboratori|magazzino|magazzini|deposito|depositi|coworking)\b/, 'commercial'],
  [/\b(appartamento|appartamenti|attico|mansarda|villa|ville|villetta|villette|casa|case|casale|rustico|loft|monolocale|bilocale|trilocale|quadrilocale|plurilocale|pentalocale|palazzo|edificio|stanza)\b/, 'residential'],
];

/** Categoria dalla tipologia del portale; null se la tipologia manca o non la dice. */
export function categoryFromTypology(typology: string | null | undefined): PropertyCategory | null {
  if (!typology) return null;
  const t = normalize(typology);
  for (const [re, category] of RULES) if (re.test(t)) return category;
  return null;
}
```

- [ ] **Passo 5: Verifica che passi**

Run: `npx vitest run tests/unit/core/category.test.ts`
Expected: PASS.

- [ ] **Passo 6: Test sul titolo dei locali di Idealista**

In `tests/unit/adapters/idealista.test.ts`, nel `describe` di `parseTitle` (o in un nuovo `describe('parseTitle')` se non esiste, importando `parseTitle` da `@/adapters/idealista/parse`):

```ts
  it('riconosce i locali senza indirizzo: "Locale a <comune>"', () => {
    expect(parseTitle("Locale a Cassano d'Adda")).toEqual({ typology: 'Locale', address: null, zone: null, city: "Cassano d'Adda" });
  });
  it('preferisce sempre la forma "in": "Villa a schiera in Via X, Comune"', () => {
    expect(parseTitle('Villa a schiera in Via Roma, 3, Treviglio')).toMatchObject({ typology: 'Villa a schiera', city: 'Treviglio' });
  });
```

Run: `npx vitest run tests/unit/adapters/idealista.test.ts -t "Locale"`
Expected: FAIL (oggi `parseTitle` restituisce tutto null).

- [ ] **Passo 7: Estendi `parseTitle` e aggiungi la categoria agli adapter**

In `src/adapters/idealista/parse.ts`, sostituisci l'inizio di `parseTitle`:

```ts
export function parseTitle(title: string): TitleParts {
  const m = /^(.+?) in (?:vendita in )?(.+)$/.exec(title.trim());
  if (!m) {
    // Locali e capannoni: "Locale a Cassano d'Adda", senza indirizzo né zona.
    const a = /^(.+?) a (.+)$/.exec(title.trim());
    return a ? { typology: a[1]!.trim(), address: null, zone: null, city: a[2]!.trim() } : { typology: null, address: null, zone: null, city: null };
  }
```

(il resto della funzione resta com'è). In `observation(...)` dello stesso file aggiungi dopo `typology: t.typology,`: `category: categoryFromTypology(t.typology),` e l'import `import { categoryFromTypology } from '@/core/category';`.

In `src/adapters/immobiliare/index.ts`, in `toObservation`, dopo `typology: p.typology?.name ?? null,`: `category: categoryFromTypology(p.typology?.name),` con l'import.

In `src/adapters/subito/index.ts`, in `toObservation`, dopo `typology,`: `category: categoryFromTypology(typology),` con l'import.

- [ ] **Passo 8: Esegui tutti i test e allinea gli oggetti attesi**

Run: `npm test`
Expected: passano i test nuovi; possono fallire i test degli adapter che confrontano osservazioni intere con `toEqual`. Per ciascuno aggiungi all'oggetto atteso la categoria che corrisponde alla sua tipologia (`category: 'residential'` per appartamenti, ville e simili; per fixture con altre tipologie usa `categoryFromTypology` sulla tipologia attesa). Non modificare le fixture.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Passo 9: Commit**

```bash
git add src/core/category.ts src/shared/types.ts src/adapters tests/unit
git commit -m "feat(category): categoria dell'immobile dalla tipologia del portale"
```

---

### Task 3: Campi nuovi dell'annuncio, database v7, ingest, backup ed export

**File:**
- Modifica: `src/shared/types.ts`, `src/core/db.ts`, `src/core/service.ts`, `src/core/backup.ts`, `src/core/export.ts`
- Modifica test: `tests/unit/core/db.test.ts`, `tests/unit/core/service.ingest.test.ts`, `tests/unit/core/backup.test.ts`, `tests/unit/core/export.test.ts` e i costruttori di `ListingRecord` nei test (`backup-builders.ts`, `export.test.ts`, `lead-groups.test.ts`, `market.test.ts`, `report.test.ts`, `rules.test.ts`, `same-property.test.ts`, `ui/sidepanel.test.tsx`)

**Interfacce:**
- Consuma: `PropertyCategory`, `categoryFromTypology` (Task 2).
- Produce: `ListingRecord.category: PropertyCategory`, `sweepScope: string | null`, `missedSweeps: number`, `missingSince: number | null`; `interface IngestOptions { sweepScope?: string; searchCategory?: PropertyCategory | null; onDrop?: (listingKey: string) => void }` in `src/shared/types.ts`; `LeadService.ingest(observations, hint?, opts?: IngestOptions)`.

- [ ] **Passo 1: Tipi**

In `src/shared/types.ts`, in `ListingRecord` dopo `typology`:

```ts
  category: PropertyCategory;
```

e dopo `seenCount`:

```ts
  /** `key` dell'ultima ricerca del giro in cui l'annuncio è stato visto; null se visto solo navigando a mano. */
  sweepScope: string | null;
  /** Giri consecutivi in cui la sua ricerca è stata completa e l'annuncio non c'era. */
  missedSweeps: number;
  /** Inizio del primo di quei giri; null se l'annuncio è stato visto nell'ultimo giro. */
  missingSince: number | null;
```

Sotto `ListingObservation`:

```ts
/** Opzioni di `ingest` per le pagine lette dal giro delle ricerche. */
export interface IngestOptions {
  /** Ricerca del giro che ha letto la pagina. */
  sweepScope?: string;
  /** Categoria della ricerca, usata se la tipologia non dice la categoria. */
  searchCategory?: PropertyCategory | null;
  /** Chiamata per un annuncio già salvato il cui prezzo è sceso o che ha un ribasso nuovo dichiarato dal portale. */
  onDrop?: (listingKey: string) => void;
}
```

- [ ] **Passo 2: Allinea i costruttori di `ListingRecord` nei test**

Run: `npm run typecheck`
Expected: errori sui letterali `ListingRecord` dei test. In ognuno dei file elencati sopra aggiungi, accanto a `seenCount: …,`: `category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null,` (prima di `...o` dove c'è). Ripeti finché il typecheck dei test non segnala più quei campi (restano gli errori in `src/`, risolti nei passi seguenti).

- [ ] **Passo 3: Test che falliscono**

In `tests/unit/core/db.test.ts`, nuovo `describe`:

```ts
describe('HomeRadarDB v7', () => {
  it('aggiunge categoria e campi del giro agli annunci già salvati', async () => {
    const name = `mig7-${Math.random()}`;
    const old = new Dexie(name);
    old.version(6).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]', leadStates: 'listingKey, status, recallAt',
      calibration: '[portal+portalId], portal', meta: 'key', splits: '[a+b], a, b',
    });
    await old.table('listings').bulkPut([
      { key: 'immobiliare:1', typology: 'Appartamento', lastSeenAt: 5 },
      { key: 'immobiliare:2', typology: 'Garage - Box', lastSeenAt: 5 },
      { key: 'idealista:3', typology: null, lastSeenAt: 5 },
    ]);
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.listings.get('immobiliare:1')).toMatchObject({ category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null });
    expect(await db.listings.get('immobiliare:2')).toMatchObject({ category: 'garage' });
    expect(await db.listings.get('idealista:3')).toMatchObject({ category: 'residential' });
  });
});
```

In `tests/unit/core/service.ingest.test.ts` (usa `setup`, `obs` da `./helpers` come gli altri test del file):

```ts
describe('ingest: categoria e giro', () => {
  it('categoria dalla tipologia, poi dalla ricerca, poi dal valore salvato', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs({ category: 'garage' })]);
    expect((await db.listings.get('immobiliare:128416572'))!.category).toBe('garage');
    await svc.ingest([obs({ category: null })]);
    expect((await db.listings.get('immobiliare:128416572'))!.category).toBe('garage');
    await svc.ingest([obs({ portalId: 7, url: 'https://www.immobiliare.it/annunci/7/', category: null })], undefined, { searchCategory: 'land' });
    expect((await db.listings.get('immobiliare:7'))!.category).toBe('land');
    await svc.ingest([obs({ portalId: 8, url: 'https://www.immobiliare.it/annunci/8/', category: null })]);
    expect((await db.listings.get('immobiliare:8'))!.category).toBe('residential');
  });

  it('il giro salva la ricerca e azzera "non più visto"; la navigazione a mano tiene la ricerca', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs()], undefined, { sweepScope: 'immobiliare|comune:015059|case' });
    await db.listings.update('immobiliare:128416572', { missedSweeps: 3, missingSince: 123 });
    await svc.ingest([obs()]);
    expect(await db.listings.get('immobiliare:128416572')).toMatchObject({ sweepScope: 'immobiliare|comune:015059|case', missedSweeps: 0, missingSince: null });
  });

  it('segnala i ribassi degli annunci già salvati, non quelli nuovi', async () => {
    const { svc } = setup();
    const drops: string[] = [];
    const onDrop = (k: string) => drops.push(k);
    await svc.ingest([obs({ price: 235000 })], undefined, { onDrop });
    expect(drops).toEqual([]);
    await svc.ingest([obs({ price: 235000 })], undefined, { onDrop });
    expect(drops).toEqual([]);
    await svc.ingest([obs({ price: 225000, lastDrop: null })], undefined, { onDrop });
    expect(drops).toEqual(['immobiliare:128416572']);
    await svc.ingest([obs({ price: 225000, lastDrop: { fromPrice: 235000, toPrice: 225000, percent: 4.3, date: Date.UTC(2026, 9, 11) } })], undefined, { onDrop });
    expect(drops).toEqual(['immobiliare:128416572', 'immobiliare:128416572']);
  });
});
```

In `tests/unit/core/export.test.ts`, nel test "mappa tutte le colonne", aggiungi l'attesa `expect(row['Categoria']).toBe('Residenziale');` (adatta il nome della variabile della riga a quello usato dal test).

In `tests/unit/core/backup.test.ts`:

```ts
  it('importa i backup precedenti al giro: categoria dalla tipologia e campi del giro vuoti', () => {
    const file = buildBackup({ listings: [listing({ typology: 'Garage - Box' })], priceSnapshots: [], leadStates: [], calibration: [] }, NOW, '0.1.0');
    const raw = JSON.parse(JSON.stringify(file));
    for (const l of raw.listings) {
      delete l.category; delete l.sweepScope; delete l.missedSweeps; delete l.missingSince;
    }
    expect(parseBackup(raw).listings[0]).toMatchObject({ category: 'garage', sweepScope: null, missedSweeps: 0, missingSince: null });
  });
```

(importa `buildBackup`, `parseBackup` da `@/core/backup` e `listing`, `NOW` da `./backup-builders` se il file non li importa già).

Run: `npx vitest run tests/unit/core/db.test.ts tests/unit/core/service.ingest.test.ts tests/unit/core/backup.test.ts tests/unit/core/export.test.ts`
Expected: FAIL sui casi nuovi.

- [ ] **Passo 4: Database v7**

In `src/core/db.ts`, dopo `version(6)` (import `categoryFromTypology` da `@/core/category` e `ListingRecord` è già importato):

```ts
    // v7: categoria dell'immobile e campi del giro delle ricerche ("non più visto").
    this.version(7)
      .stores({ listings: 'key, lastSeenAt' })
      .upgrade(async (tx) => {
        await tx.table<Partial<ListingRecord>>('listings').toCollection().modify((l) => {
          l.category ??= categoryFromTypology(l.typology) ?? 'residential';
          l.sweepScope ??= null;
          l.missedSweeps ??= 0;
          l.missingSince ??= null;
        });
      });
```

- [ ] **Passo 5: Ingest**

In `src/core/service.ts` cambia la firma: `async ingest(observations: ListingObservation[], hint?: CalibrationHint, opts: IngestOptions = {}): Promise<Evaluation[]>` (aggiungi `IngestOptions` all'import da `@/shared/types`). Nel ciclo, nel letterale `record`, dopo `typology: …`:

```ts
          category: o.category ?? opts.searchCategory ?? prev?.category ?? 'residential',
```

e dopo `seenCount: …`:

```ts
          sweepScope: opts.sweepScope ?? prev?.sweepScope ?? null,
          // Visto adesso: non è più "non più visto", qualunque sia la strada da cui arriva.
          missedSweeps: 0,
          missingSince: null,
```

Subito dopo `const drop = resolveDrop(...)`:

```ts
        const priceDropped = prev?.currentPrice != null && o.price != null && o.price < prev.currentPrice;
        const newDeclared = drop != null && (prev?.lastDrop == null || prev.lastDrop.fromPrice !== drop.fromPrice || prev.lastDrop.toPrice !== drop.toPrice);
        if (prev && (priceDropped || newDeclared)) opts.onDrop?.(key);
```

- [ ] **Passo 6: Backup**

In `src/core/backup.ts` importa `PROPERTY_CATEGORIES` da `@/shared/types` e `categoryFromTypology` da `@/core/category`. Nello schema `ListingSchema`, nell'oggetto dopo `seenCount: int.min(1),`:

```ts
    // Facoltativi: i backup precedenti al giro delle ricerche non li hanno.
    category: z.enum(PROPERTY_CATEGORIES).optional(), sweepScope: text.optional(), missedSweeps: int.min(0).optional(), missingSince: num.nullable().optional(),
```

e dopo `.refine(...)`:

```ts
  .transform((l): ListingRecord => ({
    ...l,
    category: l.category ?? categoryFromTypology(l.typology) ?? 'residential',
    sweepScope: l.sweepScope ?? null,
    missedSweeps: l.missedSweeps ?? 0,
    missingSince: l.missingSince ?? null,
  }));
```

- [ ] **Passo 7: Export**

In `src/core/export.ts`: in `EXPORT_COLUMNS` inserisci `'Categoria'` subito dopo `'Tipologia'`; in `toExportRows` dopo `'Tipologia': …,` aggiungi `'Categoria': CATEGORY_LABELS[l.category],` (import `CATEGORY_LABELS` da `@/shared/types`).

- [ ] **Passo 8: Verifica**

Run: `npm test && npm run typecheck`
Expected: PASS. Se un test confronta l'elenco completo delle colonne dell'export, aggiungi `'Categoria'` dopo `'Tipologia'` nell'elenco atteso.

- [ ] **Passo 9: Commit**

```bash
git add src tests
git commit -m "feat(db): categoria e campi del giro sugli annunci (v7), ingest, backup ed export"
```

---

### Task 4: Mercato e stesso immobile per categoria

**File:**
- Modifica: `src/core/market.ts`, `src/core/same-property.ts`
- Test: `tests/unit/core/market.test.ts`, `tests/unit/core/same-property.test.ts`

**Interfacce:** consuma `ListingRecord.category` (Task 3). Nessuna firma pubblica cambia.

- [ ] **Passo 1: Test che falliscono**

In `tests/unit/core/market.test.ts` (il file ha un costruttore di `ListingRecord` locale; qui lo chiamo `rec`, usa il nome del file):

```ts
  it('confronta solo annunci della stessa categoria', () => {
    const homes = Array.from({ length: 6 }, (_, i) => rec({ key: `immobiliare:${i + 1}`, portalId: i + 1, surfaceM2: 100, currentPrice: 300000 }));
    const shops = Array.from({ length: 6 }, (_, i) => rec({ key: `immobiliare:${i + 11}`, portalId: i + 11, category: 'commercial', surfaceM2: 100, currentPrice: 100000 }));
    const lead = rec({ key: 'immobiliare:99', portalId: 99, surfaceM2: 100, currentPrice: 330000 });
    const m = compareToMarket([...homes, ...shops, lead]).get('immobiliare:99')!;
    expect(m.medianPerM2).toBe(3000);
  });

  it('nessun confronto per box e terreni', () => {
    const boxes = Array.from({ length: 10 }, (_, i) => rec({ key: `immobiliare:${i + 1}`, portalId: i + 1, category: 'garage', surfaceM2: 20, currentPrice: 20000 }));
    expect(compareToMarket(boxes).size).toBe(0);
  });
```

In `tests/unit/core/same-property.test.ts` (costruttore locale; qui `rec`):

```ts
  it('non unisce annunci di categorie diverse', () => {
    const a = rec({ key: 'immobiliare:1', portal: 'immobiliare', portalId: 1, category: 'garage', surfaceM2: 15, currentPrice: 20000, rooms: null });
    const b = rec({ key: 'idealista:2', portal: 'idealista', portalId: 2, category: 'commercial', surfaceM2: 15, currentPrice: 20000, rooms: null });
    expect(groupListings([a, b], [])).toEqual([]);
  });
```

Run: `npx vitest run tests/unit/core/market.test.ts tests/unit/core/same-property.test.ts`
Expected: FAIL sui casi nuovi (se `groupListings` di due annunci non uniti restituisce gruppi da uno, adatta l'attesa al comportamento esistente per "non uniti", come negli altri test del file).

- [ ] **Passo 2: Implementa**

In `src/core/market.ts`, in `entryOf`:

```ts
/** Il €/m² dice qualcosa solo per case e immobili commerciali; box e terreni non hanno confronto. */
const MARKET_CATEGORIES = new Set(['residential', 'commercial']);

function entryOf(listing: ListingRecord): Entry | null {
  if (!MARKET_CATEGORIES.has(listing.category)) return null;
  const perM2 = validPerM2(listing);
  const city = normalize(listing.city ?? '');
  if (perM2 == null || !city) return null;
  // La categoria entra nella chiave: un negozio non fa mediana con le case della stessa via.
  const cityKey = `${listing.category}|${city}`;
  const zone = normalize(listing.zone ?? '');
  return { listing, perM2, cityKey, zoneKey: zone ? `${cityKey}|${zone}` : null };
}
```

In `src/core/same-property.ts`, in `compatible(...)` aggiungi come prima condizione `x.listing.category === y.listing.category &&`; in `isRepost(...)` aggiungi `a.category === b.category &&` dopo `a.portal === b.portal &&`.

- [ ] **Passo 3: Verifica**

Run: `npm test`
Expected: PASS.

- [ ] **Passo 4: Commit**

```bash
git add src/core/market.ts src/core/same-property.ts tests/unit/core
git commit -m "feat(market): mercato e stesso immobile solo dentro la stessa categoria"
```

---

### Task 5: Elenco dei comuni

**File:**
- Crea: `scripts/generate-comuni.mjs`, `src/shared/comuni.json` (generato), `src/core/comuni.ts`, `tests/unit/core/comuni.test.ts`

**Interfacce:**
- Produce: `interface ProvinceInfo { sigla: string; name: string; region: string }`, `interface ComuneInfo { istat: string; name: string; province: ProvinceInfo }`, `comuneInfo(istat: string): ComuneInfo | null`, `searchComuni(query: string, limit?: number): ComuneInfo[]`, `toRef(c: ComuneInfo): ComuneRef`, `slug(name: string): string`, `groupByProvince(comuni: ComuneInfo[]): { province: ProvinceInfo; comuni: ComuneInfo[] }[]`. `ComuneRef` è definito nel Task 6; in questo task aggiungilo già a `src/shared/types.ts`:

```ts
/** Comune della zona di lavoro, come salvato nelle impostazioni. */
export interface ComuneRef {
  /** Codice ISTAT, 6 cifre. */
  istat: string;
  name: string;
  /** Sigla della provincia, "BG". */
  province: string;
}
```

- [ ] **Passo 1: Scarica il file ISTAT (fuori dall'estensione)**

```bash
mkdir -p fixtures-raw
curl -L -o fixtures-raw/Elenco-comuni-italiani.csv https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv
```

(`fixtures-raw/` è ignorata da git. Se il download fallisce, chiedi all'utente di scaricare il file dalla pagina ISTAT "Codici statistici delle unità amministrative territoriali" e salvarlo lì.)

- [ ] **Passo 2: Scrivi lo script**

`scripts/generate-comuni.mjs`:

```js
// Genera src/shared/comuni.json dal file ISTAT "Elenco dei comuni italiani" (CSV con ;).
// Uso: node scripts/generate-comuni.mjs fixtures-raw/Elenco-comuni-italiani.csv
// Nessuna richiesta in rete: il file si scarica a mano.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input] = process.argv;
if (!input) {
  console.error('Uso: node scripts/generate-comuni.mjs <Elenco-comuni-italiani.csv>');
  process.exit(1);
}
const bytes = readFileSync(input);
let text = new TextDecoder('utf-8').decode(bytes);
// Il file ISTAT è stato pubblicato sia in UTF-8 sia in Windows-1252.
if (text.includes('�')) text = new TextDecoder('windows-1252').decode(bytes);
text = text.replace(/^﻿/, '');

/** CSV con campi tra virgolette che possono contenere ; e a capo (le intestazioni ISTAT ne hanno). */
function parseCsv(s, sep = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const [header, ...rows] = parseCsv(text);
const clean = (h) => h.replace(/\s+/g, ' ').trim();
const col = (re) => {
  const i = header.findIndex((h) => re.test(clean(h)));
  if (i < 0) throw new Error(`Colonna non trovata: ${re}`);
  return i;
};
const I = {
  istat: col(/^Codice Comune formato alfanumerico/),
  name: col(/^Denominazione in italiano/),
  sigla: col(/^Sigla automobilistica/),
  region: col(/^Denominazione Regione/),
  province: col(/^Denominazione dell.Unit/),
};

const provinces = [];
const index = new Map();
const comuni = [];
for (const r of rows) {
  const sigla = r[I.sigla].trim();
  if (!index.has(sigla)) {
    index.set(sigla, provinces.length);
    provinces.push([sigla, r[I.province].trim(), r[I.region].trim()]);
  }
  comuni.push([r[I.istat].trim().padStart(6, '0'), r[I.name].trim(), index.get(sigla)]);
}
comuni.sort((a, b) => a[1].localeCompare(b[1], 'it'));
writeFileSync('src/shared/comuni.json', JSON.stringify({ source: 'ISTAT, Elenco dei comuni italiani', p: provinces, c: comuni }));
console.log(`${comuni.length} comuni, ${provinces.length} province`);
```

Run: `node scripts/generate-comuni.mjs fixtures-raw/Elenco-comuni-italiani.csv`
Expected: `79xx comuni, 10x province` (circa 7.900 comuni, circa 107 province). Controlla a occhio con `node -e "const d=require('./src/shared/comuni.json');console.log(d.c.find(c=>c[0]==='015059'), d.p[d.c.find(c=>c[0]==='015059')[2]])"` → `['015059', "Cassano d'Adda", n]` e `['MI', 'Milano', 'Lombardia']`.

- [ ] **Passo 3: Test che falliscono**

`tests/unit/core/comuni.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { comuneInfo, groupByProvince, searchComuni, slug, toRef } from '@/core/comuni';

describe('comuni', () => {
  it('trova un comune per codice ISTAT, con provincia e regione', () => {
    expect(comuneInfo('015059')).toEqual({ istat: '015059', name: "Cassano d'Adda", province: { sigla: 'MI', name: 'Milano', region: 'Lombardia' } });
    expect(comuneInfo('999999')).toBeNull();
  });

  it('cerca per prefisso senza accenti e apostrofi, prima i nomi che iniziano così', () => {
    expect(searchComuni('trevig')[0]).toMatchObject({ name: 'Treviglio', province: { sigla: 'BG' } });
    expect(searchComuni("cassano d'a").map((c) => c.name)).toContain("Cassano d'Adda");
    expect(searchComuni('cantu').map((c) => c.name)).toContain('Cantù');
    expect(searchComuni('')).toEqual([]);
    expect(searchComuni('a', 5)).toHaveLength(5);
  });

  it('slug come negli URL dei portali', () => {
    expect(slug("Cassano d'Adda")).toBe('cassano-d-adda');
    expect(slug('Cantù')).toBe('cantu');
    expect(slug('Bolzano/Bozen')).toBe('bolzano');
    expect(slug('Trentino-Alto Adige/Südtirol')).toBe('trentino-alto-adige');
    expect(slug("Valle d'Aosta/Vallée d'Aoste")).toBe('valle-d-aosta');
  });

  it('raggruppa per provincia e converte in riferimento salvabile', () => {
    const tre = searchComuni('treviglio')[0]!;
    const cas = comuneInfo('015059')!;
    const groups = groupByProvince([tre, cas]);
    expect(groups.map((g) => g.province.sigla).sort()).toEqual(['BG', 'MI']);
    expect(toRef(cas)).toEqual({ istat: '015059', name: "Cassano d'Adda", province: 'MI' });
  });
});
```

Run: `npx vitest run tests/unit/core/comuni.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Passo 4: Implementa**

`src/core/comuni.ts`:

```ts
import { normalize } from '@/core/lead-filters';
import data from '@/shared/comuni.json';
import type { ComuneRef } from '@/shared/types';

export interface ProvinceInfo {
  /** Sigla automobilistica, "BG". */
  sigla: string;
  name: string;
  region: string;
}

export interface ComuneInfo {
  /** Codice ISTAT, 6 cifre. */
  istat: string;
  name: string;
  province: ProvinceInfo;
}

// Formato compatto generato da scripts/generate-comuni.mjs: p = [sigla, nome, regione], c = [istat, nome, indice provincia].
type Raw = { p: [string, string, string][]; c: [string, string, number][] };
const raw = data as unknown as Raw;
const provinces: ProvinceInfo[] = raw.p.map(([sigla, name, region]) => ({ sigla, name, region }));
const all: ComuneInfo[] = raw.c.map(([istat, name, p]) => ({ istat, name, province: provinces[p]! }));
const byIstat = new Map(all.map((c) => [c.istat, c]));
const keyed = all.map((c) => ({ c, n: normalize(c.name) }));

export function comuneInfo(istat: string): ComuneInfo | null {
  return byIstat.get(istat) ?? null;
}

/** Comuni il cui nome inizia con la ricerca, poi quelli con una parola che inizia così; i nomi più corti prima. */
export function searchComuni(query: string, limit = 8): ComuneInfo[] {
  const q = normalize(query);
  if (!q) return [];
  const rank = (a: { n: string }, b: { n: string }) => a.n.length - b.n.length || a.n.localeCompare(b.n);
  const starts = keyed.filter((k) => k.n.startsWith(q)).sort(rank);
  const words = keyed.filter((k) => !k.n.startsWith(q) && k.n.split(' ').some((w) => w.startsWith(q))).sort(rank);
  return [...starts, ...words].slice(0, limit).map((k) => k.c);
}

export function toRef(c: ComuneInfo): ComuneRef {
  return { istat: c.istat, name: c.name, province: c.province.sigla };
}

/** Nome negli URL dei portali: solo la parte italiana, minuscole, senza accenti, apostrofi e spazi come "-". */
export function slug(name: string): string {
  return normalize(name.split('/')[0]!).replace(/ /g, '-');
}

export function groupByProvince(comuni: ComuneInfo[]): { province: ProvinceInfo; comuni: ComuneInfo[] }[] {
  const groups = new Map<string, { province: ProvinceInfo; comuni: ComuneInfo[] }>();
  for (const c of comuni) {
    const g = groups.get(c.province.sigla);
    if (g) g.comuni.push(c);
    else groups.set(c.province.sigla, { province: c.province, comuni: [c] });
  }
  return [...groups.values()];
}
```

Se `npm run typecheck` segnala l'import JSON, aggiungi `"resolveJsonModule": true` in `compilerOptions` di `tsconfig.json`.

- [ ] **Passo 5: Verifica**

Run: `npx vitest run tests/unit/core/comuni.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Passo 6: Commit**

```bash
git add scripts/generate-comuni.mjs src/shared/comuni.json src/core/comuni.ts src/shared/types.ts tests/unit/core/comuni.test.ts tsconfig.json
git commit -m "feat(comuni): elenco ISTAT dei comuni con ricerca per prefisso e slug"
```

---

### Task 6: Zona di lavoro nelle impostazioni

**File:**
- Modifica: `src/shared/types.ts`, `src/core/settings.ts`, `src/core/backup.ts`
- Test: `tests/unit/core/settings.test.ts`, `tests/unit/core/backup.test.ts`

**Interfacce:**
- Consuma: `ComuneRef` (Task 5), `PROPERTY_CATEGORIES` (Task 2).
- Produce: `interface SearchArea { comuni: ComuneRef[]; categories: PropertyCategory[] }`, `Settings.searchArea: SearchArea`, `DEFAULT_SETTINGS.searchArea = { comuni: [], categories: [...PROPERTY_CATEGORIES] }`, `MAX_COMUNI = 30` in `src/core/settings.ts`.

- [ ] **Passo 1: Test che falliscono**

In `tests/unit/core/settings.test.ts`:

```ts
describe('validateSettings: zona di lavoro', () => {
  const tre = { istat: '016219', name: 'Treviglio', province: 'BG' };
  it('predefinita: nessun comune, tutte le categorie', () => {
    expect(validateSettings({}).searchArea).toEqual({ comuni: [], categories: ['residential', 'commercial', 'land', 'garage'] });
  });
  it('toglie i doppioni e ordina le categorie', () => {
    const s = validateSettings({ searchArea: { comuni: [tre, tre], categories: ['garage', 'residential', 'garage'] } });
    expect(s.searchArea).toEqual({ comuni: [tre], categories: ['residential', 'garage'] });
  });
  it('rifiuta comuni malformati, troppi comuni e nessuna categoria', () => {
    expect(() => validateSettings({ searchArea: { comuni: [{ ...tre, istat: '16219' }], categories: ['residential'] } })).toThrow('Zona di lavoro non valida');
    const many = Array.from({ length: 31 }, (_, i) => ({ istat: String(100000 + i), name: `C${i}`, province: 'BG' }));
    expect(() => validateSettings({ searchArea: { comuni: many, categories: ['residential'] } })).toThrow('Al massimo 30 comuni');
    expect(() => validateSettings({ searchArea: { comuni: [tre], categories: [] } })).toThrow('Scegli almeno una categoria');
  });
});
```

In `tests/unit/core/backup.test.ts`:

```ts
  it('esporta e reimporta la zona di lavoro', () => {
    const settings = validateSettings({ searchArea: { comuni: [{ istat: '015059', name: "Cassano d'Adda", province: 'MI' }], categories: ['residential'] } });
    const file = buildBackup({ settings, listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, NOW, '0.1.0');
    expect(parseBackup(JSON.parse(JSON.stringify(file))).settings?.searchArea).toEqual(settings.searchArea);
  });
```

Run: `npx vitest run tests/unit/core/settings.test.ts tests/unit/core/backup.test.ts`
Expected: FAIL.

- [ ] **Passo 2: Tipi e predefiniti**

In `src/shared/types.ts`, sotto `ComuneRef`:

```ts
/** Zona di lavoro: dove e cosa cerca il giro delle ricerche. */
export interface SearchArea {
  comuni: ComuneRef[];
  categories: PropertyCategory[];
}
```

In `Settings`, dopo `reportingEnabled`:

```ts
  /** Comuni e categorie del giro delle ricerche; senza comuni «Cerca» resta spento. */
  searchArea: SearchArea;
```

In `DEFAULT_SETTINGS`: `searchArea: { comuni: [], categories: [...PROPERTY_CATEGORIES] },` (sposta `PROPERTY_CATEGORIES` sopra `DEFAULT_SETTINGS` se serve all'ordine delle dichiarazioni).

- [ ] **Passo 3: Validazione**

In `src/core/settings.ts` (import `PROPERTY_CATEGORIES`, `type ComuneRef`, `type SearchArea` da `@/shared/types`):

```ts
export const MAX_COMUNI = 30;
const INVALID_AREA = 'Zona di lavoro non valida';

function validateArea(input: Partial<SearchArea> | undefined): SearchArea {
  const area = { ...DEFAULT_SETTINGS.searchArea, ...input };
  if (!Array.isArray(area.comuni) || !Array.isArray(area.categories)) throw new Error(INVALID_AREA);
  const comuni: ComuneRef[] = [];
  for (const c of area.comuni as Partial<ComuneRef>[]) {
    if (!c || typeof c.istat !== 'string' || !/^\d{6}$/.test(c.istat) || typeof c.name !== 'string' || !c.name.trim()
      || typeof c.province !== 'string' || !/^[A-Z]{2}$/.test(c.province)) throw new Error(INVALID_AREA);
    if (!comuni.some((x) => x.istat === c.istat)) comuni.push({ istat: c.istat, name: c.name, province: c.province });
  }
  if (comuni.length > MAX_COMUNI) throw new Error(`Al massimo ${MAX_COMUNI} comuni`);
  const categories = PROPERTY_CATEGORIES.filter((k) => (area.categories as string[]).includes(k));
  if (!categories.length) throw new Error('Scegli almeno una categoria');
  return { comuni, categories };
}
```

In `validateSettings`, prima del `return s;`: `s.searchArea = validateArea(input.searchArea);`.

- [ ] **Passo 4: Backup**

In `src/core/backup.ts`, in `SettingsSchema` aggiungi:

```ts
  searchArea: z.object({
    comuni: z.array(z.object({ istat: z.string(), name: z.string(), province: z.string() })),
    categories: z.array(z.string()),
  }).optional(),
```

(la validazione vera la fa `validateSettings`, come per gli altri campi).

- [ ] **Passo 5: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS (se un test confronta `DEFAULT_SETTINGS` o impostazioni intere, aggiungi `searchArea` all'atteso).

```bash
git add src tests
git commit -m "feat(settings): zona di lavoro (comuni e categorie) nelle impostazioni e nel backup"
```

---

### Task 7: Interfaccia della zona (impostazioni e onboarding)

**File:**
- Crea: `src/ui/sidepanel/ZoneEditor.tsx`, `src/ui/onboarding/ZoneStep.tsx`, `tests/unit/ui/zone.test.tsx`
- Modifica: `src/ui/sidepanel/SettingsView.tsx`, `src/ui/onboarding/Onboarding.tsx`, `src/ui/sidepanel/styles.css`

**Interfacce:**
- Consuma: `searchComuni`, `toRef` (Task 5); `SearchArea`, `MAX_COMUNI` (Task 6).
- Produce: `ZoneEditor({ value: SearchArea; onChange(next: SearchArea): void })`, `ZoneStep({ api: Pick<Api, 'saveSettings'>; initial: Settings })`.

- [ ] **Passo 1: Test che fallisce**

`tests/unit/ui/zone.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type SearchArea } from '@/shared/types';
import { ZoneEditor } from '@/ui/sidepanel/ZoneEditor';

describe('ZoneEditor', () => {
  it('aggiunge un comune dai suggerimenti e lo toglie', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ZoneEditor value={DEFAULT_SETTINGS.searchArea} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Comuni'), { target: { value: 'trevig' } });
    fireEvent.click(screen.getByRole('button', { name: 'Treviglio (BG)' }));
    const next = onChange.mock.calls[0]![0] as SearchArea;
    expect(next.comuni.map((c) => c.name)).toEqual(['Treviglio']);
    rerender(<ZoneEditor value={next} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Togli Treviglio' }));
    expect((onChange.mock.calls[1]![0] as SearchArea).comuni).toEqual([]);
  });

  it("l'ultima categoria non si può togliere", () => {
    const onChange = vi.fn();
    render(<ZoneEditor value={{ comuni: [], categories: ['garage'] }} onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'Box' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terreni' }));
    expect(onChange).toHaveBeenCalledWith({ comuni: [], categories: ['land', 'garage'] });
  });
});
```

Run: `npx vitest run tests/unit/ui/zone.test.tsx`
Expected: FAIL, modulo inesistente.

- [ ] **Passo 2: `ZoneEditor`**

`src/ui/sidepanel/ZoneEditor.tsx`:

```tsx
import { useId, useState } from 'react';
import { searchComuni, toRef, type ComuneInfo } from '@/core/comuni';
import { MAX_COMUNI } from '@/core/settings';
import { CATEGORY_LABELS, PROPERTY_CATEGORIES, type PropertyCategory, type SearchArea } from '@/shared/types';
import { CloseIcon } from './Icons';

/** Comuni e categorie del giro delle ricerche. Controllato: chi lo usa decide quando salvare. */
export function ZoneEditor({ value, onChange }: { value: SearchArea; onChange(next: SearchArea): void }) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const chosen = new Set(value.comuni.map((c) => c.istat));
  const full = value.comuni.length >= MAX_COMUNI;
  const suggestions = full ? [] : searchComuni(query).filter((c) => !chosen.has(c.istat));

  const add = (c: ComuneInfo) => {
    onChange({ ...value, comuni: [...value.comuni, toRef(c)] });
    setQuery('');
  };
  const remove = (istat: string) => onChange({ ...value, comuni: value.comuni.filter((c) => c.istat !== istat) });
  const toggle = (k: PropertyCategory) => {
    const next = value.categories.includes(k) ? value.categories.filter((x) => x !== k) : [...value.categories, k];
    if (next.length) onChange({ ...value, categories: PROPERTY_CATEGORIES.filter((x) => next.includes(x)) });
  };

  return (
    <div className="zone">
      <label htmlFor={`${ids}-q`} className="zone__label">Comuni</label>
      <input
        id={`${ids}-q`}
        className="field"
        type="search"
        placeholder={full ? `Al massimo ${MAX_COMUNI} comuni` : 'Scrivi un comune…'}
        disabled={full}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {suggestions.length > 0 && (
        <ul className="zone__suggestions" aria-label="Comuni suggeriti">
          {suggestions.map((c) => (
            <li key={c.istat}>
              <button type="button" className="zone__suggestion" onClick={() => add(c)}>{`${c.name} (${c.province.sigla})`}</button>
            </li>
          ))}
        </ul>
      )}
      {value.comuni.length > 0 ? (
        <ul className="zone__chips" aria-label="Comuni scelti">
          {value.comuni.map((c) => (
            <li key={c.istat} className="chip chip--on zone__chip">
              {`${c.name} (${c.province})`}
              <button type="button" className="icon-btn" aria-label={`Togli ${c.name}`} title={`Togli ${c.name}`} onClick={() => remove(c.istat)}>
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card__text">Nessun comune scelto: il pulsante «Cerca» resta spento.</p>
      )}
      <fieldset className="zone__categories">
        <legend className="zone__label">Categorie</legend>
        {PROPERTY_CATEGORIES.map((k) => {
          const on = value.categories.includes(k);
          return (
            <label key={k} className="zone__category">
              <input type="checkbox" checked={on} disabled={on && value.categories.length === 1} onChange={() => toggle(k)} />
              {CATEGORY_LABELS[k]}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
```

CSS in `src/ui/sidepanel/styles.css` (in fondo):

```css
/* Zona di lavoro: campo con suggerimenti, comuni scelti, categorie. */
.zone { display: grid; gap: 8px; }
.zone__label { font-size: 12px; font-weight: 600; color: var(--muted); }
.zone__suggestions, .zone__chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.zone__suggestions { flex-direction: column; gap: 2px; }
.zone__suggestion { width: 100%; text-align: left; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); cursor: pointer; }
.zone__suggestion:hover { border-color: var(--brand); background: var(--brand-soft); }
.zone__chip { display: inline-flex; align-items: center; gap: 4px; }
.zone__categories { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.zone__category { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; }
```

Run: `npx vitest run tests/unit/ui/zone.test.tsx`
Expected: PASS.

- [ ] **Passo 3: Scheda nelle impostazioni**

In `src/ui/sidepanel/SettingsView.tsx`:
- import `ZoneEditor` da `./ZoneEditor`;
- in `applySaved`, nell'oggetto aggiornato, aggiungi `searchArea: result.searchArea,` (così un salvataggio successivo dei campi numerici non riporta indietro la zona);
- come **prima** card dentro `<section className="settings">` (dopo il messaggio):

```tsx
      <div className="card">
        <div className="settings__row">
          <h2 className="card__title">La tua zona</h2>
          <InfoTip label="La tua zona">
            I comuni e le categorie che «Cerca» visita sui portali attivi. Le case si cercano comune per comune; negozi,
            uffici, box e terreni nella provincia, tenendo solo i comuni scelti. Ogni modifica è salvata subito.
          </InfoTip>
        </div>
        <ZoneEditor value={form.searchArea} onChange={(searchArea) => void saveNow({ searchArea }, 'Zona salvata')} />
      </div>
```

- [ ] **Passo 4: Passo "La tua zona" nell'onboarding**

`src/ui/onboarding/ZoneStep.tsx`:

```tsx
import { useState } from 'react';
import type { SearchArea, Settings } from '@/shared/types';
import type { Api } from '@/ui/sidepanel/api';
import { ZoneEditor } from '@/ui/sidepanel/ZoneEditor';

const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

/** Dopo la conferma dell'informativa: comuni e categorie, salvati a ogni modifica. Si può saltare. */
export function ZoneStep({ api, initial }: { api: Pick<Api, 'saveSettings'>; initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function change(searchArea: SearchArea) {
    try {
      setSettings(await api.saveSettings({ ...settings, searchArea }));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <section className="card">
      <h2 className="onboarding__h">La tua zona</h2>
      <p>
        Scegli i comuni in cui lavori: quando premi «Cerca» nel pannello, HomeRadar apre le loro ricerche e aggiorna i lead.
        Puoi farlo anche dopo, dalle impostazioni.
      </p>
      {error && <p className="banner banner--error"><span>{error}</span></p>}
      <ZoneEditor value={settings.searchArea} onChange={(a) => void change(a)} />
    </section>
  );
}
```

In `src/ui/onboarding/Onboarding.tsx`, nel ramo `mode === 'confirm' && (done || …)` (schermata "HomeRadar è attivo"), dopo la `<section className="card">` esistente aggiungi `<ZoneStep api={api} initial={data.settings} />` (import da `./ZoneStep`) e cambia il primo paragrafo in: `Apri una ricerca su Immobiliare.it, Idealista.it o Subito.it, oppure scegli qui sotto la tua zona e premi «Cerca» nel pannello: i lead dei privati si aggiornano da soli.`

- [ ] **Passo 5: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS (se un test dell'onboarding cerca il vecchio testo del paragrafo, aggiorna la stringa attesa).

```bash
git add src/ui tests/unit/ui
git commit -m "feat(ui): zona di lavoro nelle impostazioni e nell'onboarding"
```

---

### Task 8: Ricerche dei portali

**File:**
- Crea: `src/adapters/immobiliare/search-urls.ts`, `src/adapters/idealista/search-urls.ts`, `src/adapters/subito/search-urls.ts`, `src/core/searches.ts`, `tests/unit/core/searches.test.ts`
- Modifica: `src/shared/types.ts`

**Interfacce:**
- Consuma: `ComuneInfo`, `comuneInfo`, `groupByProvince`, `slug` (Task 5); `SearchArea` (Task 6).
- Produce (in `src/shared/types.ts`):

```ts
/** Una ricerca del giro: URL della pagina 1 e regole per tenere gli annunci. Solo dati: si salva in storage.session. */
export interface SearchSpec {
  portal: Portal;
  /** Stabile tra un giro e l'altro: "immobiliare|comune:015059|case", "idealista|prov:BG|negozi", "subito|comune:015059|immobili". */
  key: string;
  /** Per il pannello: "Treviglio · Case", "Provincia di Bergamo · Negozi". */
  label: string;
  /** Categorie ammesse; una sola per Immobiliare e Idealista, quelle scelte per Subito. */
  categories: PropertyCategory[];
  /** Ricerca per provincia: si tengono solo gli annunci dei comuni scelti. */
  byProvince: boolean;
  /** Nomi normalizzati (`normalize`) dei comuni ammessi. */
  cities: string[];
  url: string;
}
```

- In `src/core/searches.ts`: `searchesFor(area: SearchArea, enabled: Record<Portal, boolean>): SearchSpec[]`, `pageUrl(spec: SearchSpec, page: number): string`, `acceptObservation(spec: SearchSpec, o: ListingObservation): boolean`, `searchCategory(spec: SearchSpec): PropertyCategory | null`.
- Ogni `search-urls.ts`: `searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[]` e `pageUrl(first: string, page: number): string`.

Se il Task 1 ha mostrato che `vendita-*/<provincia>-provincia/` non esiste su Idealista, in `src/adapters/idealista/search-urls.ts` usa per le categorie non residenziali lo stesso ciclo per comune di `vendita-case` (chiave `idealista|comune:<istat>|<percorso>`, `byProvince: false`) e adatta il test.

- [ ] **Passo 1: Test che fallisce**

`tests/unit/core/searches.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { acceptObservation, pageUrl, searchCategory, searchesFor } from '@/core/searches';
import type { SearchArea } from '@/shared/types';
import { obs } from './helpers';

const cassano = { istat: '015059', name: "Cassano d'Adda", province: 'MI' };
const ALL = { immobiliare: true, idealista: true, subito: true };

describe('searchesFor', () => {
  it('case per comune, il resto per provincia, Subito una sola ricerca per comune', () => {
    const specs = searchesFor({ comuni: [cassano], categories: ['residential', 'commercial', 'garage', 'land'] }, ALL);
    const urls = specs.map((s) => s.url);
    expect(urls).toContain("https://www.immobiliare.it/vendita-case/cassano-d-adda/?criterio=privateFirst");
    expect(urls).toContain('https://www.immobiliare.it/vendita-negozi/milano-provincia/?criterio=privateFirst');
    expect(urls).toContain('https://www.immobiliare.it/vendita-uffici/milano-provincia/?criterio=privateFirst');
    expect(urls).toContain('https://www.immobiliare.it/vendita-capannoni/milano-provincia/?criterio=privateFirst');
    expect(urls).toContain('https://www.immobiliare.it/vendita-garage/milano-provincia/?criterio=privateFirst');
    expect(urls).toContain('https://www.immobiliare.it/vendita-terreni/milano-provincia/?criterio=privateFirst');
    expect(urls).toContain('https://www.idealista.it/vendita-case/cassano-d-adda-milano/?ordine=da-privati-asc');
    expect(urls).toContain('https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0');
    expect(specs.filter((s) => s.portal === 'subito')).toHaveLength(1);
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
    const shops = specs.find((s) => s.key === 'immobiliare|prov:MI|negozi')!;
    expect(shops).toMatchObject({ byProvince: true, cities: ['cassano d adda'], categories: ['commercial'], label: 'Provincia di Milano · Negozi' });
  });

  it('solo portali attivi e categorie scelte; niente senza comuni', () => {
    const specs = searchesFor({ comuni: [cassano], categories: ['residential'] }, { immobiliare: true, idealista: false, subito: true });
    expect(specs.map((s) => s.key)).toEqual(['immobiliare|comune:015059|case', 'subito|comune:015059|immobili']);
    expect(searchesFor({ comuni: [], categories: ['residential'] }, ALL)).toEqual([]);
  });
});

describe('pageUrl', () => {
  const area: SearchArea = { comuni: [cassano], categories: ['residential'] };
  const [imm, ide, sub] = searchesFor(area, ALL);
  it('aggiunge la pagina come il sito', () => {
    expect(pageUrl(imm!, 1)).toBe(imm!.url);
    expect(pageUrl(imm!, 3)).toBe('https://www.immobiliare.it/vendita-case/cassano-d-adda/?criterio=privateFirst&pag=3');
    expect(pageUrl(ide!, 2)).toBe('https://www.idealista.it/vendita-case/cassano-d-adda-milano/lista-2.htm?ordine=da-privati-asc');
    expect(pageUrl(sub!, 2)).toBe('https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0&o=2');
  });
});

describe('acceptObservation', () => {
  const specs = searchesFor({ comuni: [cassano], categories: ['residential', 'commercial'] }, ALL);
  const byProvince = specs.find((s) => s.key === 'immobiliare|prov:MI|negozi')!;
  const sub = specs.find((s) => s.portal === 'subito')!;
  it('per provincia tiene solo i comuni scelti; senza città scarta', () => {
    expect(acceptObservation(byProvince, obs({ city: "Cassano d'Adda", category: 'commercial' }))).toBe(true);
    expect(acceptObservation(byProvince, obs({ city: 'Milano', category: 'commercial' }))).toBe(false);
    expect(acceptObservation(byProvince, obs({ city: null, category: 'commercial' }))).toBe(false);
  });
  it('scarta le categorie non scelte; categoria sconosciuta passa', () => {
    expect(acceptObservation(sub, obs({ category: 'garage' }))).toBe(false);
    expect(acceptObservation(sub, obs({ category: null }))).toBe(true);
    expect(searchCategory(sub)).toBeNull();
    expect(searchCategory(byProvince)).toBe('commercial');
  });
});
```

Run: `npx vitest run tests/unit/core/searches.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Passo 2: Immobiliare**

`src/adapters/immobiliare/search-urls.ts`:

```ts
import { groupByProvince, slug, type ComuneInfo } from '@/core/comuni';
import { normalize } from '@/core/lead-filters';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

const BASE = 'https://www.immobiliare.it';
// Verificati il 2026-10-17: "privati prima" vale per tutte le categorie; /da-privati/ solo per le case.
const SORT = '?criterio=privateFirst';
const BY_PROVINCE: Record<Exclude<PropertyCategory, 'residential'>, string[]> = {
  commercial: ['negozi', 'uffici', 'capannoni'],
  garage: ['garage'],
  land: ['terreni'],
};
const LABELS: Record<string, string> = { negozi: 'Negozi', uffici: 'Uffici', capannoni: 'Capannoni', garage: 'Box', terreni: 'Terreni' };

/** Case comune per comune; le altre categorie, con pochi privati, una ricerca per provincia. */
export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  const out: SearchSpec[] = [];
  if (categories.includes('residential')) {
    for (const c of comuni) {
      out.push({
        portal: 'immobiliare', key: `immobiliare|comune:${c.istat}|case`, label: `${c.name} · Case`, categories: ['residential'],
        byProvince: false, cities: [normalize(c.name)], url: `${BASE}/vendita-case/${slug(c.name)}/${SORT}`,
      });
    }
  }
  for (const { province, comuni: inProvince } of groupByProvince(comuni)) {
    for (const category of categories) {
      if (category === 'residential') continue;
      for (const path of BY_PROVINCE[category]) {
        out.push({
          portal: 'immobiliare', key: `immobiliare|prov:${province.sigla}|${path}`, label: `Provincia di ${province.name} · ${LABELS[path]}`,
          categories: [category], byProvince: true, cities: inProvince.map((c) => normalize(c.name)),
          url: `${BASE}/vendita-${path}/${slug(province.name)}-provincia/${SORT}`,
        });
      }
    }
  }
  return out;
}

export function pageUrl(first: string, page: number): string {
  const u = new URL(first);
  if (page > 1) u.searchParams.set('pag', String(page));
  return u.toString();
}
```

- [ ] **Passo 3: Idealista**

`src/adapters/idealista/search-urls.ts`:

```ts
import { groupByProvince, slug, type ComuneInfo } from '@/core/comuni';
import { normalize } from '@/core/lead-filters';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

const BASE = 'https://www.idealista.it';
// Verificato il 2026-10-17: "privati prima" e 30 annunci per pagina. "negozi" = "locali o capannoni".
const SORT = '?ordine=da-privati-asc';
const BY_PROVINCE: Record<Exclude<PropertyCategory, 'residential'>, string[]> = {
  commercial: ['negozi', 'uffici'],
  garage: ['garage'],
  land: ['terreni'],
};
const LABELS: Record<string, string> = { negozi: 'Locali e capannoni', uffici: 'Uffici', garage: 'Box', terreni: 'Terreni' };

export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  const out: SearchSpec[] = [];
  if (categories.includes('residential')) {
    for (const c of comuni) {
      out.push({
        portal: 'idealista', key: `idealista|comune:${c.istat}|case`, label: `${c.name} · Case`, categories: ['residential'],
        byProvince: false, cities: [normalize(c.name)], url: `${BASE}/vendita-case/${slug(c.name)}-${slug(c.province.name)}/${SORT}`,
      });
    }
  }
  for (const { province, comuni: inProvince } of groupByProvince(comuni)) {
    for (const category of categories) {
      if (category === 'residential') continue;
      for (const path of BY_PROVINCE[category]) {
        out.push({
          portal: 'idealista', key: `idealista|prov:${province.sigla}|${path}`, label: `Provincia di ${province.name} · ${LABELS[path]}`,
          categories: [category], byProvince: true, cities: inProvince.map((c) => normalize(c.name)),
          url: `${BASE}/vendita-${path}/${slug(province.name)}-provincia/${SORT}`,
        });
      }
    }
  }
  return out;
}

/** Pagine successive: ".../lista-2.htm?ordine=…". */
export function pageUrl(first: string, page: number): string {
  const u = new URL(first);
  if (page > 1) u.pathname = u.pathname.replace(/\/$/, `/lista-${page}.htm`);
  return u.toString();
}
```

- [ ] **Passo 4: Subito**

`src/adapters/subito/search-urls.ts`:

```ts
import { slug, type ComuneInfo } from '@/core/comuni';
import { normalize } from '@/core/lead-filters';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

const BASE = 'https://www.subito.it';

/** Una ricerca per comune: la categoria "immobili" le comprende tutte; advt=0 = solo privati (verificato il 2026-10-17). */
export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  return comuni.map((c) => ({
    portal: 'subito' as const, key: `subito|comune:${c.istat}|immobili`, label: `${c.name} · Immobili`, categories: [...categories],
    byProvince: false, cities: [normalize(c.name)],
    url: `${BASE}/annunci-${slug(c.province.region)}/vendita/immobili/${slug(c.province.name)}/${slug(c.name)}/?advt=0`,
  }));
}

export function pageUrl(first: string, page: number): string {
  const u = new URL(first);
  if (page > 1) u.searchParams.set('o', String(page));
  return u.toString();
}
```

- [ ] **Passo 5: Modulo comune**

`src/core/searches.ts`:

```ts
import * as idealista from '@/adapters/idealista/search-urls';
import * as immobiliare from '@/adapters/immobiliare/search-urls';
import * as subito from '@/adapters/subito/search-urls';
import { comuneInfo, type ComuneInfo } from '@/core/comuni';
import { normalize } from '@/core/lead-filters';
import { PORTALS, type ListingObservation, type Portal, type PropertyCategory, type SearchArea, type SearchSpec } from '@/shared/types';

const BUILDERS: Record<Portal, { searches(c: ComuneInfo[], k: PropertyCategory[]): SearchSpec[]; pageUrl(first: string, page: number): string }> = {
  immobiliare, idealista, subito,
};

/** Ricerche del giro per la zona di lavoro, sui portali attivi. Un comune sconosciuto all'elenco ISTAT si salta. */
export function searchesFor(area: SearchArea, enabled: Record<Portal, boolean>): SearchSpec[] {
  const comuni = area.comuni.map((r) => comuneInfo(r.istat)).filter((c): c is ComuneInfo => c != null);
  if (!comuni.length || !area.categories.length) return [];
  return PORTALS.filter((p) => enabled[p]).flatMap((p) => BUILDERS[p].searches(comuni, area.categories));
}

export function pageUrl(spec: SearchSpec, page: number): string {
  return BUILDERS[spec.portal].pageUrl(spec.url, page);
}

/** Annunci da tenere: categoria scelta (o non riconosciuta) e, per le ricerche per provincia, un comune scelto. */
export function acceptObservation(spec: SearchSpec, o: ListingObservation): boolean {
  if (o.category != null && !spec.categories.includes(o.category)) return false;
  if (!spec.byProvince) return true;
  return o.city != null && spec.cities.includes(normalize(o.city));
}

/** Categoria da usare se la tipologia non la dice; null se la ricerca ne comprende più di una. */
export function searchCategory(spec: SearchSpec): PropertyCategory | null {
  return spec.categories.length === 1 ? spec.categories[0]! : null;
}
```

- [ ] **Passo 6: Verifica e commit**

Run: `npx vitest run tests/unit/core/searches.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add src/adapters/*/search-urls.ts src/core/searches.ts src/shared/types.ts tests/unit/core/searches.test.ts
git commit -m "feat(searches): ricerche del giro per comune e per provincia sui tre portali"
```

---

### Task 9: Pagina letta (`pageRead`) dai content script

**File:**
- Crea: `src/content/page-problem.ts`, `tests/unit/content/page-problem.test.ts`
- Modifica: `src/shared/types.ts` (`PageInfo`, `ParseResult.page`, `PageReport`), `src/shared/messages.ts`, `src/adapters/immobiliare/index.ts`, `src/adapters/subito/index.ts`, `src/adapters/idealista/index.ts`, `src/adapters/idealista/parse.ts`, `src/content/controller.ts`, `src/content/payload-script.ts`, `src/entrypoints/idealista.content.ts`, `src/core/router.ts` (solo il caso `pageRead` che per ora non fa nulla)
- Test: `tests/unit/adapters/immobiliare.test.ts`, `tests/unit/adapters/subito.test.ts`, `tests/unit/adapters/idealista.test.ts`, `tests/unit/content/controller.test.ts`

**Interfacce:**
- Produce:

```ts
/** Riassunto di una pagina di ricerca, per la condizione di fine del giro. */
export interface PageInfo {
  /** Annunci letti in pagina, agenzie comprese. */
  results: number;
  privates: number;
  lastPage: boolean;
}
export interface PageReport extends PageInfo {
  portal: Portal;
  url: string;
  /** Verifica di DataDome ("non sei un robot"). */
  blocked: boolean;
  /** Il portale dice che la pagina non esiste (comune o percorso sbagliato). */
  notFound: boolean;
}
```

`ParseResult.page?: PageInfo`; messaggio `{ type: 'pageRead'; report: PageReport }`; `pageProblem(doc: Document): 'blocked' | 'notFound' | null`; nel controller `checkProblem(doc: Document): Promise<void>`.

- [ ] **Passo 1: Test che falliscono**

`tests/unit/content/page-problem.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pageProblem } from '@/content/page-problem';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('pageProblem', () => {
  it('riconosce la verifica di DataDome', () => {
    expect(pageProblem(doc('<body><iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe></body>'))).toBe('blocked');
    expect(pageProblem(doc('<body><h1>Ops! Al momento non siamo disponibili</h1></body>'))).toBe('blocked');
  });
  it('riconosce la pagina inesistente di Immobiliare', () => {
    expect(pageProblem(doc('<body><p>La pagina che stai cercando non è presente sul nostro sito o non è più disponibile.</p></body>'))).toBe('notFound');
  });
  it('null su una pagina normale', () => {
    expect(pageProblem(doc('<body><ul><li>annuncio</li></ul></body>'))).toBeNull();
  });
});
```

Negli adapter (aggiungi ai file di test esistenti, riusando i costruttori di payload che i file già hanno: `tests/unit/adapters/builders.ts`, `subito-builders.ts`, `idealista-builders.ts`; i nomi qui sotto sono quelli da cercare in quei file, adatta se diversi):

```ts
// immobiliare.test.ts
it('riassume la pagina: annunci, privati e ultima pagina', () => {
  const data = { results: [privateResult(1), agencyResult(2)], currentPage: 2, maxPages: 2 };
  expect(parseSearchData(data).page).toEqual({ results: 2, privates: 1, lastPage: true });
  expect(parseSearchData({ ...data, currentPage: 1 }).page).toMatchObject({ lastPage: false });
  expect(parseSearchData({ results: [] }).page).toEqual({ results: 0, privates: 0, lastPage: true });
});
```

```ts
// subito.test.ts
it('riassume la pagina dal numero di pagine e dal parametro o', () => {
  const json = nextDataWith([privateAd(1), privateAd(2)], { totalPages: 3 });
  expect(subitoAdapter.parseNextData(json, 'https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0').page)
    .toEqual({ results: 2, privates: 2, lastPage: false });
  expect(subitoAdapter.parseNextData(json, 'https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0&o=3').page)
    .toMatchObject({ lastPage: true });
});
```

```ts
// idealista.test.ts
it('riassume la pagina: ultima se manca il link alla successiva', () => {
  const root = searchPage([privateCard(1), agencyCard(2)], { pagination: ['/vendita-case/treviglio-bergamo/lista-2.htm'] });
  expect(idealistaAdapter.readDocument!(root, 'https://www.idealista.it/vendita-case/treviglio-bergamo/').page).toEqual({ results: 2, privates: 1, lastPage: false });
  expect(idealistaAdapter.readDocument!(root, 'https://www.idealista.it/vendita-case/treviglio-bergamo/lista-2.htm').page).toMatchObject({ lastPage: true });
});
```

Se i costruttori dei test non prevedono `currentPage`/`maxPages`, `totalPages` o la paginazione, aggiungili ai costruttori come parametri facoltativi (per Idealista: `<div class="pagination"><ul><li><a href="…">2</a></li></ul></div>` nel corpo).

In `tests/unit/content/controller.test.ts` (riusa la configurazione del file per un adapter in modalità payload, con `send` finto che registra le richieste):

```ts
it('dopo la lettura invia pageRead, anche senza annunci', async () => {
  // adapter finto: parsePayload restituisce { observations: [], errors: [], page: { results: 0, privates: 0, lastPage: true } }
  await controller.handle('next-data', url, {});
  expect(sent.at(-1)).toEqual({ type: 'pageRead', report: { portal: 'immobiliare', url, results: 0, privates: 0, lastPage: true, blocked: false, notFound: false } });
});

it('checkProblem segnala la verifica solo sulle pagine di ricerca', async () => {
  const d = new DOMParser().parseFromString('<body><iframe src="https://geo.captcha-delivery.com/x"></iframe></body>', 'text/html');
  await controller.checkProblem(d);
  expect(sent.at(-1)).toMatchObject({ type: 'pageRead', report: { blocked: true, notFound: false, results: 0 } });
});
```

Run: `npx vitest run tests/unit/content tests/unit/adapters`
Expected: FAIL sui casi nuovi.

- [ ] **Passo 2: Tipi e messaggio**

In `src/shared/types.ts`: aggiungi `PageInfo` e `PageReport` (sopra), e in `ParseResult`:

```ts
  /** Pagine di ricerca: riassunto per il giro delle ricerche. */
  page?: PageInfo;
```

In `src/shared/messages.ts`, nell'unione `Request`: `| { type: 'pageRead'; report: PageReport }` (import `PageReport`).

In `src/core/router.ts`, nello `switch`, un caso provvisorio (il Task 12 lo collega al giro):

```ts
    case 'pageRead':
      return null;
```

- [ ] **Passo 3: `pageProblem`**

`src/content/page-problem.ts`:

```ts
/** Pagine che il giro deve riconoscere: verifica di DataDome o pagina inesistente. */
export type PageProblem = 'blocked' | 'notFound';

export function pageProblem(doc: Document): PageProblem | null {
  if (doc.querySelector('iframe[src*="captcha-delivery.com"]')) return 'blocked';
  const text = doc.body?.textContent ?? '';
  if (/Al momento non siamo disponibili/i.test(text)) return 'blocked';
  if (/La pagina che stai cercando non è presente/i.test(text)) return 'notFound';
  return null;
}
```

- [ ] **Passo 4: Riassunto di pagina negli adapter**

`src/adapters/immobiliare/index.ts`, in fondo a `parseSearchData` prima di `return out;`:

```ts
  const d = obj(data);
  const total = out.observations.length;
  const current = typeof d?.currentPage === 'number' ? d.currentPage : null;
  const max = typeof d?.maxPages === 'number' ? d.maxPages : null;
  out.page = {
    results: total,
    privates: out.observations.filter((o) => o.sellerType === 'private').length,
    lastPage: results.length === 0 || (current != null && max != null && current >= max),
  };
```

`src/adapters/subito/index.ts`, in `parseNextData`, sostituisci il `return parseAds(...)` con:

```ts
  const result = parseAds([...items.originalList, ...listOf(items.galleryList), ...listOf(items.boostedItems)], 'next', now);
  const total = typeof items.totalPages === 'number' ? items.totalPages : null;
  const page = Number(new URL(url, 'https://www.subito.it').searchParams.get('o') ?? '1') || 1;
  result.page = {
    results: result.observations.length,
    privates: result.observations.filter((o) => o.sellerType === 'private').length,
    lastPage: items.originalList.length === 0 || (total != null && page >= total),
  };
  return result;
```

`src/adapters/idealista/parse.ts`, nuova funzione esportata:

```ts
/** C'è un link alla pagina successiva (".../lista-N.htm") nella paginazione. */
export function hasNextPage(root: ParentNode, url: string): boolean {
  const m = /\/lista-(\d+)\.htm/.exec(new URL(url, 'https://www.idealista.it').pathname);
  const next = `/lista-${(m ? Number(m[1]) : 1) + 1}.htm`;
  return [...root.querySelectorAll('.pagination a[href]')].some((a) => (a.getAttribute('href') ?? '').includes(next));
}
```

`src/adapters/idealista/index.ts`, in `readDocument`, dopo `const result = parseSearch(root);`:

```ts
    result.page = {
      results: result.observations.length,
      privates: result.observations.filter((o) => o.sellerType === 'private').length,
      lastPage: !hasNextPage(root, url),
    };
```

- [ ] **Passo 5: Controller**

In `src/content/controller.ts` (import `pageProblem` da `@/content/page-problem`):
- in `process`, sostituisci `if (!result.observations.length) return;` e le righe seguenti con:

```ts
    if (result.observations.length) {
      const calibrationHint = result.newestId != null ? { portal: adapter.portal, portalId: result.newestId } : undefined;
      const evs = (await send({ type: 'ingest', observations: result.observations, ...(calibrationHint ? { calibrationHint } : {}) })) as Evaluation[];
      for (const ev of evs) evaluations.set(ev.portalId, ev);
      applyAll();
    }
    // Dopo ingest: il giro conta gli annunci già salvati quando passa alla pagina successiva.
    if (result.page) {
      await send({ type: 'pageRead', report: { portal: adapter.portal, url: getUrl(), ...result.page, blocked: false, notFound: false } });
    }
```

- nuova funzione, restituita insieme alle altre:

```ts
  /** Pagina di ricerca senza dati perché il portale chiede una verifica o non trova la pagina: lo dice al giro. */
  async function checkProblem(doc: Document): Promise<void> {
    if (adapter.pageKind(getUrl()) !== 'search') return;
    const problem = pageProblem(doc);
    if (!problem) return;
    await send({
      type: 'pageRead',
      report: { portal: adapter.portal, url: getUrl(), results: 0, privates: 0, lastPage: true, blocked: problem === 'blocked', notFound: problem === 'notFound' },
    });
  }

  return { handle, scan, applyAll, hasUnseenListings, isEnabled, checkProblem };
```

In `src/content/payload-script.ts`, dopo `watcher.check();`:

```ts
  // Verifica di DataDome o pagina inesistente: nessun payload arriverà, il giro lo deve sapere subito.
  setTimeout(() => void controller.checkProblem(document).catch(() => {}), 2500);
```

In `src/entrypoints/idealista.content.ts`, dopo `scan();`: la stessa riga.

- [ ] **Passo 6: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src tests
git commit -m "feat(content): riassunto della pagina letta e riconoscimento di verifica e pagina inesistente"
```

---

### Task 10: Stato del giro (logica pura)

**File:**
- Crea: `src/core/sweep.ts`, `tests/unit/core/sweep.test.ts`
- Modifica: `src/shared/types.ts` (tipi dell'esito e dell'avanzamento)

**Interfacce:**
- Consuma: `SearchSpec`, `PageReport` (Task 8, 9), `pageUrl` (Task 8).
- Produce (in `src/shared/types.ts`):

```ts
export type SweepOutcome = 'completed' | 'partial' | 'stopped' | 'interrupted';
export type PortalSweepOutcome = 'complete' | 'capped' | 'blocked' | 'error' | 'skipped';
export interface PortalSweepStats { pages: number; privates: number; outcome: PortalSweepOutcome }
/** Esito dell'ultimo giro, in `meta.sweep` (fuori dal backup). */
export interface SweepResult {
  startedAt: number;
  finishedAt: number;
  outcome: SweepOutcome;
  portals: Partial<Record<Portal, PortalSweepStats>>;
  /** Ricerche che il portale non riconosce: "Treviglio · Case (Idealista)". */
  notFound: string[];
  newCount: number;
  drops: number;
  missing: number;
}
export interface SweepProgress {
  startedAt: number;
  total: number;
  done: number;
  current: string | null;
  portals: Partial<Record<Portal, { pages: number; privates: number }>>;
  newCount: number;
  drops: number;
}
export interface SweepStatus { running: SweepProgress | null; last: SweepResult | null }
```

- In `src/core/sweep.ts`: costanti `MAX_PAGES_PER_SEARCH`, `MAX_PAGES_PER_PORTAL`, `PAGE_TIMEOUT_MS`, `PAUSE_MS`; tipi `SearchOutcome`, `SearchRun`, `SweepState`; funzioni `createSweep(specs, now, id)`, `skipDisabled(s, enabled)`, `nextStep(s): number | null`, `beginStep(s, index)`, `stepUrl(s, index)`, `onPageRead(s, r)`, `onTimeout(s)`, `markSeen(s, observations)`, `finishSweep(s, now)`, `stopSweep(s, how, now)`, `completeScopes(s): string[]`, `pauseMs(portal, random)`, `buildResult(s, counts)`, `progressOf(s, newCount)`.

- [ ] **Passo 1: Test che falliscono**

`tests/unit/core/sweep.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  beginStep, buildResult, completeScopes, createSweep, finishSweep, MAX_PAGES_PER_PORTAL, MAX_PAGES_PER_SEARCH, markSeen, nextStep,
  onPageRead, onTimeout, pauseMs, progressOf, skipDisabled, stepUrl, stopSweep, type SweepState,
} from '@/core/sweep';
import type { PageReport, Portal, SearchSpec } from '@/shared/types';
import { obs } from './helpers';

const spec = (portal: Portal, key: string, url: string): SearchSpec => ({
  portal, key, label: key, categories: ['residential'], byProvince: false, cities: ['treviglio'], url,
});
const IMM = spec('immobiliare', 'immobiliare|comune:016219|case', 'https://www.immobiliare.it/vendita-case/treviglio/?criterio=privateFirst');
const IDE = spec('idealista', 'idealista|comune:016219|case', 'https://www.idealista.it/vendita-case/treviglio-bergamo/?ordine=da-privati-asc');
const SUB = spec('subito', 'subito|comune:016219|immobili', 'https://www.subito.it/annunci-lombardia/vendita/immobili/bergamo/treviglio/?advt=0');
const report = (portal: Portal, o: Partial<PageReport> = {}): PageReport => ({
  portal, url: 'x', results: 25, privates: 25, lastPage: false, blocked: false, notFound: false, ...o,
});
/** Avanza: sceglie il passo e lo marca in corso. */
const step = (s: SweepState) => beginStep(s, nextStep(s)!);

describe('giro: passi', () => {
  it('alterna i portali e costruisce gli URL di pagina', () => {
    let s = createSweep([IMM, { ...IMM, key: 'immobiliare|b' }, IDE, SUB], 0, 'id');
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('immobiliare');
    expect(stepUrl(s, s.current!)).toBe(IMM.url);
    s = onPageRead(s, report('immobiliare'));
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('idealista');
    s = onPageRead(s, report('idealista', { privates: 3 }));
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('subito');
    s = onPageRead(s, report('subito', { lastPage: true }));
    s = step(s);
    expect(s.runs[s.current!]!.spec.portal).toBe('immobiliare');
    expect(stepUrl(s, s.current!)).toBe(`${IMM.url}&pag=2`);
  });

  it('fine ricerca: prima pagina con un\'agenzia (Immobiliare, Idealista), ultima pagina o pagina vuota', () => {
    let s = step(createSweep([IMM], 0, 'id'));
    s = onPageRead(s, report('immobiliare', { results: 25, privates: 24 }));
    expect(s.runs[0]!.outcome).toBe('complete');
    s = step(createSweep([SUB], 0, 'id'));
    s = onPageRead(s, report('subito', { results: 30, privates: 20 }));
    expect(s.runs[0]!.outcome).toBe('pending');
    s = step(s);
    s = onPageRead(s, report('subito', { results: 0, privates: 0 }));
    expect(s.runs[0]!.outcome).toBe('complete');
    expect(nextStep(s)).toBeNull();
  });

  it('tetto per ricerca e per portale', () => {
    let s = createSweep([IMM], 0, 'id');
    for (let i = 0; i < MAX_PAGES_PER_SEARCH; i++) s = onPageRead(step(s), report('immobiliare'));
    expect(s.runs[0]!.outcome).toBe('capped');
    const many = Array.from({ length: MAX_PAGES_PER_PORTAL + 1 }, (_, i) => ({ ...IMM, key: `k${i}` }));
    s = createSweep(many, 0, 'id');
    for (let i = 0; i < MAX_PAGES_PER_PORTAL; i++) s = onPageRead(step(s), report('immobiliare', { privates: 1 }));
    expect(s.runs.at(-1)!.outcome).toBe('capped');
    expect(s.halted.immobiliare).toBe('capped');
  });

  it('blocco: ferma il portale, gli altri proseguono', () => {
    let s = createSweep([IDE, { ...IDE, key: 'idealista|b' }, SUB], 0, 'id');
    s = step(s);
    s = onPageRead(s, report('idealista', { blocked: true, results: 0, privates: 0 }));
    expect(s.runs.map((r) => r.outcome)).toEqual(['blocked', 'skipped', 'pending']);
    expect(s.runs[nextStep(s)!]!.spec.portal).toBe('subito');
  });

  it('timeout: ricerca in errore; due di fila fermano il portale', () => {
    let s = createSweep([IMM, { ...IMM, key: 'b' }, { ...IMM, key: 'c' }], 0, 'id');
    s = onTimeout(step(s));
    expect(s.runs[0]!.outcome).toBe('error');
    expect(s.halted.immobiliare).toBeUndefined();
    s = onTimeout(step(s));
    expect(s.runs.map((r) => r.outcome)).toEqual(['error', 'error', 'skipped']);
    expect(s.halted.immobiliare).toBe('error');
  });

  it('pagina inesistente: ricerca chiusa e segnalata', () => {
    let s = onPageRead(step(createSweep([SUB], 0, 'id')), report('subito', { notFound: true, results: 0, privates: 0 }));
    expect(s.runs[0]!.outcome).toBe('notFound');
    s = finishSweep(s, 10);
    expect(buildResult(s, { newCount: 0, missing: 0 }).notFound).toEqual(['subito|comune:016219|immobili (Subito)']);
  });

  it('un pageRead di un altro portale o senza pagina in corso non cambia nulla', () => {
    const s = step(createSweep([IMM], 0, 'id'));
    expect(onPageRead(s, report('subito'))).toBe(s);
    const idle = createSweep([IMM], 0, 'id');
    expect(onPageRead(idle, report('immobiliare'))).toBe(idle);
  });

  it('portale spento: le sue ricerche si saltano', () => {
    const s = skipDisabled(createSweep([IMM, SUB], 0, 'id'), { immobiliare: false, idealista: true, subito: true });
    expect(s.runs.map((r) => r.outcome)).toEqual(['skipped', 'pending']);
  });
});

describe('giro: esito', () => {
  it('completato solo se tutte le ricerche sono complete o inesistenti; le complete danno le chiavi', () => {
    let s = createSweep([IMM, SUB], 0, 'id');
    s = onPageRead(step(s), report('immobiliare', { privates: 3 }));
    s = onPageRead(step(s), report('subito', { lastPage: true }));
    s = finishSweep(s, 60_000);
    expect(s.status).toBe('completed');
    expect(completeScopes(s)).toEqual([IMM.key, SUB.key]);
    const r = buildResult(s, { newCount: 4, missing: 1 });
    expect(r).toMatchObject({ outcome: 'completed', finishedAt: 60_000, newCount: 4, drops: 0, missing: 1 });
    expect(r.portals.immobiliare).toEqual({ pages: 1, privates: 3, outcome: 'complete' });
  });

  it('fermato o interrotto: le ricerche aperte risultano saltate', () => {
    const s = stopSweep(step(createSweep([IMM, SUB], 0, 'id')), 'stopped', 5);
    expect(s.status).toBe('stopped');
    expect(s.runs.every((r) => r.outcome === 'skipped')).toBe(true);
    expect(buildResult(s, { newCount: 0, missing: 0 }).portals.immobiliare!.outcome).toBe('skipped');
  });

  it('esito per portale: blocco, errore, tetto', () => {
    let s = createSweep([IDE, SUB], 0, 'id');
    s = onPageRead(step(s), report('idealista', { blocked: true }));
    s = onTimeout(step(s));
    s = finishSweep(s, 1);
    const r = buildResult(s, { newCount: 0, missing: 0 });
    expect(r.outcome).toBe('partial');
    expect(r.portals.idealista!.outcome).toBe('blocked');
    expect(r.portals.subito!.outcome).toBe('error');
  });

  it('annunci visti e avanzamento', () => {
    let s = step(createSweep([IMM, SUB], 100, 'id'));
    s = markSeen(s, [obs(), obs({ portalId: 2, sellerType: 'agency' })]);
    expect(s.seen).toEqual(['immobiliare:128416572']);
    s = { ...s, drops: ['immobiliare:128416572'] };
    expect(progressOf(s, 2)).toEqual({ startedAt: 100, total: 2, done: 0, current: IMM.key, portals: { immobiliare: { pages: 0, privates: 0 }, subito: { pages: 0, privates: 0 } }, newCount: 2, drops: 1 });
  });

  it('pause nell\'intervallo del portale', () => {
    expect(pauseMs('immobiliare', () => 0)).toBe(4000);
    expect(pauseMs('immobiliare', () => 0.999)).toBeLessThan(10_000);
    expect(pauseMs('idealista', () => 0)).toBe(8000);
  });
});
```

Run: `npx vitest run tests/unit/core/sweep.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Passo 2: Tipi**

Aggiungi a `src/shared/types.ts` i tipi del blocco "Produce" sopra.

- [ ] **Passo 3: Implementa**

`src/core/sweep.ts`:

```ts
import { pageUrl } from '@/core/searches';
import {
  listingKey, PORTAL_TAGS, PORTALS,
  type ListingObservation, type PageReport, type Portal, type PortalSweepOutcome, type SearchSpec, type SweepOutcome, type SweepProgress, type SweepResult,
} from '@/shared/types';

// Valori iniziali dalla fase 0 (2026-10-17); rivisti con la prova di ritmo.
export const MAX_PAGES_PER_SEARCH = 10;
export const MAX_PAGES_PER_PORTAL = 60;
// Build di test (WXT_SWEEP_FAST=1, solo e2e): pause e attese brevi. Mai nella build del pilota.
const FAST = import.meta.env.WXT_SWEEP_FAST === '1';
export const PAGE_TIMEOUT_MS = FAST ? 5_000 : 45_000;
export const PAUSE_MS: Record<Portal, [number, number]> = FAST
  ? { immobiliare: [100, 200], idealista: [100, 200], subito: [100, 200] }
  : { immobiliare: [4_000, 10_000], idealista: [8_000, 14_000], subito: [4_000, 10_000] };

export type SearchOutcome = 'pending' | 'complete' | 'capped' | 'blocked' | 'error' | 'notFound' | 'skipped';

export interface SearchRun {
  spec: SearchSpec;
  /** Pagine lette. */
  pages: number;
  privates: number;
  outcome: SearchOutcome;
}

/** Stato del giro: solo dati, salvato in storage.session a ogni passo. */
export interface SweepState {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | SweepOutcome;
  runs: SearchRun[];
  /** Ricerca la cui pagina è in caricamento; null tra una pagina e l'altra. */
  current: number | null;
  /** Portale dell'ultima pagina avviata, per alternare. */
  lastPortal: Portal | null;
  errorsInRow: Partial<Record<Portal, number>>;
  /** Portali fermati in questo giro e perché. */
  halted: Partial<Record<Portal, 'blocked' | 'error' | 'capped'>>;
  /** Annunci di privati visti nel giro (chiavi). */
  seen: string[];
  /** Annunci già salvati con un ribasso trovato nel giro (chiavi). */
  drops: string[];
}

export function createSweep(specs: SearchSpec[], now: number, id: string): SweepState {
  return {
    id, startedAt: now, finishedAt: null, status: 'running', runs: specs.map((spec) => ({ spec, pages: 0, privates: 0, outcome: 'pending' })),
    current: null, lastPortal: null, errorsInRow: {}, halted: {}, seen: [], drops: [],
  };
}

const withRuns = (s: SweepState, fn: (r: SearchRun) => SearchRun): SweepState => ({ ...s, runs: s.runs.map(fn) });

function halt(s: SweepState, portal: Portal, why: 'blocked' | 'error' | 'capped'): SweepState {
  const outcome: SearchOutcome = why === 'capped' ? 'capped' : 'skipped';
  return { ...withRuns(s, (r) => (r.spec.portal === portal && r.outcome === 'pending' ? { ...r, outcome } : r)), halted: { ...s.halted, [portal]: why } };
}

/** Portali spenti dall'agente a giro in corso: le loro ricerche aperte si saltano. */
export function skipDisabled(s: SweepState, enabled: Record<Portal, boolean>): SweepState {
  return withRuns(s, (r) => (!enabled[r.spec.portal] && r.outcome === 'pending' ? { ...r, outcome: 'skipped' } : r));
}

/** Prossima ricerca: il portale dopo l'ultimo usato che ha ancora ricerche aperte. */
export function nextStep(s: SweepState): number | null {
  const start = s.lastPortal ? PORTALS.indexOf(s.lastPortal) + 1 : 0;
  for (let i = 0; i < PORTALS.length; i++) {
    const p = PORTALS[(start + i) % PORTALS.length]!;
    const idx = s.runs.findIndex((r) => r.spec.portal === p && r.outcome === 'pending');
    if (idx >= 0) return idx;
  }
  return null;
}

export function beginStep(s: SweepState, index: number): SweepState {
  return { ...s, current: index, lastPortal: s.runs[index]!.spec.portal };
}

export function stepUrl(s: SweepState, index: number): string {
  const run = s.runs[index]!;
  return pageUrl(run.spec, run.pages + 1);
}

/** Immobiliare e Idealista mettono i privati prima: la prima agenzia chiude la ricerca. Subito filtra già i privati. */
function isLastPage(portal: Portal, r: PageReport): boolean {
  return r.results === 0 || r.lastPage || (portal !== 'subito' && r.privates < r.results);
}

const portalPages = (s: SweepState, p: Portal) => s.runs.reduce((n, r) => n + (r.spec.portal === p ? r.pages : 0), 0);

export function onPageRead(s: SweepState, r: PageReport): SweepState {
  if (s.current == null) return s;
  const index = s.current;
  const portal = s.runs[index]!.spec.portal;
  if (portal !== r.portal) return s;
  const set = (patch: Partial<SearchRun>): SweepState => ({
    ...s, current: null, errorsInRow: { ...s.errorsInRow, [portal]: 0 }, runs: s.runs.map((x, i) => (i === index ? { ...x, ...patch } : x)),
  });
  if (r.blocked) return halt(set({ outcome: 'blocked' }), portal, 'blocked');
  if (r.notFound) return set({ outcome: 'notFound' });
  const run = s.runs[index]!;
  const pages = run.pages + 1;
  const outcome: SearchOutcome = isLastPage(portal, r) ? 'complete' : pages >= MAX_PAGES_PER_SEARCH ? 'capped' : 'pending';
  const next = set({ pages, privates: run.privates + r.privates, outcome });
  return portalPages(next, portal) >= MAX_PAGES_PER_PORTAL ? halt(next, portal, 'capped') : next;
}

export function onTimeout(s: SweepState): SweepState {
  if (s.current == null) return s;
  const index = s.current;
  const portal = s.runs[index]!.spec.portal;
  const errors = (s.errorsInRow[portal] ?? 0) + 1;
  const next: SweepState = {
    ...s, current: null, errorsInRow: { ...s.errorsInRow, [portal]: errors },
    runs: s.runs.map((x, i) => (i === index ? { ...x, outcome: 'error' } : x)),
  };
  return errors >= 2 ? halt(next, portal, 'error') : next;
}

/** Annunci di privati visti nel giro: servono a "non più visto". */
export function markSeen(s: SweepState, observations: ListingObservation[]): SweepState {
  const keys = observations.filter((o) => o.sellerType === 'private').map((o) => listingKey(o.portal, o.portalId));
  const fresh = keys.filter((k) => !s.seen.includes(k));
  return fresh.length ? { ...s, seen: [...s.seen, ...new Set(fresh)] } : s;
}

export function finishSweep(s: SweepState, now: number): SweepState {
  const ok = s.runs.every((r) => r.outcome === 'complete' || r.outcome === 'notFound');
  return { ...s, current: null, finishedAt: now, status: ok ? 'completed' : 'partial' };
}

export function stopSweep(s: SweepState, how: 'stopped' | 'interrupted', now: number): SweepState {
  return { ...withRuns(s, (r) => (r.outcome === 'pending' ? { ...r, outcome: 'skipped' } : r)), current: null, finishedAt: now, status: how };
}

/** Ricerche complete: solo i loro annunci mancanti contano per "non più visto". */
export function completeScopes(s: SweepState): string[] {
  return s.runs.filter((r) => r.outcome === 'complete').map((r) => r.spec.key);
}

export function pauseMs(portal: Portal, random: () => number): number {
  const [min, max] = PAUSE_MS[portal];
  return Math.floor(min + random() * (max - min));
}

function portalOutcome(s: SweepState, p: Portal): PortalSweepOutcome {
  if (s.halted[p] === 'blocked') return 'blocked';
  const outcomes = s.runs.filter((r) => r.spec.portal === p).map((r) => r.outcome);
  if (outcomes.includes('error')) return 'error';
  if (outcomes.includes('capped')) return 'capped';
  if (outcomes.includes('skipped') || outcomes.includes('pending')) return 'skipped';
  return 'complete';
}

const portalsOf = (s: SweepState) => PORTALS.filter((p) => s.runs.some((r) => r.spec.portal === p));

function totals(s: SweepState, p: Portal): { pages: number; privates: number } {
  return s.runs.filter((r) => r.spec.portal === p).reduce((t, r) => ({ pages: t.pages + r.pages, privates: t.privates + r.privates }), { pages: 0, privates: 0 });
}

export function buildResult(s: SweepState, counts: { newCount: number; missing: number }): SweepResult {
  return {
    startedAt: s.startedAt,
    finishedAt: s.finishedAt ?? s.startedAt,
    outcome: s.status === 'running' ? 'interrupted' : s.status,
    portals: Object.fromEntries(portalsOf(s).map((p) => [p, { ...totals(s, p), outcome: portalOutcome(s, p) }])),
    notFound: s.runs.filter((r) => r.outcome === 'notFound').map((r) => `${r.spec.label} (${PORTAL_TAGS[r.spec.portal]})`),
    newCount: counts.newCount,
    drops: s.drops.length,
    missing: counts.missing,
  };
}

export function progressOf(s: SweepState, newCount: number): SweepProgress {
  return {
    startedAt: s.startedAt,
    total: s.runs.length,
    done: s.runs.filter((r) => r.outcome !== 'pending').length,
    current: s.current != null ? s.runs[s.current]!.spec.label : null,
    portals: Object.fromEntries(portalsOf(s).map((p) => [p, totals(s, p)])),
    newCount,
    drops: s.drops.length,
  };
}
```

Se il Task 1 ha cambiato le pause o i tetti, usa qui i valori decisi.

- [ ] **Passo 4: Verifica e commit**

Run: `npx vitest run tests/unit/core/sweep.test.ts && npm run typecheck`
Expected: PASS. (Se `import.meta.env.WXT_SWEEP_FAST` dà errore di tipo, dichiaralo come `report-config.ts` fa per `WXT_REPORT_URL`, cioè accedendo con `?? ''`; WXT tipizza `import.meta.env` come record di stringhe.)

```bash
git add src/core/sweep.ts src/shared/types.ts tests/unit/core/sweep.test.ts
git commit -m "feat(sweep): stato del giro puro (passi, fine ricerca, tetti, esito)"
```

---

### Task 11: "Non più visto" e servizi del giro

**File:**
- Crea: `src/core/missing.ts`, `tests/unit/core/missing.test.ts`, `tests/unit/core/service.sweep.test.ts`
- Modifica: `src/core/service.ts`

**Interfacce:**
- Consuma: `SweepState`, `completeScopes`, `buildResult`, `finishSweep` (Task 10); campi del Task 3.
- Produce: `MISSING_SWEEPS = 3`, `isMissing(l: ListingRecord): boolean`, `missingUpdates(listings, completeScopes: Set<string>, seen: Set<string>, startedAt: number): ListingRecord[]`; in `LeadService`: `countNewSince(since: number): Promise<number>`, `applySweepResult(completeScopes: string[], seen: string[], startedAt: number): Promise<number>`, `finishSweep(s: SweepState): Promise<SweepResult>`, `lastSweep(): Promise<SweepResult | null>`.

- [ ] **Passo 1: Test che falliscono**

`tests/unit/core/missing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isMissing, MISSING_SWEEPS, missingUpdates } from '@/core/missing';
import type { ListingRecord } from '@/shared/types';
import { listing } from './backup-builders';

const A = 'immobiliare|comune:016219|case';
const rec = (o: Partial<ListingRecord>) => listing({ sweepScope: A, missedSweeps: 0, missingSince: null, ...o });

describe('missingUpdates', () => {
  it('conta un giro mancato solo se la sua ricerca è stata completa', () => {
    const l = rec({});
    expect(missingUpdates([l], new Set([A]), new Set(), 500)).toEqual([{ ...l, missedSweeps: 1, missingSince: 500 }]);
    expect(missingUpdates([l], new Set(['altra']), new Set(), 500)).toEqual([]);
  });
  it('non tocca gli annunci visti, quelli senza ricerca e quelli di ricerche tolte dalla zona', () => {
    expect(missingUpdates([rec({})], new Set([A]), new Set(['immobiliare:128416572']), 500)).toEqual([]);
    expect(missingUpdates([rec({ sweepScope: null })], new Set([A]), new Set(), 500)).toEqual([]);
    expect(missingUpdates([rec({ sweepScope: 'immobiliare|comune:999999|case' })], new Set([A]), new Set(), 500)).toEqual([]);
  });
  it('tiene la data del primo giro mancato; diventa "non più visto" al terzo', () => {
    const l = rec({ missedSweeps: MISSING_SWEEPS - 1, missingSince: 100 });
    const [u] = missingUpdates([l], new Set([A]), new Set(), 500);
    expect(u).toMatchObject({ missedSweeps: MISSING_SWEEPS, missingSince: 100 });
    expect(isMissing(u!)).toBe(true);
    expect(isMissing(l)).toBe(false);
  });
});
```

`tests/unit/core/service.sweep.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { beginStep, createSweep, markSeen, nextStep, onPageRead } from '@/core/sweep';
import type { SearchSpec } from '@/shared/types';
import { obs, setup } from './helpers';

const IMM: SearchSpec = {
  portal: 'immobiliare', key: 'immobiliare|comune:016219|case', label: 'Treviglio · Case', categories: ['residential'],
  byProvince: false, cities: ['treviglio'], url: 'https://www.immobiliare.it/vendita-case/treviglio/?criterio=privateFirst',
};

describe('LeadService: giro', () => {
  it('a fine giro conta nuovi, ribassi e non più visti e salva l\'esito', async () => {
    const { db, svc, advance, now } = setup();
    await svc.ingest([obs({ portalId: 1, url: 'https://www.immobiliare.it/annunci/1/' })], undefined, { sweepScope: IMM.key });
    await db.listings.update('immobiliare:1', { missedSweeps: 2, missingSince: 10 });
    advance(60_000);
    const started = now();
    let s = createSweep([IMM], started, 'g1');
    s = beginStep(s, nextStep(s)!);
    await svc.ingest([obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/' })], undefined, { sweepScope: IMM.key });
    s = markSeen(s, [obs({ portalId: 2 })]);
    s = onPageRead(s, { portal: 'immobiliare', url: IMM.url, results: 2, privates: 1, lastPage: false, blocked: false, notFound: false });
    advance(1000);
    const result = await svc.finishSweep({ ...s, status: 'completed', finishedAt: now(), drops: ['immobiliare:2'] });
    expect(result).toMatchObject({ outcome: 'completed', newCount: 1, drops: 1, missing: 1 });
    expect(await db.listings.get('immobiliare:1')).toMatchObject({ missedSweeps: 3, missingSince: 10 });
    expect(await svc.lastSweep()).toEqual(result);
    expect((await svc.getDiagnostics('x')).counters).toMatchObject({ sweep_completed: 1, sweepPages_immobiliare: 1 });
  });

  it('nessun esito salvato: lastSweep è null', async () => {
    const { svc } = setup();
    expect(await svc.lastSweep()).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/core/missing.test.ts tests/unit/core/service.sweep.test.ts`
Expected: FAIL.

- [ ] **Passo 2: `missing.ts`**

`src/core/missing.ts`:

```ts
import type { ListingRecord } from '@/shared/types';

/** Giri completi consecutivi senza l'annuncio prima di segnalarlo come "non più visto". */
export const MISSING_SWEEPS = 3;

export const isMissing = (l: ListingRecord) => l.missedSweeps >= MISSING_SWEEPS;

/**
 * Annunci da aggiornare a fine giro: quelli della cui ricerca il giro è stato completo e che non sono stati visti.
 * Annunci visti solo a mano (senza ricerca), di ricerche incomplete o tolte dalla zona restano come sono.
 */
export function missingUpdates(listings: ListingRecord[], complete: Set<string>, seen: Set<string>, startedAt: number): ListingRecord[] {
  return listings
    .filter((l) => l.sweepScope != null && complete.has(l.sweepScope) && !seen.has(l.key))
    .map((l) => ({ ...l, missedSweeps: l.missedSweeps + 1, missingSince: l.missingSince ?? startedAt }));
}
```

- [ ] **Passo 3: Servizio**

In `src/core/service.ts` (import `missingUpdates`, `MISSING_SWEEPS` da `@/core/missing`; `buildResult`, `completeScopes`, `type SweepState` da `@/core/sweep`; `SweepResult` da `@/shared/types`):

```ts
  /** Annunci comparsi per la prima volta da `since` (giro o navigazione). */
  countNewSince(since: number): Promise<number> {
    return this.db.listings.filter((l) => l.firstSeenAt >= since).count();
  }

  /** Aggiorna "non più visto"; restituisce quanti annunci lo sono diventati in questo giro. */
  async applySweepResult(complete: string[], seen: string[], startedAt: number): Promise<number> {
    return this.db.transaction('rw', this.db.listings, async () => {
      const updates = missingUpdates(await this.db.listings.toArray(), new Set(complete), new Set(seen), startedAt);
      await this.db.listings.bulkPut(updates);
      return updates.filter((l) => l.missedSweeps === MISSING_SWEEPS).length;
    });
  }

  /** Chiude un giro finito, fermato o interrotto: "non più visto", esito in `meta.sweep`, contatori per il report. */
  async finishSweep(s: SweepState): Promise<SweepResult> {
    const missing = await this.applySweepResult(completeScopes(s), s.seen, s.startedAt);
    const result = buildResult(s, { newCount: await this.countNewSince(s.startedAt), missing });
    await this.db.meta.put({ key: 'sweep', value: result });
    await this.bumpCounter(`sweep_${result.outcome}`);
    await this.bumpCounter('sweepMinutes', Math.round((result.finishedAt - result.startedAt) / 60_000));
    for (const [p, stats] of Object.entries(result.portals)) {
      await this.bumpCounter(`sweepPages_${p}`, stats.pages);
      if (stats.outcome === 'blocked') await this.bumpCounter(`sweepBlocked_${p}`);
    }
    return result;
  }

  async lastSweep(): Promise<SweepResult | null> {
    return ((await this.db.meta.get('sweep'))?.value as SweepResult | undefined) ?? null;
  }
```

- [ ] **Passo 4: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src/core/missing.ts src/core/service.ts tests/unit/core
git commit -m "feat(missing): annunci non più visti dopo tre giri completi e chiusura del giro nel servizio"
```

---

### Task 12: Orchestratore, router e background

**File:**
- Crea: `src/background/sweep-runner.ts`, `tests/unit/background/sweep-runner.test.ts`
- Modifica: `src/shared/messages.ts`, `src/core/router.ts`, `src/entrypoints/background.ts`, `wxt.config.ts`, `tests/unit/core/router.test.ts`

**Interfacce:**
- Consuma: tutto il Task 8 e 10; `LeadService.finishSweep`, `countNewSince`, `lastSweep` (Task 11).
- Produce:
  - messaggi `{ type: 'startSweep' }`, `{ type: 'stopSweep' }`, `{ type: 'getSweepStatus' }` (risposta `SweepStatus`), costante `SWEEP_CHANGED = 'sweepChanged'`;
  - `handleRequest(service, req, version, hooks, ctx: { tabId?: number } = {})`;
  - in `RouterHooks`: `sweep: SweepHooks` con

```ts
export interface SweepHooks {
  /** Scheda del giro: annunci da salvare e opzioni di ingest; null per le altre schede. */
  intercept(tabId: number | undefined, observations: ListingObservation[]): Promise<{ observations: ListingObservation[]; options: IngestOptions } | null>;
  pageRead(tabId: number | undefined, report: PageReport): Promise<void>;
  start(): Promise<SweepStatus>;
  stop(): Promise<SweepStatus>;
  status(): Promise<SweepStatus>;
}
```

  - `createSweepRunner(deps: SweepRunnerDeps): SweepHooks & { windowRemoved(windowId: number): Promise<void>; recover(): Promise<void> }`, costanti `SWEEP_RUNNING = 'Giro già in corso'`, `NO_SEARCHES = 'Nessuna ricerca da fare: controlla la zona e i portali attivi'`.

- [ ] **Passo 1: Test dell'orchestratore**

`tests/unit/background/sweep-runner.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createSweepRunner, SWEEP_RUNNING, type RunnerState, type SweepRunnerDeps } from '@/background/sweep-runner';
import type { SweepState } from '@/core/sweep';
import type { PageReport, SearchSpec, SweepResult } from '@/shared/types';
import { obs } from '../core/helpers';

const IMM: SearchSpec = {
  portal: 'immobiliare', key: 'immobiliare|prov:MI|negozi', label: 'Provincia di Milano · Negozi', categories: ['commercial'],
  byProvince: true, cities: ['cassano d adda'], url: 'https://www.immobiliare.it/vendita-negozi/milano-provincia/?criterio=privateFirst',
};
const SUB: SearchSpec = {
  portal: 'subito', key: 'subito|comune:015059|immobili', label: "Cassano d'Adda · Immobili", categories: ['residential', 'commercial'],
  byProvince: false, cities: ['cassano d adda'], url: 'https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0',
};
const page = (portal: PageReport['portal'], o: Partial<PageReport> = {}): PageReport => ({
  portal, url: 'x', results: 3, privates: 1, lastPage: true, blocked: false, notFound: false, ...o,
});

function harness(o: Partial<SweepRunnerDeps> = {}) {
  const timers: { fn: () => void; ms: number }[] = [];
  let stored: RunnerState | null = null;
  const finished: SweepState[] = [];
  const deps: SweepRunnerDeps = {
    now: () => 1000, random: () => 0, uuid: () => 'g1',
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    clearTimer: (h) => { timers[h as number] = { fn: () => {}, ms: -1 }; },
    keepAlive: () => () => {},
    openWindow: vi.fn(async () => ({ windowId: 7, tabId: 70 })),
    navigate: vi.fn(async () => {}),
    closeWindow: vi.fn(async () => {}),
    loadState: async () => stored,
    saveState: async (s) => { stored = s; },
    plan: async () => [IMM, SUB],
    blockReason: async () => null,
    enabledPortals: async () => ({ immobiliare: true, idealista: true, subito: true }),
    finish: async (s) => { finished.push(s); return { outcome: s.status } as SweepResult; },
    countNew: async () => 0,
    lastResult: async () => null,
    changed: vi.fn(),
    ...o,
  };
  /** Esegue l'ultimo timer ancora valido (pausa o timeout) e aspetta la coda. */
  const fire = async () => {
    const t = [...timers].reverse().find((x) => x.ms >= 0)!;
    t.ms = -1;
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
    await runner.status();
  };
  const runner = createSweepRunner(deps);
  return { runner, deps, timers, finished, fire, stored: () => stored };
}

describe('sweep runner', () => {
  it('apre la finestra, alterna le ricerche, chiude e salva l\'esito', async () => {
    const h = harness();
    const st = await h.runner.start();
    expect(h.deps.openWindow).toHaveBeenCalledWith(IMM.url);
    expect(st.running).toMatchObject({ total: 2, done: 0, current: IMM.label });
    await h.runner.pageRead(70, page('immobiliare'));
    await h.fire(); // pausa → naviga su Subito
    expect(h.deps.navigate).toHaveBeenCalledWith(70, SUB.url);
    await h.runner.pageRead(70, page('subito'));
    expect(h.deps.closeWindow).toHaveBeenCalledWith(7);
    expect(h.finished[0]!.status).toBe('completed');
    expect(h.stored()).toBeNull();
  });

  it('rifiuta un secondo avvio e gli avvii bloccati', async () => {
    const h = harness();
    await h.runner.start();
    await expect(h.runner.start()).rejects.toThrow(SWEEP_RUNNING);
    const b = harness({ blockReason: async () => 'Imposta prima la tua zona di lavoro' });
    await expect(b.runner.start()).rejects.toThrow('Imposta prima la tua zona di lavoro');
  });

  it('ignora le altre schede; dalla scheda del giro tiene solo i comuni scelti', async () => {
    const h = harness();
    await h.runner.start();
    expect(await h.runner.intercept(99, [obs()])).toBeNull();
    await h.runner.pageRead(99, page('immobiliare'));
    expect(h.deps.navigate).not.toHaveBeenCalled();
    const r = await h.runner.intercept(70, [
      obs({ portalId: 1, city: "Cassano d'Adda", category: 'commercial' }),
      obs({ portalId: 2, city: 'Milano', category: 'commercial' }),
    ]);
    expect(r!.observations.map((o) => o.portalId)).toEqual([1]);
    expect(r!.options).toMatchObject({ sweepScope: IMM.key, searchCategory: 'commercial' });
    expect(h.stored()!.sweep.seen).toEqual(['immobiliare:1']);
  });

  it('scarta gli annunci della scheda del giro fuori da una pagina in corso', async () => {
    const h = harness();
    await h.runner.start();
    await h.runner.pageRead(70, page('immobiliare'));
    expect(await h.runner.intercept(70, [obs()])).toEqual({ observations: [], options: {} });
  });

  it('timeout: ricerca in errore e si prosegue', async () => {
    const h = harness();
    await h.runner.start();
    await h.fire(); // timeout della prima pagina
    expect(h.stored()!.sweep.runs[0]!.outcome).toBe('error');
    await h.fire(); // pausa → Subito
    expect(h.deps.navigate).toHaveBeenCalledWith(70, SUB.url);
  });

  it('Ferma, finestra chiusa dall\'agente e riavvio del worker chiudono il giro', async () => {
    const a = harness();
    await a.runner.start();
    await a.runner.stop();
    expect(a.finished[0]!.status).toBe('stopped');
    expect(a.deps.closeWindow).toHaveBeenCalledWith(7);

    const b = harness();
    await b.runner.start();
    await b.runner.windowRemoved(7);
    expect(b.finished[0]!.status).toBe('interrupted');
    expect(b.deps.closeWindow).not.toHaveBeenCalled();

    const c = harness();
    await c.runner.start();
    const restarted = createSweepRunner({ ...c.deps, loadState: async () => c.stored() });
    await restarted.recover();
    expect(c.finished[0]!.status).toBe('interrupted');
    expect(c.deps.closeWindow).toHaveBeenCalledWith(7);
  });
});
```

Run: `npx vitest run tests/unit/background/sweep-runner.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Passo 2: Messaggi**

In `src/shared/messages.ts`:

```ts
export const SWEEP_CHANGED = 'sweepChanged';
```

e nell'unione `Request`: `| { type: 'startSweep' } | { type: 'stopSweep' } | { type: 'getSweepStatus' }`.

- [ ] **Passo 3: Orchestratore**

`src/background/sweep-runner.ts`:

```ts
import { acceptObservation, searchCategory } from '@/core/searches';
import {
  beginStep, createSweep, finishSweep, markSeen, nextStep, onPageRead, onTimeout, PAGE_TIMEOUT_MS, pauseMs, progressOf, skipDisabled, stepUrl,
  stopSweep, type SweepState,
} from '@/core/sweep';
import type { IngestOptions, ListingObservation, PageReport, Portal, SearchSpec, SweepResult, SweepStatus } from '@/shared/types';

export const SWEEP_RUNNING = 'Giro già in corso';
export const NO_SEARCHES = 'Nessuna ricerca da fare: controlla la zona e i portali attivi';

/** Stato salvato in storage.session: sopravvive al riavvio del service worker, non a quello del browser. */
export interface RunnerState {
  sweep: SweepState;
  windowId: number;
  tabId: number;
  /** Una pagina è in caricamento e si aspetta il suo pageRead. */
  awaiting: boolean;
}

export interface SweepRunnerDeps {
  now(): number;
  random(): number;
  uuid(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Tiene sveglio il service worker durante il giro; restituisce la funzione che smette. */
  keepAlive(): () => void;
  openWindow(url: string): Promise<{ windowId: number; tabId: number }>;
  navigate(tabId: number, url: string): Promise<void>;
  closeWindow(windowId: number): Promise<void>;
  loadState(): Promise<RunnerState | null>;
  saveState(s: RunnerState | null): Promise<void>;
  plan(): Promise<SearchSpec[]>;
  /** Motivo per non partire (informativa, zona), o null. */
  blockReason(): Promise<string | null>;
  enabledPortals(): Promise<Record<Portal, boolean>>;
  finish(s: SweepState): Promise<SweepResult>;
  countNew(since: number): Promise<number>;
  lastResult(): Promise<SweepResult | null>;
  /** Avvisa il pannello: avanzamento o fine del giro. */
  changed(): void;
}

export function createSweepRunner(d: SweepRunnerDeps) {
  let st: RunnerState | null = null;
  let loaded = false;
  let timer: unknown = null;
  let stopKeepAlive: (() => void) | null = null;
  // Un passo alla volta: messaggi dei content script, timer e pulsanti non si accavallano.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  };

  async function load(): Promise<RunnerState | null> {
    if (!loaded) {
      st = await d.loadState();
      loaded = true;
    }
    return st;
  }
  async function save(): Promise<void> {
    await d.saveState(st);
    d.changed();
  }
  function clearTimer(): void {
    if (timer != null) d.clearTimer(timer);
    timer = null;
  }
  function armTimeout(): void {
    timer = d.setTimer(() => void serial(timeoutTick), PAGE_TIMEOUT_MS);
  }

  async function go(index: number): Promise<void> {
    timer = null;
    if (!st) return;
    st.sweep = beginStep(st.sweep, index);
    st.awaiting = true;
    await save();
    armTimeout();
    try {
      await d.navigate(st.tabId, stepUrl(st.sweep, index));
    } catch {
      // Scheda chiusa o non navigabile: il timeout chiude la ricerca.
    }
  }

  async function advance(): Promise<void> {
    if (!st) return;
    st.sweep = skipDisabled(st.sweep, await d.enabledPortals());
    const index = nextStep(st.sweep);
    if (index == null) return end(null, true);
    timer = d.setTimer(() => void serial(() => go(index)), pauseMs(st.sweep.runs[index]!.spec.portal, d.random));
  }

  async function timeoutTick(): Promise<void> {
    timer = null;
    if (!st?.awaiting) return;
    st.awaiting = false;
    st.sweep = onTimeout(st.sweep);
    await save();
    await advance();
  }

  /** Chiude il giro: `how` null = finito da solo. */
  async function end(how: 'stopped' | 'interrupted' | null, closeWindow: boolean): Promise<void> {
    clearTimer();
    stopKeepAlive?.();
    stopKeepAlive = null;
    const cur = st!;
    st = null;
    await d.saveState(null);
    if (closeWindow) await d.closeWindow(cur.windowId).catch(() => {});
    await d.finish(how ? stopSweep(cur.sweep, how, d.now()) : finishSweep(cur.sweep, d.now()));
    d.changed();
  }

  async function statusNow(): Promise<SweepStatus> {
    const running = st ? progressOf(st.sweep, await d.countNew(st.sweep.startedAt)) : null;
    return { running, last: await d.lastResult() };
  }

  return {
    start: () => serial(async () => {
      if (await load()) throw new Error(SWEEP_RUNNING);
      const reason = await d.blockReason();
      if (reason) throw new Error(reason);
      const specs = await d.plan();
      if (!specs.length) throw new Error(NO_SEARCHES);
      let sweep = createSweep(specs, d.now(), d.uuid());
      const index = nextStep(sweep)!;
      sweep = beginStep(sweep, index);
      const { windowId, tabId } = await d.openWindow(stepUrl(sweep, index));
      st = { sweep, windowId, tabId, awaiting: true };
      stopKeepAlive = d.keepAlive();
      await save();
      armTimeout();
      return statusNow();
    }),

    stop: () => serial(async () => {
      if (await load()) await end('stopped', true);
      return statusNow();
    }),

    status: () => serial(async () => {
      await load();
      return statusNow();
    }),

    pageRead: (tabId: number | undefined, report: PageReport) => serial(async () => {
      const s = await load();
      if (!s || tabId !== s.tabId || !s.awaiting) return;
      clearTimer();
      s.awaiting = false;
      s.sweep = onPageRead(s.sweep, report);
      await save();
      await advance();
    }),

    intercept: (tabId: number | undefined, observations: ListingObservation[]) =>
      serial(async (): Promise<{ observations: ListingObservation[]; options: IngestOptions } | null> => {
        const s = await load();
        if (!s || tabId !== s.tabId) return null;
        // Dalla scheda del giro, fuori da una pagina attesa, non si salva nulla: potrebbe essere di un comune non scelto.
        if (s.sweep.current == null || !s.awaiting) return { observations: [], options: {} };
        const spec = s.sweep.runs[s.sweep.current]!.spec;
        const accepted = observations.filter((o) => acceptObservation(spec, o));
        s.sweep = markSeen(s.sweep, accepted);
        await d.saveState(s);
        const onDrop = (key: string) => {
          if (st && !st.sweep.drops.includes(key)) st.sweep = { ...st.sweep, drops: [...st.sweep.drops, key] };
        };
        return { observations: accepted, options: { sweepScope: spec.key, searchCategory: searchCategory(spec), onDrop } };
      }),

    windowRemoved: (windowId: number) => serial(async () => {
      const s = await load();
      if (s && s.windowId === windowId) await end('interrupted', false);
    }),

    recover: () => serial(async () => {
      if (await load()) await end('interrupted', true);
    }),
  };
}
```

Run: `npx vitest run tests/unit/background/sweep-runner.test.ts`
Expected: PASS.

- [ ] **Passo 4: Router**

In `src/core/router.ts` (import `IngestOptions`, `ListingObservation`, `PageReport`, `SweepStatus` da `@/shared/types`):
- aggiungi l'interfaccia `SweepHooks` (blocco "Produce") e in `RouterHooks`: `/** Giro delle ricerche. */ sweep: SweepHooks;`;
- firma: `export async function handleRequest(service: LeadService, req: Request, version: string, hooks: RouterHooks, ctx: { tabId?: number } = {}): Promise<unknown>`;
- nel caso `ingest`, sostituisci da `const hint = …` fino a `const evaluations = …` con:

```ts
      const hint = req.calibrationHint && enabled[req.calibrationHint.portal] ? req.calibrationHint : undefined;
      // Pagine del giro: solo comuni e categorie scelti, con la ricerca che le ha lette.
      const sweep = await hooks.sweep.intercept(ctx.tabId, observations);
      const toSave = sweep ? sweep.observations : observations;
      if (!toSave.length) return [];
      const evaluations = await service.ingest(toSave, hint, sweep?.options);
      await service.bumpCounter('ingested', toSave.length);
```

  (togli la vecchia riga `await service.bumpCounter('ingested', observations.length);`);
- sostituisci il caso provvisorio `pageRead` e aggiungi:

```ts
    case 'pageRead':
      await hooks.sweep.pageRead(ctx.tabId, req.report);
      return null;
    case 'startSweep':
      return hooks.sweep.start();
    case 'stopSweep':
      return hooks.sweep.stop();
    case 'getSweepStatus':
      return hooks.sweep.status();
```

In `tests/unit/core/router.test.ts`, nella funzione `hooks()` aggiungi:

```ts
    sweep: {
      intercept: vi.fn(async () => null), pageRead: vi.fn(async () => {}),
      start: vi.fn(async () => ({ running: null, last: null })), stop: vi.fn(async () => ({ running: null, last: null })),
      status: vi.fn(async () => ({ running: null, last: null })),
    },
```

e i test:

```ts
  it('ingest dalla scheda del giro: salva solo ciò che il giro accetta, con le sue opzioni', async () => {
    const { svc, db } = await ready();
    const h = hooks();
    h.sweep.intercept = vi.fn(async () => ({ observations: [obs({ portalId: 5, url: 'https://www.immobiliare.it/annunci/5/' })], options: { sweepScope: 's1' } }));
    await handleRequest(svc, { type: 'ingest', observations: [obs(), obs({ portalId: 5, url: 'https://www.immobiliare.it/annunci/5/' })] }, 'v', h, { tabId: 70 });
    expect(h.sweep.intercept).toHaveBeenCalledWith(70, expect.any(Array));
    expect(await db.listings.count()).toBe(1);
    expect((await db.listings.get('immobiliare:5'))!.sweepScope).toBe('s1');
  });

  it('pageRead e comandi del giro passano all\'orchestratore con la scheda', async () => {
    const { svc } = await ready();
    const h = hooks();
    const report = { portal: 'immobiliare' as const, url: 'x', results: 1, privates: 1, lastPage: true, blocked: false, notFound: false };
    await handleRequest(svc, { type: 'pageRead', report }, 'v', h, { tabId: 70 });
    expect(h.sweep.pageRead).toHaveBeenCalledWith(70, report);
    await handleRequest(svc, { type: 'startSweep' }, 'v', h);
    await handleRequest(svc, { type: 'stopSweep' }, 'v', h);
    await handleRequest(svc, { type: 'getSweepStatus' }, 'v', h);
    expect(h.sweep.start).toHaveBeenCalled();
    expect(h.sweep.stop).toHaveBeenCalled();
    expect(h.sweep.status).toHaveBeenCalled();
  });
```

- [ ] **Passo 5: Background e permesso `storage`**

In `wxt.config.ts`, in `permissions` aggiungi `'storage'` (serve a `storage.session`; nessun avviso all'installazione).

In `src/entrypoints/background.ts` (import `createSweepRunner` da `@/background/sweep-runner`, `searchesFor` da `@/core/searches`, `SWEEP_CHANGED` da `@/shared/messages`, `type RunnerState`):

```ts
  const sweep = createSweepRunner({
    now: Date.now,
    random: Math.random,
    uuid: () => crypto.randomUUID(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    // Una chiamata alle API ogni 20 s tiene acceso il service worker durante il giro.
    keepAlive: () => {
      const h = setInterval(() => void browser.runtime.getPlatformInfo(), 20_000);
      return () => clearInterval(h);
    },
    async openWindow(url) {
      const w = await browser.windows.create({ url, state: 'minimized', focused: false, type: 'normal' });
      return { windowId: w!.id!, tabId: w!.tabs![0]!.id! };
    },
    navigate: async (tabId, url) => {
      await browser.tabs.update(tabId, { url });
    },
    closeWindow: async (windowId) => {
      await browser.windows.remove(windowId);
    },
    loadState: async () => ((await browser.storage.session.get('sweep')).sweep as RunnerState | undefined) ?? null,
    saveState: async (s) => {
      if (s) await browser.storage.session.set({ sweep: s });
      else await browser.storage.session.remove('sweep');
    },
    plan: async () => {
      const s = await service.getSettings();
      return searchesFor(s.searchArea, s.enabledPortals);
    },
    blockReason: async () => {
      const status = await service.onboardingStatus();
      if (needsOnboarding(status.acceptedVersion, status.current)) return "Conferma prima l'informativa";
      if (!(await service.getSettings()).searchArea.comuni.length) return 'Imposta prima la tua zona di lavoro';
      return null;
    },
    enabledPortals: async () => (await service.getSettings()).enabledPortals,
    finish: async (s) => {
      const result = await service.finishSweep(s);
      hooks.leadsChanged();
      return result;
    },
    countNew: (since) => service.countNewSince(since),
    lastResult: () => service.lastSweep(),
    changed: () => {
      browser.runtime.sendMessage({ type: SWEEP_CHANGED }).catch(() => {});
    },
  });
```

Mettilo **prima** di `const hooks: RouterHooks = {` e aggiungi `sweep,` dentro `hooks` (la funzione `finish` usa `hooks` solo quando viene chiamata, dopo l'inizializzazione). Poi:
- nel listener `onMessage`, ignora anche `SWEEP_CHANGED`: `if (typeof type !== 'string' || type === LEADS_CHANGED || type === ONBOARDING_CHANGED || type === SWEEP_CHANGED || isOffscreenRequest(msg)) return false;` e passa la scheda: `handleRequest(service, msg as Request, version, hooks, { tabId: _sender.tab?.id })` (rinomina `_sender` in `sender`);
- dopo il listener: 

```ts
  // L'agente chiude la finestra del giro: giro interrotto, i dati letti restano.
  browser.windows.onRemoved.addListener((windowId) => void sweep.windowRemoved(windowId).catch(() => {}));
  // Worker riavviato a giro in corso (raro): lo stato in storage.session si chiude come interrotto.
  void sweep.recover().catch((err: unknown) =>
    service.recordError(`Giro delle ricerche: ${err instanceof Error ? err.message : String(err)}`).catch(() => {}),
  );
```

- [ ] **Passo 6: Verifica e commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS e build riuscita; nel manifest generato (`.output/chrome-mv3/manifest.json`) `permissions` contiene `storage`.

```bash
git add src wxt.config.ts tests
git commit -m "feat(sweep): orchestratore del giro nel background, router e messaggi"
```

---

### Task 13: "Non più visto" e categorie nei lead

**File:**
- Modifica: `src/shared/types.ts` (`LeadView`), `src/core/lead-groups.ts`, `src/core/leads.ts`, `src/ui/sidepanel/LeadItem.tsx`, `src/ui/sidepanel/styles.css`
- Test: `tests/unit/core/lead-groups.test.ts`, `tests/unit/core/leads.test.ts`, `tests/unit/ui/sidepanel.test.tsx`

**Interfacce:**
- Consuma: `isMissing` (Task 11).
- Produce: `LeadView.missing: number | null` (data del primo giro mancato, solo se tutti gli annunci principali sono "non più visti"), `LeadView.missingPortals: Portal[]` (portali spariti in un gruppo ancora visibile altrove); `leadCategories(view: LeadView): PropertyCategory[]` in `src/core/leads.ts`.

- [ ] **Passo 1: Test che falliscono**

In `tests/unit/core/lead-groups.test.ts` (costruttore locale; qui `rec`, con i campi del Task 3; usa gli helper del file per un gruppo di due portali, come negli altri test di gruppi):

```ts
  it('lead "non più visto" solo se lo sono tutti i suoi annunci principali', () => {
    const gone = rec({ missedSweeps: 3, missingSince: 100 });
    const [single] = buildLeadViews({ listings: [gone], states: [], snapshots: [], splits: [] }, DEFAULT_SETTINGS, NOW);
    expect(single!).toMatchObject({ missing: 100, missingPortals: [] });
  });

  it('gruppo misto: il principale è quello ancora visto, il portale sparito è segnalato', () => {
    const a = rec({ key: 'immobiliare:1', portal: 'immobiliare', portalId: 1, missedSweeps: 3, missingSince: 100 });
    const b = rec({ key: 'idealista:2', portal: 'idealista', portalId: 2, url: 'https://www.idealista.it/immobile/2/' });
    const [v] = buildLeadViews({ listings: [a, b], states: [], snapshots: [], splits: [] }, DEFAULT_SETTINGS, NOW);
    expect(v!.listing.key).toBe('idealista:2');
    expect(v!).toMatchObject({ missing: null, missingPortals: ['immobiliare'] });
  });
```

(Perché `a` e `b` siano lo stesso immobile, devono avere stessa città, m², prezzo e locali, come gli altri casi di gruppo nel file.)

In `tests/unit/core/leads.test.ts`:

```ts
  it('leadCategories: categorie di tutte le fonti, senza doppioni', () => {
    const v = view({ listing: rec({ category: 'commercial' }), others: [{ listing: rec({ key: 'idealista:2', category: 'commercial' }) }, { listing: rec({ key: 'subito:3', category: 'garage' }) }] });
    expect(leadCategories(v)).toEqual(['commercial', 'garage']);
  });
```

(adatta `view`/`rec` ai costruttori del file; `others` serve solo con `listing`).

Run: `npx vitest run tests/unit/core/lead-groups.test.ts tests/unit/core/leads.test.ts`
Expected: FAIL.

- [ ] **Passo 2: Implementa**

`src/shared/types.ts`, in `LeadView` dopo `reposted`:

```ts
  /** Non più visto nei giri: data del primo giro mancato; null se almeno un annuncio principale c'è ancora. */
  missing: number | null;
  /** Portali da cui l'immobile è sparito mentre resta visibile su un altro. */
  missingPortals: Portal[];
```

`src/core/lead-groups.ts` (import `isMissing` da `@/core/missing`, `type Portal`):
- in `byPrimary`, come primo confronto:

```ts
  // Il principale è un annuncio ancora visto nei giri, se ce n'è uno.
  const gone = Number(isMissing(a.listing)) - Number(isMissing(b.listing));
  if (gone !== 0) return gone;
```

- nel `return units.map(...)`, prima del `return {`:

```ts
    const heads = members.filter((m) => !m.previous);
    const goneHeads = heads.filter((m) => isMissing(m.listing));
    const allGone = goneHeads.length === heads.length;
```

  e nell'oggetto restituito:

```ts
      missing: allGone ? Math.max(...goneHeads.map((m) => m.listing.missingSince ?? 0)) : null,
      missingPortals: allGone ? [] : [...new Set(goneHeads.map((m) => m.listing.portal))] as Portal[],
```

`src/core/leads.ts` (import `PROPERTY_CATEGORIES`, `type PropertyCategory`):

```ts
/** Categorie delle fonti del lead, nell'ordine standard. */
export function leadCategories(view: LeadView): PropertyCategory[] {
  const set = new Set([view.listing, ...view.others.map((o) => o.listing)].map((l) => l.category));
  return PROPERTY_CATEGORIES.filter((c) => set.has(c));
}
```

`src/ui/sidepanel/LeadItem.tsx`, dopo la riga di `lead.reposted` (import `formatDate` se manca):

```tsx
          {lead.missing != null && <span className="pill pill--missing">{`Non più visto dal ${formatDate(lead.missing)}`}</span>}
          {lead.missingPortals.map((p) => (
            <span key={`gone-${p}`} className="pill pill--missing">{`Non più su ${PORTAL_TAGS[p]}`}</span>
          ))}
```

`src/ui/sidepanel/styles.css`, dopo `.pill--multi`:

```css
.pill--missing { background: var(--medium-soft); color: #7a3a05; border-color: var(--medium-border); }
```

Nei test che costruiscono `LeadView` a mano (`tests/unit/ui/sidepanel.test.tsx`, `export.test.ts`, …) aggiungi `missing: null, missingPortals: []` dove il typecheck lo chiede.

- [ ] **Passo 3: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add src tests
git commit -m "feat(leads): lead non più visti e portali spariti, categorie dei lead"
```

---

### Task 14: Pannello: scheda Ricerca e filtri

**File:**
- Crea: `src/ui/sidepanel/SweepCard.tsx`, `tests/unit/ui/sweep-card.test.tsx`
- Modifica: `src/ui/sidepanel/api.ts`, `src/ui/sidepanel/App.tsx`, `src/ui/sidepanel/styles.css`, `tests/unit/ui/sidepanel.test.tsx` (api finta)

**Interfacce:**
- Consuma: messaggi del Task 12, `SweepStatus` (Task 10), `leadCategories` (Task 13).
- Produce: in `Api`: `startSweep(): Promise<SweepStatus>`, `stopSweep(): Promise<SweepStatus>`, `getSweepStatus(): Promise<SweepStatus>`, `onSweepChanged(cb: () => void): () => void`; `SweepCard({ api, onShowNew(since: number): void; onOpenSettings(): void })`.

- [ ] **Passo 1: Api**

In `src/ui/sidepanel/api.ts`: aggiungi i quattro metodi all'interfaccia e a `defaultApi`:

```ts
  startSweep: () => send({ type: 'startSweep' }),
  stopSweep: () => send({ type: 'stopSweep' }),
  getSweepStatus: () => send({ type: 'getSweepStatus' }),
  onSweepChanged: (cb) => onBroadcast(SWEEP_CHANGED, cb),
```

(import `SWEEP_CHANGED` e `SweepStatus`). Nelle api finte dei test (`tests/unit/ui/*.test.tsx`) aggiungi: `startSweep: vi.fn(async () => ({ running: null, last: null })), stopSweep: vi.fn(async () => ({ running: null, last: null })), getSweepStatus: vi.fn(async () => ({ running: null, last: null })), onSweepChanged: () => () => {},`.

- [ ] **Passo 2: Test che fallisce**

`tests/unit/ui/sweep-card.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type SweepStatus } from '@/shared/types';
import { SweepCard } from '@/ui/sidepanel/SweepCard';

function api(status: SweepStatus, comuni = 1) {
  return {
    getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, searchArea: { ...DEFAULT_SETTINGS.searchArea, comuni: Array.from({ length: comuni }, (_, i) => ({ istat: `01600${i}`, name: `C${i}`, province: 'BG' })) } })),
    getSweepStatus: vi.fn(async () => status),
    startSweep: vi.fn(async () => status),
    stopSweep: vi.fn(async () => status),
    onSweepChanged: () => () => {},
  };
}

describe('SweepCard', () => {
  it('senza comuni manda alle impostazioni', async () => {
    const onOpenSettings = vi.fn();
    render(<SweepCard api={api({ running: null, last: null }, 0)} onShowNew={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Imposta la tua zona' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('a riposo avvia il giro', async () => {
    const a = api({ running: null, last: null });
    render(<SweepCard api={a} onShowNew={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('Giro di oggi da fare')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerca', exact: true }));
    expect(a.startSweep).toHaveBeenCalled();
  });

  it('in corso mostra avanzamento e Ferma', async () => {
    const a = api({ running: { startedAt: Date.now(), total: 10, done: 4, current: 'Treviglio · Case', portals: { immobiliare: { pages: 5, privates: 30 } }, newCount: 2, drops: 1 }, last: null });
    render(<SweepCard api={a} onShowNew={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('Treviglio · Case')).toBeInTheDocument();
    expect(screen.getByText(/5 pagine · 30 privati/)).toBeInTheDocument();
    expect(screen.getByText('Finora: 2 nuovi · 1 ribassi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ferma' }));
    expect(a.stopSweep).toHaveBeenCalled();
  });

  it('a fine giro (in questa sessione) mostra il riepilogo e i motivi', async () => {
    const now = Date.now();
    const a = api({ running: null, last: {
      startedAt: now - 600_000, finishedAt: now + 1000, outcome: 'partial', newCount: 18, drops: 4, missing: 2, notFound: [],
      portals: { idealista: { pages: 3, privates: 9, outcome: 'blocked' } },
    } });
    const onShowNew = vi.fn();
    render(<SweepCard api={a} onShowNew={onShowNew} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('18 nuovi · 4 ribassi · 2 non più visti')).toBeInTheDocument();
    expect(screen.getByText('Idealista.it ha chiesto una verifica: aprilo tu e riprova domani.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vedi i nuovi' }));
    expect(onShowNew).toHaveBeenCalledWith(now - 600_000);
  });
});
```

Run: `npx vitest run tests/unit/ui/sweep-card.test.tsx`
Expected: FAIL, modulo inesistente.

- [ ] **Passo 3: `SweepCard`**

`src/ui/sidepanel/SweepCard.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { localDay } from '@/core/usage';
import { formatDateTime } from '@/shared/format';
import { PORTAL_SITES, PORTALS, type Portal, type PortalSweepOutcome, type SweepResult, type SweepStatus } from '@/shared/types';
import type { Api } from './api';

type SweepApi = Pick<Api, 'getSettings' | 'getSweepStatus' | 'startSweep' | 'stopSweep' | 'onSweepChanged'>;

const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
const OUTCOME_TITLES: Record<SweepResult['outcome'], string> = {
  completed: 'Giro completato', partial: 'Giro completato in parte', stopped: 'Giro fermato', interrupted: 'Giro interrotto',
};

function portalReason(p: Portal, o: PortalSweepOutcome): string | null {
  const site = PORTAL_SITES[p];
  if (o === 'blocked') return `${site} ha chiesto una verifica: aprilo tu e riprova domani.`;
  if (o === 'capped') return `${site}: raggiunto il limite di pagine, alcune ricerche sono incomplete.`;
  if (o === 'error') return `${site} non ha risposto ad alcune pagine.`;
  return null;
}

function reasons(r: SweepResult): string[] {
  const out = PORTALS.flatMap((p) => {
    const s = r.portals[p];
    const why = s && portalReason(p, s.outcome);
    return why ? [why] : [];
  });
  if (r.notFound.length) out.push(`Non trovati: ${r.notFound.join(', ')}.`);
  return out;
}

/** Scheda "Ricerca" in cima ai lead: avvio del giro, avanzamento, riepilogo. */
export function SweepCard({ api, onShowNew, onOpenSettings }: { api: SweepApi; onShowNew(since: number): void; onOpenSettings(): void }) {
  const [status, setStatus] = useState<SweepStatus | null>(null);
  const [comuni, setComuni] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Il riepilogo si mostra per un giro finito mentre il pannello era aperto, finché l'agente non lo chiude.
  const [openedAt] = useState(Date.now);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, settings] = await Promise.all([api.getSweepStatus(), api.getSettings()]);
      setStatus(s);
      setComuni(settings.searchArea.comuni.length);
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return api.onSweepChanged(() => void refresh());
  }, [api, refresh]);

  const act = (fn: () => Promise<SweepStatus>) => {
    setError(null);
    fn().then(setStatus, (e: unknown) => setError(errorText(e)));
  };

  if (!status) return null;
  const { running, last } = status;
  const now = Date.now();

  if (running) {
    return (
      <section className="card sweep" aria-label="Ricerca">
        <h2 className="card__title">{`Ricerca in corso · ${minutes(now - running.startedAt)}`}</h2>
        <progress className="sweep__bar" max={running.total} value={running.done} aria-label="Ricerche fatte" />
        {running.current && <p className="sweep__current">{running.current}</p>}
        <ul className="sweep__portals">
          {PORTALS.filter((p) => running.portals[p]).map((p) => (
            <li key={p}>{`${PORTAL_SITES[p]}: ${running.portals[p]!.pages} pagine · ${running.portals[p]!.privates} privati`}</li>
          ))}
        </ul>
        <div className="settings__row">
          <span>{`Finora: ${running.newCount} nuovi · ${running.drops} ribassi`}</span>
          <button type="button" className="btn btn--sm" onClick={() => act(() => api.stopSweep())}>Ferma</button>
        </div>
        {error && <p className="banner banner--error"><span>{error}</span></p>}
      </section>
    );
  }

  if (last && last.finishedAt >= openedAt && dismissed !== last.finishedAt) {
    return (
      <section className="card sweep" aria-label="Ricerca">
        <h2 className="card__title">{`${OUTCOME_TITLES[last.outcome]} · ${minutes(last.finishedAt - last.startedAt)}`}</h2>
        <p>{`${last.newCount} nuovi · ${last.drops} ribassi · ${last.missing} non più visti`}</p>
        {reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
        <div className="settings__row">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => onShowNew(last.startedAt)}>Vedi i nuovi</button>
          <button type="button" className="btn btn--sm" onClick={() => setDismissed(last.finishedAt)}>Chiudi</button>
        </div>
      </section>
    );
  }

  const today = last != null && localDay(last.startedAt) === localDay(now);
  return (
    <section className="card sweep" aria-label="Ricerca">
      {comuni === 0 ? (
        <div className="settings__row">
          <span>Scegli i comuni in cui lavori per cercare i lead con un clic.</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onOpenSettings}>Imposta la tua zona</button>
        </div>
      ) : (
        <>
          <p className="sweep__last">
            {last ? `Ultimo giro: ${formatDateTime(last.startedAt)} · ${OUTCOME_TITLES[last.outcome].replace('Giro ', '')}` : 'Nessun giro fatto finora'}
          </p>
          {last && reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
          <div className="settings__row">
            <span>{today ? `${comuni} ${comuni === 1 ? 'comune' : 'comuni'}` : 'Giro di oggi da fare'}</span>
            <button type="button" className={today ? 'btn btn--sm' : 'btn btn--primary btn--sm'} onClick={() => act(() => api.startSweep())}>Cerca</button>
          </div>
        </>
      )}
      {error && <p className="banner banner--error"><span>{error}</span></p>}
    </section>
  );
}
```

CSS in fondo a `styles.css`:

```css
/* Scheda "Ricerca": giro delle ricerche. */
.sweep { display: grid; gap: 6px; }
.sweep__bar { width: 100%; height: 6px; accent-color: var(--brand); }
.sweep__current, .sweep__last { margin: 0; font-size: 12px; color: var(--muted); }
.sweep__portals { list-style: none; margin: 0; padding: 0; font-size: 12px; }
.sweep__reason { margin: 0; font-size: 12px; color: #7a3a05; }
```

Run: `npx vitest run tests/unit/ui/sweep-card.test.tsx`
Expected: PASS.

- [ ] **Passo 4: App: scheda e filtri**

In `src/ui/sidepanel/App.tsx` (import `SweepCard`, `leadCategories` da `@/core/leads`, `CATEGORY_LABELS`, `PROPERTY_CATEGORIES`, `type PropertyCategory`):
- nuovi stati, accanto a `multi`:

```tsx
  /** Filtri che agiscono prima delle schede, come ricerca e prezzo. */
  const [categories, setCategories] = useState<PropertyCategory[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);
  /** "Vedi i nuovi" del giro: lead con una fonte vista per la prima volta da questa data. */
  const [since, setSince] = useState<number | null>(null);
```

- sostituisci `const applied = applyQuery(leads, query);` con:

```tsx
  const applied = applyQuery(leads, query).filter((l) =>
    (!categories.length || leadCategories(l).some((c) => categories.includes(c)))
    && (!missingOnly || l.missing != null || l.missingPortals.length > 0)
    && (since == null || [l.listing, ...l.others.map((o) => o.listing)].some((x) => x.firstSeenAt >= since)));
```

- in `tagParts` aggiungi:

```tsx
    ...(categories.length ? [joinList(categories.map((c) => CATEGORY_LABELS[c]), 'e')] : []),
    ...(missingOnly ? ['non più visti'] : []),
    ...(since != null ? ['da questo giro'] : []),
```

- in `anyFilter` aggiungi `|| categories.length > 0 || missingOnly || since != null`; in `resetFilters` aggiungi `setCategories([]); setMissingOnly(false); setSince(null);`; nelle dipendenze dell'`useEffect` di `setConfirmingAll(false)` aggiungi `categories, missingOnly, since`;
- funzione accanto a `togglePortal`:

```tsx
  const toggleCategory = (c: PropertyCategory) =>
    setCategories((cs) => {
      const next = PROPERTY_CATEGORIES.filter((x) => (x === c ? !cs.includes(x) : cs.includes(x)));
      return next.length === PROPERTY_CATEGORIES.length ? [] : next;
    });
```

- subito dopo l'apertura del ramo della lista (prima di `<nav className="tabs" role="tablist">`):

```tsx
              <SweepCard
                api={api}
                onShowNew={(at) => {
                  setSince(at);
                  setTab('new');
                }}
                onOpenSettings={() => setView('settings')}
              />
```

- dopo il gruppo "Filtra per sito", un nuovo gruppo:

```tsx
              <div className="filters" role="group" aria-label="Filtra per categoria">
                {PROPERTY_CATEGORIES.map((c) => {
                  const count = tabLeads(tab).filter((l) => leadCategories(l).includes(c)).length;
                  const on = categories.includes(c);
                  return (
                    <button key={c} type="button" aria-pressed={on} aria-label={`${CATEGORY_LABELS[c]} (${count})`}
                      className={`chip${on ? ' chip--on' : ''}`} disabled={count === 0 && !on} onClick={() => toggleCategory(c)}>
                      {CATEGORY_LABELS[c]} <span className="chip__count">{count}</span>
                    </button>
                  );
                })}
                {(() => {
                  const count = tabLeads(tab).filter((l) => l.missing != null || l.missingPortals.length > 0).length;
                  return (
                    <button type="button" aria-pressed={missingOnly} aria-label={`Non più visti (${count})`}
                      className={`chip${missingOnly ? ' chip--on' : ''}`} disabled={count === 0 && !missingOnly} onClick={() => setMissingOnly((m) => !m)}>
                      Non più visti <span className="chip__count">{count}</span>
                    </button>
                  );
                })()}
                {since != null && (
                  <button type="button" aria-pressed className="chip chip--on" onClick={() => setSince(null)}>Da questo giro ✕</button>
                )}
              </div>
```

- nel testo della lista vuota, sostituisci `Naviga su … per raccoglierne.` con `` `Nessun lead in questa scheda. Premi «Cerca» o naviga su ${joinList(PORTALS.map((p) => PORTAL_SITES[p]), 'o')} per raccoglierne.` ``.

In `tests/unit/ui/sidepanel.test.tsx` aggiungi:

```tsx
  it('filtra per categoria', async () => {
    // api finta con due lead "Nuovi": uno residenziale, uno box (category sul listing)
    render(<App api={fakeApi} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Box \(1\)$/ }));
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('lead'))).toHaveLength(1);
  });
```

(costruisci i due lead con i costruttori del file, cambiando `category`; se il nome della api finta è diverso, usa quello del file).

- [ ] **Passo 5: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS (adegua eventuali test del pannello che contano i gruppi di filtri o il testo della lista vuota).

```bash
git add src/ui tests/unit/ui
git commit -m "feat(ui): scheda Ricerca con avanzamento e riepilogo, filtri per categoria, non più visti e giro"
```

---

### Task 15: Informativa v6, documenti

**File:**
- Modifica: `src/core/onboarding.ts`, `src/ui/onboarding/Onboarding.tsx`, `docs/privacy-pilota.md`, `CLAUDE.md`, `docs/smoke-test.md`, `src/ui/sidepanel/SettingsView.tsx` (testi dei portali)
- Test: `tests/unit/core/onboarding.test.ts`, `tests/unit/ui/onboarding.test.tsx`

- [ ] **Passo 1: Test che fallisce**

In `tests/unit/core/onboarding.test.ts`:

```ts
  it('v6: il giro delle ricerche richiede una nuova conferma', () => {
    expect(ONBOARDING_VERSION).toBe(6);
    expect(changesSince(5).join(' ')).toContain('«Cerca»');
  });
```

Run: `npx vitest run tests/unit/core/onboarding.test.ts`
Expected: FAIL.

- [ ] **Passo 2: Versione e novità**

In `src/core/onboarding.ts`: `export const ONBOARDING_VERSION = 6;` e in `ONBOARDING_CHANGES`:

```ts
  6: [
    "Ora puoi scegliere la tua zona di lavoro (comuni e categorie) e premere «Cerca» nel pannello: HomeRadar apre le ricerche dei portali in una finestra a parte e aggiorna i lead, solo quando lo chiedi tu. Salva anche la categoria dell'immobile e segnala gli annunci che non compaiono più nei giri.",
  ],
```

- [ ] **Passo 3: Testo dell'informativa**

In `src/ui/onboarding/Onboarding.tsx`:
- sostituisci la frase `Lavora solo sulle pagine che apri tu: non visita i portali da solo e non fa ricerche al posto tuo.` con: `Lavora sulle pagine che apri tu e, quando premi «Cerca» nel pannello, sulle ricerche dei comuni che hai scelto: le apre in una finestra a parte e le legge come faresti tu. Non parte mai da solo.`
- nella lista "Cosa salva", dopo la voce sugli annunci:

```tsx
          <li>
            La categoria dell'immobile (residenziale, commerciale, terreno, box), i comuni e le categorie della tua zona e,
            per gli annunci trovati con «Cerca», se nei giri successivi non compaiono più.
          </li>
```

- dopo la sezione "Cosa non salva mai", un paragrafo nella stessa card:

```tsx
        <p>
          I portali possono chiedere una verifica («non sei un robot») se vedono molte pagine aperte di fila: in quel caso
          HomeRadar si ferma su quel portale e te lo dice. Puoi sempre interrompere il giro con «Ferma» o chiudendo la sua finestra.
        </p>
```

In `src/ui/sidepanel/SettingsView.tsx`, in `PORTAL_HELP`, aggiungi a ciascuna voce: ` Con «Cerca» legge anche le ricerche della tua zona.`

- [ ] **Passo 4: Documenti**

- `docs/privacy-pilota.md`: aggiungi i punti del Passo 3 (stesso contenuto, in prosa) e, tra i punti aperti per il legale, "giro delle ricerche avviato dall'agente con un clic (navigazione automatica delle pagine di ricerca nel suo browser)".
- `CLAUDE.md`, sezione Architettura, nuovo punto dopo `src/core/`:

```markdown
- Giro delle ricerche: `src/core/searches.ts` (ricerche per comune e per provincia dalla zona `Settings.searchArea`, URL per portale in `src/adapters/<portale>/search-urls.ts`, `acceptObservation` scarta prima di `ingest` i comuni non scelti), `src/core/sweep.ts` (stato puro: alternanza dei portali, fine ricerca alla prima agenzia su Immobiliare/Idealista, tetti, esito), `src/core/missing.ts` ("non più visto" dopo `MISSING_SWEEPS` giri completi), `src/background/sweep-runner.ts` (finestra ridotta a icona, una scheda, pause, timeout, stato in `storage.session`; parte solo da `startSweep`). I content script mandano `pageRead` dopo ogni pagina di ricerca (`ParseResult.page`, `src/content/page-problem.ts` per verifica DataDome e pagina inesistente); il router passa all'orchestratore `ingest` e `pageRead` con la scheda (`ctx.tabId`). Elenco comuni: `src/shared/comuni.json` da `scripts/generate-comuni.mjs` (file ISTAT). Esito in `meta.sweep`, contatori `sweep_*` nel report.
```

  e nei Vincoli, sostituisci "Niente crawling." con "Niente crawling: il giro delle ricerche parte solo dal clic dell'agente su «Cerca», naviga una scheda alla volta con pause e si ferma alla prima verifica."
- `docs/smoke-test.md`: nuova sezione "Giro delle ricerche" con i passi: imposta 2-3 comuni piccoli → **Cerca** → la finestra ridotta a icona compare nella barra delle applicazioni → avanzamento nel pannello → riepilogo; chiudere la finestra a metà dà "Giro interrotto"; i lead nuovi hanno la categoria giusta.

- [ ] **Passo 5: Verifica e commit**

Run: `npm test && npm run typecheck`
Expected: PASS (aggiorna nei test dell'onboarding le stringhe del vecchio testo).

```bash
git add src docs CLAUDE.md tests
git commit -m "docs(informativa): v6 con il giro delle ricerche; documenti e guida aggiornati"
```

---

### Task 16: Test end-to-end del giro

**File:**
- Crea: `scripts/build-e2e.mjs`, `tests/e2e/sweep.spec.ts`
- Modifica: `package.json` (`test:e2e`)

**Interfacce:** consuma tutta la funzione; la build e2e usa `WXT_SWEEP_FAST=1` (pause 100-200 ms, timeout 5 s).

- [ ] **Passo 1: Build e2e**

`scripts/build-e2e.mjs`:

```js
// Build per i test end-to-end: pause e attese del giro brevissime (WXT_SWEEP_FAST). Mai usarla per il pilota.
import { execSync } from 'node:child_process';

execSync('npx wxt build', { stdio: 'inherit', env: { ...process.env, WXT_SWEEP_FAST: '1' } });
```

In `package.json`: `"test:e2e": "node scripts/build-e2e.mjs && playwright test"`.

- [ ] **Passo 2: Test**

`tests/e2e/sweep.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildSearchHtml } from './fixture-page';

const base = JSON.parse(readFileSync('tests/fixtures/immobiliare/search-privati.json', 'utf8'));
const agency = {
  realEstate: {
    id: 1, title: 'Bilocale via Esempio 101, Centro, Cassano d’Adda', contract: 'sale', price: { visible: true, value: 200000 },
    properties: [{ surface: '60 m²', rooms: '2', typology: { name: 'Appartamento' }, location: { city: "Cassano d'Adda" } }],
    advertiser: { agency: { type: 'agency' } },
  },
  seo: { url: 'https://www.immobiliare.it/annunci/1/' },
};
/** Pagina 1 di Cassano d'Adda: privati della fixture, poi un'agenzia → il giro si ferma qui. */
function cassanoPage() {
  const nd = structuredClone(base);
  const data = nd.props.pageProps.dehydratedState.queries[0].state.data;
  data.results.push(agency);
  data.currentPage = 1;
  data.maxPages = 1;
  return buildSearchHtml(nd);
}
const CAPTCHA = '<!doctype html><html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>';

async function panelWithZone(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(async () => {
    const settings = (await chrome.runtime.sendMessage({ type: 'getSettings' })).data;
    await chrome.runtime.sendMessage({
      type: 'saveSettings',
      settings: {
        ...settings,
        enabledPortals: { immobiliare: true, idealista: false, subito: false },
        searchArea: { comuni: [{ istat: '015059', name: "Cassano d'Adda", province: 'MI' }], categories: ['residential'] },
      },
    });
  });
  await panel.reload();
  return panel;
}

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/)/, (route) => route.abort());
});

test('Cerca: legge la ricerca nella finestra del giro e mostra il riepilogo', async ({ context, extensionId }) => {
  await context.route('https://www.immobiliare.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/vendita-case/cassano-d-adda/') return route.fulfill({ contentType: 'text/html', body: cassanoPage() });
    return route.fulfill({ status: 404, body: '' });
  });
  const panel = await panelWithZone(context, extensionId);
  await panel.getByRole('button', { name: 'Cerca', exact: true }).click();
  await expect(panel.getByText(/^Giro completato/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^[1-9]\d* nuovi · 0 ribassi · 0 non più visti$/)).toBeVisible();
  await panel.getByRole('button', { name: 'Vedi i nuovi' }).click();
  await expect(panel.locator('.lead').first()).toBeVisible();
});

test('verifica di DataDome: il portale si ferma e il pannello lo dice', async ({ context, extensionId }) => {
  await context.route('https://www.immobiliare.it/**', (route) => route.fulfill({ contentType: 'text/html', body: CAPTCHA }));
  const panel = await panelWithZone(context, extensionId);
  await panel.getByRole('button', { name: 'Cerca', exact: true }).click();
  await expect(panel.getByText('Immobiliare.it ha chiesto una verifica: aprilo tu e riprova domani.')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^Giro completato in parte/)).toBeVisible();
});

test('Ferma interrompe il giro', async ({ context, extensionId }) => {
  // Pagina lenta: il giro resta sulla prima pagina abbastanza a lungo da premere Ferma.
  await context.route('https://www.immobiliare.it/**', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ contentType: 'text/html', body: cassanoPage() });
  });
  const panel = await panelWithZone(context, extensionId);
  await panel.getByRole('button', { name: 'Cerca', exact: true }).click();
  await panel.getByRole('button', { name: 'Ferma' }).click();
  await expect(panel.getByText(/^Giro fermato/)).toBeVisible({ timeout: 10_000 });
});
```

Se `send` nel pannello avvolge le risposte (`{ ok, data }`), il `.data` del primo `sendMessage` è corretto; il `saveSettings` non ha bisogno della risposta.

- [ ] **Passo 3: Esegui**

Run: `npm run test:e2e`
Expected: PASS di tutti i test e2e (vecchi e nuovi). Se la finestra ridotta a icona non si apre nell'ambiente Playwright, controlla con `chrome.windows.getAll` dal pannello e, solo se serve, usa nella build e2e `state: 'normal'` passando la scelta da `WXT_SWEEP_FAST` in `openWindow` (commentando il motivo).

- [ ] **Passo 4: Commit**

```bash
git add scripts/build-e2e.mjs tests/e2e/sweep.spec.ts package.json
git commit -m "test(e2e): giro delle ricerche completo, verifica di DataDome e Ferma"
```

---

### Task 17: Verifica finale e prova vera

**File:** nessuno nuovo (eventuali correzioni).

- [ ] **Passo 1: Tutto verde**

Run: `npm test && npm run typecheck && npm run test:e2e && npm --prefix worker test`
Expected: PASS ovunque (il Worker non cambia: il suo test conferma che lo schema del report coincide ancora).

- [ ] **Passo 2: Build del pilota senza la modalità veloce**

Run: `npm run build` e controlla che in `.output/chrome-mv3` non ci sia la modalità veloce:

```bash
grep -rl "WXT_SWEEP_FAST" .output/chrome-mv3 || echo "ok: nessun riferimento"
grep -o "45e3\|45000" .output/chrome-mv3/background.js | head -1
```

Expected: `ok: nessun riferimento` e il timeout da 45 s presente.

- [ ] **Passo 3: Prova vera con l'utente**

Fermati e chiedi all'utente di: caricare la build (`.output/chrome-mv3`) al posto della versione installata, confermare l'informativa v6, impostare 3-4 comuni veri, premere **Cerca** e seguire `docs/smoke-test.md` (sezione "Giro delle ricerche"). Annota durata, esito, eventuali verifiche e lead nuovi; se qualcosa non torna, apri un task di correzione prima della PR.

- [ ] **Passo 4: Memoria e chiusura del branch**

Aggiorna la memoria del progetto (giro delle ricerche fatto, costanti finali) e usa superpowers:finishing-a-development-branch per la PR.
