# Smoke test sul sito reale (prima di ogni rilascio al pilota)

Durata: ~10 minuti. Usa `npm run build` e carica `.output/chrome-mv3` in Chrome.

## Immobiliare.it

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
   - [ ] Filtro per badge: scegli "Da verificare" e restano solo quei lead; i conteggi dei filtri corrispondono alla scheda; cambiando scheda il filtro resta attivo e i filtri senza annunci sono disattivati.
   - [ ] Con un filtro attivo il pulsante dice "Elimina tutti «…» (n)" e n è il numero dei lead filtrati (premi "Annulla", non confermare).
6. Export.
   - [ ] XLSX si apre in Excel; CSV si apre in Excel con colonne separate e accenti corretti.
   - [ ] Con un filtro attivo il file contiene solo i lead filtrati.
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

## Idealista.it

Naviga a mano, senza automazione: Idealista usa DataDome.

12. Apri `https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc`.
    - [ ] Badge sulla foto di ogni privato (anche sulle card "Senza foto"); nessun badge su agenzie, pubblicità e annunci suggeriti "dalla tua zona".
13. Vai alla pagina 2 con il link del sito (la pagina si ricarica).
    - [ ] Badge sulla nuova pagina; nessun banner "ricarica".
14. Apri la scheda di un privato con ribasso.
    - [ ] Nel pannello il lead ha l'etichetta "Idealista" e "Ribassato del …% (… → … €) rilevato il gg/mm".
15. Apri `?ordine=pubblicazione-desc` (prima pagina), poi Impostazioni → "Copia report diagnostico".
    - [ ] Il report dice "Avviso adattatore: no" e ha il contatore `domScans`.
16. Export XLSX/CSV.
    - [ ] Colonna "Portale" con "Idealista.it" / "Immobiliare.it".
17. Console di Chrome sulla pagina di ricerca.
    - [ ] Nessun errore `[HomeRadar]`.

Se il sito è cambiato: ricattura le fixture (Immobiliare: piano MVP, Task 4; Idealista: piano 2026-10-13, Task 8), aggiorna schemi o selettori, riesegui `npm test`.
