import { DAY_MS, type Portal } from '@/shared/types';

export type IdDate = { portalId: number; createdAt: number };

/**
 * Coppie ID → data per portale.
 * Immobiliare: verificate sul sito il 2026-10-10.
 * Idealista: prima cattura sul Wayback Machine degli annunci di ogni fascia di ID
 * (CDX `url=www.idealista.it/immobile/{prefisso}&matchType=prefix&collapse=urlkey`),
 * quindi un limite superiore con pochi giorni di ritardo; l'ultimo punto è stato letto dal sito il 2026-10-13.
 */
export const DEFAULT_CALIBRATION: Record<Portal, IdDate[]> = {
  immobiliare: [
    { portalId: 128416572, createdAt: Date.UTC(2026, 3, 20) },
    { portalId: 131597836, createdAt: 1786025032000 },
    { portalId: 133428292, createdAt: 1791609879000 },
  ],
  idealista: [
    { portalId: 33_000_000, createdAt: Date.UTC(2025, 5, 16) },
    { portalId: 34_000_000, createdAt: Date.UTC(2025, 9, 30) },
    { portalId: 35_000_000, createdAt: Date.UTC(2026, 2, 5) },
    { portalId: 36_000_000, createdAt: Date.UTC(2026, 5, 13) },
    { portalId: 37_000_000, createdAt: Date.UTC(2026, 9, 5) },
    { portalId: 37_142_000, createdAt: Date.UTC(2026, 9, 13) },
  ],
};

/** Ritmo medio di nuovi ID al giorno, per i portali che imparano dalla pagina "più recenti". */
export const LEARN_RATE_PER_DAY: Partial<Record<Portal, number>> = { idealista: 8200 };

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
