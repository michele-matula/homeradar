import { describe, expect, it } from 'vitest';
import { DEFAULT_CALIBRATION, estimateCreatedAt, mergeCalibration } from '@/core/age';

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
    expect(estimateCreatedAt(131597836, DEFAULT_CALIBRATION)).toBe(1786025032000);
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
