import type { CalibrationPoint } from '@/shared/types';

/** Coppie ID → data reale verificate su Immobiliare.it il 2026-10-10. */
export const DEFAULT_CALIBRATION: CalibrationPoint[] = [
  { portalId: 128416572, createdAt: Date.UTC(2026, 3, 20) },
  { portalId: 131597836, createdAt: 1786025032000 },
  { portalId: 133428292, createdAt: 1791609879000 },
];

export function mergeCalibration(defaults: CalibrationPoint[], learned: CalibrationPoint[]): CalibrationPoint[] {
  const byId = new Map<number, CalibrationPoint>();
  for (const p of [...defaults, ...learned]) byId.set(p.portalId, p);
  return [...byId.values()].sort((a, b) => a.portalId - b.portalId);
}

export function estimateCreatedAt(portalId: number, points: CalibrationPoint[]): number | null {
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
