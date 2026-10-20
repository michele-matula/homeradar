import { describe, expect, it } from 'vitest';
import { isMissing, MISSING_SWEEPS, missingUpdates } from '@/core/missing';
import type { ListingRecord } from '@/shared/types';
import { listing } from './backup-builders';

const A = 'immobiliare|comune:016219|case';
const rec = (o: Partial<ListingRecord>) => listing({ sweepScope: A, missedSweeps: 0, missingSince: null, ...o });

describe('missingUpdates', () => {
  it('conta un giro mancato solo se la sua ricerca è stata completa', () => {
    const l = rec({});
    expect(missingUpdates([l], new Set([A]), new Set(), 500)).toEqual([{ ...l, missedSweeps: 1, missingSince: 500 }]);
    expect(missingUpdates([l], new Set(['altra']), new Set(), 500)).toEqual([]);
  });
  it('non tocca gli annunci visti, quelli senza ricerca e quelli di ricerche tolte dalla zona', () => {
    expect(missingUpdates([rec({})], new Set([A]), new Set(['immobiliare:128416572']), 500)).toEqual([]);
    expect(missingUpdates([rec({ sweepScope: null })], new Set([A]), new Set(), 500)).toEqual([]);
    expect(missingUpdates([rec({ sweepScope: 'immobiliare|comune:999999|case' })], new Set([A]), new Set(), 500)).toEqual([]);
  });
  it('tiene la data del primo giro mancato; diventa "non più visto" al terzo', () => {
    const l = rec({ missedSweeps: MISSING_SWEEPS - 1, missingSince: 100 });
    const [u] = missingUpdates([l], new Set([A]), new Set(), 500);
    expect(u).toMatchObject({ missedSweeps: MISSING_SWEEPS, missingSince: 100 });
    expect(isMissing(u!)).toBe(true);
    expect(isMissing(l)).toBe(false);
  });
});
