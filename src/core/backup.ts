import { z } from 'zod';
import { validateSettings } from '@/core/settings';
import {
  LEAD_STATUSES, PORTALS, listingKey,
  type CalibrationPoint, type ImportSummary, type LeadState, type ListingRecord, type Portal, type PriceSnapshot, type Settings,
} from '@/shared/types';

export const BACKUP_FORMAT = 'homeradar-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const AUTO_BACKUP_SLOTS = 4;

export const NOT_A_BACKUP = 'Il file non è un backup di HomeRadar';
export const TOO_NEW = "Backup creato da una versione più recente di HomeRadar: aggiorna l'estensione";

export type BackupSnapshot = Omit<PriceSnapshot, 'id'>;

export interface BackupData {
  settings?: Settings;
  listings: ListingRecord[];
  priceSnapshots: BackupSnapshot[];
  leadStates: LeadState[];
  calibration: CalibrationPoint[];
}

export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: number;
  extensionVersion: string;
}

const PORTAL_DOMAINS: Record<Portal, string> = { immobiliare: 'immobiliare.it', idealista: 'idealista.it', subito: 'subito.it' };

/** Il link dell'annuncio viene mostrato nel pannello: solo https verso il dominio del suo portale. */
function isPortalUrl(url: string, portal: Portal): boolean {
  try {
    const u = new URL(url);
    const d = PORTAL_DOMAINS[portal];
    return u.protocol === 'https:' && (u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Gli schemi sono la lista dei campi ammessi: z.object scarta tutto ciò che non è dichiarato.
const num = z.number();
const int = z.number().int();
const text = z.string().nullable();
const portal = z.enum(PORTALS);

const DropSchema = z.object({ fromPrice: num, toPrice: num, percent: num, date: num, dateEstimated: z.boolean().optional() });

const ListingSchema = z
  .object({
    key: z.string(), portal, portalId: int, url: z.string(), title: z.string(),
    address: text, city: text, zone: text, typology: text,
    surfaceM2: num.nullable(), rooms: num.nullable(), currentPrice: num.nullable(),
    portalCreatedAt: num.nullable(), estimatedCreatedAt: num.nullable(), lastDrop: DropSchema.nullable(),
    firstSeenAt: num, lastSeenAt: num, seenCount: int.min(1),
  })
  .refine((l) => l.key === listingKey(l.portal, l.portalId) && isPortalUrl(l.url, l.portal));

const SnapshotSchema = z.object({ listingKey: z.string(), price: num, at: num, source: z.enum(['observed', 'declared']) });

const LeadStateSchema = z
  .object({ listingKey: z.string(), status: z.enum(LEAD_STATUSES), notes: z.string(), statusChangedAt: num, updatedAt: num.optional() })
  .transform((s): LeadState => ({ ...s, updatedAt: s.updatedAt ?? s.statusChangedAt }));

const CalibrationSchema = z.object({ portal, portalId: int, createdAt: num });

const SettingsSchema = z.object({
  minAgeDays: num.optional(), minDropPercent: num.optional(), retentionDays: num.optional(), autoBackup: z.boolean().optional(),
  enabledPortals: z.object({ immobiliare: z.boolean().optional(), idealista: z.boolean().optional(), subito: z.boolean().optional() }).optional(),
});

const HeaderSchema = z.object({ format: z.literal(BACKUP_FORMAT), formatVersion: int.min(1), createdAt: num, extensionVersion: z.string() });

function table<T>(raw: Record<string, unknown>, field: string, schema: z.ZodType<T, unknown>, label: string): T[] {
  const r = z.array(schema).safeParse(raw[field]);
  if (!r.success) throw new Error(`Backup non valido (${label})`);
  return r.data;
}

export function parseBackup(json: unknown): BackupFile {
  const header = HeaderSchema.safeParse(json);
  if (!header.success) throw new Error(NOT_A_BACKUP);
  if (header.data.formatVersion > BACKUP_FORMAT_VERSION) throw new Error(TOO_NEW);
  const raw = json as Record<string, unknown>;
  const file: BackupFile = {
    ...header.data,
    listings: table(raw, 'listings', ListingSchema, 'annunci'),
    priceSnapshots: table(raw, 'priceSnapshots', SnapshotSchema, 'storico prezzi'),
    leadStates: table(raw, 'leadStates', LeadStateSchema, 'stati dei lead'),
    calibration: table(raw, 'calibration', CalibrationSchema, 'calibrazione'),
  };
  if (raw.settings !== undefined) {
    const s = SettingsSchema.safeParse(raw.settings);
    try {
      if (!s.success) throw new Error();
      file.settings = validateSettings(s.data as Partial<Settings>);
    } catch {
      throw new Error('Backup non valido (impostazioni)');
    }
  }
  return file;
}

export function buildBackup(data: BackupData, now: number, extensionVersion: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now,
    extensionVersion,
    ...(data.settings ? { settings: data.settings } : {}),
    listings: data.listings,
    // L'id è una chiave locale autoincrementale: non va nel file.
    priceSnapshots: data.priceSnapshots.map(({ listingKey: k, price, at, source }) => ({ listingKey: k, price, at, source })),
    leadStates: data.leadStates,
    calibration: data.calibration,
  };
}

export function backupFileName(now: number): string {
  return `homeradar-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export function autoBackupFileName(slot: number): string {
  return `HomeRadar/homeradar-backup-${slot}.json`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function importSummaryText(s: ImportSummary): string {
  return `Backup importato: ${count(s.added, 'annuncio nuovo', 'annunci nuovi')}, ${count(s.updated, 'aggiornato', 'aggiornati')}, ${count(s.unchanged, 'già presente', 'già presenti')}`;
}
