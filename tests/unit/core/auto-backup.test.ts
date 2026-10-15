import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_BACKUP_INTERVAL_MS,
  PENDING_BACKUP_MAX_MS,
  isBackupDue,
  runAutoBackup,
  settleAutoBackup,
  type AutoBackupDeps,
  type DownloadOutcome,
} from '@/core/auto-backup';
import type { LeadService } from '@/core/service';
import { DAY_MS, DEFAULT_SETTINGS } from '@/shared/types';
import { obs, setup } from './helpers';

const NOW = Date.UTC(2026, 9, 14);
const never = { lastAt: null, lastAutoFailedAt: null, nextSlot: 1, pending: null };

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

/**
 * Finto Chrome: i download partono e restano in corso finché il test non li chiude, come quando
 * l'utente ha davanti la finestra "Salva con nome".
 */
function fakeChrome() {
  const downloads = new Map<string, { filename: string; json: string; outcome: DownloadOutcome }>();
  let n = 0;
  return {
    downloads,
    createUrl: vi.fn(async (json: string) => {
      const url = `blob:x/${++n}`;
      downloads.set(url, { filename: '', json, outcome: { state: 'missing' } });
      return url;
    }),
    startDownload: vi.fn(async (url: string, filename: string) => {
      downloads.set(url, { ...downloads.get(url)!, filename, outcome: { state: 'in_progress' } });
    }),
    downloadOutcome: vi.fn(async (url: string) => downloads.get(url)?.outcome ?? { state: 'missing' as const }),
    release: vi.fn(async (_url: string) => {}),
    finish(url: string, outcome: DownloadOutcome = { state: 'complete' }) {
      downloads.set(url, { ...downloads.get(url)!, outcome });
    },
    started: () => [...downloads.entries()].filter(([, d]) => d.filename),
  };
}

function deps(svc: LeadService, now: () => number, chrome = fakeChrome()): AutoBackupDeps & { chrome: ReturnType<typeof fakeChrome> } {
  return {
    chrome,
    now,
    status: () => svc.backupStatus(),
    settings: () => svc.getSettings(),
    listingCount: () => svc.listingCount(),
    exportJson: async () => JSON.stringify(await svc.exportBackup('v')),
    createUrl: chrome.createUrl,
    startDownload: chrome.startDownload,
    downloadOutcome: chrome.downloadOutcome,
    release: chrome.release,
    recordStarted: (slot, url) => svc.recordBackupStarted(slot, url),
    recordSuccess: (slot) => svc.recordBackup(slot),
    recordFailure: (m) => svc.recordBackupFailure(m),
  };
}

/** Avvia il backup e chiude subito il download, come quando Chrome salva senza chiedere. */
async function runAndComplete(d: ReturnType<typeof deps>) {
  const r = await runAutoBackup(d);
  if (r === 'started') {
    const [url] = d.chrome.started().at(-1)!;
    d.chrome.finish(url);
    await settleAutoBackup(d);
  }
  return r;
}

