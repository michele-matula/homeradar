export function formatEuro(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatPercent(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDayMonth(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

export function formatDate(ms: number): string {
  return `${formatDayMonth(ms)}/${new Date(ms).getUTCFullYear()}`;
}

/** "A", "A e B", "A, B e C". */
export function joinList(items: string[], conj: 'e' | 'o'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conj} ${items.at(-1)}`;
}
