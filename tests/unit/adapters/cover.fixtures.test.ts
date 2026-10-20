import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idealistaAdapter } from '@/adapters/idealista';
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { subitoAdapter } from '@/adapters/subito';
import type { ParseResult } from '@/shared/types';

const read = (path: string) => readFileSync(`tests/fixtures/${path}`, 'utf8');
const privates = (r: ParseResult) => r.observations.filter((o) => o.sellerType === 'private');

/** Quasi tutti i privati hanno la copertina (Salerno, 2026-10-20: 23/25, 29/30, 25/31) e tutte sono URL finti. */
function expectCovers(r: ParseResult, fake: RegExp) {
  expect(r.errors).toEqual([]);
  const p = privates(r);
  expect(p.length).toBeGreaterThan(0);
  const withCover = p.filter((o) => o.coverUrl);
  expect(withCover.length / p.length).toBeGreaterThanOrEqual(0.7);
  for (const o of withCover) expect(o.coverUrl).toMatch(fake);
}

describe('copertine sulle fixture reali', () => {
  it('Immobiliare, pagina di ricerca', () => {
    const r = immobiliareAdapter.parseNextData(JSON.parse(read('immobiliare/search-salerno.json')), 'https://www.immobiliare.it/vendita-case/salerno/?criterio=privateFirst');
    expectCovers(r, /^https:\/\/pwm\.im-cdn\.it\/image\/\d{1,3}\/xxs-c\.jpg$/);
  });

  it('Immobiliare, risposta XHR', () => {
    const r = immobiliareAdapter.parseIntercepted('https://www.immobiliare.it/api-next/search-list/listings/?pag=2', JSON.parse(read('immobiliare/api-salerno.json')));
    expectCovers(r, /^https:\/\/pwm\.im-cdn\.it\/image\/\d{1,3}\/xxs-c\.jpg$/);
  });

  it('Idealista, pagina di ricerca', () => {
    const doc = new DOMParser().parseFromString(read('idealista/search-salerno.html'), 'text/html');
    const r = idealistaAdapter.readDocument!(doc, 'https://www.idealista.it/vendita-case/salerno-salerno/?ordine=da-privati-asc');
    expectCovers(r, /^https:\/\/img4\.idealista\.it\/blur\/480_360_mq\/0\/id\.pro\.it\.image\.master\/00\/00\/00\/\d{1,3}\.jpg$/);
  });

  it('Subito, pagina di ricerca e API', () => {
    const fake = /^https:\/\/images\.sbito\.it\/api\/v1\/sbt-ads-images-pro\/images\/00\/00000000-0000-0000-0000-\d{12}\?rule=vertical-mini-card-1x-auto$/;
    expectCovers(subitoAdapter.parseNextData(JSON.parse(read('subito/search-appartamenti.json')), 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/', Date.UTC(2026, 9, 13, 10)), fake);
    expectCovers(subitoAdapter.parseApi('https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30', JSON.parse(read('subito/api-page2.json')), Date.UTC(2026, 9, 13, 10)), fake);
  });

  it('nessun URL di foto reale nelle fixture', () => {
    for (const f of ['immobiliare/search-salerno.json', 'immobiliare/api-salerno.json', 'idealista/search-salerno.html', 'subito/search-appartamenti.json', 'subito/api-page2.json', 'subito/search-altra-categoria.json']) {
      const text = read(f);
      expect(text).not.toMatch(/pwm\.im-cdn\.it\/image\/\d{4,}/);
      expect(text).not.toMatch(/id\.pro\.it\.image\.master\/(?!00\/00\/00\/)/);
      expect(text).not.toMatch(/images\/[0-9a-f]{2}\/(?!00000000-0000-0000-0000-)[0-9a-f-]{36}/);
      expect(text).not.toContain('//s.sbito.it');
    }
  });
});
