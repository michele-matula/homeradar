import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { subitoAdapter as A } from '@/adapters/subito';

const read = (name: string) => readFileSync(`tests/fixtures/subito/${name}`, 'utf8');
const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/;
const SEARCH = 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/';
const API = 'https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30';

describe.each(['search-appartamenti.json', 'api-page2.json', 'search-altra-categoria.json'])('fixture %s', (name) => {
  it('non contiene dati personali', () => {
    const text = read(name);
    for (const k of ['"name"', '"phone"', '"user_id"', '"userId"', '"shop_name"', '"body"']) expect(text).not.toContain(k);
    expect(text).not.toMatch(PHONE);
  });

  it('ha titoli e URL sintetici', () => {
    const text = read(name);
    const subjects = [...text.matchAll(/"subject": "([^"]*)"/g)].map((m) => m[1]);
    expect(subjects.length).toBeGreaterThan(0);
    for (const s of subjects) expect(s).toMatch(/ in Via Esempio \d+$/);
    for (const m of text.matchAll(/"default": "([^"]*)"/g)) expect(m[1]).toMatch(/^https:\/\/www\.subito\.it\/[a-z-]+\/annuncio-\d+\.htm$/);
  });
});

describe('adattatore sulle fixture reali', () => {
  it('legge la ricerca di appartamenti senza errori', () => {
    const r = A.parseNextData(JSON.parse(read('search-appartamenti.json')), SEARCH);
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
    expect(r.observations.some((o) => o.sellerType === 'private')).toBe(true);
    expect(r.observations.some((o) => o.sellerType === 'agency')).toBe(true);
    expect(r.observations.every((o) => o.sellerType !== 'unknown')).toBe(true);
    expect(r.observations.filter((o) => o.price != null).length).toBeGreaterThan(r.observations.length / 2);
  });

  it("legge la risposta dell'API senza errori", () => {
    const r = A.parseApi(API, JSON.parse(read('api-page2.json')));
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThanOrEqual(20);
    expect(r.observations.every((o) => o.typology === 'Appartamenti')).toBe(true);
  });

  it("legge un'altra categoria di immobili", () => {
    const r = A.parseNextData(JSON.parse(read('search-altra-categoria.json')), SEARCH);
    expect(r.errors).toEqual([]);
    expect(r.observations.length).toBeGreaterThan(0);
    expect(r.observations.some((o) => o.typology !== 'Appartamenti')).toBe(true);
  });
});
