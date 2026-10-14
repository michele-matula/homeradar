import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { EXPORT_COLUMNS, exportFileName, toCsv, toExportRows, toXlsx } from '@/core/export';
import type { LeadView } from '@/shared/types';

const lead: LeadView = {
  listing: {
    key: 'immobiliare:128416572', portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/',
    title: 'Bilocale via Esempio 1, Precotto, Milano', address: 'Via Esempio', city: 'Milano', zone: 'Precotto',
    typology: 'Appartamento', surfaceM2: 62, rooms: 2, currentPrice: 235000, portalCreatedAt: null,
    estimatedCreatedAt: Date.UTC(2026, 3, 20), lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) },
    firstSeenAt: Date.UTC(2026, 9, 1), lastSeenAt: Date.UTC(2026, 9, 10), seenCount: 3,
  },
  evaluation: {
    listingKey: 'immobiliare:128416572', portalId: 128416572, priority: 'high', ageDays: 173, ageEstimated: true, ageUncertain: false,
    dropPercent: 5.6, dropCount: 1, maxKnownPrice: 249000, reasons: [], badgeText: '',
  },
  state: { listingKey: 'immobiliare:128416572', status: 'to_contact', notes: 'chiamare la sera', statusChangedAt: 0, updatedAt: 0 },
  prices: [],
};

describe('toExportRows', () => {
  it('mappa tutte le colonne', () => {
    expect(toExportRows([lead])).toEqual([{
      'Priorità': 'Alta', 'Stato': 'Da contattare', 'Portale': 'Immobiliare.it', 'Titolo': 'Bilocale via Esempio 1, Precotto, Milano',
      'Indirizzo': 'Via Esempio', 'Città/Zona': 'Milano / Precotto', 'Tipologia': 'Appartamento', 'm²': 62, 'Locali': 2,
      'Prezzo attuale': 235000, 'Prezzo massimo noto': 249000, 'Calo %': 5.6, 'Data ultimo ribasso': '21/09/2026',
      'Online da (giorni)': 173, 'Età stimata': 'sì', 'Prima visita': '01/10/2026', 'Ultima visita': '10/10/2026',
      'Note': 'chiamare la sera', 'URL': 'https://www.immobiliare.it/annunci/128416572/',
    }]);
    expect(Object.keys(toExportRows([lead])[0]!)).toEqual([...EXPORT_COLUMNS]);
  });
});

describe('toExportRows per Idealista', () => {
  it('chiama "Età incerta" la priorità da verificare', () => {
    const idealista: LeadView = {
      ...lead,
      listing: { ...lead.listing, key: 'idealista:1', portal: 'idealista' },
      evaluation: { ...lead.evaluation, priority: 'verify' },
    };
    expect(toExportRows([idealista])[0]).toMatchObject({ 'Priorità': 'Età incerta', 'Portale': 'Idealista.it' });
  });
});

describe('toCsv', () => {
  it('usa ; come separatore, BOM UTF-8 e virgola decimale', () => {
    const csv = toCsv(toExportRows([lead]));
    expect(csv.startsWith('﻿Priorità;Stato;Portale;Titolo;')).toBe(true);
    expect(csv).toContain(';5,6;');
    expect(csv.split('\r\n')).toHaveLength(2);
  });

  it('quota i testi ostili e neutralizza le formule', () => {
    const hostile = { ...lead, state: { ...lead.state, notes: '=HYPERLINK("http://x")' }, listing: { ...lead.listing, title: 'Via "A"; scala B\nint. 3' } };
    const row = toCsv(toExportRows([hostile])).split('\r\n')[1]!;
    expect(row).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(row).toContain('"Via ""A""; scala B\nint. 3"');
    for (const bad of ['+1', '-1', '@x']) {
      const r = toCsv(toExportRows([{ ...lead, state: { ...lead.state, notes: bad } }])).split('\r\n')[1]!;
      expect(r).toContain(`;'${bad};`);
    }
  });
});

describe('toXlsx', () => {
  it('produce un file leggibile con le stesse righe', () => {
    const wb = XLSX.read(toXlsx(toExportRows([lead])), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Lead']!);
    expect(rows[0]).toMatchObject({ 'Priorità': 'Alta', 'Prezzo attuale': 235000, 'Note': 'chiamare la sera' });
  });
});

describe('exportFileName', () => {
  it('include la data', () => {
    expect(exportFileName('xlsx', Date.UTC(2026, 9, 10))).toBe('homeradar-lead-2026-10-10.xlsx');
  });
});
