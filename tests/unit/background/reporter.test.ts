import { describe, expect, it, vi } from 'vitest';
import { createReporter, FEEDBACK_EMPTY, FEEDBACK_TOO_LONG, NO_PILOT_CODE, NOT_CONFIGURED, REPORT_MIN_GAP_MS, type ReporterDeps } from '@/background/reporter';
import { EMPTY_USAGE } from '@/core/usage';
import { DEFAULT_SETTINGS, type QueuedFeedback, type ReportingStatus, type Settings } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 17, 12);

type Options = Partial<Omit<ReporterDeps, 'settings'>> & { settings?: Partial<Settings>; responses?: (number | 'network' | 'timeout')[] };

function deps(p: Options = {}) {
  const { settings: overrides, responses: planned, ...rest } = p;
  let status: ReportingStatus = { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false };
  let queue: QueuedFeedback[] = [];
  const responses = [...(planned ?? [])];
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = responses.shift() ?? 204;
    if (r === 'network') throw new TypeError('Failed to fetch');
    if (r === 'timeout') throw new DOMException('aborted', 'AbortError');
    return new Response(null, { status: r });
  });
  let n = 0;
  const d: ReporterDeps = {
    url: 'https://pilot.example.workers.dev/',
    version: '0.1.0',
    now: () => NOW,
    timezoneOffset: () => -120,
    fetch: fetchFn as unknown as typeof fetch,
    settings: async () => ({ ...DEFAULT_SETTINGS, pilotCode: 'ROSSI-7K2P', ...overrides }),
    onboardingAccepted: async () => true,
    installId: async () => '7f3c2a8e-1b2d-4c5e-8f90-123456789abc',
    usage: async () => EMPTY_USAGE,
    diagnostics: async () => ({ version: '0.1.0', counters: {}, errors: [], adapterWarning: {} }),
    leads: async () => [],
    status: async () => status,
    updateStatus: async (fn) => { status = { ...status }; fn(status); return status; },
    queue: async () => queue,
    enqueue: async (text) => {
      const q = { id: `00000000-0000-4000-8000-00000000000${++n}`, text, createdAt: NOW, version: '0.1.0' };
      queue = [...queue, q];
      return q;
    },
    dropFeedback: async (id) => { queue = queue.filter((q) => q.id !== id); },
    recordError: vi.fn(async () => {}),
    ...rest,
  };
  return { d, calls, fetchFn, getQueue: () => queue, setStatus: (s: Partial<ReportingStatus>) => { status = { ...status, ...s }; } };
}

