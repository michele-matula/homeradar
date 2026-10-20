import { describe, expect, it } from 'vitest';
import { searchComuni, toRef } from '@/core/comuni';
import { acceptObservation, estimateMinutes, pageUrl, searchCategory, searchesFor } from '@/core/searches';
import type { SearchArea } from '@/shared/types';
import { obs } from './helpers';

const cassano = { istat: '015059', name: "Cassano d'Adda", province: 'MI' };
const ALL = { immobiliare: true, idealista: true, subito: true, casadaprivato: true };

describe('searchesFor', () => {
  it('una ricerca per comune e categoria; Subito una sola ricerca per comune', () => {
    const specs = searchesFor({ comuni: [cassano], categories: ['residential', 'commercial', 'land', 'garage'] }, ALL);
    expect(specs.map((s) => s.url)).toEqual([
      'https://www.immobiliare.it/vendita-case/cassano-d-adda/?criterio=privateFirst',
      'https://www.immobiliare.it/vendita-negozi/cassano-d-adda/?criterio=privateFirst',
      'https://www.immobiliare.it/vendita-uffici/cassano-d-adda/?criterio=privateFirst',
      'https://www.immobiliare.it/vendita-capannoni/cassano-d-adda/?criterio=privateFirst',
      'https://www.immobiliare.it/vendita-terreni/cassano-d-adda/?criterio=privateFirst',
      'https://www.immobiliare.it/vendita-garage/cassano-d-adda/?criterio=privateFirst',
      'https://www.idealista.it/vendita-case/cassano-d-adda-milano/?ordine=da-privati-asc',
      'https://www.idealista.it/vendita-negozi/cassano-d-adda-milano/?ordine=da-privati-asc',
      'https://www.idealista.it/vendita-uffici/cassano-d-adda-milano/?ordine=da-privati-asc',
      'https://www.idealista.it/vendita-terreni/cassano-d-adda-milano/?ordine=da-privati-asc',
      'https://www.idealista.it/vendita-garage/cassano-d-adda-milano/?ordine=da-privati-asc',
      'https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0',
      'https://www.casadaprivato.it/annunci-vendita/immobili/milano-cassano_d_adda',
    ]);
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
    expect(specs[1]).toMatchObject({ key: 'immobiliare|comune:015059|negozi', label: "Cassano d'Adda · Negozi", categories: ['commercial'] });
    expect(specs.at(-1)).toMatchObject({ key: 'casadaprivato|comune:015059|immobili', categories: ['residential', 'commercial', 'land', 'garage'] });
    expect(specs.at(-2)).toMatchObject({ key: 'subito|comune:015059|immobili', categories: ['residential', 'commercial', 'land', 'garage'] });
  });

  it('solo portali attivi e categorie scelte; niente senza comuni', () => {
    const specs = searchesFor({ comuni: [cassano], categories: ['residential'] }, { immobiliare: true, idealista: false, subito: true, casadaprivato: true });
    expect(specs.map((s) => s.key)).toEqual(['immobiliare|comune:015059|case', 'subito|comune:015059|immobili', 'casadaprivato|comune:015059|immobili']);
    expect(searchesFor({ comuni: [], categories: ['residential'] }, ALL)).toEqual([]);
  });

  it('province con nome diverso sui portali: Monza e Brianza', () => {
    const [ide, sub] = searchesFor({ comuni: [{ istat: '108033', name: 'Monza', province: 'MB' }], categories: ['residential'] }, { immobiliare: false, idealista: true, subito: true, casadaprivato: true });
    expect(ide!.url).toBe('https://www.idealista.it/vendita-case/monza-monza-brianza/?ordine=da-privati-asc');
    expect(sub!.url).toBe('https://www.subito.it/annunci-lombardia/vendita/immobili/monza-brianza/monza/?advt=0');
  });
});

describe('pageUrl', () => {
  const area: SearchArea = { comuni: [cassano], categories: ['residential'] };
  const [imm, ide, sub] = searchesFor(area, ALL);
  it('aggiunge la pagina come il sito', () => {
    expect(pageUrl(imm!, 1)).toBe(imm!.url);
    expect(pageUrl(imm!, 3)).toBe('https://www.immobiliare.it/vendita-case/cassano-d-adda/?criterio=privateFirst&pag=3');
    expect(pageUrl(ide!, 2)).toBe('https://www.idealista.it/vendita-case/cassano-d-adda-milano/lista-2.htm?ordine=da-privati-asc');
    expect(pageUrl(sub!, 2)).toBe('https://www.subito.it/annunci-lombardia/vendita/immobili/milano/cassano-d-adda/?advt=0&o=2');
  });
});

describe('acceptObservation', () => {
  const [imm, , sub] = searchesFor({ comuni: [cassano], categories: ['residential'] }, ALL);
  it('scarta le categorie non scelte; categoria sconosciuta passa', () => {
    expect(acceptObservation(imm!, obs({ category: 'garage' }))).toBe(false);
    expect(acceptObservation(imm!, obs({ category: null }))).toBe(true);
    expect(acceptObservation(imm!, obs({ category: 'residential' }))).toBe(true);
  });
  it('Subito tiene solo le categorie scelte, anche se la pagina le porta tutte', () => {
    expect(acceptObservation(sub!, obs({ category: 'garage' }))).toBe(false);
    expect(acceptObservation(sub!, obs({ category: 'residential' }))).toBe(true);
    expect(acceptObservation(sub!, obs({ category: null }))).toBe(true);
  });
  it('categoria della ricerca solo se la pagina ne porta una', () => {
    expect(searchCategory(imm!)).toBe('residential');
    expect(searchCategory(sub!)).toBeNull();
  });
});

describe('estimateMinutes', () => {
  it('circa 14 secondi a ricerca, arrotondato al minuto', () => {
    const area: SearchArea = { comuni: searchComuni('ca', 10).map(toRef), categories: ['residential'] };
    expect(estimateMinutes({ comuni: [cassano], categories: ['residential'] })).toEqual({ searches: 4, minutes: 1 });
    expect(estimateMinutes(area)).toEqual({ searches: 40, minutes: 9 });
  });
});
