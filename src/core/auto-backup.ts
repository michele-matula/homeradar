import { AUTO_BACKUP_SLOTS, autoBackupFileName } from '@/core/backup';
import { DAY_MS, type BackupStatus, type PendingBackup, type Settings } from '@/shared/types';

export const AUTO_BACKUP_INTERVAL_MS = 7 * DAY_MS;
/** Oltre questo tempo un download non concluso si considera perso (l'allarme è giornaliero). */
export const PENDING_BACKUP_MAX_MS = DAY_MS / 2;

/** Con il database vuoto non si salva: un browser appena pulito non sovrascrive i backup buoni. */
export function isBackupDue(status: BackupStatus, settings: Settings, listingCount: number, now: number): boolean {
  if (!settings.autoBackup || listingCount === 0) return false;
  // Una data nel futuro (orologio andato avanti e poi corretto) non deve bloccare i backup.
  return status.lastAt === null || status.lastAt > now || now - status.lastAt >= AUTO_BACKUP_INTERVAL_MS;
}

export type DownloadOutcome =
  | { state: 'complete' }
  | { state: 'interrupted'; error: string }
  | { state: 'in_progress' }
  /** Download non (ancora) presente nella cronologia di Chrome. */
  | { state: 'missing' };

export interface AutoBackupDeps {
  now(): number;
  status(): Promise<BackupStatus>;
  settings(): Promise<Settings>;
  listingCount(): Promise<number>;
  exportJson(): Promise<string>;
  /** Prepara il file e ne restituisce l'URL blob; resta valido fino a `release`. */
  createUrl(json: string): Promise<string>;
  /** Avvia il download; può non risolversi mai se il service worker viene spento nel frattempo. */
  startDownload(url: string, filename: string): Promise<void>;
  downloadOutcome(url: string): Promise<DownloadOutcome>;
  release(url: string): Promise<void>;
  recordStarted(slot: number, url: string): Promise<void>;
  recordSuccess(slot: number): Promise<void>;
  recordFailure(message: string): Promise<void>;
}

/** Chiude il backup in corso se il download è concluso; `false` se è ancora aperto. */
async function settle(d: AutoBackupDeps, pending: PendingBackup): Promise<boolean> {
  const outcome = await d.downloadOutcome(pending.url);
  if (outcome.state === 'complete') await d.recordSuccess(pending.slot);
  else if (outcome.state === 'interrupted') await d.recordFailure(`download interrotto (${outcome.error})`);
  else if (d.now() - pending.startedAt >= PENDING_BACKUP_MAX_MS) await d.recordFailure('download non completato');
  else return false;
  await d.release(pending.url);
  return true;
}

/** Da chiamare a ogni download concluso: il service worker può essere stato riavviato dall'avvio del backup. */
export async function settleAutoBackup(d: AutoBackupDeps): Promise<void> {
  const { pending } = await d.status();
  if (pending) await settle(d, pending);
}

export async function runAutoBackup(d: AutoBackupDeps): Promise<'skipped' | 'waiting' | 'started' | 'failed'> {
  const before = await d.status();
  if (before.pending && !(await settle(d, before.pending))) return 'waiting';
  const [status, settings, count] = await Promise.all([d.status(), d.settings(), d.listingCount()]);
  if (!isBackupDue(status, settings, count, d.now())) return 'skipped';
  const slot = Number.isInteger(status.nextSlot) && status.nextSlot >= 1 && status.nextSlot <= AUTO_BACKUP_SLOTS ? status.nextSlot : 1;
  let url: string | null = null;
  try {
    url = await d.createUrl(await d.exportJson());
    // Prima del download: il completamento può arrivare a un service worker nuovo.
    await d.recordStarted(slot, url);
    await d.startDownload(url, autoBackupFileName(slot));
  } catch (err) {
    await d.recordFailure(err instanceof Error ? err.message : String(err));
    if (url) await d.release(url).catch(() => {});
    return 'failed';
  }
  return 'started';
}
