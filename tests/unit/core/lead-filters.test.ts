import { describe, expect, it } from 'vitest';
import { applyQuery, describeQuery, EMPTY_QUERY, inComuni, inPriceRange, isEmptyQuery, leadComuni, matchesText, normalize, OTHER_COMUNI, parseThousands } from '@/core/lead-filters';
import type { LeadView } from '@/shared/types';

type ListingFields = Partial<Pick<LeadView['listing'], 'title' | 'address' | 'city' | 'zone' | 'typology' | 'currentPrice'>>;

function lead(key: string, f: ListingFields = {}): LeadView {
  return {
    listing: { key, title: '', address: null, city: null, zone: null, typology: null, currentPrice: null, ...f } as LeadView['listing'],
    evaluation: { listingKey: key } as LeadView['evaluation'],
    state: { listingKey: key, status: 'new', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null },
    prices: [],
    market: null,
    others: [],
    reposted: false, missing: null, missingPortals: [], covers: [],
  };
}
const keys = (ls: LeadView[]) => ls.map((l) => l.listing.key);

describe('normalize', () => {
  it('toglie accenti, maiuscole, punteggiatura e spazi doppi', () => {
    expect(normalize('  Città  ALTA ')).toBe('citta alta');
    expect(normalize("Sant'Ambrogio")).toBe('sant ambrogio');
    expect(normalize('Via Roma, 12/A')).toBe('via roma 12 a');
    expect(normalize(' - ')).toBe('');
  });
});

describe('matchesText', () => {
  const l = lead('a', { title: 'Trilocale luminoso', address: 'Via Città di Castello 3', city: 'Bologna', zone: 'Navile', typology: 'Appartamento' });

  it('con query vuota o di soli simboli passa tutto', () => {
    expect(matchesText(l, '')).toBe(true);
    expect(matchesText(l, '   ')).toBe(true);
    expect(matchesText(l, '-')).toBe(true);
  });
  it('ogni parola deve comparire in almeno un campo, anche in campi diversi', () => {
    expect(matchesText(l, 'bologna navile')).toBe(true);
    expect(matchesText(l, 'BOLOGNA trilo')).toBe(true);
    expect(matchesText(l, 'bologna milano')).toBe(false);
  });
  it('ignora accenti e apostrofi in entrambe le direzioni', () => {
    expect(matchesText(l, 'citta')).toBe(true);
    expect(matchesText(lead('b', { zone: "Sant'Ambrogio" }), 'sant ambrogio')).toBe(true);
    expect(matchesText(lead('c', { zone: 'Sant Ambrogio' }), "sant'ambrogio")).toBe(true);
  });
  it('cerca anche nella tipologia e ignora i campi null', () => {
    expect(matchesText(l, 'appartamento')).toBe(true);
    expect(matchesText(lead('d', { title: 'Villa' }), 'villa')).toBe(true);
    expect(matchesText(lead('e'), 'villa')).toBe(false);
  });
});

describe('parseThousands', () => {
  it('legge migliaia di euro con virgola o punto', () => {
    expect(parseThousands('150')).toBe(150000);
    expect(parseThousands(' 150,5 ')).toBe(150500);
    expect(parseThousands('150.5')).toBe(150500);
    expect(parseThousands('0')).toBe(0);
  });
  it('accetta il separatore senza cifre dopo (mentre si scrive "150,5") o prima', () => {
    expect(parseThousands('150,')).toBe(150000);
    expect(parseThousands('150.')).toBe(150000);
    expect(parseThousands(',5')).toBe(500);
    expect(parseThousands(',')).toBe('invalid');
  });
  it('vuoto è null, il resto è invalid', () => {
    expect(parseThousands('')).toBeNull();
    expect(parseThousands('  ')).toBeNull();
    expect(parseThousands('-5')).toBe('invalid');
    expect(parseThousands('abc')).toBe('invalid');
    expect(parseThousands('1,5,0')).toBe('invalid');
    expect(parseThousands('150k')).toBe('invalid');
  });
});

describe('inPriceRange', () => {
  const p = (n: number | null) => lead('x', { currentPrice: n });

  it('senza estremi passa tutto, anche senza prezzo', () => {
    expect(inPriceRange(p(null), null, null)).toBe(true);
    expect(inPriceRange(p(5), null, null)).toBe(true);
  });
  it('con un estremo esclude i lead senza prezzo, anche con minimo 0', () => {
    expect(inPriceRange(p(null), 0, null)).toBe(false);
    expect(inPriceRange(p(0), 0, null)).toBe(true);
    expect(inPriceRange(p(null), null, 250000)).toBe(false);
  });
  it('estremi inclusi, con un solo estremo o con entrambi', () => {
    expect(inPriceRange(p(150000), 150000, null)).toBe(true);
    expect(inPriceRange(p(149999), 150000, null)).toBe(false);
    expect(inPriceRange(p(250000), null, 250000)).toBe(true);
    expect(inPriceRange(p(250001), null, 250000)).toBe(false);
    expect(inPriceRange(p(200000), 150000, 250000)).toBe(true);
  });
  it('se min > max li scambia', () => {
    expect(inPriceRange(p(200000), 250000, 150000)).toBe(true);
    expect(inPriceRange(p(300000), 250000, 150000)).toBe(false);
  });
});

