import { describe, expect, it } from 'vitest';
import { aboveMarketText, compareToMarket, isAboveMarket, marketExplanation, marketSummary, validPerM2 } from '@/core/market';
import type { ListingRecord, MarketComparison } from '@/shared/types';

let n = 0;
/** Annuncio di 100 m²: il prezzo è €/m² × 100. */
function rec(perM2: number | null, o: Partial<ListingRecord> = {}): ListingRecord {
  const id = ++n;
  return {
    key: `immobiliare:${id}`, portal: 'immobiliare', portalId: id, url: '', title: '', address: null,
    city: 'Milano', zone: 'Navigli', typology: null, surfaceM2: 100, rooms: null,
    currentPrice: perM2 == null ? null : perM2 * 100, portalCreatedAt: null, estimatedCreatedAt: null,
    lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 1, category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null, ...o,
  };
}
const many = (values: number[], o: Partial<ListingRecord> = {}) => values.map((v) => rec(v, o));

describe('validPerM2', () => {
  it('scarta prezzo mancante, superficie piccola o mancante e valori fuori intervallo', () => {
    expect(validPerM2(rec(4000))).toBe(4000);
    expect(validPerM2(rec(null))).toBeNull();
    expect(validPerM2(rec(4000, { surfaceM2: null }))).toBeNull();
    expect(validPerM2(rec(4000, { surfaceM2: 19, currentPrice: 76000 }))).toBeNull();
    expect(validPerM2(rec(4000, { surfaceM2: 20, currentPrice: 80000 }))).toBe(4000);
    expect(validPerM2(rec(299))).toBeNull();
    expect(validPerM2(rec(300))).toBe(300);
    expect(validPerM2(rec(30000))).toBe(30000);
    expect(validPerM2(rec(30001))).toBeNull();
  });
});

describe('compareToMarket', () => {
  it('confronta con la mediana della zona, escluso il lead (dispari)', () => {
    const x = rec(5500);
    const m = compareToMarket([x, ...many([4000, 4200, 4400, 4600, 4800])]).get(x.key)!;
    expect(m).toMatchObject({ scope: 'zone', label: 'Navigli', city: 'Milano', medianPerM2: 4400, sampleSize: 5 });
    expect(m.deltaPercent).toBeCloseTo(25);
  });

  it('con un numero pari di valori usa la media dei due centrali', () => {
    const x = rec(5000);
    const m = compareToMarket([x, ...many([4000, 4100, 4200, 4400, 4600, 4800])]).get(x.key)!;
    expect(m.medianPerM2).toBe(4300);
    expect(m.sampleSize).toBe(6);
  });

  it('con valori uguali toglie una sola occorrenza: scarto 0', () => {
    const all = many([4000, 4000, 4000, 4000, 4000, 4000]);
    const result = compareToMarket(all);
    for (const l of all) expect(result.get(l.key)).toMatchObject({ medianPerM2: 4000, sampleSize: 5, deltaPercent: 0 });
  });

  it('il lead stesso non entra nella propria mediana', () => {
    // Con il lead (9000) i valori sarebbero 6 e la mediana 4500; senza, 5 valori e mediana 4400.
    const x = rec(9000);
    expect(compareToMarket([x, ...many([4000, 4200, 4400, 4600, 4800])]).get(x.key)!.medianPerM2).toBe(4400);
  });

  it('con meno di 5 annunci in zona ripiega sulla città (almeno 8)', () => {
    const x = rec(5000);
    const zone = many([4000, 4000, 4000]);
    const brera = many([6000, 6000, 6000, 6000, 6000, 6000, 6000, 6000], { zone: 'Brera' });
    const m = compareToMarket([x, ...zone, ...brera]).get(x.key)!;
    expect(m).toMatchObject({ scope: 'city', label: 'Milano', city: 'Milano', medianPerM2: 6000, sampleSize: 11 });
    expect(m.deltaPercent).toBeCloseTo(-16.667, 2);
  });

  it('senza zona usa la città', () => {
    const x = rec(5000, { zone: null });
    const m = compareToMarket([x, ...many([4000, 4000, 4000, 4000, 4000, 4000, 4000, 4000])]).get(x.key)!;
    expect(m.scope).toBe('city');
  });

  it('nessun confronto se anche la città ha meno di 8 annunci', () => {
    const x = rec(5000);
    const result = compareToMarket([x, ...many([4000, 4000, 4000, 4000], { zone: 'Brera' }), ...many([4000, 4000, 4000])]);
    expect(result.has(x.key)).toBe(false);
  });

  it('gli annunci non validi non contano e non hanno confronto', () => {
    const x = rec(5000);
    const bad = [rec(null), rec(100), rec(40000), rec(4000, { surfaceM2: 10, currentPrice: 40000 }), rec(4000, { city: null })];
    const result = compareToMarket([x, ...many([4000, 4000, 4000, 4000]), ...bad]);
    expect(result.has(x.key)).toBe(false);
    for (const b of bad) expect(result.has(b.key)).toBe(false);
  });

  it('senza città non c\'è confronto anche se la zona ha abbastanza annunci', () => {
    const x = rec(5000, { city: null });
    const result = compareToMarket([x, ...many([4000, 4000, 4000, 4000, 4000], { city: null })]);
    expect(result.size).toBe(0);
  });

  it('unisce le zone scritte in modo diverso dai portali; l\'etichetta è quella del lead', () => {
    const x = rec(5000, { zone: "Sant'Ambrogio", city: 'Milano' });
    const others = [
      rec(4000, { portal: 'subito', zone: 'sant ambrogio', city: 'MILANO' }),
      rec(4000, { portal: 'idealista', zone: 'Sant’Ambrogio', city: 'milano' }),
      rec(4000, { zone: 'SANT AMBROGIO ' }),
      rec(4000, { zone: 'Sànt Ambrogio' }),
      rec(4000, { zone: "Sant'Ambrogio" }),
    ];
    expect(compareToMarket([x, ...others]).get(x.key)).toMatchObject({ scope: 'zone', label: "Sant'Ambrogio", sampleSize: 5 });
  });
});

const zoneCmp = (deltaPercent: number): MarketComparison => ({ scope: 'zone', label: 'Navigli', city: 'Milano', medianPerM2: 4200.4, sampleSize: 7, deltaPercent });
const cityCmp: MarketComparison = { scope: 'city', label: 'Bologna', city: 'Bologna', medianPerM2: 3100, sampleSize: 12, deltaPercent: 18 };

describe('testi', () => {
  it('sopra mercato da +10% in su', () => {
    expect(isAboveMarket(null)).toBe(false);
    expect(isAboveMarket(zoneCmp(9.96))).toBe(false);
    expect(isAboveMarket(zoneCmp(10))).toBe(true);
  });

  it('etichetta, nota e riepilogo per zona e città', () => {
    expect(aboveMarketText(zoneCmp(18.4))).toBe('+18% su Navigli');
    expect(marketExplanation(zoneCmp(18.4))).toBe(
      "Mediana dei privati visti in zona Navigli (Milano): 4.200 €/m² su 7 annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto.",
    );
    expect(marketExplanation(cityCmp)).toBe(
      "Mediana dei privati visti a Bologna: 3.100 €/m² su 12 annunci. È un'indicazione, non una valutazione: conta solo gli annunci che hai visto.",
    );
    expect(marketSummary(zoneCmp(18.4))).toBe('Navigli (Milano), 7 annunci, 4.200 €/m²');
    expect(marketSummary(cityCmp)).toBe('Bologna, 12 annunci, 3.100 €/m²');
  });
});
