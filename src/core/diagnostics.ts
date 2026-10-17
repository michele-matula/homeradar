import { formatDate } from '@/shared/format';
import { PORTAL_SITES, PORTALS, type Diagnostics, type Portal } from '@/shared/types';

/** Portali con l'avviso acceso; un booleano (versioni precedenti) vale per Immobiliare. */
export function warnedPortals(w: Partial<Record<Portal, boolean>> | boolean | undefined): Portal[] {
  if (typeof w === 'boolean') return w ? ['immobiliare'] : [];
  return PORTALS.filter((p) => w?.[p]);
}

export function formatDiagnostics(d: Diagnostics, now: number): string {
  const counters = Object.entries(d.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(', ');
  const warned = warnedPortals(d.adapterWarning).map((p) => PORTAL_SITES[p]);
  const lines = [
    `HomeRadar ${d.version} — report del ${formatDate(now)}`,
    `Avviso adattatore: ${warned.length ? warned.join(', ') : 'no'}`,
    `Contatori: ${counters || 'nessuno'}`,
  ];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (d.usage) {
    const u = d.usage;
    lines.push(`Uso: ${[
      `navigazione ${plural(u.browsingDays.length, 'giorno', 'giorni')}`,
      `pannello ${plural(u.panelDays.length, 'giorno', 'giorni')}`,
      ...Object.entries(u.statusChanges).map(([k, v]) => `${k}=${v}`),
      `richiami ${u.recallsSet}`,
      `note ${u.notesWritten}`,
      `export xlsx=${u.exports.xlsx} csv=${u.exports.csv}`,
    ].join(', ')}`);
  }
  if (d.reporting) {
    const { configured, status: s, queued } = d.reporting;
    const parts = !configured ? ['non configurato'] : [
      s.lastSentAt ? `ultimo il ${formatDate(s.lastSentAt)}` : 'mai',
      ...(s.lastError ? [`ultimo errore ${s.lastError}`] : []),
      ...(queued ? [`feedback in coda ${queued}`] : []),
    ];
    lines.push(`Invio: ${parts.join('; ')}`);
  }
  lines.push('Ultimi errori:', ...(d.errors.length ? d.errors.map((e) => `- ${formatDate(e.at)} ${e.message}`) : ['- nessuno']));
  return lines.join('\n');
}
