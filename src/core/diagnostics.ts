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
    'Ultimi errori:',
    ...(d.errors.length ? d.errors.map((e) => `- ${formatDate(e.at)} ${e.message}`) : ['- nessuno']),
  ];
  return lines.join('\n');
}
