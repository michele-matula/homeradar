import { describe, expect, it, vi } from 'vitest';
import type { LeadService } from '@/core/service';
import { DAY_MS } from '@/shared/types';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const stripIds = async (svc: LeadService) => (await svc.listLeads()).map((l) => ({ ...l, prices: l.prices.map(({ id: _id, ...p }) => p) }));

async function filled() {
  const a = setup();
  await a.svc.ingest([obs(), obs({ portalId: 120000000, lastDrop: null, price: 500000 })]);
  a.advance(DAY_MS);
  await a.svc.ingest([obs({ price: 230000, lastDrop: null })]);
  await a.svc.setLeadState(KEY, { status: 'to_contact', notes: 'chiamare la sera' });
  await a.svc.saveSettings({ minAgeDays: 90 });
  return a;
}

describe('LeadService backup', () => {
  it('rifiuta di esportare un backup che non si potrebbe ripristinare', async () => {
    const { svc, db } = setup();
    await svc.ingest([obs()]);
    await db.listings.toCollection().modify({ url: 'javascript:alert(1)' });
    await expect(svc.exportBackup('v')).rejects.toThrow('Backup non ripristinabile: Backup non valido (annunci)');
  });

  it('esporta e reimporta in un browser vuoto: stessi lead, stati, storico e impostazioni', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('0.1.0'));
    expect(file).toMatchObject({ format: 'homeradar-backup', formatVersion: 1, extensionVersion: '0.1.0' });

    const b = setup(a.now());
    expect(await b.svc.importBackup(file)).toEqual({ added: 2, updated: 0, unchanged: 0 });
    expect(await b.svc.getSettings()).toEqual(await a.svc.getSettings());
    expect(await stripIds(b.svc)).toEqual(await stripIds(a.svc));
    expect(await b.db.calibration.toArray()).toEqual(await a.db.calibration.toArray());
  });

  it('reimportare lo stesso file non crea doppioni', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('v'));
    const snaps = await a.db.priceSnapshots.count();
    expect(await a.svc.importBackup(file)).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(await a.svc.importBackup(file)).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(await a.db.priceSnapshots.count()).toBe(snaps);
  });

  it('non tocca le impostazioni già salvate nel browser', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('v'));
    const b = setup(a.now());
    await b.svc.saveSettings({ minAgeDays: 200 });
    await b.svc.importBackup(file);
    expect((await b.svc.getSettings()).minAgeDays).toBe(200);
  });

  it('un errore di scrittura annulla tutta l\'importazione', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('v'));
    const b = setup(a.now());
    vi.spyOn(b.db.priceSnapshots, 'bulkAdd').mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(b.svc.importBackup(file)).rejects.toThrow('QuotaExceededError');
    expect(await b.db.listings.count()).toBe(0);
    expect(await b.db.leadStates.count()).toBe(0);
  });

  it('un file non valido non scrive nulla', async () => {
    const b = setup();
    await expect(b.svc.importBackup({ format: 'altro' })).rejects.toThrow('Il file non è un backup di HomeRadar');
    expect(await b.db.listings.count()).toBe(0);
  });

  it('stato del backup: ultimo backup, rotazione degli slot, fallimenti nel diagnostico', async () => {
    const { svc, advance, now } = setup();
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: null, nextSlot: 1, pending: null });
    await svc.recordBackup(4);
    expect(await svc.backupStatus()).toEqual({ lastAt: now(), lastAutoFailedAt: null, nextSlot: 1, pending: null });
    advance(1000);
    await svc.recordBackup();
    expect(await svc.backupStatus()).toMatchObject({ lastAt: now(), nextSlot: 1 });
    await svc.recordBackup(2);
    expect((await svc.backupStatus()).nextSlot).toBe(3);
    advance(1000);
    await svc.recordBackupFailure('download interrotto (FILE_FAILED)');
    expect(await svc.backupStatus()).toMatchObject({ lastAt: now() - 1000, lastAutoFailedAt: now() });
    expect((await svc.getDiagnostics('v')).errors.at(-1)!.message).toBe('Backup automatico non riuscito: download interrotto (FILE_FAILED)');
  });

  it('backup automatico in corso: un backup manuale non lo chiude, il successo o il fallimento sì', async () => {
    const { svc, now } = setup();
    await svc.recordBackupStarted(2, 'blob:x/1');
    expect((await svc.backupStatus()).pending).toEqual({ slot: 2, url: 'blob:x/1', startedAt: now() });
    await svc.recordBackup();
    expect((await svc.backupStatus()).pending).not.toBeNull();
    await svc.recordBackup(2);
    expect(await svc.backupStatus()).toMatchObject({ nextSlot: 3, pending: null });
    await svc.recordBackupStarted(3, 'blob:x/2');
    await svc.recordBackupFailure('download interrotto (USER_CANCELED)');
    expect(await svc.backupStatus()).toMatchObject({ nextSlot: 3, pending: null });
  });

  it('conta gli annunci salvati', async () => {
    const a = await filled();
    expect(await a.svc.listingCount()).toBe(2);
  });
});

describe('LeadService backup separazioni', () => {
  it('le separazioni passano dal backup a un altro browser', async () => {
    const a = setup();
    await a.svc.ingest([obs(), obs({ portal: 'idealista', portalId: 2, url: 'https://www.idealista.it/immobile/2/', lastDrop: null })]);
    await a.db.splits.put({ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 });
    const file = JSON.parse(JSON.stringify(await a.svc.exportBackup('v')));
    const b = setup();
    await b.svc.importBackup(file);
    expect(await b.db.splits.toArray()).toEqual([{ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 }]);
  });
});
