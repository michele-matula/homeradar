import { describe, expect, it } from 'vitest';
import { validateSettings } from '@/core/settings';
import { autoBackupFileName, backupFileName, buildBackup, importSummaryText, NOT_A_BACKUP, parseBackup, TOO_NEW, type BackupData } from '@/core/backup';
import { DEFAULT_SETTINGS } from '@/shared/types';
import { listing, NOW } from './backup-builders';

function data(): BackupData {
  return {
    settings: { ...DEFAULT_SETTINGS, minAgeDays: 90 },
    listings: [listing()],
    priceSnapshots: [{ listingKey: 'immobiliare:128416572', price: 235000, at: NOW, source: 'observed' }],
    leadStates: [{ listingKey: 'immobiliare:128416572', status: 'to_contact', notes: 'sera', statusChangedAt: 5, updatedAt: 6, recallAt: null }],
    calibration: [{ portal: 'idealista', portalId: 34000000, createdAt: Date.UTC(2026, 9, 1) }],
  };
}

const roundTrip = (d: BackupData) => JSON.parse(JSON.stringify(buildBackup(d, NOW, '0.1.0')));

describe('buildBackup / parseBackup', () => {
  it('il file letto torna uguale ai dati esportati', () => {
    const file = parseBackup(roundTrip(data()));
    expect(file).toEqual({ format: 'homeradar-backup', formatVersion: 1, createdAt: NOW, extensionVersion: '0.1.0', splits: [], ...data() });
  });

  it('conserva il richiamo; un file senza richiamo si legge come null', () => {
    const d = data();
    d.leadStates = [{ ...d.leadStates[0]!, recallAt: Date.UTC(2026, 9, 16, 22) }];
    expect(parseBackup(roundTrip(d)).leadStates[0]!.recallAt).toBe(Date.UTC(2026, 9, 16, 22));
    const raw = roundTrip(data());
    delete raw.leadStates[0].recallAt;
    expect(parseBackup(raw).leadStates[0]!.recallAt).toBeNull();
  });

  it('un lead scartato non porta un richiamo', () => {
    const raw = roundTrip(data());
    raw.leadStates[0].status = 'discarded';
    raw.leadStates[0].recallAt = Date.UTC(2026, 9, 16, 22);
    expect(parseBackup(raw).leadStates[0]!.recallAt).toBeNull();
  });

  it('toglie gli id degli snapshot ed esclude le impostazioni mai salvate', () => {
    const d = { ...data(), settings: undefined, priceSnapshots: [{ id: 7, listingKey: 'immobiliare:128416572', price: 1, at: 1, source: 'observed' as const }] };
    const file = buildBackup(d, NOW, 'v');
    expect(file.priceSnapshots).toEqual([{ listingKey: 'immobiliare:128416572', price: 1, at: 1, source: 'observed' }]);
    expect('settings' in JSON.parse(JSON.stringify(file))).toBe(false);
  });

  it('scarta i campi non dichiarati', () => {
    const raw = roundTrip(data());
    raw.listings[0].phone = '333 1234567';
    raw.leadStates[0].sellerName = 'Mario';
    raw.settings.evil = true;
    raw.diagnostics = { errors: [] };
    const file = parseBackup(raw);
    expect(file.listings[0]).not.toHaveProperty('phone');
    expect(file.leadStates[0]).not.toHaveProperty('sellerName');
    expect(file.settings).not.toHaveProperty('evil');
    expect(file).not.toHaveProperty('diagnostics');
  });

  it('senza updatedAt usa la data di cambio stato', () => {
    const raw = roundTrip(data());
    delete raw.leadStates[0].updatedAt;
    expect(parseBackup(raw).leadStates[0]!.updatedAt).toBe(5);
  });

  it.each([['ciao'], [null], [[]], [{ format: 'altro', formatVersion: 1, createdAt: 1, extensionVersion: 'v' }], [{ format: 'homeradar-backup' }]])(
    'rifiuta ciò che non è un backup: %j',
    (json) => expect(() => parseBackup(json)).toThrow(NOT_A_BACKUP),
  );

  it('rifiuta un formato più recente', () => {
    expect(() => parseBackup({ ...roundTrip(data()), formatVersion: 2 })).toThrow(TOO_NEW);
    // Anche se l'intestazione di una versione futura è diversa.
    expect(() => parseBackup({ format: 'homeradar-backup', formatVersion: 2 })).toThrow(TOO_NEW);
  });

  // `any` serve solo a corrompere i dati del file di prova.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  it.each([
    ['annunci', (r: any) => { r.listings[0].url = 'javascript:alert(1)'; }],
    ['annunci', (r: any) => { r.listings[0].url = 'https://www.evil.example/annunci/1/'; }],
    ['annunci', (r: any) => { r.listings[0].key = 'idealista:128416572'; }],
    ['annunci', (r: any) => { r.listings = 'tanti'; }],
    ['storico prezzi', (r: any) => { r.priceSnapshots[0].source = 'boh'; }],
    ['stati dei lead', (r: any) => { r.leadStates[0].status = 'boh'; }],
    ['calibrazione', (r: any) => { r.calibration[0].portal = 'casa.it'; }],
    ['impostazioni', (r: any) => { r.settings.minAgeDays = 0; }],
  ])('rifiuta il file intero e nomina la tabella: %s', (table, corrupt) => {
    const raw = roundTrip(data());
    corrupt(raw);
    expect(() => parseBackup(raw)).toThrow(`Backup non valido (${table})`);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it('accetta gli URL di tutti e tre i portali', () => {
    const raw = roundTrip({
      ...data(),
      listings: [
        listing({ key: 'idealista:34000001', portal: 'idealista', portalId: 34000001, url: 'https://www.idealista.it/immobile/34000001/' }),
        listing({ key: 'subito:600000001', portal: 'subito', portalId: 600000001, url: 'https://www.subito.it/appartamenti/bilocale-milano-600000001.htm' }),
      ],
    });
    expect(parseBackup(raw).listings).toHaveLength(2);
  });
});

