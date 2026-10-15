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

## Subito.it

18. Apri `https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/` e scorri fino in fondo.
    - [ ] Badge sulla foto di ogni privato, anche sugli annunci in evidenza; nessun badge sulle agenzie e sulle pubblicità.
19. Vai alla pagina 2 con il pulsante del sito (la pagina non si ricarica).
    - [ ] Nuovi badge; nessun banner "ricarica".
20. Cambia categoria dai filtri del sito (es. ville, uffici).
    - [ ] Badge anche lì.
21. Torna indietro con il browser.
    - [ ] Nessun falso banner "ricarica".
22. Apri la scheda di un annuncio.
    - [ ] Nessun banner, nessun errore `[HomeRadar]` in console.
23. Pannello.
    - [ ] Lead con etichetta "Subito" ed età con "~"; vicino alla soglia "Età incerta".
24. Export XLSX/CSV.
    - [ ] Colonna "Portale" con "Subito.it"; nessun nome o telefono del venditore.
25. Impostazioni → "Copia report diagnostico".
    - [ ] Nessun avviso adattatore per Subito.it.

## Backup

26. Installa la build su un profilo Chrome nuovo e accetta i permessi.
    - [ ] Chrome chiede il permesso "Gestire i download".
27. Naviga una ricerca su un portale finché compaiono lead, poi attendi almeno 5 minuti con il browser aperto.
    - [ ] Compare `Download/HomeRadar/homeradar-backup-1.json`; in Impostazioni "Ultimo backup" ha data e ora di oggi.
28. Attiva in Chrome "Chiedi dove salvare ogni file prima di scaricarlo", azzera lo stato del backup (rimuovi l'estensione e reinstallala), ripeti il punto 27.
    - [ ] Si apre la finestra di salvataggio (va segnalato nell'onboarding, roadmap punto 2). Prima di confermarla, in Impostazioni c'è "Backup automatico in corso".
    - [ ] Aspetta almeno 1 minuto con la finestra aperta, poi conferma: riaprendo Impostazioni "Ultimo backup" ha data e ora di oggi, senza "non riuscito".
    - [ ] Variante: annulla la finestra. In Impostazioni compare "Ultimo backup automatico non riuscito".
29. Impostazioni → "Esporta backup ora".
    - [ ] Scarica `homeradar-backup-AAAA-MM-GG.json`; il file non contiene nomi né telefoni dei venditori.
30. Su un altro profilo Chrome pulito: Impostazioni → "Importa backup" con quel file.
    - [ ] Riepilogo "Backup importato: N annunci nuovi…"; lead, stati, note, grafici prezzi e impostazioni come nel profilo di origine.

## Onboarding e informativa

31. Installa la build su un profilo Chrome nuovo.
    - [ ] Si apre da sola la scheda "Benvenuto in HomeRadar"; la legenda mostra le soglie delle impostazioni (120 giorni di default).
    - [ ] L'icona dell'estensione ha un pallino; passandoci sopra: "HomeRadar: conferma l'informativa per iniziare".
32. Chiudi la scheda senza confermare e apri una ricerca su Immobiliare.it.
    - [ ] Nessun badge; compare l'avviso "HomeRadar non è ancora attivo…" con "Apri".
    - [ ] Il pannello laterale mostra l'informativa, senza lista e senza pulsante Impostazioni.
33. Premi "Apri" nell'avviso.
    - [ ] Si apre la scheda di benvenuto; l'avviso diventa "dopo aver confermato, ricarica la pagina".
34. Premi "Ho capito, inizia" nella scheda.
    - [ ] La scheda dice "HomeRadar è attivo"; il pannello, se aperto, passa da solo alla lista; il pallino sull'icona sparisce.
    - [ ] Ricaricando la ricerca compaiono i badge. Su Idealista compaiono anche senza ricaricare, scorrendo i risultati.
35. Impostazioni → "Rivedi informativa".
    - [ ] Stessa schermata in sola lettura, con "Confermata il" e la data di oggi; "Chiudi" torna alle impostazioni.

Se il sito è cambiato: ricattura le fixture (Immobiliare: piano MVP, Task 4; Idealista: piano 2026-10-13, Task 8; Subito: piano 2026-10-13-subito-adapter, Task 5), aggiorna schemi o selettori, riesegui `npm test`.