describe('applyQuery, isEmptyQuery, describeQuery', () => {
  const leads = [
    lead('a', { zone: 'Navile', currentPrice: 200000 }),
    lead('b', { zone: 'Navile', currentPrice: 400000 }),
    lead('c', { zone: 'Centro', currentPrice: 200000 }),
    lead('d', { zone: 'Navile', currentPrice: null }),
  ];

  it('combina testo e prezzo', () => {
    expect(keys(applyQuery(leads, EMPTY_QUERY))).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(applyQuery(leads, { text: 'navile', minPrice: null, maxPrice: null }))).toEqual(['a', 'b', 'd']);
    expect(keys(applyQuery(leads, { text: 'navile', minPrice: null, maxPrice: 250000 }))).toEqual(['a']);
  });
  it('solo trattativa riservata: i lead senza prezzo', () => {
    expect(keys(applyQuery(leads, { ...EMPTY_QUERY, reservedOnly: true }))).toEqual(['d']);
    expect(isEmptyQuery({ ...EMPTY_QUERY, reservedOnly: true })).toBe(false);
    expect(describeQuery({ ...EMPTY_QUERY, reservedOnly: true })).toEqual(['trattativa riservata']);
  });
  it('una query di soli spazi è vuota', () => {
    expect(isEmptyQuery(EMPTY_QUERY)).toBe(true);
    expect(isEmptyQuery({ text: '  ', minPrice: null, maxPrice: null })).toBe(true);
    expect(isEmptyQuery({ text: '', minPrice: 0, maxPrice: null })).toBe(false);
    expect(isEmptyQuery({ text: 'x', minPrice: null, maxPrice: null })).toBe(false);
  });
  it('descrive testo e fascia per il tag', () => {
    expect(describeQuery(EMPTY_QUERY)).toEqual([]);
    expect(describeQuery({ text: '  ', minPrice: null, maxPrice: null })).toEqual([]);
    expect(describeQuery({ text: ' Navile ', minPrice: 150000, maxPrice: 250000 })).toEqual(['"Navile"', '150–250 k€']);
    expect(describeQuery({ text: '', minPrice: 150500, maxPrice: null })).toEqual(['da 150,5 k€']);
    expect(describeQuery({ text: '', minPrice: 0, maxPrice: null })).toEqual(['da 0 k€']);
    expect(describeQuery({ text: '', minPrice: null, maxPrice: 250000 })).toEqual(['fino a 250 k€']);
    expect(describeQuery({ text: '', minPrice: 250000, maxPrice: 150000 })).toEqual(['150–250 k€']);
  });
});

describe('matchesText su un lead unito', () => {
  it("trova il lead anche dal testo di un'altra fonte", () => {
    const main = lead('immobiliare:1', { title: 'Bilocale', address: null });
    const other = lead('idealista:2', { title: 'Bilocale in via Padova' });
    const merged: LeadView = { ...main, others: [{ listing: other.listing, evaluation: other.evaluation, prices: [], previous: false }] };
    expect(matchesText(merged, 'padova')).toBe(true);
    expect(matchesText(main, 'padova')).toBe(false);
  });
});

describe('leadComuni e inComuni', () => {
  const zone = [
    { istat: '098031', name: 'Lodi', province: 'LO' },
    { istat: '098048', name: "Sant'Angelo Lodigiano", province: 'LO' },
  ];
  const withSource = (l: LeadView, f: ListingFields & { sweepScope?: string | null }): LeadView =>
    ({ ...l, others: [{ listing: { ...l.listing, key: `${l.listing.key}-b`, city: null, sweepScope: null, ...f } } as LeadView['others'][number]] });
  const scoped = (key: string, f: ListingFields, sweepScope: string | null) =>
    ({ ...lead(key, f), listing: { ...lead(key, f).listing, sweepScope } }) as LeadView;

  it('riconosce il comune dal nome scritto dal portale, senza maiuscole, accenti e apostrofi', () => {
    expect(leadComuni(lead('a', { city: 'LODI' }), zone)).toEqual(['098031']);
    expect(leadComuni(lead('b', { city: 'Sant Angelo Lodigiano' }), zone)).toEqual(['098048']);
    expect(leadComuni(lead('c', { city: 'Codogno' }), zone)).toEqual([]);
  });

  it('senza città, o con una città fuori zona, usa il comune della ricerca del giro che ha trovato l\'annuncio', () => {
    expect(leadComuni(scoped('a', {}, 'subito|comune:098031|immobili'), zone)).toEqual(['098031']);
    expect(leadComuni(scoped('b', { city: 'Lodi Vecchio' }, 'immobiliare|comune:098048|case'), zone)).toEqual(['098048']);
    expect(leadComuni(scoped('c', { city: 'Lodi' }, 'immobiliare|comune:098048|case'), zone)).toEqual(['098031']);
    expect(leadComuni(scoped('d', {}, 'immobiliare|comune:015146|case'), zone)).toEqual([]);
    expect(leadComuni(lead('e'), zone)).toEqual([]);
  });

  it('basta una fonte del lead nel comune', () => {
    expect(leadComuni(withSource(lead('a', { city: null }), { city: 'Lodi' }), zone)).toEqual(['098031']);
  });

  it('inComuni: nessuna scelta passa tutto; "altri comuni" prende i lead fuori zona e senza comune', () => {
    const lodi = lead('a', { city: 'Lodi' });
    const codogno = lead('b', { city: 'Codogno' });
    const none = lead('c');
    const pick = (chosen: string[]) => keys([lodi, codogno, none].filter((l) => inComuni(l, zone, chosen)));
    expect(pick([])).toEqual(['a', 'b', 'c']);
    expect(pick(['098031'])).toEqual(['a']);
    expect(pick([OTHER_COMUNI])).toEqual(['b', 'c']);
    expect(pick(['098031', OTHER_COMUNI])).toEqual(['a', 'b', 'c']);
    expect(pick(['098048'])).toEqual([]);
  });
});