describe('nomi dei file e riepilogo', () => {
  it('nomi', () => {
    expect(backupFileName(new Date(2026, 9, 14, 1, 0).getTime())).toBe('homeradar-backup-2026-10-14.json');
    expect(autoBackupFileName(3)).toBe('HomeRadar/homeradar-backup-3.json');
  });
  it('riepilogo al plurale e al singolare', () => {
    expect(importSummaryText({ added: 120, updated: 34, unchanged: 210 })).toBe('Backup importato: 120 annunci nuovi, 34 aggiornati, 210 già presenti');
    expect(importSummaryText({ added: 1, updated: 1, unchanged: 1 })).toBe('Backup importato: 1 annuncio nuovo, 1 aggiornato, 1 già presente');
  });
});

describe('separazioni nel backup', () => {
  const base = () => buildBackup({ listings: [listing()], priceSnapshots: [], leadStates: [], calibration: [] }, NOW, 'v');

  it('un file senza separazioni resta valido', () => {
    const json = JSON.parse(JSON.stringify(base())) as Record<string, unknown>;
    delete json.splits;
    expect(parseBackup(json).splits).toEqual([]);
  });

  it('esporta e rilegge le separazioni', () => {
    const file = buildBackup({ listings: [listing()], priceSnapshots: [], leadStates: [], calibration: [], splits: [{ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 }] }, NOW, 'v');
    expect(parseBackup(JSON.parse(JSON.stringify(file))).splits).toEqual([{ a: 'idealista:2', b: 'immobiliare:128416572', at: 5 }]);
  });

  it('rifiuta una separazione con le chiavi non in ordine', () => {
    const json = { ...JSON.parse(JSON.stringify(base())), splits: [{ a: 'subito:1', b: 'idealista:2', at: 5 }] };
    expect(() => parseBackup(json)).toThrow('Backup non valido (separazioni)');
  });
});
describe('backup: impostazioni del pilota', () => {
  it('accetta impostazioni con o senza codice pilota', () => {
    const base = buildBackup({ listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, 0, '0.1.0');
    const old = { ...base, settings: { minAgeDays: 100 } };
    expect(parseBackup(JSON.parse(JSON.stringify(old))).settings).toMatchObject({ minAgeDays: 100, pilotCode: '', reportingEnabled: true });
    const now = { ...base, settings: { pilotCode: 'rossi-7k2p', reportingEnabled: false } };
    expect(parseBackup(JSON.parse(JSON.stringify(now))).settings).toMatchObject({ pilotCode: 'ROSSI-7K2P', reportingEnabled: false });
  });
});

describe('backup: campi del giro', () => {
  it('importa i backup precedenti al giro: categoria dalla tipologia e campi del giro vuoti', () => {
    const file = buildBackup({ listings: [listing({ typology: 'Garage - Box' })], priceSnapshots: [], leadStates: [], calibration: [] }, NOW, '0.1.0');
    const raw = JSON.parse(JSON.stringify(file));
    for (const l of raw.listings) {
      delete l.category; delete l.sweepScope; delete l.missedSweeps; delete l.missingSince;
    }
    expect(parseBackup(raw).listings[0]).toMatchObject({ category: 'garage', sweepScope: null, missedSweeps: 0, missingSince: null });
  });
});

describe('backup: zona di lavoro', () => {
  it('esporta e reimporta la zona di lavoro', () => {
    const settings = validateSettings({ searchArea: { comuni: [{ istat: '015059', name: "Cassano d'Adda", province: 'MI' }], categories: ['residential'] } });
    const file = buildBackup({ settings, listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, NOW, '0.1.0');
    expect(parseBackup(JSON.parse(JSON.stringify(file))).settings?.searchArea).toEqual(settings.searchArea);
  });
});

describe('backup: copertina', () => {
  const COVER = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
  const withListing = (l: ReturnType<typeof listing>): BackupData => ({ ...data(), listings: [l] });

  it('andata e ritorno con la copertina', () => {
    expect(parseBackup(roundTrip(withListing(listing({ coverUrl: COVER })))).listings[0]!.coverUrl).toBe(COVER);
  });

  it('un file senza copertina si legge senza il campo', () => {
    expect('coverUrl' in parseBackup(roundTrip(data())).listings[0]!).toBe(false);
  });

  it('una copertina su un server non ammesso sparisce, il resto si importa', () => {
    const parsed = parseBackup(roundTrip(withListing(listing({ coverUrl: 'https://evil.example/x.jpg' }))));
    expect(parsed.listings).toHaveLength(1);
    expect('coverUrl' in parsed.listings[0]!).toBe(false);
  });
});
