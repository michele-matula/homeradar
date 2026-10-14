import { describe, expect, it } from 'vitest';
import { acceptLearnedPoint, DEFAULT_CALIBRATION, estimateCreatedAt, LEARN_RATE_PER_DAY, mergeCalibration, utcDay } from '@/core/age';

const pts = [
  { portalId: 100, createdAt: 0 },
  { portalId: 150, createdAt: 400 },
  { portalId: 200, createdAt: 1000 },
];

describe('estimateCreatedAt', () => {
  it('restituisce la data esatta per un punto noto', () => {
    expect(estimateCreatedAt(150, pts)).toBe(400);
  });
  it('interpola tra i punti vicini', () => {
    expect(estimateCreatedAt(125, pts)).toBe(200);
    expect(estimateCreatedAt(175, pts)).toBe(700);
  });
  it('estrapola con il primo e l\'ultimo punto', () => {
    expect(estimateCreatedAt(300, pts)).toBe(2000);
    expect(estimateCreatedAt(50, pts)).toBe(-500);
  });
  it('richiede almeno due punti', () => {
    expect(estimateCreatedAt(150, [{ portalId: 150, createdAt: 400 }])).toBeNull();
    expect(estimateCreatedAt(150, [])).toBeNull();
  });
  it('ignora l\'ordine di ingresso', () => {
    expect(estimateCreatedAt(125, [...pts].reverse())).toBe(200);
  });
  it('con la calibrazione predefinita colloca un ID noto alla sua data', () => {
    expect(estimateCreatedAt(131597836, DEFAULT_CALIBRATION.immobiliare)).toBe(1786025032000);
    expect(estimateCreatedAt(36_000_000, DEFAULT_CALIBRATION.idealista)).toBe(Date.UTC(2026, 5, 13));
  });
  it('Idealista: gli ID vecchi si interpolano sui punti storici, non si estrapolano dal 2025', () => {
    const pts = DEFAULT_CALIBRATION.idealista;
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.portalId).toBeGreaterThan(pts[i - 1]!.portalId);
      expect(pts[i]!.createdAt).toBeGreaterThan(pts[i - 1]!.createdAt);
    }
    expect(pts[0]!.portalId).toBeLessThanOrEqual(5_100_000);
    // ID 10.028.343 catturato dal Wayback Machine il 2016-09-29.
    expect(estimateCreatedAt(10_028_343, pts)).toBe(Date.UTC(2016, 8, 29));
  });
  it('con la calibrazione di Subito colloca un ID noto alla sua data', () => {
    expect(estimateCreatedAt(630_881_728, DEFAULT_CALIBRATION.subito)).toBe(Date.UTC(2026, 0, 10));
  });
});

describe('mergeCalibration', () => {
  it('i punti appresi sostituiscono quelli predefiniti con lo stesso ID', () => {
    const merged = mergeCalibration([{ portalId: 1, createdAt: 10 }, { portalId: 2, createdAt: 20 }], [{ portalId: 2, createdAt: 25 }, { portalId: 3, createdAt: 30 }]);
    expect(merged).toEqual([
      { portalId: 1, createdAt: 10 },
      { portalId: 2, createdAt: 25 },
      { portalId: 3, createdAt: 30 },
    ]);
  });
});

describe('utcDay', () => {
  it('riporta alla mezzanotte UTC', () => {
    expect(utcDay(Date.UTC(2026, 9, 13, 23, 59))).toBe(Date.UTC(2026, 9, 13));
  });
});

describe('acceptLearnedPoint', () => {
  const pts = DEFAULT_CALIBRATION.idealista; // ultimo punto: 37.142.000 il 13/10/2026
  const RATE = 8200;
  const at = (day: number) => Date.UTC(2026, 9, day);

  it("accetta l'annuncio più recente di una grande città", () => {
    expect(acceptLearnedPoint({ portalId: 37_200_000, createdAt: at(20) }, pts, RATE)).toBe(true);
  });
  it('rifiuta un ID non maggiore di quelli noti', () => {
    expect(acceptLearnedPoint({ portalId: 37_100_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
  it("rifiuta un punto nello stesso giorno dell'ultimo", () => {
    expect(acceptLearnedPoint({ portalId: 37_150_000, createdAt: at(13) }, pts, RATE)).toBe(false);
  });
  it('rifiuta un ritmo troppo basso (comune piccolo, annuncio vecchio)', () => {
    expect(acceptLearnedPoint({ portalId: 37_150_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
  it('rifiuta un ritmo troppo alto', () => {
    expect(acceptLearnedPoint({ portalId: 37_400_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
  it('senza punti di riferimento non accetta nulla', () => {
    expect(acceptLearnedPoint({ portalId: 37_200_000, createdAt: at(20) }, [], RATE)).toBe(false);
  });
});

describe('acceptLearnedPoint su Subito', () => {
  const pts = DEFAULT_CALIBRATION.subito; // ultimo punto: 664.395.700 il 13/10/2026
  const RATE = LEARN_RATE_PER_DAY.subito!;
  const at = (day: number) => Date.UTC(2026, 9, day);

  it('accetta un annuncio nuovo una settimana dopo', () => {
    expect(acceptLearnedPoint({ portalId: 665_250_000, createdAt: at(20) }, pts, RATE)).toBe(true);
  });
  it('rifiuta un annuncio vecchio rinnovato oggi', () => {
    expect(acceptLearnedPoint({ portalId: 650_000_000, createdAt: at(20) }, pts, RATE)).toBe(false);
  });
});
