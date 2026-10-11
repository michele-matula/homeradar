import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from '@/core/diagnostics';

describe('formatDiagnostics', () => {
  it('produce un testo senza dati degli annunci', () => {
    const text = formatDiagnostics(
      { version: '0.1.0', counters: { ingested: 50, apiPayloads: 3 }, errors: [{ at: Date.UTC(2026, 9, 10), message: 'result[0]: id Required' }], adapterWarning: true },
      Date.UTC(2026, 9, 10, 12),
    );
    expect(text).toBe([
      'HomeRadar 0.1.0 — report del 10/10/2026',
      'Avviso adattatore: sì',
      'Contatori: apiPayloads=3, ingested=50',
      'Ultimi errori:',
      '- 10/10/2026 result[0]: id Required',
    ].join('\n'));
  });
});