describe('runAutoBackup', () => {
  it('ruota sui 4 file, una volta ogni 7 giorni', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    for (let i = 0; i < 5; i++) {
      expect(await runAndComplete(d)).toBe('started');
      expect(await runAutoBackup(d)).toBe('skipped');
      advance(AUTO_BACKUP_INTERVAL_MS);
    }
    const started = d.chrome.started();
    expect(started.map(([, x]) => x.filename)).toEqual([1, 2, 3, 4, 1].map((n) => `HomeRadar/homeradar-backup-${n}.json`));
    expect(JSON.parse(started[0]![1].json).format).toBe('homeradar-backup');
    expect(d.chrome.release).toHaveBeenCalledTimes(5);
  });

  it('il download in corso si segna prima di avviarlo, così un service worker riavviato lo ritrova', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    d.chrome.startDownload.mockImplementation(async () => {
      expect((await svc.backupStatus()).pending).toEqual({ slot: 1, url: 'blob:x/1', startedAt: now() });
    });
    expect(await runAutoBackup(d)).toBe('started');
    expect((await svc.backupStatus()).lastAt).toBeNull();
  });

  it('se il worker muore mentre la finestra di salvataggio è aperta, il completamento lo registra comunque', async () => {
    const { svc, now, advance } = setup();
    await svc.ingest([obs()]);
    const before = deps(svc, now);
    // startDownload non si risolve mai: Chrome spegne il worker mentre l'utente sceglie dove salvare.
    before.chrome.startDownload.mockImplementation(() => new Promise(() => {}));
    void runAutoBackup(before);
    await vi.waitFor(async () => expect((await svc.backupStatus()).pending).not.toBeNull());

    // Nuovo worker, risvegliato dall'evento di download completato.
    advance(3 * 60_000);
    const after = deps(svc, now, before.chrome);
    before.chrome.finish('blob:x/1');
    await settleAutoBackup(after);
    expect(await svc.backupStatus()).toEqual({ lastAt: now(), lastAutoFailedAt: null, nextSlot: 2, pending: null });
    expect(after.chrome.release).toHaveBeenCalledWith('blob:x/1');
  });

  it('finestra annullata: fallimento registrato, si riprova al prossimo allarme', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    expect(await runAutoBackup(d)).toBe('started');
    d.chrome.finish('blob:x/1', { state: 'interrupted', error: 'USER_CANCELED' });
    await settleAutoBackup(d);
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: now(), nextSlot: 1, pending: null });
    expect((await svc.getDiagnostics('v')).errors.at(-1)!.message).toBe('Backup automatico non riuscito: download interrotto (USER_CANCELED)');
    expect(await runAutoBackup(d)).toBe('started');
  });

  it('un download ancora in corso non ne avvia un altro', async () => {
    const { svc, now, advance } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    expect(await runAutoBackup(d)).toBe('started');
    advance(PENDING_BACKUP_MAX_MS - 1);
    expect(await runAutoBackup(d)).toBe('waiting');
    expect(d.chrome.startDownload).toHaveBeenCalledTimes(1);
  });

  it('allarme successivo: un download completato senza evento ricevuto viene registrato', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    expect(await runAutoBackup(d)).toBe('started');
    d.chrome.finish('blob:x/1');
    expect(await runAutoBackup(d)).toBe('skipped');
    expect(await svc.backupStatus()).toMatchObject({ lastAt: now(), nextSlot: 2, pending: null });
  });

  it('un download rimasto in sospeso troppo a lungo conta come fallito e si riprova', async () => {
    const { svc, now, advance } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    expect(await runAutoBackup(d)).toBe('started');
    advance(PENDING_BACKUP_MAX_MS);
    expect(await runAutoBackup(d)).toBe('started');
    expect(d.chrome.release).toHaveBeenCalledWith('blob:x/1');
    expect(await svc.backupStatus()).toMatchObject({ lastAutoFailedAt: now(), pending: { url: 'blob:x/2', slot: 1 } });
    expect((await svc.getDiagnostics('v')).errors.at(-1)!.message).toBe('Backup automatico non riuscito: download non completato');
  });

  it('settleAutoBackup senza backup in corso non fa nulla', async () => {
    const { svc, now } = setup();
    const d = deps(svc, now);
    await settleAutoBackup(d);
    expect(d.chrome.downloadOutcome).not.toHaveBeenCalled();
    expect(await svc.backupStatus()).toEqual(never);
  });

  it('se il download non parte non avanza né lo slot né la data, lo registra e libera il file', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    d.chrome.startDownload.mockRejectedValueOnce(new Error('Invalid filename'));
    expect(await runAutoBackup(d)).toBe('failed');
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: now(), nextSlot: 1, pending: null });
    expect(d.chrome.release).toHaveBeenCalledWith('blob:x/1');
    expect(await runAutoBackup(d)).toBe('started');
  });

  it('un backup non ripristinabile risulta fallito e non viene salvato', async () => {
    const { svc, db, now } = setup();
    await svc.ingest([obs()]);
    await db.listings.toCollection().modify({ url: 'javascript:alert(1)' });
    const d = deps(svc, now);
    expect(await runAutoBackup(d)).toBe('failed');
    expect(d.chrome.createUrl).not.toHaveBeenCalled();
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: now(), nextSlot: 1, pending: null });
  });

  it('con il database vuoto non salva nulla', async () => {
    const { svc, now } = setup();
    const d = deps(svc, now);
    expect(await runAutoBackup(d)).toBe('skipped');
    expect(d.chrome.createUrl).not.toHaveBeenCalled();
  });

  it('uno slot fuori intervallo riparte da 1', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now);
    await runAutoBackup({ ...d, status: async () => ({ ...never, nextSlot: 9 }) });
    expect(d.chrome.startDownload.mock.calls[0]![1]).toBe('HomeRadar/homeradar-backup-1.json');
  });
});
