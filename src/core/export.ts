import * as XLSX from 'xlsx';
import { priorityLabel, STATUS_LABELS } from '@/core/leads';
import { isAboveMarket, marketSummary } from '@/core/market';
import { formatLocalDate } from '@/core/recall';
import { formatDate } from '@/shared/format';
import { PORTAL_SITES, type LeadView } from '@/shared/types';

export const EXPORT_COLUMNS = [
  'Priorità', 'Stato', 'Richiamo', 'Portale', 'Titolo', 'Indirizzo', 'Città/Zona', 'Tipologia', 'm²', 'Locali', 'Prezzo attuale',
  'Prezzo massimo noto', 'Calo %', 'Sopra mercato %', 'Confronto mercato', 'Data ultimo ribasso', 'Online da (giorni)', 'Età stimata', 'Prima visita',
  'Ultima visita', 'Note', 'URL',
] as const;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number>;

export function toExportRows(leads: LeadView[]): ExportRow[] {
  return leads.map(({ listing: l, evaluation: e, state: s, market }) => ({
    'Priorità': priorityLabel(e.priority, l.portal),
    'Stato': STATUS_LABELS[s.status],
    'Richiamo': s.recallAt != null ? formatLocalDate(s.recallAt) : '',
    'Portale': PORTAL_SITES[l.portal],
    'Titolo': l.title,
    'Indirizzo': l.address ?? '',
    'Città/Zona': [l.city, l.zone].filter(Boolean).join(' / '),
    'Tipologia': l.typology ?? '',
    'm²': l.surfaceM2 ?? '',
    'Locali': l.rooms ?? '',
    'Prezzo attuale': l.currentPrice ?? '',
    'Prezzo massimo noto': e.maxKnownPrice ?? '',
    'Calo %': e.dropPercent || '',
    'Sopra mercato %': isAboveMarket(market) ? Math.round(market.deltaPercent) : '',
    'Confronto mercato': isAboveMarket(market) ? marketSummary(market) : '',
    'Data ultimo ribasso': l.lastDrop ? formatDate(l.lastDrop.date) : '',
    'Online da (giorni)': e.ageDays ?? '',
    'Età stimata': e.ageDays == null ? '' : e.ageEstimated ? 'sì' : 'no',
    'Prima visita': formatDate(l.firstSeenAt),
    'Ultima visita': formatDate(l.lastSeenAt),
    'Note': s.notes,
    'URL': l.url,
  }));
}

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  // Neutralizza formule (CSV injection) e quota i caratteri speciali.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(';'), ...rows.map((r) => EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(';'))];
  return `﻿${lines.join('\r\n')}`;
}

export function toXlsx(rows: ExportRow[]): Uint8Array {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...EXPORT_COLUMNS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Lead');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

export function exportFileName(ext: 'csv' | 'xlsx', now: number): string {
  return `homeradar-lead-${new Date(now).toISOString().slice(0, 10)}.${ext}`;
}
