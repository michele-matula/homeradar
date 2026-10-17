import { buildReport } from '@/core/report';
import type { UsageStats } from '@/core/usage';
import { FEEDBACK_MAX, UsageReportSchema, type FeedbackPayload, type UsageReport } from '@/shared/report-schema';
import type { Diagnostics, LeadView, QueuedFeedback, ReportingInfo, ReportingStatus, Settings } from '@/shared/types';

export const REPORT_MIN_GAP_MS = 20 * 3600_000;
export const REPORT_TIMEOUT_MS = 15_000;
export const FEEDBACK_EMPTY = 'Scrivi il messaggio prima di inviarlo';
export const FEEDBACK_TOO_LONG = `Il messaggio supera ${FEEDBACK_MAX} caratteri`;
export const NOT_CONFIGURED = 'Invio non configurato in questa versione';
export const NO_PILOT_CODE = 'Inserisci il codice pilota nelle impostazioni';

export interface ReporterDeps {
  /** URL del Worker dalla build; vuota = invio spento. */
  url: string;
  version: string;
  now(): number;
  timezoneOffset(): number;
  fetch: typeof fetch;
  settings(): Promise<Settings>;
  onboardingAccepted(): Promise<boolean>;
  installId(): Promise<string>;
  usage(): Promise<UsageStats>;
  diagnostics(): Promise<Diagnostics>;
  leads(): Promise<LeadView[]>;
  status(): Promise<ReportingStatus>;
  updateStatus(fn: (s: ReportingStatus) => void): Promise<ReportingStatus>;
  queue(): Promise<QueuedFeedback[]>;
  enqueue(text: string): Promise<QueuedFeedback>;
  dropFeedback(id: string): Promise<void>;
  recordError(message: string): Promise<void>;
}

export interface Reporter {
  info(): Promise<ReportingInfo>;
  /** Il report che partirebbe adesso, già ripulito. */
  preview(): Promise<UsageReport>;
  sendReport(trigger: 'alarm' | 'startup' | 'manual'): Promise<ReportingInfo>;
  sendFeedback(text: string): Promise<'sent' | 'queued'>;
  flushFeedback(): Promise<void>;
}

type PostResult = { kind: 'ok' } | { kind: 'http'; status: number } | { kind: 'network' };

export function createReporter(d: ReporterDeps): Reporter {
  const endpoint = (path: string) => `${d.url.replace(/\/?$/, '/')}${path}`;
  let running: Promise<ReportingInfo> | null = null;

  async function post(path: string, body: unknown): Promise<PostResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REPORT_TIMEOUT_MS);
    try {
      const res = await d.fetch(endpoint(path), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      return res.ok ? { kind: 'ok' } : { kind: 'http', status: res.status };
    } catch {
      return { kind: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function info(): Promise<ReportingInfo> {
    return { configured: d.url !== '', status: await d.status(), queued: (await d.queue()).length };
  }

  async function preview(): Promise<UsageReport> {
    const settings = await d.settings();
    return buildReport({
      installId: await d.installId(), pilotCode: settings.pilotCode, version: d.version, settings,
      usage: await d.usage(), diagnostics: await d.diagnostics(), leads: await d.leads(), now: d.now(), timezoneOffset: d.timezoneOffset(),
    });
  }

  async function flushFeedback(): Promise<void> {
    const settings = await d.settings();
    if (!d.url || !settings.pilotCode) return;
    const installId = await d.installId();
    for (const q of await d.queue()) {
      const body: FeedbackPayload = { id: q.id, installId, pilotCode: settings.pilotCode, version: q.version, text: q.text, createdAt: q.createdAt };
      const r = await post('feedback', body);
      if (r.kind === 'ok') {
        await d.dropFeedback(q.id);
      } else if (r.kind === 'http' && r.status === 400) {
        // Tenerlo bloccherebbe i messaggi successivi.
        await d.recordError('Feedback rifiutato dal server (HTTP 400)');
        await d.dropFeedback(q.id);
      } else {
        return;
      }
    }
  }

  async function doSend(trigger: 'alarm' | 'startup' | 'manual'): Promise<ReportingInfo> {
    const settings = await d.settings();
    if (!d.url || !settings.reportingEnabled || !settings.pilotCode || !(await d.onboardingAccepted())) return info();
    const before = await d.status();
    if (trigger !== 'manual' && before.codeRejected) return info();
    // Chrome riaccende il worker di continuo: all'avvio si riprova solo se da 20 ore non c'è né un invio né un tentativo.
    const lastTry = Math.max(before.lastSentAt ?? 0, before.lastAttemptAt ?? 0);
    if (trigger === 'startup' && lastTry > 0 && d.now() - lastTry <= REPORT_MIN_GAP_MS) return info();
    const valid = UsageReportSchema.safeParse(await preview());
    if (!valid.success) {
      const now = d.now();
      await d.updateStatus((s) => {
        s.lastAttemptAt = now;
        s.lastError = 'invalid';
      });
      await d.recordError(`Report non valido: ${valid.error.issues.map((i) => i.path.join('.')).join(', ')}`);
      return info();
    }
    const r = await post('report', valid.data);
    const now = d.now();
    await d.updateStatus((s) => {
      s.lastAttemptAt = now;
      if (r.kind === 'ok') Object.assign(s, { lastSentAt: now, lastError: null, codeRejected: false });
      else if (r.kind === 'network') s.lastError = 'network';
      else if (r.status === 401 || r.status === 403) Object.assign(s, { lastError: 'rejected', codeRejected: true });
      else if (r.status >= 500) s.lastError = 'server';
      else s.lastError = 'invalid';
    });
    if (r.kind === 'http' && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403) {
      await d.recordError(`Report rifiutato dal server (HTTP ${r.status})`);
    }
    await flushFeedback();
    return info();
  }

  return {
    info,
    preview,
    flushFeedback,
    sendReport(trigger) {
      // Allarme e avvio possono arrivare insieme: un solo invio alla volta.
      running ??= doSend(trigger).finally(() => {
        running = null;
      });
      return running;
    },
    async sendFeedback(text) {
      const t = text.trim();
      if (!t) throw new Error(FEEDBACK_EMPTY);
      if (t.length > FEEDBACK_MAX) throw new Error(FEEDBACK_TOO_LONG);
      if (!d.url) throw new Error(NOT_CONFIGURED);
      if (!(await d.settings()).pilotCode) throw new Error(NO_PILOT_CODE);
      const item = await d.enqueue(t);
      await flushFeedback();
      return (await d.queue()).some((q) => q.id === item.id) ? 'queued' : 'sent';
    },
  };
}
