import type { Priority } from '@/shared/types';

/** Aspetto del badge, senza posizionamento: lo usano i badge sulle pagine e la legenda dell'informativa. */
export const BADGE_LOOK: Record<string, string> = {
  display: 'inline-block', 'box-sizing': 'border-box', padding: '4px 10px', 'border-radius': '999px',
  'border-width': '1px', 'border-style': 'solid', font: "600 12px/1.3 Inter, 'Segoe UI', system-ui, sans-serif", 'white-space': 'nowrap',
  'letter-spacing': '0.01em', 'box-shadow': '0 1px 2px rgba(16,24,40,.12), 0 2px 8px rgba(16,24,40,.18)',
};

export const BADGE_COLORS: Record<Priority, Record<string, string>> = {
  high: { background: '#c0262d', color: '#ffffff', 'border-color': '#a01e24' },
  medium: { background: '#fff4e0', color: '#8a3f04', 'border-color': '#f2cf8c' },
  verify: { background: '#eaf1fd', color: '#1d5fd1', 'border-color': '#b6ccf5' },
  none: { background: '#ffffff', color: '#0f4c5c', 'border-color': '#cdd5db' },
};

/** Da proprietà CSS ("border-color") a stile React ("borderColor"). */
export function toReactStyle(css: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(css).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}
