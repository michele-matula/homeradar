import { AUTO_BACKUP_SLOTS, autoBackupFileName } from '@/core/backup';
import { DAY_MS, type BackupStatus, type Settings } from '@/shared/types';

export const AUTO_BACKUP_INTERVAL_MS = 7 * DAY_MS;

/** Con il database vuoto non si salva: un browser appena pulito non sovrascrive i backup buoni. */
export function isBackupDue(status: BackupStatus, settings: Settings, listingCount: number, now: number): boolean {
  if (!settings.autoBackup || listingCount === 0) return false;
  // Una data nel futuro (orologio andato avanti e poi corretto) non deve bloccare i backup.
  return status.lastAt === null || status.lastAt > now || now - status.lastAt >= AUTO_BACKUP_INTERVAL_MS;
}

export interface AutoBackupDeps {
  now(): number;
  status(): Promise<BackupStatus>;
  settings(): Promise<Settings>;
  listingCount(): Promise<number>;
  exportJson(): Promise<string>;
  /** Si risolve solo quando il file è davvero scritto su disco. */
  saveFile(json: string, filename: string): Promise<void>;
  recordSuccess(slot: number): Promise<void>;
  recordFailure(message: string): Promise<void>;
}

export async function runAutoBackup(d: AutoBackupDeps): Promise<'skipped' | 'done' | 'failed'> {
  const [status, settings, count] = await Promise.all([d.status(), d.settings(), d.listingCount()]);
  if (!isBackupDue(status, settings, count, d.now())) return 'skipped';
  const slot = Number.isInteger(status.nextSlot) && status.nextSlot >= 1 && status.nextSlot <= AUTO_BACKUP_SLOTS ? status.nextSlot : 1;
  try {
    await d.saveFile(await d.exportJson(), autoBackupFileName(slot));
  } catch (err) {
    await d.recordFailure(err instanceof Error ? err.message : String(err));
    return 'failed';
  }
  await d.recordSuccess(slot);
  return 'done';
}
