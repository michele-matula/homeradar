import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Il repository è pubblico: nessuna fixture deve portare dati che riconducono a un venditore privato o alla sua casa.
const ROOT = 'tests/fixtures';
const files = readdirSync(ROOT, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .map((d) => join(d.parentPath, d.name));

const FORBIDDEN = [
  'phoneUrl', // immagine con il numero di telefono (Immobiliare)
  'pic.im-cdn.it/text/', // stessa immagine, per URL
  '"anchor"', // testo del link con indirizzo e civico reali (Immobiliare, seo.anchor)
  '"latitude"',
  '"longitude"',
  'idGeoHash',
];

describe.each(files)('fixture %s', (file) => {
  it('non contiene telefoni, indirizzi reali né coordinate', () => {
    const text = readFileSync(file, 'utf8');
    for (const k of FORBIDDEN) expect(text, k).not.toContain(k);
    expect(text).not.toMatch(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/);
  });
});
