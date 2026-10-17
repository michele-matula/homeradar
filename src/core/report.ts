import { warnedPortals } from '@/core/diagnostics';
import { activeRange, type UsageStats } from '@/core/usage';
import type { UsageReport } from '@/shared/report-schema';
import { DAY_MS, PORTALS, type Diagnostics, type LeadView, type Settings } from '@/shared/types';

const MAX_ERRORS = 20;
const MAX_MESSAGE = 200;

/**
 * Toglie da un messaggio d'errore ciò che potrebbe venire da un annuncio: URL, percorsi di file, testi tra
 * virgolette (i valori "received" di zod), numeri di 4 o più cifre. Restano indici brevi e percorsi dei campi.
 */
export function sanitizeError(message: string): string {
  return message
    .replace(/\b(?:https?|chrome-extension):\/\/\S+/g, '<url>')
    .replace(/\b[A-Za-z]:\\[^\s'"«»]*/g, '<path>')
    .replace(/\/(?:Users|home)\/[^\s'"«»]*/g, '<path>')
    // Un apostrofo dopo una lettera (dell'informativa) non apre una citazione.
    .replace(/(^|[^\p{L}\p{N}])(?:'[^']*'|"[^"]*"|`[^`]*`)/gu, '$1<testo>')
    .replace(/«[^»]*»/g, '<testo>')
    .replace(/\d[\d.,]*\d|\d/g, (m) => (m.replace(/\D/g, '').length >= 4 ? '#' : m))
    .slice(0, MAX_MESSAGE);
}

export interface ReportInput {
  installId: string;
  pilotCode: string;
  version: string;
  settings: Settings;
  usage: UsageStats;
  diagnostics: Diagnostics;
  /** Lead come li mostra il pannello: un gruppo vale uno. */
  leads: LeadView[];
  now: number;
  timezoneOffset: number;
}

export function buildReport(i: ReportInput): UsageReport {
  const byPortal = Object.fromEntries(PORTALS.map((p) => [p, 0])) as UsageReport['leads']['byPortal'];
  const byPriority: UsageReport['leads']['byPriority'] = { high: 0, medium: 0, verify: 0, none: 0 };
  let newLast7Days = 0;
  for (const l of i.leads) {
    byPortal[l.listing.portal] += 1;
    byPriority[l.evaluation.priority] += 1;
    const firstSeen = Math.min(l.listing.firstSeenAt, ...l.others.map((o) => o.listing.firstSeenAt));
    if (firstSeen >= i.now - 7 * DAY_MS) newLast7Days += 1;
  }
  const range = activeRange(i.usage);
  return {
    formatVersion: 1,
    installId: i.installId,
    pilotCode: i.pilotCode,
    version: i.version,
    sentAt: i.now,
    timezoneOffset: i.timezoneOffset,
    enabledPortals: PORTALS.filter((p) => i.settings.enabledPortals[p]),
    usage: { ...i.usage, firstActiveDay: range.first, lastActiveDay: range.last },
    leads: { total: i.leads.length, byPortal, byPriority, newLast7Days },
    technical: {
      counters: { ...i.diagnostics.counters },
      adapterWarning: warnedPortals(i.diagnostics.adapterWarning),
      errors: i.diagnostics.errors.slice(-MAX_ERRORS).map((e) => ({ at: e.at, message: sanitizeError(e.message) })),
    },
  };
}
