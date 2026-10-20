import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idealistaAdapter as A } from '@/adapters/idealista';

const read = (name: string) => readFileSync(`tests/fixtures/idealista/${name}`, 'utf8');
const parse = (name: string) => new DOMParser().parseFromString(read(name), 'text/html');
const PHONE = /\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/;
const SEARCH = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc';
const DETAIL = 'https://www.idealista.it/immobile/25975303/';

describe.each(['search-privati.html', 'detail-private.html', 'detail-agency.html', 'search-salerno.html'])('fixture %s', (name) => {
  it('non contiene dati personali né script', () => {
    const text = read(name);
    expect(text).not.toMatch(PHONE);
    expect(text).not.toContain('<script');
    expect(text).not.toContain('item-description');
  });

  it('ha titoli sintetici (nessuna via reale)', () => {
    const doc = parse(name);
    const titles = [
      doc.title,
      ...[...doc.querySelectorAll('[title], .geo-reach-card__address')].map((e) => e.getAttribute('title') ?? e.textContent ?? ''),
    ];
    for (const t of titles.filter((x) => !x.startsWith('Fixture'))) expect(t).toMatch(/Via Esempio \d+/);
  });
});

describe('adattatore Idealista sulle fixture reali', () => {
  it('legge la ricerca "da privati" senza errori, ignorando gli annunci suggeriti', () => {
    const doc = parse('search-privati.html');
    const r = A.readDocument!(doc, SEARCH);
    expect(r.errors).toEqual([]);
    expect(r.observations).toHaveLength(30);
    expect(r.observations.every((o) => o.sellerType === 'private')).toBe(true);
    expect(r.observations.some((o) => o.lastDrop)).toBe(true);
    expect(r.observations.some((o) => o.price == null)).toBe(false);
    for (const o of r.observations) expect(o.url).toMatch(/^https:\/\/www\.idealista\.it\/immobile\/\d+\/$/);
    // Le card suggerite (.geo-reach-card) sono in pagina ma non contano.
    expect(doc.querySelectorAll('article.geo-reach-card').length).toBeGreaterThan(0);
    expect(A.cardIds(doc)).toHaveLength(30);
  });

  it('trova il contenitore della foto su ogni card, anche senza foto', () => {
    const doc = parse('search-privati.html');
    for (const id of A.cardIds(doc)) {
      const c = A.cardFor(doc, id)!;
      expect(A.badgeHost(c)).not.toBe(c);
    }
  });

  it('legge la scheda di un privato con il ribasso e quella di un\'agenzia', () => {
    const p = A.readDocument!(parse('detail-private.html'), DETAIL);
    expect(p.errors).toEqual([]);
    expect(p.observations[0]).toMatchObject({
      sellerType: 'private', source: 'detail', price: 445000, surfaceM2: 52, rooms: 2,
      lastDrop: { fromPrice: 450000, toPrice: 445000, date: null },
    });
    const a = A.readDocument!(parse('detail-agency.html'), DETAIL);
    expect(a.observations[0]).toMatchObject({ sellerType: 'agency', price: 625000, lastDrop: { fromPrice: 645000 } });
  });
});
