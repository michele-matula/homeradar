# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HomeRadar è un'estensione Chrome (MV3, WXT + React + TypeScript) per agenti immobiliari: su Immobiliare.it riconosce gli annunci di privati, ne costruisce lo storico prezzi in locale e segnala i lead (anzianità ≥ soglia oppure ribassi). Conversazione e testi dell'interfaccia in italiano.

## Comandi

```bash
npm run dev          # Chrome con estensione in hot reload
npm run build        # build in .output/chrome-mv3
npm run typecheck
npm test             # unit test (Vitest, jsdom + fake-indexeddb)
npx vitest run tests/unit/core/rules.test.ts   # un singolo file
npx vitest run -t "Alta"                        # test per nome
npm run test:e2e     # build + Playwright su pagine fixture locali
node scripts/generate-icons.mjs                 # rigenera public/icon/*.png da src/shared/logo.ts
```

## Architettura

Flusso: `bridge (MAIN world) → content script (ISOLATED) → adapter → background → IndexedDB → side panel`.

- `src/bridge/bridge.ts`: unico codice nel contesto della pagina. Inoltra `__NEXT_DATA__` e le risposte XHR di `/api-next/search-list/listings/` via `window.postMessage`. Non fa mai richieste proprie.
- `src/adapters/immobiliare/`: funzioni pure. Gli schemi zod sono la **lista dei campi ammessi**: ciò che non è dichiarato (telefoni, nomi, descrizioni) viene scartato. `urls.ts` non importa zod perché è usato anche dal bridge.
- `src/core/`: logica pura e testabile. `rules.ts` (priorità e badge), `age.ts` (stima età da ID), `service.ts` (`LeadService`, unico scrittore su Dexie), `router.ts` (dispatch dei messaggi), `export.ts`.
- `src/content/`: badge sulle card (`li` con link `/annunci/{id}/`), `RouteWatcher` che mostra il banner "ricarica" se dopo un cambio rotta non arrivano dati.
- `src/ui/sidepanel/`: React; parla col background solo tramite `api.ts`.
- Tipi condivisi in `src/shared/types.ts`; messaggi in `src/shared/messages.ts`.

## Vincoli da rispettare

- Mai richieste HTTP dell'estensione verso il portale (DataDome; rischio legale). Niente crawling.
- Salvare solo annunci di privati; mai telefoni o nomi del venditore.
- Il repository è pubblico: le fixture vanno sempre passate da `scripts/sanitize-fixture.mjs`; i file grezzi stanno in `fixtures-raw/` (ignorata).
- Timestamp sempre in ms epoch UTC.
- Se Immobiliare.it cambia struttura: aggiorna gli schemi in `src/adapters/immobiliare/schemas.ts`, ricattura le fixture (vedi `docs/smoke-test.md`), non modificare le fixture a mano.

## Documenti

- Specifica: `docs/superpowers/specs/2026-10-10-homeradar-mvp-design.md`
- Piano: `docs/superpowers/plans/2026-10-10-homeradar-mvp.md`
- Checklist prima di un rilascio al pilota: `docs/smoke-test.md`
