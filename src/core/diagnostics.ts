import { formatDate } from '@/shared/format';
import type { Diagnostics } from '@/shared/types';

export function formatDiagnostics(d: Diagnostics, now: number): string {
  const counters = Object.entries(d.counters).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(', ');
  const lines = [
    `HomeRadar ${d.version} — report del ${formatDate(now)}`,
    `Avviso adattatore: ${d.adapterWarning ? 'sì' : 'no'}`,
    `Contatori: ${counters || 'nessuno'}`,
    'Ultimi errori:',
    ...(d.errors.length ? d.errors.map((e) => `- ${formatDate(e.at)} ${e.message}`) : ['- nessuno']),
  ];
  return lines.join('\n');
}
