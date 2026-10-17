import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '@/core/diagnostics';

describe('formatDiagnostics', () => {
  it('produce un testo senza dati degli annunci', () => {
    const text = formatDiagnostics(
      { version: '0.1.0', counters: { ingested: 50, apiPayloads: 3 }, errors: [{ at: Date.UTC(2026, 9, 10), message: 'result[0]: id Required' }], adapterWarning: { immobiliare: true } },
      Date.UTC(2026, 9, 10, 12),
    );
    expect(text).toBe([
      'HomeRadar 0.1.0 — report del 10/10/2026',
      'Avviso adattatore: Immobiliare.it',
      'Contatori: apiPayloads=3, ingested=50',
      'Ultimi errori:',
      '- 10/10/2026 result[0]: id Required',
    ].join('\n'));
  });

  it('elenca i portali con avviso e dice "no" senza avvisi', () => {
    const base = { version: 'v', counters: {}, errors: [] };
    expect(formatDiagnostics({ ...base, adapterWarning: { immobiliare: true, idealista: true } }, 0)).toContain('Avviso adattatore: Immobiliare.it, Idealista.it');
    expect(formatDiagnostics({ ...base, adapterWarning: { immobiliare: false } }, 0)).toContain('Avviso adattatore: no');
  });
  it('aggiunge uso e invio quando ci sono', () => {
    const text = formatDiagnostics({
      version: '0.1.0', counters: {}, errors: [], adapterWarning: {},
      usage: { browsingDays: ['2026-10-15', '2026-10-16'], panelDays: ['2026-10-16'], statusChanges: { contacted: 3, discarded: 1 }, recallsSet: 2, notesWritten: 4, exports: { xlsx: 1, csv: 0 } },
      reporting: { configured: true, queued: 1, status: { lastSentAt: Date.UTC(2026, 9, 16, 8), lastAttemptAt: Date.UTC(2026, 9, 16, 8), lastError: null, codeRejected: false } },
    }, Date.UTC(2026, 9, 17, 12));
    expect(text).toContain('Uso: navigazione 2 giorni, pannello 1 giorno, contacted=3, discarded=1, richiami 2, note 4, export xlsx=1 csv=0');
    expect(text).toContain('Invio: ultimo il 16/10/2026; feedback in coda 1');
    expect(text.indexOf('Invio:')).toBeLessThan(text.indexOf('Ultimi errori:'));
  });

  it("descrive gli stati dell'invio", () => {
    const base = { version: 'v', counters: {}, errors: [], adapterWarning: {} };
    const st = { lastSentAt: null, lastAttemptAt: 5, lastError: 'network' as const, codeRejected: false };
    expect(formatDiagnostics({ ...base, reporting: { configured: false, queued: 0, status: st } }, 0)).toContain('Invio: non configurato');
    expect(formatDiagnostics({ ...base, reporting: { configured: true, queued: 0, status: st } }, 0)).toContain('Invio: mai; ultimo errore network');
  });
});
