import { describe, expect, it } from 'vitest';
import { mergeBackup, type BackupData, type CurrentData } from '@/core/backup';
import { DEFAULT_SETTINGS, type LeadState } from '@/shared/types';
import { listing, NOW } from './backup-builders';

const K = 'immobiliare:128416572';
const state = (o: Partial<LeadState> = {}): LeadState => ({ listingKey: K, status: 'new', notes: '', statusChangedAt: 1, updatedAt: 1, recallAt: null, ...o });
const empty = (): CurrentData => ({ listings: [], priceSnapshots: [], leadStates: [], calibration: [], settingsSaved: false });
const file = (o: Partial<BackupData> = {}): BackupData => ({ listings: [listing()], priceSnapshots: [], leadStates: [state()], calibration: [], ...o });

describe('mergeBackup', () => {
  it('aggiunge un annuncio assente con il suo stato', () => {
    const m = mergeBackup(empty(), file({ leadStates: [state({ status: 'contacted' })] }), NOW);
    expect(m.listings).toEqual([listing()]);
    expect(m.leadStates).toEqual([state({ status: 'contacted' })]);
    expect(m.summary).toEqual({ added: 1, updated: 0, unchanged: 0 });
  });

  it('a un annuncio aggiunto senza stato dà lo stato "new"', () => {
    const m = mergeBackup(empty(), file({ leadStates: [] }), NOW);
    expect(m.leadStates).toEqual([{ listingKey: K, status: 'new', notes: '', statusChangedAt: NOW, updatedAt: NOW, recallAt: null }]);
  });

  it('lo stesso contenuto non produce scritture, anche con le chiavi in ordine diverso', () => {
    const l = listing();
    const reordered = { ...l, lastDrop: { date: l.lastDrop!.date, percent: 5.6, toPrice: 235000, fromPrice: 249000 } };
    const cur = { ...empty(), listings: [reordered], leadStates: [state()] };
    const m = mergeBackup(cur, file(), NOW);
    expect(m).toMatchObject({ listings: [], leadStates: [], priceSnapshots: [], summary: { added: 0, updated: 0, unchanged: 1 } });
  });

  it('annuncio del backup più vecchio: tiene i campi del browser, allarga le visite', () => {
    const cur = { ...empty(), listings: [listing({ firstSeenAt: 500, lastSeenAt: NOW, seenCount: 2, currentPrice: 230000 })], leadStates: [state()] };
    const m = mergeBackup(cur, file({ listings: [listing({ firstSeenAt: 100, lastSeenAt: NOW - 5000, seenCount: 7, currentPrice: 240000 })] }), NOW);
    expect(m.listings).toEqual([listing({ firstSeenAt: 100, lastSeenAt: NOW, seenCount: 7, currentPrice: 230000 })]);
    expect(m.summary.updated).toBe(1);
  });

  it('annuncio del backup più recente: prende i suoi campi', () => {
    const cur = { ...empty(), listings: [listing({ lastSeenAt: NOW - 5000, currentPrice: 240000 })], leadStates: [state()] };
    const m = mergeBackup(cur, file({ listings: [listing({ lastSeenAt: NOW, currentPrice: 230000 })] }), NOW);
    expect(m.listings[0]).toMatchObject({ lastSeenAt: NOW, currentPrice: 230000 });
  });

  it('stato: vince updatedAt più alto; a parità resta il browser', () => {
    const cur = { ...empty(), listings: [listing()], leadStates: [state({ status: 'contacted', updatedAt: 10 })] };
    expect(mergeBackup(cur, file({ leadStates: [state({ status: 'discarded', updatedAt: 20 })] }), NOW).leadStates).toEqual([state({ status: 'discarded', updatedAt: 20 })]);
    expect(mergeBackup(cur, file({ leadStates: [state({ status: 'discarded', updatedAt: 5 })] }), NOW).leadStates).toEqual([]);
    const tie = mergeBackup(cur, file({ leadStates: [state({ status: 'discarded', updatedAt: 10 })] }), NOW);
    expect(tie.leadStates).toEqual([]);
    expect(tie.summary).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });

  it('storico prezzi: unione senza doppioni, anche dentro il file', () => {
    const a = { listingKey: K, price: 249000, at: 1, source: 'declared' as const };
    const b = { listingKey: K, price: 235000, at: 2, source: 'observed' as const };
    const cur = { ...empty(), listings: [listing()], leadStates: [state()], priceSnapshots: [{ ...a, id: 9 }] };
    const m = mergeBackup(cur, file({ priceSnapshots: [a, b, b] }), NOW);
    expect(m.priceSnapshots).toEqual([b]);
    expect(m.summary).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });

  it('scarta stati e snapshot di annunci assenti dal file', () => {
    const orphan = 'subito:1';
    const m = mergeBackup(empty(), file({
      leadStates: [state(), state({ listingKey: orphan })],
      priceSnapshots: [{ listingKey: orphan, price: 1, at: 1, source: 'observed' }],
    }), NOW);
    expect(m.leadStates.map((s) => s.listingKey)).toEqual([K]);
    expect(m.priceSnapshots).toEqual([]);
  });

  it('calibrazione: aggiunge i punti nuovi, non sovrascrive quelli del browser', () => {
    const cur = { ...empty(), calibration: [{ portal: 'idealista' as const, portalId: 1, createdAt: 100 }] };
    const m = mergeBackup(cur, file({ calibration: [{ portal: 'idealista', portalId: 1, createdAt: 999 }, { portal: 'subito', portalId: 2, createdAt: 200 }] }), NOW);
    expect(m.calibration).toEqual([{ portal: 'subito', portalId: 2, createdAt: 200 }]);
  });

  it('impostazioni: importate solo se nel browser non sono mai state salvate', () => {
    const settings = { ...DEFAULT_SETTINGS, minAgeDays: 90 };
    expect(mergeBackup(empty(), file({ settings }), NOW).settings).toEqual(settings);
    expect(mergeBackup({ ...empty(), settingsSaved: true }, file({ settings }), NOW).settings).toBeNull();
    expect(mergeBackup(empty(), file(), NOW).settings).toBeNull();
  });
});
