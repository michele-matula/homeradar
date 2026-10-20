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
