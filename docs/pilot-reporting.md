# Report del pilota: Worker Cloudflare

Il Worker in `worker/` riceve i report giornalieri e i feedback delle estensioni del pilota e li mostra in una pagina admin. Specifica: `docs/superpowers/specs/2026-10-17-misura-pilota-design.md`.

## Primo deploy

Da `worker/`:

1. `npm install`. Se npm segnala che gli script di installazione di `workerd` ed `esbuild` non sono approvati e `wrangler` non parte, approvali con `npm install-scripts approve workerd esbuild` e ripeti `npm install`.
2. `npx wrangler login`
3. `npx wrangler d1 create homeradar-pilot` e copia `database_id` in `wrangler.toml`.
4. `npx wrangler d1 migrations apply homeradar-pilot --remote`
5. `npx wrangler secret put ADMIN_PASSWORD` (una password lunga, solo tua).
6. `npx wrangler deploy`: annota l'indirizzo `https://homeradar-pilot.<account>.workers.dev/`.

## Build dell'estensione per il pilota

Nella radice del repository crea `.env` (ignorato da git):

    WXT_REPORT_URL=https://homeradar-pilot.<account>.workers.dev/

poi `npm run zip`. Il dominio del Worker entra nei permessi del manifest solo con questa variabile. Senza `.env` l'estensione non invia nulla e la scheda Pilota dice "Invio non configurato in questa versione".

## Codici pilota

Apri `https://homeradar-pilot.<account>.workers.dev/admin/pilots` (utente qualsiasi, la password di `ADMIN_PASSWORD`), crea un codice per agenzia e consegnalo insieme allo zip. L'agente lo inserisce nell'informativa o in Impostazioni → Pilota. Un codice disattivato smette di essere accettato: le estensioni mostrano "Codice non riconosciuto".

## Consultare i dati

- `/admin`: una riga per installazione con versione, ultimo invio, giorni d'uso (7, 30, totale), attività degli ultimi 30 giorni, contattati, export, lead, lead di priorità Alta, avvisi ed errori. Le righe senza invii da più di 3 giorni sono evidenziate.
- `/admin/install/<id>`: andamento giorno per giorno, errori (già ripuliti dall'estensione) e ultimo report completo.
- `/admin/feedback`: i messaggi degli agenti.

Le date sono in UTC.

## Cancellare dati

    npx wrangler d1 execute homeradar-pilot --remote --command "DELETE FROM reports WHERE install_id = '<id>'"
    npx wrangler d1 execute homeradar-pilot --remote --command "DELETE FROM feedback WHERE code = '<CODICE>'"

I report più vecchi di 180 giorni si cancellano da soli ogni notte. I feedback restano finché non li cancelli.

## Prova in locale

Da `worker/`:

1. `npx wrangler d1 migrations apply homeradar-pilot --local`
2. `npx wrangler d1 execute homeradar-pilot --local --command "INSERT INTO pilots VALUES ('PROVA-0001', 'Prova', 1, 0)"`
3. Crea `.dev.vars` (ignorato da git) con `ADMIN_PASSWORD=prova`, poi `npx wrangler dev --port 8787`.
4. Nella radice, `.env` con `WXT_REPORT_URL=http://localhost:8787/`, poi `npm run build` e ricarica l'estensione da `.output/chrome-mv3`.
5. La pagina admin è su `http://localhost:8787/admin` (password `prova`).

Ricordati di cancellare `.env` prima di una build per il pilota con l'URL vera.

## Test

`npm --prefix worker test` esegue i test nel runtime dei Worker con un D1 locale. Lo schema del report (`worker/src/schema.ts`) è una copia di `src/shared/report-schema.ts`: se cambi quest'ultimo, copia il file; un test dell'estensione fallisce finché i due non coincidono.