describe('reporter', () => {
  it('invia il report e registra il successo', async () => {
    const t = deps();
    const info = await createReporter(t.d).sendReport('alarm');
    expect(t.calls[0]!.url).toBe('https://pilot.example.workers.dev/report');
    expect(t.calls[0]!.body).toMatchObject({ formatVersion: 1, pilotCode: 'ROSSI-7K2P' });
    expect(info.status).toMatchObject({ lastSentAt: NOW, lastAttemptAt: NOW, lastError: null, codeRejected: false });
  });

  it.each<[string, Options]>([
    ['URL vuota', { url: '' }],
    ['informativa da confermare', { onboardingAccepted: async () => false }],
    ['interruttore spento', { settings: { reportingEnabled: false } }],
    ['codice vuoto', { settings: { pilotCode: '' } }],
  ])('non invia con %s', async (_n, p) => {
    const t = deps(p);
    await createReporter(t.d).sendReport('manual');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('403 segna il codice rifiutato e blocca gli invii automatici, non quello manuale', async () => {
    const t = deps({ responses: [403, 204] });
    const r = createReporter(t.d);
    expect((await r.sendReport('alarm')).status).toMatchObject({ codeRejected: true, lastError: 'rejected', lastSentAt: null });
    await r.sendReport('alarm');
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
    expect((await r.sendReport('manual')).status).toMatchObject({ codeRejected: false, lastSentAt: NOW });
  });

  it.each([
    [400, 'invalid'],
    [500, 'server'],
    ['network', 'network'],
    ['timeout', 'network'],
  ] as const)('esito %s → lastError %s', async (resp, err) => {
    const t = deps({ responses: [resp] });
    const info = await createReporter(t.d).sendReport('alarm');
    expect(info.status).toMatchObject({ lastError: err, lastSentAt: null, lastAttemptAt: NOW, codeRejected: false });
    if (resp === 400) expect(t.d.recordError).toHaveBeenCalledWith('Report rifiutato dal server (HTTP 400)');
  });

  it("all'avvio invia solo se l'ultimo invio ha più di 20 ore", async () => {
    const t = deps();
    t.setStatus({ lastSentAt: NOW - REPORT_MIN_GAP_MS + 1 });
    await createReporter(t.d).sendReport('startup');
    expect(t.fetchFn).not.toHaveBeenCalled();
    t.setStatus({ lastSentAt: NOW - REPORT_MIN_GAP_MS - 1 });
    await createReporter(t.d).sendReport('startup');
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('due invii contemporanei fanno un solo POST', async () => {
    const t = deps();
    const r = createReporter(t.d);
    await Promise.all([r.sendReport('alarm'), r.sendReport('startup')]);
    expect(t.calls.filter((c) => c.url.endsWith('/report'))).toHaveLength(1);
  });

  it("il feedback parte subito, anche con l'invio statistiche spento", async () => {
    const t = deps({ settings: { reportingEnabled: false } });
    expect(await createReporter(t.d).sendFeedback('  Molto utile  ')).toBe('sent');
    expect(t.calls[0]!.url).toBe('https://pilot.example.workers.dev/feedback');
    expect(t.calls[0]!.body).toMatchObject({ text: 'Molto utile', pilotCode: 'ROSSI-7K2P', installId: '7f3c2a8e-1b2d-4c5e-8f90-123456789abc', version: '0.1.0' });
    expect(t.getQueue()).toEqual([]);
  });

  it('feedback senza rete resta in coda e parte dopo il report successivo, in ordine', async () => {
    const t = deps({ responses: ['network', 'network', 204, 204, 204] });
    const r = createReporter(t.d);
    expect(await r.sendFeedback('primo')).toBe('queued');
    // Accodando il secondo si riprova il primo: fallisce di nuovo e lo svuotamento si ferma.
    expect(await r.sendFeedback('secondo')).toBe('queued');
    await r.sendReport('manual');
    expect(t.calls.slice(2).map((c) => (c.body as { text?: string }).text ?? 'report')).toEqual(['report', 'primo', 'secondo']);
    expect(t.getQueue()).toEqual([]);
  });

  it('un feedback rifiutato (400) esce dalla coda, 429 ferma lo svuotamento', async () => {
    const t = deps({ responses: [400, 429] });
    const r = createReporter(t.d);
    await t.d.enqueue('a');
    await t.d.enqueue('b');
    await t.d.enqueue('c');
    await r.flushFeedback();
    expect(t.getQueue().map((q) => q.text)).toEqual(['b', 'c']);
    expect(t.d.recordError).toHaveBeenCalledWith('Feedback rifiutato dal server (HTTP 400)');
  });

  it('403 ferma lo svuotamento della coda', async () => {
    const t = deps({ responses: [403] });
    await t.d.enqueue('a');
    await t.d.enqueue('b');
    await createReporter(t.d).flushFeedback();
    expect(t.getQueue().map((q) => q.text)).toEqual(['a', 'b']);
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('valida il testo e la configurazione del feedback', async () => {
    await expect(createReporter(deps().d).sendFeedback('   ')).rejects.toThrow(FEEDBACK_EMPTY);
    await expect(createReporter(deps().d).sendFeedback('x'.repeat(2001))).rejects.toThrow(FEEDBACK_TOO_LONG);
    await expect(createReporter(deps({ url: '' }).d).sendFeedback('ok')).rejects.toThrow(NOT_CONFIGURED);
    await expect(createReporter(deps({ settings: { pilotCode: '' } }).d).sendFeedback('ok')).rejects.toThrow(NO_PILOT_CODE);
  });

  it('info e anteprima', async () => {
    const t = deps();
    await t.d.enqueue('x');
    const r = createReporter(t.d);
    expect(await r.info()).toMatchObject({ configured: true, queued: 1 });
    expect((await r.preview()).pilotCode).toBe('ROSSI-7K2P');
    expect((await createReporter(deps({ url: '' }).d).info()).configured).toBe(false);
  });
});
