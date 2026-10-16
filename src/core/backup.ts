import { z } from 'zod';
import { splitId } from '@/core/same-property';
import { validateSettings } from '@/core/settings';
import {
  LEAD_STATUSES, PORTALS, listingKey,
  type CalibrationPoint, type ImportSummary, type LeadState, type ListingRecord, type Portal, type PriceSnapshot, type Settings,
  type SplitPair,
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
  /** Coppie separate dall'agente; assenti nei backup precedenti. */
  splits?: SplitPair[];
}

export interface BackupFile extends BackupData {
  splits: SplitPair[];
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
  .object({
    listingKey: z.string(), status: z.enum(LEAD_STATUSES), notes: z.string(), statusChangedAt: num, updatedAt: num.optional(),
    recallAt: num.nullable().optional(),
  })
  .transform((s): LeadState => ({
    ...s,
    updatedAt: s.updatedAt ?? s.statusChangedAt,
    // Backup precedenti al richiamo, o un lead scartato: nessun richiamo.
    recallAt: s.status === 'discarded' ? null : (s.recallAt ?? null),
  }));

const CalibrationSchema = z.object({ portal, portalId: int, createdAt: num });

const SplitSchema = z.object({ a: z.string(), b: z.string(), at: num }).refine((s) => s.a < s.b);

const SettingsSchema = z.object({
  minAgeDays: num.optional(), minDropPercent: num.optional(), retentionDays: num.optional(), autoBackup: z.boolean().optional(),
  enabledPortals: z.object({ immobiliare: z.boolean().optional(), idealista: z.boolean().optional(), subito: z.boolean().optional() }).optional(),
});

const VersionSchema = z.object({ format: z.literal(BACKUP_FORMAT), formatVersion: int.min(1) });
const HeaderSchema = VersionSchema.extend({ createdAt: num, extensionVersion: z.string() });

function table<T>(raw: Record<string, unknown>, field: string, schema: z.ZodType<T, unknown>, label: string): T[] {
  const r = z.array(schema).safeParse(raw[field]);
  if (!r.success) throw new Error(`Backup non valido (${label})`);
  return r.data;
}

export function parseBackup(json: unknown): BackupFile {
  // Prima formato e versione: un file di una versione futura può avere un'intestazione diversa.
  const version = VersionSchema.safeParse(json);
  if (!version.success) throw new Error(NOT_A_BACKUP);
  if (version.data.formatVersion > BACKUP_FORMAT_VERSION) throw new Error(TOO_NEW);
  const header = HeaderSchema.safeParse(json);
  if (!header.success) throw new Error(NOT_A_BACKUP);
  const raw = json as Record<string, unknown>;
  const file: BackupFile = {
    ...header.data,
    listings: table(raw, 'listings', ListingSchema, 'annunci'),
    priceSnapshots: table(raw, 'priceSnapshots', SnapshotSchema, 'storico prezzi'),
    leadStates: table(raw, 'leadStates', LeadStateSchema, 'stati dei lead'),
    calibration: table(raw, 'calibration', CalibrationSchema, 'calibrazione'),
    // Facoltativo: i backup precedenti alle separazioni non lo hanno.
    splits: raw.splits === undefined ? [] : table(raw, 'splits', SplitSchema, 'separazioni'),
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
    splits: data.splits ?? [],
  };
}

export function backupFileName(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `homeradar-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function autoBackupFileName(slot: number): string {
  return `HomeRadar/homeradar-backup-${slot}.json`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function importSummaryText(s: ImportSummary): string {
  return `Backup importato: ${count(s.added, 'annuncio nuovo', 'annunci nuovi')}, ${count(s.updated, 'aggiornato', 'aggiornati')}, ${count(s.unchanged, 'già presente', 'già presenti')}`;
}

export interface CurrentData {
  listings: ListingRecord[];
  priceSnapshots: BackupSnapshot[];
  leadStates: LeadState[];
  calibration: CalibrationPoint[];
  splits?: SplitPair[];
  /** Le impostazioni sono state salvate almeno una volta in questo browser. */
  settingsSaved: boolean;
}

export interface MergeResult {
  listings: ListingRecord[];
  priceSnapshots: BackupSnapshot[];
  leadStates: LeadState[];
  calibration: CalibrationPoint[];
  splits: SplitPair[];
  settings: Settings | null;
  summary: ImportSummary;
}

/** JSON con le chiavi ordinate: Dexie e zod restituiscono gli stessi oggetti con chiavi in ordine diverso. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

const snapId = (s: BackupSnapshot) => `${s.listingKey}|${s.at}|${s.price}|${s.source}`;
const calId = (c: CalibrationPoint) => `${c.portal}|${c.portalId}`;

/** Unione che non cancella mai nulla: restituisce solo i record da scrivere. */
export function mergeBackup(current: CurrentData, incoming: BackupData, now: number): MergeResult {
  const out: MergeResult = { listings: [], priceSnapshots: [], leadStates: [], calibration: [], splits: [], settings: null, summary: { added: 0, updated: 0, unchanged: 0 } };
  const curListings = new Map(current.listings.map((l) => [l.key, l]));
  const curStates = new Map(current.leadStates.map((s) => [s.listingKey, s]));
  const incListings = new Map(incoming.listings.map((l) => [l.key, l]));
  const incStates = new Map(incoming.leadStates.filter((s) => incListings.has(s.listingKey)).map((s) => [s.listingKey, s]));
  /** Annunci già presenti a cui l'importazione aggiunge storico o cambia lo stato. */
  const touched = new Set<string>();

  const seenSnaps = new Set(current.priceSnapshots.map(snapId));
  for (const s of incoming.priceSnapshots) {
    if (!incListings.has(s.listingKey) || seenSnaps.has(snapId(s))) continue;
    seenSnaps.add(snapId(s));
    out.priceSnapshots.push(s);
    touched.add(s.listingKey);
  }

  for (const [key, s] of incStates) {
    const cur = curStates.get(key);
    if (cur && (s.updatedAt <= cur.updatedAt)) continue;
    out.leadStates.push(s);
    touched.add(key);
  }

  for (const inc of incListings.values()) {
    const cur = curListings.get(inc.key);
    if (!cur) {
      out.listings.push(inc);
      out.summary.added++;
      if (!incStates.has(inc.key) && !curStates.has(inc.key)) {
        out.leadStates.push({ listingKey: inc.key, status: 'new', notes: '', statusChangedAt: now, updatedAt: now, recallAt: null });
      }
      continue;
    }
    const newer = inc.lastSeenAt > cur.lastSeenAt ? inc : cur;
    const merged: ListingRecord = {
      ...newer,
      firstSeenAt: Math.min(cur.firstSeenAt, inc.firstSeenAt),
      lastSeenAt: Math.max(cur.lastSeenAt, inc.lastSeenAt),
      seenCount: Math.max(cur.seenCount, inc.seenCount),
    };
    const changed = stable(merged) !== stable(cur);
    if (changed) out.listings.push(merged);
    if (changed || touched.has(inc.key)) out.summary.updated++;
    else out.summary.unchanged++;
  }

  const seenCal = new Set(current.calibration.map(calId));
  for (const c of incoming.calibration) {
    if (seenCal.has(calId(c))) continue;
    seenCal.add(calId(c));
    out.calibration.push(c);
  }

  // Una separazione serve solo se entrambi gli annunci esistono qui o nel file.
  const known = new Set([...curListings.keys(), ...incListings.keys()]);
  const seenSplits = new Set((current.splits ?? []).map((s) => splitId(s.a, s.b)));
  for (const s of incoming.splits ?? []) {
    const id = splitId(s.a, s.b);
    if (seenSplits.has(id) || !known.has(s.a) || !known.has(s.b)) continue;
    seenSplits.add(id);
    out.splits.push(s);
  }

  if (!current.settingsSaved && incoming.settings) out.settings = incoming.settings;
  return out;
}
