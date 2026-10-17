import { describe, expect, it } from 'vitest';
import { FEEDBACK_QUEUE_FULL, FEEDBACK_QUEUE_MAX } from '@/core/pilot-store';
import { obs, setup } from './helpers';

describe('PilotStore', () => {
  it("crea l'ID di installazione una volta sola", async () => {
    const { svc } = setup();
    const id = await svc.pilot.installId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await svc.pilot.installId()).toBe(id);
  });

  it("registra gli eventi d'uso", async () => {
    const { svc } = setup();
    await svc.pilot.recordUsage({ kind: 'panel' });
    await svc.pilot.recordUsage({ kind: 'export', format: 'csv' });
    const u = await svc.pilot.usage();
    expect(u.panelDays).toHaveLength(1);
    expect(u.exports).toEqual({ xlsx: 0, csv: 1 });
  });

  it("stato dell'invio: default e aggiornamento", async () => {
    const { svc } = setup();
    expect(await svc.pilot.reportingStatus()).toEqual({ lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false });
    const s = await svc.pilot.updateReporting((r) => { r.codeRejected = true; });
    expect(s.codeRejected).toBe(true);
    expect((await svc.pilot.reportingStatus()).codeRejected).toBe(true);
  });

  it('coda dei feedback con limite', async () => {
    const { svc, now } = setup();
    const f = await svc.pilot.enqueueFeedback('Ottimo', '0.1.0');
    expect(f).toMatchObject({ text: 'Ottimo', version: '0.1.0', createdAt: now() });
    for (let i = 1; i < FEEDBACK_QUEUE_MAX; i++) await svc.pilot.enqueueFeedback(`m${i}`, 'v');
    await expect(svc.pilot.enqueueFeedback('troppo', 'v')).rejects.toThrow(FEEDBACK_QUEUE_FULL);
    await svc.pilot.dropFeedback(f.id);
    expect((await svc.pilot.feedbackQueue()).map((q) => q.text)[0]).toBe('m1');
  });

  it('setLeadState conta una volta per gruppo e non fallisce se i contatori non si scrivono', async () => {
    const { svc } = setup();
    await svc.ingest([obs({ portalId: 1, url: 'https://www.immobiliare.it/annunci/1/' }), obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/' })]);
    await svc.setLeadState(['immobiliare:1', 'immobiliare:2'], { status: 'contacted', notes: 'ok' });
    expect((await svc.pilot.usage()).statusChanges).toEqual({ contacted: 1 });
    expect((await svc.pilot.usage()).notesWritten).toBe(1);
    svc.pilot.recordUsage = async () => { throw new Error('quota'); };
    await expect(svc.setLeadState(['immobiliare:1'], { status: 'discarded' })).resolves.toMatchObject({ status: 'discarded' });
    expect((await svc.getDiagnostics('v')).errors.at(-1)?.message).toBe("Contatori d'uso: quota");
  });
});
