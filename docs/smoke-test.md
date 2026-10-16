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
   - [ ] Ricerca: scrivi il nome di una zona o di una via che vedi nei lead (anche senza accenti); lista e numeri sulle schede si aggiornano mentre scrivi; la ✕ svuota la ricerca e torna tutto come prima.
   - [ ] Prezzo da/a in k€ (es. 150 e 250): restano solo i lead nella fascia, senza quelli privi di prezzo; un valore come "abc" si colora di rosso e non filtra; "Azzera filtri" riporta ricerca, prezzo, badge e siti a "Tutti".
   - [ ] Con ricerca o prezzo attivi, "Elimina tutti «…»" li riporta nel testo (premi "Annulla").
6. Export.
   - [ ] XLSX si apre in Excel; CSV si apre in Excel con colonne separate e accenti corretti.
   - [ ] Con un filtro attivo (badge, sito, ricerca o prezzo) il file contiene solo i lead filtrati e il numero accanto a "Esporta la vista corrente" corrisponde.
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

## Promemoria di ricontatto

36. Aggiorna l'estensione su un profilo che aveva già confermato l'informativa (build precedente, poi questa).
    - [ ] Il pannello chiede di riconfermare, con il riquadro "Cosa è cambiato" sulle date di ricontatto; la legenda spiega il numero rosso sull'icona.
37. Su un lead "Nuovo": "Richiama…" → "Domani".
    - [ ] Il lead passa a "Da contattare" e mostra "Richiamo <giorno> · domani"; nella scheda "Richiami" è sotto "Prossimi".
38. Su un altro lead: "Richiama…" → nel campo data scrivi la data di oggi da tastiera e premi Invio.
    - [ ] Mentre scrivi l'anno la riga resta aperta e non si salva nulla; con Invio si salva il giorno scritto.
    - [ ] Sull'icona compare "1" in rosso; passandoci sopra: "HomeRadar: 1 richiamo da fare".
    - [ ] Chiudendo e riaprendo il pannello si apre la scheda "Richiami", con il contatore rosso e il lead sotto "Oggi".
39. Sul lead di oggi: "Sposta…" → "Tra 1 settimana".
    - [ ] Il lead va sotto "Prossimi" e il numero sull'icona sparisce.
40. Rimetti il richiamo a oggi, poi premi "Fatto".
    - [ ] L'etichetta del richiamo sparisce, torna "Richiama…" e il numero sull'icona sparisce.
41. Su un lead con richiamo, cambia lo stato in "Scartato".
    - [ ] Il richiamo sparisce e il lead non ha più "Richiama…".
42. Nella scheda "Richiami", esporta CSV.
    - [ ] La colonna "Richiamo" ha la data giusta (gg/mm/aaaa), non il giorno prima.
43. Con un richiamo di oggi: "Esporta backup ora", "Azzera archivio annunci", poi "Importa backup".
    - [ ] Il richiamo torna con la stessa data e il numero sull'icona ricompare.

## Prezzo rispetto alla zona

44. Su Immobiliare, cerca in una città con filtro "privati" e scorri qualche pagina finché il pannello ha almeno 6 privati con m² nella stessa zona (oppure 9 nella stessa città).
    - [ ] Su qualche lead compare "+N% su <zona>" (o "su <città>"); mai sotto il 10%.
    - [ ] L'icona "i" accanto apre la nota: zona, mediana €/m², numero di annunci, "È un'indicazione, non una valutazione". La nota si legge per intero, anche su un lead "Scartato".
45. Ordina per "Sopra mercato".
    - [ ] In cima i lead con la percentuale più alta; seguono quelli senza etichetta ma con un confronto (scarto sotto il 10%); in fondo quelli senza confronto (senza m², zona e città con pochi annunci).
46. Esporta CSV.
    - [ ] Colonne "Sopra mercato %" e "Confronto mercato" valorizzate solo sui lead con l'etichetta.
47. Impostazioni → "Rivedi informativa".
    - [ ] Nella legenda c'è la riga "+18% su Navigli"; l'informativa non chiede una nuova conferma.

## Stesso immobile su più portali

48. Da un'installazione con l'informativa confermata alla versione precedente, apri il pannello.
    - [ ] Il pannello chiede di riconfermare; "Cosa è cambiato" cita lo stesso immobile su più portali; la legenda ha "· 2 portali".
49. Trova un privato pubblicato sia su Immobiliare sia su Idealista (o Subito): cerca la stessa via o lo stesso titolo con filtro "privati" su entrambi i siti e apri le due ricerche.
    - [ ] Nel pannello compare un solo lead, con le etichette dei due portali e "Su 2 portali".
    - [ ] Sulla card di Idealista (o Subito) il badge finisce con "· 2 portali" e mostra la stessa età del badge su Immobiliare.
    - [ ] Il filtro "Su più portali" mostra solo i lead uniti.
50. Cambia lo stato del lead unito in "Contattato" e scrivi una nota.
    - [ ] "Fonti (2)" mostra le due fonti con prezzo, m² ed età; "Apri" porta all'annuncio giusto.
51. Premi "Separa" su una delle due fonti.
    - [ ] I lead diventano due, entrambi "Contattato" e con la nota; ricaricando le due ricerche non si riuniscono.
52. Esporta CSV con un lead unito nella vista.
    - [ ] Una riga per il lead, "Portale" con entrambi i siti, "Altri URL" con il link dell'altro annuncio.

Se il sito è cambiato: ricattura le fixture (Immobiliare: piano MVP, Task 4; Idealista: piano 2026-10-13, Task 8; Subito: piano 2026-10-13-subito-adapter, Task 5), aggiorna schemi o selettori, riesegui `npm test`.
