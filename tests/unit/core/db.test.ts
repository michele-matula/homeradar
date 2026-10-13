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
});
