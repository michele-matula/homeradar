import { describe, expect, it, vi } from 'vitest';
import { AUTO_BACKUP_INTERVAL_MS, isBackupDue, runAutoBackup, type AutoBackupDeps } from '@/core/auto-backup';
import type { LeadService } from '@/core/service';
import { DAY_MS, DEFAULT_SETTINGS } from '@/shared/types';
import { obs, setup } from './helpers';

const NOW = Date.UTC(2026, 9, 14);
const never = { lastAt: null, lastAutoFailedAt: null, nextSlot: 1 };

describe('isBackupDue', () => {
  it.each([
    ['mai fatto', never, DEFAULT_SETTINGS, 5, true],
    ['meno di 7 giorni', { ...never, lastAt: NOW - 6 * DAY_MS }, DEFAULT_SETTINGS, 5, false],
    ['7 giorni esatti', { ...never, lastAt: NOW - AUTO_BACKUP_INTERVAL_MS }, DEFAULT_SETTINGS, 5, true],
    ['data nel futuro (orologio corretto)', { ...never, lastAt: NOW + DAY_MS }, DEFAULT_SETTINGS, 5, true],
    ['database vuoto', never, DEFAULT_SETTINGS, 0, false],
    ['backup automatico spento', never, { ...DEFAULT_SETTINGS, autoBackup: false }, 5, false],
  ])('%s', (_name, status, settings, count, due) => {
    expect(isBackupDue(status, settings, count, NOW)).toBe(due);
  });
});

function deps(svc: LeadService, now: () => number, saveFile: AutoBackupDeps['saveFile']): AutoBackupDeps {
  return {
    now,
    status: () => svc.backupStatus(),
    settings: () => svc.getSettings(),
    listingCount: () => svc.listingCount(),
    exportJson: async () => JSON.stringify(await svc.exportBackup('v')),
    saveFile,
    recordSuccess: (slot) => svc.recordBackup(slot),
    recordFailure: (m) => svc.recordBackupFailure(m),
  };
}

describe('runAutoBackup', () => {
  it('ruota sui 4 file, una volta ogni 7 giorni', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    const saveFile = vi.fn(async (_json: string, _filename: string) => {});
    const d = deps(svc, now, saveFile);
    for (let i = 0; i < 5; i++) {
      expect(await runAutoBackup(d)).toBe('done');
      expect(await runAutoBackup(d)).toBe('skipped');
      advance(AUTO_BACKUP_INTERVAL_MS);
    }
    expect(saveFile.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4, 1].map((n) => `HomeRadar/homeradar-backup-${n}.json`));
    expect(JSON.parse(saveFile.mock.calls[0]![0]).format).toBe('homeradar-backup');
  });

  it('se il salvataggio fallisce non avanza né lo slot né la data e lo registra', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now, vi.fn(async () => { throw new Error('download interrotto (FILE_FAILED)'); }));
    expect(await runAutoBackup(d)).toBe('failed');
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: now(), nextSlot: 1 });
    // Riprova al prossimo allarme.
    expect(await runAutoBackup({ ...d, saveFile: vi.fn(async (_json: string, _filename: string) => {}) })).toBe('done');
  });

  it('un backup non ripristinabile risulta fallito e non viene salvato', async () => {
    const { svc, db, now } = setup();
    await svc.ingest([obs()]);
    await db.listings.toCollection().modify({ url: 'javascript:alert(1)' });
    const saveFile = vi.fn(async (_json: string, _filename: string) => {});
    expect(await runAutoBackup(deps(svc, now, saveFile))).toBe('failed');
    expect(saveFile).not.toHaveBeenCalled();
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: now(), nextSlot: 1 });
  });

  it('con il database vuoto non salva nulla', async () => {
    const { svc, now } = setup();
    const saveFile = vi.fn(async (_json: string, _filename: string) => {});
    expect(await runAutoBackup(deps(svc, now, saveFile))).toBe('skipped');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('uno slot fuori intervallo riparte da 1', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const saveFile = vi.fn(async (_json: string, _filename: string) => {});
    await runAutoBackup({ ...deps(svc, now, saveFile), status: async () => ({ ...never, nextSlot: 9 }) });
    expect(saveFile.mock.calls[0]![1]).toBe('HomeRadar/homeradar-backup-1.json');
  });
});
