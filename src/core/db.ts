import Dexie, { type Table } from 'dexie';
import type { CalibrationPoint, LeadState, ListingRecord, PriceSnapshot } from '@/shared/types';

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class HomeRadarDB extends Dexie {
  declare listings: Table<ListingRecord, string>;
  declare priceSnapshots: Table<PriceSnapshot, number>;
  declare leadStates: Table<LeadState, string>;
  declare idCalibration: Table<CalibrationPoint, number>;
  declare meta: Table<MetaRecord, string>;

  constructor(name = 'homeradar') {
    super(name);
    this.version(1).stores({
      listings: 'key, lastSeenAt',
      priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status',
      idCalibration: 'portalId',
      meta: 'key',
    });
  }
}
