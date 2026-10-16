# HomeRadar — Roadmap prima del pilota

- **Data:** 2026-10-14
- **Stato:** approvata, da implementare

Funzionalità da completare **tutte prima del rilascio al pilota** con le agenzie. Ogni punto si sviluppa a sé con il solito percorso: specifica in `docs/superpowers/specs/`, piano in `docs/superpowers/plans/`, branch dedicato, PR. Quando un punto viene unito su `main` si spunta qui e si aggiunge il link alla PR.

L'ordine conta: il punto 7 riusa il confronto per caratteristiche del punto 6.

## Avanzamento

| # | Funzionalità | Stato | PR |
|---|---|---|---|
| 1 | Backup e ripristino | fatto | [#7](https://github.com/michele-matula/homeradar/pull/7) |
| 2 | Onboarding e informativa privacy | fatto | [#8](https://github.com/michele-matula/homeradar/pull/8) |
| 3 | Ricerca e filtri nel pannello | fatto | [#9](https://github.com/michele-matula/homeradar/pull/9) |
| 4 | Promemoria di ricontatto | fatto | [#10](https://github.com/michele-matula/homeradar/pull/10) |
| 5 | Prezzo al m² rispetto alla zona | fatto | [#11](https://github.com/michele-matula/homeradar/pull/11) |
| 6 | Stesso immobile su più portali | da fare | |
| 7 | Ripubblicazioni | da fare | |
| 8 | Misura del pilota: contatori d'uso e feedback | da fare | |

## 1. Backup e ripristino

**Problema:** i dati vivono solo nell'IndexedDB del browser. Un cambio di PC, una reinstallazione o la pulizia dei dati di Chrome cancellano stati, note e storico prezzi, cioè il valore accumulato in settimane. L'export XLSX/CSV non si può reimportare.

**Cosa fare:** nelle impostazioni, "Esporta backup" (file JSON) e "Importa backup". Il file contiene annunci, snapshot dei prezzi, stati dei lead, punti di calibrazione e impostazioni, con un numero di versione del formato.

**Da decidere nella specifica:** importazione che unisce o che sostituisce; gestione dei conflitti (stesso annuncio con stati diversi); validazione del file con zod.

**Vincoli:** tutto in locale, nessun server.

## 2. Onboarding e informativa privacy

**Problema:** la specifica MVP richiede un'informativa per gli utenti del pilota, e l'indirizzo completo salvato va dichiarato. Senza spiegazioni i badge stimati (Idealista, Subito) rischiano di essere fraintesi.

**Cosa fare:** schermata al primo avvio, riapribile dalle impostazioni, che spiega:

- cosa fa l'estensione e su quali portali;
- cosa salva (annunci di privati, indirizzo, storico prezzi, note dell'agente) e cosa non salva mai (telefoni, nomi);
- che i dati restano sul browser dell'agente;
- la legenda dei badge: priorità, "~" = età stimata, "Età incerta", ribassi.

## 3. Ricerca e filtri nel pannello

**Problema:** oggi si filtra solo per badge e per sito. Con qualche centinaio di lead non basta.

**Cosa fare:** ricerca a testo libero su titolo e indirizzo, filtro per città/zona, fascia di prezzo. Si combinano con i filtri e l'ordinamento esistenti; l'export della vista corrente rispetta i nuovi filtri.

## 4. Promemoria di ricontatto

**Problema:** lo stato "Contattato" non dice quando richiamare.

**Cosa fare:** data di ricontatto sul lead; i richiami scaduti sono evidenziati nel pannello e contati sull'icona dell'estensione. Il permesso `alarms` è già presente.

**Note:** richiede una nuova `version(n+1)` dello schema Dexie con migrazione.

## 5. Prezzo al m² rispetto alla zona

**Problema:** i privati con prezzo sopra mercato sono quelli che non vendono e più probabilmente accettano un'agenzia.

**Cosa fare:** mediana €/m² per zona calcolata dagli annunci già raccolti; segnale "sopra mercato del X%" sul lead.

**Vincoli:** è un'indicazione, non una valutazione: il campione è solo ciò che l'agente ha visto. Va mostrata solo con un numero minimo di annunci per zona (soglia da definire nella specifica) e dichiarata come indicativa.

## 6. Stesso immobile su più portali

**Problema:** un privato spesso pubblica la stessa casa su Immobiliare, Idealista e Subito; oggi diventano tre lead separati.

**Cosa fare:** raggruppare gli annunci che corrispondono per città/zona, m², locali e prezzo simile in un solo lead con più fonti e l'età più vecchia. La presenza su più portali è anche un segnale di motivazione del venditore.

**Da decidere nella specifica:** criteri e tolleranze del confronto; come l'agente separa un raggruppamento sbagliato; effetto su stati, note ed export.

## 7. Ripubblicazioni

**Problema:** chi ripubblica azzera la data di creazione; l'annuncio vecchio sembra nuovo (rischio già indicato nella specifica MVP).

**Cosa fare:** riconoscere un annuncio sparito e ricomparso con un nuovo ID, con il confronto del punto 6, ed ereditarne età e storico prezzi.

## 8. Misura del pilota: contatori d'uso e feedback

**Problema:** il criterio di successo del pilota ("trovano più lead in meno tempo e continuano a usarlo") oggi non è misurato.

**Cosa fare:**

- contatori anonimi nel report diagnostico: giorni di utilizzo, lead passati a "Contattato", export eseguiti;
- un modo rapido per l'agente di mandare un feedback.

**Vincoli:** nessun dato degli annunci nel report, come oggi. Nessuna telemetria automatica: è l'agente a decidere cosa inviare. Il canale di feedback (es. email precompilata con il report) va scelto nella specifica.

## Fuori da questa roadmap

- **Annunci rimossi o venduti:** richiederebbe di interrogare i portali, escluso dai vincoli del progetto. Al massimo "non visto da N giorni".
- **Condivisione tra colleghi, CRM, backend:** cambia il profilo legale e privacy; solo dopo il parere legale e se il pilota lo chiede.
