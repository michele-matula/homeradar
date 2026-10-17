import type { HomeRadarDB } from '@/core/db';
import { applyUsage, normalizeUsage, type UsageEvent, type UsageStats } from '@/core/usage';
import type { QueuedFeedback, ReportingStatus } from '@/shared/types';

export const FEEDBACK_QUEUE_MAX = 20;
export const FEEDBACK_QUEUE_FULL = 'Troppi messaggi in attesa di invio: riprova più tardi';

const DEFAULT_STATUS: ReportingStatus = { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false };

/** Dati della misura del pilota in `meta`, fuori dal backup: ID d'installazione, contatori, stato dell'invio, coda dei feedback. */
export class PilotStore {
  constructor(
    private readonly db: HomeRadarDB,
    private readonly clock: () => number = Date.now,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  installId(): Promise<string> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const id = ((await this.db.meta.get('install'))?.value as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string' && id) return id;
      const fresh = this.uuid();
      await this.db.meta.put({ key: 'install', value: { id: fresh } });
      return fresh;
    });
  }

  async usage(): Promise<UsageStats> {
    return normalizeUsage((await this.db.meta.get('usage'))?.value);
  }

  async recordUsage(e: UsageEvent): Promise<void> {
    const now = this.clock();
    await this.db.transaction('rw', this.db.meta, async () => {
      await this.db.meta.put({ key: 'usage', value: applyUsage(await this.usage(), e, now) });
    });
  }

  async reportingStatus(): Promise<ReportingStatus> {
    return { ...DEFAULT_STATUS, ...((await this.db.meta.get('reporting'))?.value as Partial<ReportingStatus> | undefined) };
  }

  updateReporting(fn: (s: ReportingStatus) => void): Promise<ReportingStatus> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const s = await this.reportingStatus();
      fn(s);
      await this.db.meta.put({ key: 'reporting', value: s });
      return s;
    });
  }

  async feedbackQueue(): Promise<QueuedFeedback[]> {
    const v = (await this.db.meta.get('feedbackQueue'))?.value;
    return Array.isArray(v) ? (v as QueuedFeedback[]) : [];
  }

  enqueueFeedback(text: string, version: string): Promise<QueuedFeedback> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const queue = await this.feedbackQueue();
      if (queue.length >= FEEDBACK_QUEUE_MAX) throw new Error(FEEDBACK_QUEUE_FULL);
      const item: QueuedFeedback = { id: this.uuid(), text, createdAt: this.clock(), version };
      await this.db.meta.put({ key: 'feedbackQueue', value: [...queue, item] });
      return item;
    });
  }

  dropFeedback(id: string): Promise<void> {
    return this.db.transaction('rw', this.db.meta, async () => {
      await this.db.meta.put({ key: 'feedbackQueue', value: (await this.feedbackQueue()).filter((q) => q.id !== id) });
    });
  }
}
