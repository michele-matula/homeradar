import { describe, expect, it } from 'vitest';
import { buildReport, sanitizeError, type ReportInput } from '@/core/report';
import { EMPTY_USAGE } from '@/core/usage';
import { UsageReportSchema } from '@/shared/report-schema';
import { DEFAULT_SETTINGS, type LeadView, type Portal, type Priority } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 17, 12);
const DAY = 86_400_000;

function lead(portal: Portal, priority: Priority, firstSeenAt: number, others: number[] = []): LeadView {
  const listing = (id: number, seen: number) => ({
    key: `${portal}:${id}`, portal, portalId: id, url: `https://www.${portal}.it/annunci/${id}/`, title: 'Trilocale via Roma 12, Milano',
    address: 'Via Roma 12', city: 'Milano', zone: 'Brera', typology: 'Appartamento', surfaceM2: 80, rooms: 3, currentPrice: 350000,
    portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: seen, lastSeenAt: seen, seenCount: 1,
  });
  const evaluation = { listingKey: `${portal}:1`, portalId: 1, priority, ageDays: 10, ageEstimated: false, ageUncertain: false, dropPercent: 0, dropCount: 0, maxKnownPrice: 350000, reasons: [], badgeText: '' };
  return {
    listing: listing(1, firstSeenAt), evaluation,
    state: { listingKey: `${portal}:1`, status: 'new', notes: 'chiamare il sig. Bianchi 3331234567', statusChangedAt: 0, updatedAt: 0, recallAt: null },
    prices: [], market: null, reposted: false,
    others: others.map((seen, i) => ({ listing: listing(100 + i, seen), evaluation, prices: [], previous: false })),
  };
}

function input(p: Partial<ReportInput> = {}): ReportInput {
  return {
    installId: '7f3c2a8e-1b2d-4c5e-8f90-123456789abc', pilotCode: 'ROSSI-7K2P', version: '0.1.0',
    settings: { ...DEFAULT_SETTINGS, enabledPortals: { immobiliare: true, idealista: false, subito: true } },
    usage: { ...EMPTY_USAGE, browsingDays: ['2026-10-15', '2026-10-17'], panelDays: ['2026-10-16'] },
    diagnostics: { version: '0.1.0', counters: { ingested: 12 }, errors: [], adapterWarning: { idealista: true } },
    leads: [], now: NOW, timezoneOffset: -120, ...p,
  };
}

describe('sanitizeError', () => {
  it.each([
    ['result[3]: price.value Invalid input: expected number, received string', 'result[3]: price.value Invalid input: expected number, received string'],
    ["ads[2]: Invalid option: expected one of 's'|'c'", 'ads[2]: Invalid option: expected one of <testo>|<testo>'],
    ['result[0]: title Invalid input: expected "Trilocale via Roma 12"', 'result[0]: title Invalid input: expected <testo>'],
    ["Apertura dell'informativa: Could not establish connection", "Apertura dell'informativa: Could not establish connection"],
    ['detail: id 128416572 non valido', 'detail: id # non valido'],
    ['prezzo 250.000 € fuori scala', 'prezzo # € fuori scala'],
    ['Fetch fallito https://www.immobiliare.it/annunci/128416572/?x=1', 'Fetch fallito <url>'],
    ['Backup automatico: C:\\Users\\Michele\\Downloads\\HomeRadar\\backup-1.json non scritto', 'Backup automatico: <path> non scritto'],
    ['File /Users/anna/Downloads/x.json mancante', 'File <path> mancante'],
    ['Titolo «Casa al mare» rifiutato', 'Titolo <testo> rifiutato'],
  ])('%s', (raw, clean) => {
    expect(sanitizeError(raw)).toBe(clean);
  });

  it('tronca a 200 caratteri', () => {
    expect(sanitizeError('a'.repeat(500))).toHaveLength(200);
  });
});

describe('buildReport', () => {
  it('produce un report valido con giorni, portali attivi e avvisi', () => {
    const r = buildReport(input());
    expect(UsageReportSchema.parse(r)).toEqual(r);
    expect(r.usage.firstActiveDay).toBe('2026-10-15');
    expect(r.usage.lastActiveDay).toBe('2026-10-17');
    expect(r.enabledPortals).toEqual(['immobiliare', 'subito']);
    expect(r.technical.adapterWarning).toEqual(['idealista']);
    expect(r.technical.counters).toEqual({ ingested: 12 });
    expect(r.sentAt).toBe(NOW);
    expect(r.timezoneOffset).toBe(-120);
  });

  it('conta i lead come li mostra il pannello', () => {
    const leads = [
      lead('immobiliare', 'high', NOW - 2 * DAY, [NOW - 30 * DAY]), // gruppo con un annuncio vecchio: non è nuovo
      lead('subito', 'medium', NOW - 3 * DAY),
      lead('subito', 'none', NOW - 20 * DAY),
    ];
    const r = buildReport(input({ leads }));
    expect(r.leads).toEqual({
      total: 3,
      byPortal: { immobiliare: 1, idealista: 0, subito: 2 },
      byPriority: { high: 1, medium: 1, verify: 0, none: 1 },
      newLast7Days: 1,
    });
  });

  it('ripulisce gli errori e ne tiene al massimo 20', () => {
    const errors = Array.from({ length: 25 }, (_, i) => ({ at: i, message: `result[${i}]: id 12345678 'x'` }));
    const r = buildReport(input({ diagnostics: { version: 'v', counters: {}, errors, adapterWarning: {} } }));
    expect(r.technical.errors).toHaveLength(20);
    expect(r.technical.errors[0]).toEqual({ at: 5, message: 'result[5]: id # <testo>' });
  });

  it('non contiene dati degli annunci', () => {
    const errors = [{ at: 1, message: "Fetch https://www.immobiliare.it/annunci/128416572/ prezzo 350000 titolo 'Trilocale via Roma 12'" }];
    const json = JSON.stringify(buildReport(input({
      leads: [lead('immobiliare', 'high', NOW), lead('subito', 'verify', NOW)],
      diagnostics: { version: 'v', counters: {}, errors, adapterWarning: {} },
    })));
    for (const banned of ['Roma', 'Milano', 'Brera', 'Trilocale', '350000', '3331234567', 'Bianchi', 'annunci', 'http']) expect(json).not.toContain(banned);
    const messages = JSON.stringify(buildReport(input({ diagnostics: { version: 'v', counters: {}, errors, adapterWarning: {} } })).technical.errors);
    expect(messages).not.toMatch(/\d{4}/);
  });
});
