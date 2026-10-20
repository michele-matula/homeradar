import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(`tests/fixtures/casadaprivato/${name}`, 'utf8');
const parse = (name: string) => new DOMParser().parseFromString(read(name), 'text/html');

describe.each(['search-salerno.html', 'search-salerno-ultima.html', 'search-acerno.html', 'search-atrani.html', 'notfound.html'])('fixture %s', (name) => {
  it('non contiene descrizioni, script né indirizzi reali', () => {
    const text = read(name);
    const doc = parse(name);
    expect(text).not.toContain('<script');
    expect(doc.querySelectorAll('div.item p')).toHaveLength(0);
    for (const a of doc.querySelectorAll('div.item h3 a')) expect(a.textContent).toMatch(/da Privato a [^,]+(, Via Esempio \d+)?$/);
    for (const a of doc.querySelectorAll('div.item a[href]')) expect(a.getAttribute('href')).toMatch(/^\/[a-z-]+\/annuncio-\d+$/);
  });
});
