# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeRadar è un'estensione Chrome (MV3, WXT + React + TypeScript) per agenti immobiliari: su Immobiliare.it, Idealista.it e Subito.it riconosce gli annunci di privati, ne costruisce lo storico prezzi in locale e segnala i lead (anzianità ≥ soglia oppure ribassi). Conversazione e testi dell'interfaccia in italiano.

## Comandi

```bash
npm run dev          # Chrome con estensione in hot reload
npm run build        # build in .output/chrome-mv3
npm run zip          # zip per il pilota
npm run typecheck
npm test             # unit test (Vitest, jsdom + fake-indexeddb)
npx vitest run tests/unit/core/rules.test.ts   # un singolo file
npx vitest run -t "Alta"                        # test per nome
npm run test:e2e     # build + Playwright su pagine fixture locali
node scripts/generate-icons.mjs                 # rigenera public/icon/*.png da src/shared/logo.ts
```

## Architettura

Flusso Immobiliare: `bridge (MAIN world) → content script (ISOLATED) → adapter.parsePayload → background → IndexedDB → side panel`.
Flusso Idealista: `content script (ISOLATED) → adapter.readDocument (DOM già mostrato) → background → …`, nessun bridge.
Flusso Subito: `bridge (MAIN world) → content script (ISOLATED) → adapter.parsePayload → background → …`, come Immobiliare (content script comune in `src/content/payload-script.ts`).

- `src/bridge/bridge.ts`: unico codice nel contesto della pagina, installato da `*-bridge.content.ts`. Inoltra `__NEXT_DATA__` e le risposte XHR/fetch del sito (Immobiliare `/api-next/search-list/listings/`, Subito `hades.subito.it/v1/search/items`) via `window.postMessage`. Non fa mai richieste proprie e non deve mai rompere quelle del sito.
- `src/adapters/immobiliare/`: funzioni pure. Gli schemi zod sono la **lista dei campi ammessi**: ciò che non è dichiarato (telefoni, nomi, descrizioni) viene scartato. `urls.ts` non importa zod perché è usato anche dal bridge.
- `src/adapters/idealista/`: funzioni pure sul DOM delle card (`article.item[data-element-id]`, `data-is-professional-ad`; esclusi gli annunci suggeriti `.geo-reach-card`). Nessuna data di pubblicazione: l'età si stima dall'ID (`DEFAULT_CALIBRATION.idealista` in `core/age.ts`, più i punti appresi dalla pagina "più recenti"). Non leggere mai `.professional-name` (nome del privato).
- `src/adapters/subito/`: funzioni pure su `__NEXT_DATA__` della ricerca (`initialState.items`, compresi `galleryList`/`boostedItems`, che hanno card in pagina) e sulle risposte di `hades.subito.it/v1/search/items` intercettate dal bridge (paginazione SPA; il cambio di categoria ricarica la pagina). Schemi zod come whitelist: di `advertiser` solo `company`/`type` (il sito espone nome e telefono). Solo `type.key === 's'` e macrocategoria Immobili `'6'` (`category.parentId` in `__NEXT_DATA__`, `category.macrocategory_id` nell'API). La data di Subito è quella di rinnovo: l'età si stima dall'ID (`DEFAULT_CALIBRATION.subito`, più i punti appresi dagli annunci rinnovati oggi). La scheda annuncio non viene letta.
- `src/adapters/types.ts`: `PortalAdapter` con modalità `parsePayload` (bridge) o `readDocument` (DOM), più `cardFor`/`badgeHost`/`cardIds` per i badge.
- `src/core/`: logica pura e testabile. `rules.ts` (priorità e badge), `age.ts` (stima età da ID), `service.ts` (`LeadService`, unico scrittore su Dexie), `router.ts` (dispatch dei messaggi), `export.ts`. Lo schema Dexie è in `db.ts` con versioni incrementali: per cambiarlo aggiungi una `version(n+1)` con migrazione, non modificare quelle esistenti.
- `src/entrypoints/`: solo cablaggio WXT (background, content script per portale, side panel); la logica sta nei moduli sopra.
- Portali attivi: `Settings.enabledPortals`. Il controller chiede `isPortalEnabled` prima di ogni lettura (spento: non legge e toglie i badge); il router scarta comunque `ingest`/`parseStatus` dei portali spenti. Il bridge resta installato (`document_start`, non può leggere le impostazioni) ma inoltra solo dentro la pagina.
- `src/content/`: badge sulle card (`li` con link `/annunci/{id}/`), `RouteWatcher` che mostra il banner "ricarica" se dopo un cambio rotta non arrivano dati.
- `src/ui/sidepanel/`: React; parla col background solo tramite `api.ts`.
- Tipi condivisi in `src/shared/types.ts`; messaggi in `src/shared/messages.ts`.

## Vincoli da rispettare

- Mai richieste HTTP dell'estensione verso il portale (DataDome; rischio legale). Niente crawling.
- Salvare solo annunci di privati; mai telefoni o nomi del venditore.
- Il repository è pubblico: le fixture vanno sempre passate da `scripts/sanitize-fixture.mjs`; i file grezzi stanno in `fixtures-raw/` (ignorata).
- Timestamp sempre in ms epoch UTC.
- Se un portale cambia struttura: aggiorna gli schemi (Immobiliare, `src/adapters/immobiliare/schemas.ts`; Subito, `src/adapters/subito/schemas.ts`) o i selettori (Idealista, `src/adapters/idealista/parse.ts`), ricattura le fixture (vedi `docs/smoke-test.md`), non modificare le fixture a mano.

## Documenti

- Specifica: `docs/superpowers/specs/2026-10-10-homeradar-mvp-design.md`
- Piano: `docs/superpowers/plans/2026-10-10-homeradar-mvp.md`
- Checklist prima di un rilascio al pilota: `docs/smoke-test.md`
- Roadmap prima del pilota (ordine e avanzamento; si riparte dal primo punto "da fare"): `docs/roadmap.md`
