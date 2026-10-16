import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { HomeRadarDB } from '@/core/db';

describe('HomeRadarDB migrazioni', () => {
  it('sposta la calibrazione v1 nella tabella per portale senza toccare gli annunci', async () => {
    const name = `mig-${Math.random()}`;
    const old = new Dexie(name);
    old.version(1).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status', idCalibration: 'portalId', meta: 'key',
    });
    await old.table('idCalibration').put({ portalId: 128416572, createdAt: 1776643200000 });
    await old.table('listings').put({ key: 'immobiliare:128416572', lastSeenAt: 5 });
    await old.table('leadStates').put({ listingKey: 'immobiliare:128416572', status: 'contacted' });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.calibration.toArray()).toEqual([{ portal: 'immobiliare', portalId: 128416572, createdAt: 1776643200000 }]);
    expect(await db.listings.get('immobiliare:128416572')).toMatchObject({ lastSeenAt: 5 });
    expect(await db.leadStates.get('immobiliare:128416572')).toMatchObject({ status: 'contacted' });
    expect(db.tables.map((t) => t.name)).not.toContain('idCalibration');
  });

  it('v4: inizializza updatedAt dei lead con la data di cambio stato', async () => {
    const name = `mig4-${Math.random()}`;
    const old = new Dexie(name);
    old.version(3).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status', calibration: '[portal+portalId], portal', meta: 'key',
    });
    await old.table('leadStates').put({ listingKey: 'immobiliare:1', status: 'contacted', notes: 'x', statusChangedAt: 123 });
    await old.table('leadStates').put({ listingKey: 'immobiliare:2', status: 'new', notes: '' });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.leadStates.get('immobiliare:1')).toMatchObject({ status: 'contacted', statusChangedAt: 123, updatedAt: 123 });
    expect(await db.leadStates.get('immobiliare:2')).toMatchObject({ updatedAt: 0 });
  });

  it('v5: aggiunge recallAt nullo ai lead senza toccare updatedAt', async () => {
    const name = `mig5-${Math.random()}`;
    const old = new Dexie(name);
    old.version(4).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status', calibration: '[portal+portalId], portal', meta: 'key',
    });
    await old.table('leadStates').put({ listingKey: 'immobiliare:1', status: 'contacted', notes: 'x', statusChangedAt: 123, updatedAt: 456 });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.leadStates.get('immobiliare:1')).toEqual({
      listingKey: 'immobiliare:1', status: 'contacted', notes: 'x', statusChangedAt: 123, updatedAt: 456, recallAt: null,
    });
    expect(await db.leadStates.where('recallAt').below(Infinity).count()).toBe(0);
  });
});

describe('HomeRadarDB v6', () => {
  it('aggiunge la tabella delle coppie separate senza toccare i dati', async () => {
    const name = `mig-${Math.random()}`;
    const old = new Dexie(name);
    old.version(5).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status, recallAt', calibration: '[portal+portalId], portal', meta: 'key',
    });
    await old.table('listings').put({ key: 'immobiliare:1', lastSeenAt: 5 });
    await old.table('leadStates').put({ listingKey: 'immobiliare:1', status: 'contacted', recallAt: null, updatedAt: 3 });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.splits.count()).toBe(0);
    await db.splits.put({ a: 'idealista:2', b: 'immobiliare:1', at: 7 });
    expect(await db.splits.where('b').equals('immobiliare:1').count()).toBe(1);
    expect(await db.listings.get('immobiliare:1')).toMatchObject({ lastSeenAt: 5 });
    expect(await db.leadStates.get('immobiliare:1')).toMatchObject({ status: 'contacted' });
  });
});
