import { describe, expect, it } from 'vitest';
import { activeRange, applyUsage, EMPTY_USAGE, localDay, MAX_USAGE_DAYS, normalizeUsage } from '@/core/usage';
import type { LeadState } from '@/shared/types';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const state = (p: Partial<LeadState> = {}): LeadState => ({ listingKey: 'immobiliare:1', status: 'new', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null, ...p });

describe('usage', () => {
  it('localDay usa la data locale', () => {
    expect(localDay(at(2026, 10, 17, 0))).toBe('2026-10-17');
    expect(localDay(at(2026, 10, 17, 23))).toBe('2026-10-17');
    expect(localDay(at(2026, 1, 5))).toBe('2026-01-05');
  });

  it('aggiunge il giorno una volta sola, in ordine', () => {
    let u = applyUsage(EMPTY_USAGE, { kind: 'browsing' }, at(2026, 10, 18));
    u = applyUsage(u, { kind: 'browsing' }, at(2026, 10, 17));
    u = applyUsage(u, { kind: 'browsing' }, at(2026, 10, 18, 20));
    u = applyUsage(u, { kind: 'panel' }, at(2026, 10, 19));
    expect(u.browsingDays).toEqual(['2026-10-17', '2026-10-18']);
    expect(u.panelDays).toEqual(['2026-10-19']);
    expect(activeRange(u)).toEqual({ first: '2026-10-17', last: '2026-10-19' });
    expect(activeRange(EMPTY_USAGE)).toEqual({ first: null, last: null });
  });

  it('tiene al massimo gli ultimi 400 giorni', () => {
    let u = EMPTY_USAGE;
    for (let i = 0; i < MAX_USAGE_DAYS + 5; i++) u = applyUsage(u, { kind: 'panel' }, at(2025, 1, 1) + i * 86_400_000);
    expect(u.panelDays).toHaveLength(MAX_USAGE_DAYS);
    expect(u.panelDays[0]).toBe(localDay(at(2025, 1, 1) + 5 * 86_400_000));
  });

  it('conta solo i passaggi di stato reali, i richiami impostati e le note scritte', () => {
    const now = at(2026, 10, 17);
    let u = applyUsage(EMPTY_USAGE, { kind: 'leadChange', prev: state(), next: state({ status: 'contacted' }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ status: 'contacted' }), next: state({ status: 'contacted' }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state(), next: state({ status: 'to_contact', recallAt: 5 }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ recallAt: 5 }), next: state({ recallAt: 5 }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ recallAt: 5 }), next: state({ recallAt: null }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state(), next: state({ notes: 'richiamare' }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ notes: 'richiamare' }), next: state({ notes: '  ' }) }, now);
    expect(u.statusChanges).toEqual({ contacted: 1, to_contact: 1 });
    expect(u.recallsSet).toBe(1);
    expect(u.notesWritten).toBe(1);
  });

  it('conta gli export per formato', () => {
    let u = applyUsage(EMPTY_USAGE, { kind: 'export', format: 'xlsx' }, 0);
    u = applyUsage(u, { kind: 'export', format: 'csv' }, 0);
    u = applyUsage(u, { kind: 'export', format: 'xlsx' }, 0);
    expect(u.exports).toEqual({ xlsx: 2, csv: 1 });
  });

  it('normalizeUsage scarta i valori di forma inattesa', () => {
    expect(normalizeUsage(undefined)).toEqual(EMPTY_USAGE);
    expect(normalizeUsage({ browsingDays: ['2026-10-17', 'x', 3], statusChanges: { contacted: 2, bogus: 1, new: -1 }, recallsSet: 'a', exports: { xlsx: 1 } }))
      .toEqual({ ...EMPTY_USAGE, browsingDays: ['2026-10-17'], statusChanges: { contacted: 2 }, exports: { xlsx: 1, csv: 0 } });
  });

  it("non modifica l'oggetto di partenza", () => {
    applyUsage(EMPTY_USAGE, { kind: 'export', format: 'csv' }, 0);
    expect(EMPTY_USAGE.exports.csv).toBe(0);
  });
});
