# HomeRadar

Estensione Chrome per agenti immobiliari. Mentre navighi su Immobiliare.it, Idealista.it o Subito.it, HomeRadar:

- riconosce gli annunci di **privati**;
- segnala quelli online da più di 120 giorni (su Idealista e Subito l'età è stimata) o con **ribassi di prezzo**, con un badge sulla foto;
- raccoglie i lead in un pannello laterale con stato, note e storico prezzi;
- esporta in **Excel (XLSX)** o **CSV**.

Tutti i dati restano nel tuo browser. L'estensione non effettua richieste proprie al portale e non salva telefoni né nomi dei venditori.

## Installazione per il pilota

1. Scarica lo zip della release (o esegui `npm install && npm run zip`).
2. Chrome → `chrome://extensions` → attiva "Modalità sviluppatore" → "Carica estensione non pacchettizzata" → seleziona la cartella estratta (`.output/chrome-mv3`).
3. Apri una ricerca su uno dei tre portali e clicca l'icona HomeRadar per il pannello.

## Sviluppo

Vedi `CLAUDE.md` per comandi e architettura.
