import Dexie, { type Table } from 'dexie';
import { categoryFromTypology } from '@/core/category';
import type { CalibrationPoint, LeadState, ListingRecord, Portal, PriceSnapshot, SplitPair } from '@/shared/types';

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class HomeRadarDB extends Dexie {
  declare listings: Table<ListingRecord, string>;
  declare priceSnapshots: Table<PriceSnapshot, number>;
  declare leadStates: Table<LeadState, string>;
  declare calibration: Table<CalibrationPoint, [Portal, number]>;
  declare meta: Table<MetaRecord, string>;
  declare splits: Table<SplitPair, [string, string]>;

  constructor(name = 'homeradar') {
    super(name);
    this.version(1).stores({
      listings: 'key, lastSeenAt',
      priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status',
      idCalibration: 'portalId',
      meta: 'key',
    });
    // v2: la calibrazione diventa per portale; i punti salvati finora sono tutti di Immobiliare.
    this.version(2)
      .stores({ calibration: '[portal+portalId], portal' })
      .upgrade(async (tx) => {
        const old = await tx.table<{ portalId: number; createdAt: number }>('idCalibration').toArray();
        await tx.table('calibration').bulkPut(old.map((p) => ({ portal: 'immobiliare', portalId: p.portalId, createdAt: p.createdAt })));
      });
    this.version(3).stores({ idCalibration: null });
    // v4: data di ultima modifica del lead, per risolvere i conflitti all'importazione di un backup.
    this.version(4)
      .stores({ leadStates: 'listingKey, status' })
      .upgrade(async (tx) => {
        await tx.table<Partial<LeadState>>('leadStates').toCollection().modify((s) => {
          s.updatedAt ??= s.statusChangedAt ?? 0;
        });
      });
    // v5: giorno di ricontatto del lead, indicizzato per contare i richiami da fare.
    this.version(5)
      .stores({ leadStates: 'listingKey, status, recallAt' })
      .upgrade(async (tx) => {
        await tx.table<Partial<LeadState>>('leadStates').toCollection().modify((s) => {
          s.recallAt ??= null;
        });
      });
    // v6: coppie di annunci che l'agente ha separato, per non unirle più come stesso immobile.
    this.version(6).stores({ splits: '[a+b], a, b' });
    // v7: categoria dell'immobile e campi del giro delle ricerche ("non più visto").
    this.version(7)
      .stores({ listings: 'key, lastSeenAt' })
      .upgrade(async (tx) => {
        await tx.table<Partial<ListingRecord>>('listings').toCollection().modify((l) => {
          l.category ??= categoryFromTypology(l.typology) ?? 'residential';
          l.sweepScope ??= null;
          l.missedSweeps ??= 0;
          l.missingSince ??= null;
        });
      });
  }
}
