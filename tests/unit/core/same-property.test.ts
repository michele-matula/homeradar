import { describe, expect, it } from 'vitest';
import { groupListings, splitPair } from '@/core/same-property';
import { DAY_MS, type ListingRecord, type Portal, type SplitPair } from '@/shared/types';

function rec(portal: Portal, id: number, o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: `${portal}:${id}`, portal, portalId: id, url: '', title: '', address: null,
    city: 'Milano', zone: null, typology: null, surfaceM2: 80, rooms: 3, currentPrice: 300000,
    portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 1, category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null, ...o,
  };
}

const keys = (listings: ListingRecord[], splits: SplitPair[] = []) => groupListings(listings, splits).map((g) => g.keys);

describe('splitPair', () => {
  it('mette le chiavi in ordine', () => {
    expect(splitPair('subito:1', 'idealista:2', 5)).toEqual({ a: 'idealista:2', b: 'subito:1', at: 5 });
  });
});

describe('groupListings', () => {
  it('unisce due annunci compatibili di portali diversi', () => {
    expect(keys([rec('immobiliare', 1), rec('idealista', 2)], [])).toEqual([['idealista:2', 'immobiliare:1']]);
  });

  it('non unisce mai due annunci dello stesso portale', () => {
    expect(keys([rec('immobiliare', 1), rec('immobiliare', 2)], [])).toEqual([]);
  });

  it('città confrontata senza maiuscole e accenti; città diverse non si uniscono', () => {
    expect(keys([rec('immobiliare', 1, { city: 'Forlì' }), rec('idealista', 2, { city: 'forli' })], [])).toHaveLength(1);
    expect(keys([rec('immobiliare', 1), rec('idealista', 2, { city: 'Monza' })], [])).toEqual([]);
  });

  it('servono città, m² e prezzo su entrambi', () => {
    expect(keys([rec('immobiliare', 1, { city: null }), rec('idealista', 2, { city: null })], [])).toEqual([]);
    expect(keys([rec('immobiliare', 1, { surfaceM2: null }), rec('idealista', 2)], [])).toEqual([]);
    expect(keys([rec('immobiliare', 1, { currentPrice: null }), rec('idealista', 2)], [])).toEqual([]);
  });

  it('m²: tollera 3 m² o il 5% del minore, il più largo', () => {
    expect(keys([rec('immobiliare', 1, { surfaceM2: 50 }), rec('idealista', 2, { surfaceM2: 53 })], [])).toHaveLength(1);
    expect(keys([rec('immobiliare', 1, { surfaceM2: 50 }), rec('idealista', 2, { surfaceM2: 54 })], [])).toEqual([]);
    expect(keys([rec('immobiliare', 1, { surfaceM2: 100 }), rec('idealista', 2, { surfaceM2: 105 })], [])).toHaveLength(1);
    expect(keys([rec('immobiliare', 1, { surfaceM2: 100 }), rec('idealista', 2, { surfaceM2: 106 })], [])).toEqual([]);
  });

  it('prezzo: tollera il 5% del minore', () => {
    expect(keys([rec('immobiliare', 1, { currentPrice: 200000 }), rec('idealista', 2, { currentPrice: 210000 })], [])).toHaveLength(1);
    expect(keys([rec('immobiliare', 1, { currentPrice: 200000 }), rec('idealista', 2, { currentPrice: 210001 })], [])).toEqual([]);
  });

  it('locali: devono coincidere se presenti su entrambi', () => {
    expect(keys([rec('immobiliare', 1, { rooms: 3 }), rec('idealista', 2, { rooms: 4 })], [])).toEqual([]);
    expect(keys([rec('immobiliare', 1, { rooms: 3 }), rec('idealista', 2, { rooms: null })], [])).toHaveLength(1);
  });

  it('unisce tre portali se ogni coppia è compatibile', () => {
    const g = keys([rec('subito', 3), rec('immobiliare', 1), rec('idealista', 2)], []);
    expect(g).toEqual([['idealista:2', 'immobiliare:1', 'subito:3']]);
  });

  it('caso ambiguo (due annunci dello stesso portale compatibili con uno): restano separati', () => {
    expect(keys([rec('immobiliare', 1), rec('idealista', 2), rec('idealista', 3, { currentPrice: 305000 })], [])).toEqual([]);
  });

  it('catena non valida: A~B e B~C ma A e C troppo diversi, nessun gruppo', () => {
    const list = [
      rec('immobiliare', 1, { currentPrice: 290000 }),
      rec('idealista', 2, { currentPrice: 300000 }),
      rec('subito', 3, { currentPrice: 310000 }),
    ];
    // 290k~300k e 300k~310k entro il 5%; 290k e 310k no (20k > 14,5k).
    expect(keys(list, [])).toEqual([]);
  });

  it('una coppia separata non si unisce; nel gruppo di tre fa cadere chi è separato', () => {
    expect(keys([rec('immobiliare', 1), rec('idealista', 2)], [splitPair('immobiliare:1', 'idealista:2', 0)])).toEqual([]);
    const three = [rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3)];
    const splits = [splitPair('subito:3', 'immobiliare:1', 0), splitPair('subito:3', 'idealista:2', 0)];
    expect(keys(three, splits)).toEqual([['idealista:2', 'immobiliare:1']]);
  });

  it("il risultato non dipende dall'ordine degli annunci", () => {
    const list = [rec('immobiliare', 1), rec('idealista', 2), rec('subito', 3), rec('immobiliare', 4, { city: 'Roma' }), rec('subito', 5, { city: 'Roma' })];
    const expected = keys(list, []);
    expect(keys([...list].reverse(), [])).toEqual(expected);
    expect(expected).toEqual([['idealista:2', 'immobiliare:1', 'subito:3'], ['immobiliare:4', 'subito:5']]);
  });
});

