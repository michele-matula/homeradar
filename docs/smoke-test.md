# Smoke test sul sito reale (prima di ogni rilascio al pilota)

Durata: ~5 minuti. Usa `npm run build` e carica `.output/chrome-mv3` in Chrome.

1. Apri `https://www.immobiliare.it/vendita-case/milano/da-privati/`.
   - [ ] Compare un badge sulla foto di ogni annuncio di privato; nessun badge sulle agenzie.
2. Passa alla pagina 2 dei risultati con il link del sito (senza ricaricare).
   - [ ] I badge compaiono sulla nuova pagina entro pochi secondi; nessun banner "ricarica".
3. Cambia ordinamento o filtro.
   - [ ] Badge aggiornati, nessun banner. Se compare il banner, la chiamata interna è cambiata: annotalo.
4. Apri un annuncio di privato (dettaglio).
   - [ ] Nessun errore; nel pannello quell'annuncio non mostra più "~" davanti ai giorni.
5. Apri il pannello laterale.
   - [ ] Schede con conteggi; cambia lo stato di un lead e scrivi una nota; ricarica il pannello: dati mantenuti.
6. Export.
   - [ ] XLSX si apre in Excel; CSV si apre in Excel con colonne separate e accenti corretti.
7. Impostazioni → "Copia report diagnostico".
   - [ ] Il testo copiato non contiene indirizzi, titoli o telefoni.
8. Icona dell'estensione.
   - [ ] Nessun "!" arancione (se presente: l'adattatore non riconosce più i dati, vedi il report diagnostico).

9. Apri un annuncio **in affitto** (dettaglio, /annunci/{id}/ di un affitto).
   - [ ] Nessun lead compare nel pannello laterale per quell'annuncio.
10. Dai risultati di ricerca, clicca su un annuncio per aprire il dettaglio senza ricaricare la pagina.
    - [ ] I dati arrivano via ricarica oppure compare il banner di riserva "ricarica la pagina".
11. Su una pagina di ricerca con badge, apri la console di Chrome (DevTools).
    - [ ] Nessun errore di idratazione React (hydration mismatch).

Se il sito è cambiato: ricattura le fixture (piano, Task 4), aggiorna gli schemi, riesegui `npm test`.
