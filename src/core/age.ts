import { DAY_MS, type Portal } from '@/shared/types';

export type IdDate = { portalId: number; createdAt: number };

/**
 * Coppie ID → data per portale.
 * Immobiliare: verificate sul sito il 2026-10-10.
 * Idealista: prima cattura sul Wayback Machine degli annunci di ogni fascia di ID
 * (CDX `url=www.idealista.it/immobile/{prefisso}&matchType=prefix&collapse=urlkey`),
 * quindi un limite superiore con pochi giorni di ritardo; l'ultimo punto è stato letto dal sito il 2026-10-13.
 * I punti sotto i 33 milioni (2013–2025, letti il 2026-10-14) sono il primo ID catturato in ogni fascia: senza,
 * gli annunci vecchi verrebbero estrapolati col ritmo del 2025.
 * Subito: per finestre di pochi giorni, l'ID più alto catturato dal Wayback Machine sotto
 * `www.subito.it/appartamenti/` (CDX `matchType=prefix&from=…&to=…`), con la data della cattura:
 * limite superiore della creazione; escluse le finestre con meno di 150 catture. Gli ID sono un
 * contatore unico per tutto il sito. L'ultimo punto è stato letto dal sito il 2026-10-13.
 */
export const DEFAULT_CALIBRATION: Record<Portal, IdDate[]> = {
  immobiliare: [
    { portalId: 128416572, createdAt: Date.UTC(2026, 3, 20) },
    { portalId: 131597836, createdAt: 1786025032000 },
    { portalId: 133428292, createdAt: 1791609879000 },
  ],
  idealista: [
    { portalId: 5_001_561, createdAt: Date.UTC(2013, 0, 5) },
    { portalId: 8_001_204, createdAt: Date.UTC(2015, 5, 21) },
    { portalId: 10_028_343, createdAt: Date.UTC(2016, 8, 29) },
    { portalId: 12_057_455, createdAt: Date.UTC(2017, 9, 31) },
    { portalId: 15_034_129, createdAt: Date.UTC(2019, 4, 9) },
    { portalId: 18_027_992, createdAt: Date.UTC(2020, 1, 7) },
    { portalId: 20_012_693, createdAt: Date.UTC(2020, 10, 4) },
    { portalId: 22_015_393, createdAt: Date.UTC(2021, 5, 7) },
    { portalId: 24_016_949, createdAt: Date.UTC(2022, 1, 20) },
    { portalId: 26_002_249, createdAt: Date.UTC(2022, 11, 1) },
    { portalId: 28_000_010, createdAt: Date.UTC(2023, 7, 7) },
    { portalId: 30_000_002, createdAt: Date.UTC(2024, 4, 13) },
    { portalId: 31_004_140, createdAt: Date.UTC(2024, 10, 7) },
    { portalId: 32_000_054, createdAt: Date.UTC(2025, 1, 17) },
    { portalId: 33_000_000, createdAt: Date.UTC(2025, 5, 16) },
    { portalId: 34_000_000, createdAt: Date.UTC(2025, 9, 30) },
    { portalId: 35_000_000, createdAt: Date.UTC(2026, 2, 5) },
    { portalId: 36_000_000, createdAt: Date.UTC(2026, 5, 13) },
    { portalId: 37_000_000, createdAt: Date.UTC(2026, 9, 5) },
    { portalId: 37_142_000, createdAt: Date.UTC(2026, 9, 13) },
  ],
  subito: [
    { portalId: 601_602_407, createdAt: Date.UTC(2025, 4, 12) },
    { portalId: 608_659_595, createdAt: Date.UTC(2025, 6, 8) },
    { portalId: 615_809_896, createdAt: Date.UTC(2025, 8, 10) },
    { portalId: 624_462_677, createdAt: Date.UTC(2025, 10, 15) },
    { portalId: 630_881_728, createdAt: Date.UTC(2026, 0, 10) },
    { portalId: 638_471_742, createdAt: Date.UTC(2026, 2, 7) },
    { portalId: 653_902_986, createdAt: Date.UTC(2026, 6, 13) },
    { portalId: 660_221_521, createdAt: Date.UTC(2026, 8, 10) },
    { portalId: 663_604_784, createdAt: Date.UTC(2026, 9, 7) },
    { portalId: 664_395_700, createdAt: Date.UTC(2026, 9, 13) },
  ],
};

/** Ritmo medio di nuovi ID al giorno, per i portali che imparano dagli annunci di oggi. */
export const LEARN_RATE_PER_DAY: Partial<Record<Portal, number>> = { idealista: 8200, subito: 120_000 };

export const utcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

export function mergeCalibration(defaults: IdDate[], learned: IdDate[]): IdDate[] {
  const byId = new Map<number, IdDate>();
  for (const p of [...defaults, ...learned]) byId.set(p.portalId, { portalId: p.portalId, createdAt: p.createdAt });
  return [...byId.values()].sort((a, b) => a.portalId - b.portalId);
}

/**
 * Un punto "creato oggi" è affidabile solo se viene da una zona con molti annunci nuovi:
 * l'ID deve superare tutti quelli noti e il ritmo rispetto all'ultimo punto deve essere plausibile.
 */
export function acceptLearnedPoint(candidate: IdDate, points: IdDate[], ratePerDay: number): boolean {
  const last = mergeCalibration([], points).at(-1);
  if (!last || candidate.portalId <= last.portalId) return false;
  const days = (candidate.createdAt - last.createdAt) / DAY_MS;
  if (days < 1) return false;
  const rate = (candidate.portalId - last.portalId) / days;
  return rate >= ratePerDay * 0.5 && rate <= ratePerDay * 2;
}

export function estimateCreatedAt(portalId: number, points: IdDate[]): number | null {
  const pts = mergeCalibration([], points);
  if (pts.length < 2) return null;
  const exact = pts.find((p) => p.portalId === portalId);
  if (exact) return exact.createdAt;

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let a = first;
  let b = last;
  if (portalId > first.portalId && portalId < last.portalId) {
    const i = pts.findIndex((p) => p.portalId > portalId);
    a = pts[i - 1]!;
    b = pts[i]!;
  }
  return Math.round(a.createdAt + ((portalId - a.portalId) * (b.createdAt - a.createdAt)) / (b.portalId - a.portalId));
}