// Le soglie proteggono da un confronto di tutti con tutti (secondi su 10.000 annunci), non misurano i millisecondi:
// con la suite intera in parallelo i tempi crescono di 3–4 volte.
describe('groupListings su un archivio grande', () => {
  it('10.000 annunci nella stessa città: confronta solo i prezzi vicini', () => {
    const portals: Portal[] = ['immobiliare', 'idealista', 'subito'];
    const list = Array.from({ length: 10_000 }, (_, i) =>
      rec(portals[i % 3]!, i, { currentPrice: 100_000 + ((i * 7919) % 900_000), surfaceM2: 40 + (i % 120) }),
    );
    const t = performance.now();
    groupListings(list, []);
    expect(performance.now() - t).toBeLessThan(1000);
  });

  it('10.000 annunci dello stesso portale visti in giorni diversi, in 40 zone: entro i tempi', () => {
    const list = Array.from({ length: 10_000 }, (_, i) =>
      rec('immobiliare', i, {
        currentPrice: 100_000 + ((i * 7919) % 900_000), surfaceM2: 40 + (i % 120), rooms: 1 + (i % 5), zone: `Zona ${i % 40}`,
        firstSeenAt: i * 3_600_000, lastSeenAt: i * 3_600_000,
      }),
    );
    const t = performance.now();
    groupListings(list, []);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

/** Annuncio visto fino al giorno 10 e poi non più. */
const old = (id: number, o: Partial<ListingRecord> = {}) => rec('immobiliare', id, { firstSeenAt: 0, lastSeenAt: 10 * DAY_MS, ...o });
/** Annuncio comparso dal giorno 20. */
const fresh = (id: number, o: Partial<ListingRecord> = {}) => rec('immobiliare', id, { firstSeenAt: 20 * DAY_MS, lastSeenAt: 30 * DAY_MS, ...o });

describe('groupListings: ripubblicazioni', () => {
  it('unisce un annuncio sparito e ricomparso con un ID più alto', () => {
    expect(groupListings([old(1), fresh(2, { currentPrice: 270000 })], [])).toEqual([
      { keys: ['immobiliare:1', 'immobiliare:2'], chains: [['immobiliare:1', 'immobiliare:2']] },
    ]);
  });

  it('visti insieme, o vecchio rivisto dopo il nuovo: nessuna unione', () => {
    expect(keys([old(1, { lastSeenAt: 25 * DAY_MS }), fresh(2)])).toEqual([]);
    expect(keys([old(1, { lastSeenAt: 20 * DAY_MS }), fresh(2)])).toEqual([]);
  });

  it('visti a meno di 30 minuti di distanza: nessuna coppia, potevano essere nella stessa pagina', () => {
    // Una visita entro 30 minuti dalla precedente non aggiorna lastSeenAt: il vecchio può essere ancora in pagina.
    const at = 10 * DAY_MS;
    expect(keys([old(1, { lastSeenAt: at }), fresh(2, { firstSeenAt: at + 20 * 60_000 })])).toEqual([]);
    expect(keys([old(1, { lastSeenAt: at }), fresh(2, { firstSeenAt: at + 31 * 60_000 })])).toHaveLength(1);
  });

  it("creato prima che il vecchio sparisse: non è una ripubblicazione, solo un annuncio trovato dopo", () => {
    // Data esatta (Immobiliare): tollera un giorno.
    expect(keys([old(1), fresh(2, { portalCreatedAt: 8 * DAY_MS })])).toEqual([]);
    expect(keys([old(1), fresh(2, { portalCreatedAt: 9.5 * DAY_MS })])).toHaveLength(1);
    // Data stimata dall'ID: tollera 15 giorni.
    expect(keys([old(1), fresh(2, { estimatedCreatedAt: -6 * DAY_MS })])).toEqual([]);
    expect(keys([old(1), fresh(2, { estimatedCreatedAt: -4 * DAY_MS })])).toHaveLength(1);
    // Senza data non si può escludere.
    expect(keys([old(1), fresh(2, { portalCreatedAt: null, estimatedCreatedAt: null })])).toHaveLength(1);
  });

  it("l'annuncio nuovo deve avere l'ID più alto", () => {
    expect(keys([old(2), fresh(1)])).toEqual([]);
  });

  it('prezzo: fino al −20% e al +5%', () => {
    expect(keys([old(1), fresh(2, { currentPrice: 240000 })])).toHaveLength(1);
    expect(keys([old(1), fresh(2, { currentPrice: 239999 })])).toEqual([]);
    expect(keys([old(1), fresh(2, { currentPrice: 315000 })])).toHaveLength(1);
    expect(keys([old(1), fresh(2, { currentPrice: 315001 })])).toEqual([]);
  });

  it('tipologia, zona e indirizzo: uguali se presenti su entrambi, senza maiuscole e punteggiatura', () => {
    expect(keys([old(1, { zone: 'Navigli' }), fresh(2, { zone: 'Isola' })])).toEqual([]);
    expect(keys([old(1, { typology: 'Appartamento' }), fresh(2, { typology: 'Attico' })])).toEqual([]);
    expect(keys([old(1, { address: 'Via Roma 1' }), fresh(2, { address: 'Via Po 3' })])).toEqual([]);
    expect(keys([old(1, { zone: 'Navigli' }), fresh(2)])).toHaveLength(1);
    expect(keys([old(1, { address: 'Via Roma, 1' }), fresh(2, { address: 'via roma 1' })])).toHaveLength(1);
  });

  it('m², locali e città come nel confronto tra portali', () => {
    expect(keys([old(1, { surfaceM2: 80 }), fresh(2, { surfaceM2: 84 })])).toHaveLength(1);
    expect(keys([old(1, { surfaceM2: 80 }), fresh(2, { surfaceM2: 85 })])).toEqual([]);
    expect(keys([old(1, { rooms: 3 }), fresh(2, { rooms: 4 })])).toEqual([]);
    expect(keys([old(1, { rooms: 3 }), fresh(2, { rooms: null })])).toHaveLength(1);
    expect(keys([old(1), fresh(2, { city: 'Monza' })])).toEqual([]);
  });

  it('portali diversi non fanno una ripubblicazione', () => {
    expect(keys([rec('idealista', 1, { lastSeenAt: 10 * DAY_MS }), fresh(2, { currentPrice: 270000 })])).toEqual([]);
  });

  it('catena di tre: il collegamento diretto tra primo e ultimo non conta', () => {
    const list = [old(1), fresh(2, { currentPrice: 270000 }), rec('immobiliare', 3, { firstSeenAt: 40 * DAY_MS, lastSeenAt: 50 * DAY_MS, currentPrice: 260000 })];
    expect(groupListings(list, [])).toEqual([
      { keys: ['immobiliare:1', 'immobiliare:2', 'immobiliare:3'], chains: [['immobiliare:1', 'immobiliare:2', 'immobiliare:3']] },
    ]);
  });

  it('due ribassi del 15% in due ripubblicazioni: il prezzo si controlla passo per passo', () => {
    const list = [old(1), fresh(2, { currentPrice: 255000 }), rec('immobiliare', 3, { firstSeenAt: 40 * DAY_MS, lastSeenAt: 50 * DAY_MS, currentPrice: 216750 })];
    expect(keys(list)).toEqual([['immobiliare:1', 'immobiliare:2', 'immobiliare:3']]);
  });

  it('caso ambiguo: due successori o due predecessori, nessuna unione', () => {
    expect(keys([old(1), fresh(2), fresh(3)])).toEqual([]);
    expect(keys([old(1), old(2), fresh(3)])).toEqual([]);
  });

  it('una coppia separata non si unisce; separare un anello in mezzo unisce primo e ultimo', () => {
    expect(keys([old(1), fresh(2)], [splitPair('immobiliare:1', 'immobiliare:2', 0)])).toEqual([]);
    const list = [old(1), fresh(2, { currentPrice: 270000 }), rec('immobiliare', 3, { firstSeenAt: 40 * DAY_MS, lastSeenAt: 50 * DAY_MS, currentPrice: 260000 })];
    const splits = [splitPair('immobiliare:2', 'immobiliare:1', 0), splitPair('immobiliare:2', 'immobiliare:3', 0)];
    expect(groupListings(list, splits)).toEqual([{ keys: ['immobiliare:1', 'immobiliare:3'], chains: [['immobiliare:1', 'immobiliare:3']] }]);
  });

  it('catena e gemello su un altro portale: il confronto usa la testa', () => {
    const twin = rec('idealista', 9, { firstSeenAt: 20 * DAY_MS, lastSeenAt: 30 * DAY_MS, currentPrice: 262000 });
    expect(groupListings([old(1), fresh(2, { currentPrice: 260000 }), twin], [])).toEqual([
      { keys: ['idealista:9', 'immobiliare:1', 'immobiliare:2'], chains: [['idealista:9'], ['immobiliare:1', 'immobiliare:2']] },
    ]);
  });

  it("un gemello compatibile solo con l'annuncio precedente non entra nel gruppo", () => {
    const twin = rec('idealista', 9, { firstSeenAt: 0, lastSeenAt: 10 * DAY_MS, currentPrice: 300000 });
    expect(keys([old(1), fresh(2, { currentPrice: 260000 }), twin])).toEqual([['immobiliare:1', 'immobiliare:2']]);
  });

  it("il risultato non dipende dall'ordine degli annunci", () => {
    const list = [
      old(1), fresh(2, { currentPrice: 260000 }), rec('idealista', 9, { firstSeenAt: 20 * DAY_MS, lastSeenAt: 30 * DAY_MS, currentPrice: 262000 }),
      old(5, { city: 'Roma' }), fresh(6, { city: 'Roma' }),
    ];
    expect(groupListings([...list].reverse(), [])).toEqual(groupListings(list, []));
  });
});
