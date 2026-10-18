import type { ListingRecord } from '@/shared/types';

/** Giri completi consecutivi senza l'annuncio prima di segnalarlo come "non più visto". */
export const MISSING_SWEEPS = 3;

export const isMissing = (l: ListingRecord) => l.missedSweeps >= MISSING_SWEEPS;

/**
 * Annunci da aggiornare a fine giro: quelli della cui ricerca il giro è stato completo e che non sono stati visti.
 * Annunci visti solo a mano (senza ricerca), di ricerche incomplete o tolte dalla zona restano come sono.
 */
export function missingUpdates(listings: ListingRecord[], complete: Set<string>, seen: Set<string>, startedAt: number): ListingRecord[] {
  return listings
    .filter((l) => l.sweepScope != null && complete.has(l.sweepScope) && !seen.has(l.key))
    .map((l) => ({ ...l, missedSweeps: l.missedSweeps + 1, missingSince: l.missingSince ?? startedAt }));
}
