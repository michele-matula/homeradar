import { describe, expect, it } from 'vitest';
import { evaluate } from '@/core/rules';
import { DAY_MS, DEFAULT_SETTINGS, type ListingRecord, type PriceSnapshot } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 10, 12);
const daysAgo = (d: number) => NOW - d * DAY_MS - 1000;
const DROP_DATE = Date.UTC(2026, 8, 21);

function listing(o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: 'immobiliare:1', portal: 'immobiliare', portalId: 1, url: 'u', title: 't',
    address: null, city: null, zone: null, typology: null, surfaceM2: null, rooms: null,
    currentPrice: 235000, portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null,
    firstSeenAt: NOW, lastSeenAt: NOW, seenCount: 1, ...o,
  };
}
const snap = (price: number, at: number, source: PriceSnapshot['source'] = 'observed'): PriceSnapshot => ({ listingKey: 'immobiliare:1', price, at, source });
const declaredDrop = [snap(249000, DROP_DATE - 1, 'declared'), snap(235000, DROP_DATE, 'declared')];
const lastDrop = { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: DROP_DATE };
const ev = (l: ListingRecord, s: PriceSnapshot[] = [], settings = DEFAULT_SETTINGS) => evaluate(l, s, settings, NOW);

describe('evaluate', () => {
  it("su Subito l'età incerta non rimanda alla scheda", () => {
    const e = ev(listing({ key: 'subito:1', portal: 'subito', estimatedCreatedAt: daysAgo(125) }));
    expect(e.priority).toBe('verify');
    expect(e.reasons).toContain('Età stimata vicina alla soglia');
    expect(e.badgeText).toBe('◐ Età incerta · ~125 gg');
  });

  it("su Idealista l'età incerta non rimanda alla scheda", () => {
    const e = ev(listing({ key: 'idealista:1', portal: 'idealista', estimatedCreatedAt: daysAgo(125) }));
    expect(e.priority).toBe('verify');
    expect(e.reasons).toContain('Età stimata vicina alla soglia');
    expect(e.reasons).not.toContain("Età da verificare: apri l'annuncio");
    // La scheda di Idealista non ha la data: il badge non deve invitare ad aprirla.
    expect(e.badgeText).toBe('◐ Età incerta · ~125 gg');
  });

  it('per un ribasso con data stimata dice "rilevato il"', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(45), lastDrop: { ...lastDrop, dateEstimated: true } }), declaredDrop);
    expect(e.reasons.at(-1)).toBe('Ribassato del 5,6% (249.000 → 235.000 €) rilevato il 21/09');
  });

  it('Alta: data reale oltre soglia e ribasso dichiarato', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(173), lastDrop }), declaredDrop);
    expect(e.priority).toBe('high');
    expect(e.ageDays).toBe(173);
    expect(e.ageEstimated).toBe(false);
    expect(e.dropPercent).toBe(5.6);
    expect(e.dropCount).toBe(1);
    expect(e.reasons).toEqual(['Online da 173 gg', 'Ribassato del 5,6% (249.000 → 235.000 €) il 21/09']);
    expect(e.badgeText).toBe('● Alta · 173 gg · −5,6%');
  });

  it('Media: solo anzianità', () => {
    const e = ev(listing({ currentPrice: 300000, portalCreatedAt: daysAgo(150) }), [snap(300000, daysAgo(10))]);
    expect(e.priority).toBe('medium');
    expect(e.badgeText).toBe('● Media · 150 gg');
  });

  it('Media: solo ribasso', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(45), lastDrop }), declaredDrop);
    expect(e.priority).toBe('medium');
    expect(e.badgeText).toBe('● Media · 45 gg · −5,6%');
  });

  it('Media: età stimata ben oltre la soglia', () => {
    const e = ev(listing({ estimatedCreatedAt: daysAgo(170) }));
    expect(e.priority).toBe('medium');
    expect(e.ageEstimated).toBe(true);
    expect(e.reasons).toEqual(['Online da ~170 gg']);
    expect(e.badgeText).toBe('● Media · ~170 gg');
  });

  it('Da verificare: età stimata vicina alla soglia, senza ribasso', () => {
    const e = ev(listing({ estimatedCreatedAt: daysAgo(112) }));
    expect(e.priority).toBe('verify');
    expect(e.ageUncertain).toBe(true);
    expect(e.reasons).toContain("Età da verificare: apri l'annuncio");
    expect(e.badgeText).toBe('◐ Da verificare · ~112 gg');
  });

  it('il margine di incertezza vale anche sopra la soglia', () => {
    expect(ev(listing({ estimatedCreatedAt: daysAgo(134) })).priority).toBe('verify');
    expect(ev(listing({ estimatedCreatedAt: daysAgo(135) })).priority).toBe('medium');
    expect(ev(listing({ estimatedCreatedAt: daysAgo(104) })).priority).toBe('none');
    expect(ev(listing({ estimatedCreatedAt: daysAgo(105) })).priority).toBe('verify');
  });

  it('Media con avviso: età incerta ma ribassato', () => {
    const e = ev(listing({ estimatedCreatedAt: daysAgo(125), lastDrop }), declaredDrop);
    expect(e.priority).toBe('medium');
    expect(e.reasons).toContain("Età da verificare: apri l'annuncio");
    expect(e.badgeText).toBe('● Media · ~125 gg · −5,6%');
  });

  it('nessuna priorità: data reale sotto soglia, senza ribassi', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(112) }));
    expect(e.priority).toBe('none');
    expect(e.badgeText).toBe('Privato · 112 gg');
  });

  it('nessuna priorità: nessuna data e nessun ribasso', () => {
    const e = ev(listing());
    expect(e.priority).toBe('none');
    expect(e.ageDays).toBeNull();
    expect(e.badgeText).toBe('Privato');
  });

  it('conta più ribassi osservati', () => {
    const e = ev(listing({ currentPrice: 270000, portalCreatedAt: daysAgo(30) }), [snap(300000, daysAgo(20)), snap(290000, daysAgo(10)), snap(270000, daysAgo(1))]);
    expect(e.dropCount).toBe(2);
    expect(e.reasons).toContain('2 ribassi, −10% totale');
  });

  it('prezzo tornato al massimo: niente segnale B', () => {
    const e = ev(listing({ currentPrice: 249000, portalCreatedAt: daysAgo(30), lastDrop }), [...declaredDrop, snap(249000, daysAgo(2))]);
    expect(e.dropPercent).toBe(0);
    expect(e.priority).toBe('none');
  });

  it('prezzo rialzato parzialmente: calo misurato sul massimo noto', () => {
    const e = ev(listing({ currentPrice: 230000, portalCreatedAt: daysAgo(30) }), [snap(249000, daysAgo(20)), snap(200000, daysAgo(10)), snap(230000, daysAgo(2))]);
    expect(e.dropPercent).toBe(7.6);
    expect(e.dropCount).toBe(1);
    expect(e.priority).toBe('medium');
  });

  it('rispetta il ribasso minimo impostato', () => {
    const e = ev(listing({ portalCreatedAt: daysAgo(45), lastDrop }), declaredDrop, { ...DEFAULT_SETTINGS, minDropPercent: 10 });
    expect(e.priority).toBe('none');
  });

  it('prezzo sconosciuto: nessun ribasso e nessun errore', () => {
    const e = ev(listing({ currentPrice: null, portalCreatedAt: daysAgo(45) }), declaredDrop);
    expect(e.dropPercent).toBe(0);
    expect(e.priority).toBe('none');
  });

  it('data stimata nel futuro: età bloccata a 0', () => {
    const e = ev(listing({ estimatedCreatedAt: NOW + 5 * DAY_MS }));
    expect(e.ageDays).toBe(0);
    expect(e.badgeText).toBe('Privato · ~0 gg');
  });
});
