import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { casadaprivatoAdapter } from '@/adapters/casadaprivato';
import { pageProblem } from '@/content/page-problem';
import { URL } from './casadaprivato-builders';

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

const obsOf = (name: string) => casadaprivatoAdapter.readDocument!(parse(name), URL);

describe('lettura delle fixture', () => {
  it('Salerno: 15 osservazioni, riservati, copertine, non residenziali', () => {
    const r = obsOf('search-salerno.html');
    expect(r.errors).toEqual([]);
    expect(r.observations).toHaveLength(15);
    expect(r.page).toMatchObject({ results: 15, lastPage: false });
    expect(r.observations.some((o) => o.priceReserved)).toBe(true);
    expect(r.observations.some((o) => o.coverUrl)).toBe(true);
    expect(r.observations.some((o) => o.category && o.category !== 'residential')).toBe(true);
  });
  it('Salerno, ultima pagina', () => {
    expect(casadaprivatoAdapter.readDocument!(parse('search-salerno-ultima.html'), `${URL}/pagina-6`).page!.lastPage).toBe(true);
  });
  it('Acerno: solo gli annunci propri', () => {
    const r = obsOf('search-acerno.html');
    expect(r.observations.length).toBeGreaterThan(0);
    expect(r.observations.every((o) => o.city === 'Acerno')).toBe(true);
    expect(r.page!.results).toBe(r.observations.length);
  });
  it('Atrani: solo comuni vicini, nessuna osservazione', () => {
    const r = obsOf('search-atrani.html');
    expect(r.observations).toEqual([]);
    expect(r.page).toEqual({ results: 0, privates: 0, lastPage: true });
  });
  it('pagina non trovata: nessuna page', () => {
    expect(obsOf('notfound.html').page).toBeUndefined();
    expect(pageProblem(parse('notfound.html'))).toBe('notFound');
  });
});
