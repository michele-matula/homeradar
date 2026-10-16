import { describe, expect, it } from 'vitest';
import { groupListings, splitPair } from '@/core/same-property';
import type { ListingRecord, Portal } from '@/shared/types';

function rec(portal: Portal, id: number, o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: `${portal}:${id}`, portal, portalId: id, url: '', title: '', address: null,
    city: 'Milano', zone: null, typology: null, surfaceM2: 80, rooms: 3, currentPrice: 300000,
    portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 1, ...o,
  };
}

describe('splitPair', () => {
  it('mette le chiavi in ordine', () => {
    expect(splitPair('subito:1', 'idealista:2', 5)).toEqual({ a: 'idealista:2', b: 'subito:1', at: 5 });
  });
});

describe('groupListings', () => {
  it('unisce due annunci compatibili di portali diversi', () => {
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2)], [])).toEqual([['idealista:2', 'immobiliare:1']]);
  });

  it('non unisce mai due annunci dello stesso portale', () => {
    expect(groupListings([rec('immobiliare', 1), rec('immobiliare', 2)], [])).toEqual([]);
  });

  it('città confrontata senza maiuscole e accenti; città diverse non si uniscono', () => {
    expect(groupListings([rec('immobiliare', 1, { city: 'Forlì' }), rec('idealista', 2, { city: 'forli' })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2, { city: 'Monza' })], [])).toEqual([]);
  });

  it('servono città, m² e prezzo su entrambi', () => {
    expect(groupListings([rec('immobiliare', 1, { city: null }), rec('idealista', 2, { city: null })], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: null }), rec('idealista', 2)], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { currentPrice: null }), rec('idealista', 2)], [])).toEqual([]);
  });

  it('m²: tollera 3 m² o il 5% del minore, il più largo', () => {
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 50 }), rec('idealista', 2, { surfaceM2: 53 })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 50 }), rec('idealista', 2, { surfaceM2: 54 })], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 100 }), rec('idealista', 2, { surfaceM2: 105 })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1, { surfaceM2: 100 }), rec('idealista', 2, { surfaceM2: 106 })], [])).toEqual([]);
  });

  it('prezzo: tollera il 5% del minore', () => {
    expect(groupListings([rec('immobiliare', 1, { currentPrice: 200000 }), rec('idealista', 2, { currentPrice: 210000 })], [])).toHaveLength(1);
    expect(groupListings([rec('immobiliare', 1, { currentPrice: 200000 }), rec('idealista', 2, { currentPrice: 210001 })], [])).toEqual([]);
  });

  it('locali: devono coincidere se presenti su entrambi', () => {
    expect(groupListings([rec('immobiliare', 1, { rooms: 3 }), rec('idealista', 2, { rooms: 4 })], [])).toEqual([]);
    expect(groupListings([rec('immobiliare', 1, { rooms: 3 }), rec('idealista', 2, { rooms: null })], [])).toHaveLength(1);
  });

  it('unisce tre portali se ogni coppia è compatibile', () => {
    const g = groupListings([rec('subito', 3), rec('immobiliare', 1), rec('idealista', 2)], []);
    expect(g).toEqual([['idealista:2', 'immobiliare:1', 'subito:3']]);
  });

  it('caso ambiguo (due annunci dello stesso portale compatibili con uno): restano separati', () => {
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2), rec('idealista', 3, { currentPrice: 305000 })], [])).toEqual([]);
  });

  it('catena non valida: A~B e B~C ma A e C troppo diversi, nessun gruppo', () => {
    const list = [
      rec('immobiliare', 1, { currentPrice: 290000 }),
      rec('idealista', 2, { currentPrice: 300000 }),
      rec('subito', 3, { currentPrice: 310000 }),
    ];
    // 290k~300k e 300k~310k entro il 5%; 290k e 310k no (20k > 14,5k).
    expect(groupListings(list, [])).toEqual([]);
  });

  it('una coppia separata non si unisce; nel gruppo di tre fa cadere chi è separato', () => {
    expect(groupListings([rec('immobiliare', 1), rec('idealista', 2)], [splitPair('immobiliare:1', 'idealista:2', 0)])).toEqual([]);
    const three = [rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3)];
    const splits = [splitPair('subito:3', 'immobiliare:1', 0), splitPair('subito:3', 'idealista:2', 0)];
    expect(groupListings(three, splits)).toEqual([['idealista:2', 'immobiliare:1']]);
  });

  it("il risultato non dipende dall'ordine degli annunci", () => {
    const list = [rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3), rec('immobiliare', 4, { city: 'Roma' }), rec('subito', 5, { city: 'Roma' })];
    const expected = groupListings(list, []);
    expect(groupListings([...list].reverse(), [])).toEqual(expected);
    expect(expected).toEqual([['idealista:2', 'immobiliare:1', 'subito:3'], ['immobiliare:4', 'subito:5']]);
  });
});

describe('groupListings su un archivio grande', () => {
  it('10.000 annunci nella stessa città: confronta solo i prezzi vicini', () => {
    const portals: Portal[] = ['immobiliare', 'idealista', 'subito'];
    const list = Array.from({ length: 10_000 }, (_, i) =>
      rec(portals[i % 3]!, i, { currentPrice: 100_000 + ((i * 7919) % 900_000), surfaceM2: 40 + (i % 120) }),
    );
    const t = performance.now();
    groupListings(list, []);
    expect(performance.now() - t).toBeLessThan(250);
  });
});
