import type { Evaluation, Priority } from '@/shared/types';

export const BADGE_ATTR = 'data-homeradar-badge';

// Tutte le proprietà vengono impostate con !important: il CSS del sito (es. i figli del
// contenitore foto stirati a tutta larghezza prima del lazy-load) non deve deformare il badge.
const BASE: Record<string, string> = {
  position: 'absolute', top: '8px', left: '8px', right: 'auto', bottom: 'auto',
  width: 'auto', height: 'auto', 'max-width': 'calc(100% - 16px)', margin: '0', transform: 'none',
  display: 'inline-block', 'box-sizing': 'border-box', overflow: 'hidden', 'text-overflow': 'ellipsis',
  'z-index': '5', 'pointer-events': 'none', padding: '4px 10px', 'border-radius': '999px',
  'border-width': '1px', 'border-style': 'solid', font: "600 12px/1.3 Inter, 'Segoe UI', system-ui, sans-serif", 'white-space': 'nowrap',
  'letter-spacing': '0.01em', 'box-shadow': '0 1px 2px rgba(16,24,40,.12), 0 2px 8px rgba(16,24,40,.18)',
};

const COLORS: Record<Priority, Record<string, string>> = {
  high: { background: '#c0262d', color: '#ffffff', 'border-color': '#a01e24' },
  medium: { background: '#fff4e0', color: '#8a3f04', 'border-color': '#f2cf8c' },
  verify: { background: '#eaf1fd', color: '#1d5fd1', 'border-color': '#b6ccf5' },
  none: { background: '#ffffff', color: '#0f4c5c', 'border-color': '#cdd5db' },
};

function findCard(root: ParentNode, portalId: number): HTMLElement | null {
  const anchor = root.querySelector<HTMLAnchorElement>(`a[href*="/annunci/${portalId}/"]`);
  return anchor?.closest('li') ?? null;
}

export function renderBadge(root: ParentNode, ev: Evaluation): 'created' | 'updated' | 'unchanged' | 'no-card' {
  const card = findCard(root, ev.portalId);
  if (!card) return 'no-card';

  let badge = card.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  if (badge && badge.textContent === ev.badgeText && badge.dataset.priority === ev.priority) return 'unchanged';

  let result: 'created' | 'updated' = 'updated';
  if (!badge) {
    const img = card.querySelector('img');
    const host = (img?.closest<HTMLElement>('.nd-slideshow__content') ?? img?.parentElement ?? card) as HTMLElement;
    const pos = host.ownerDocument.defaultView?.getComputedStyle(host).position;
    if (!pos || pos === 'static') host.style.position = 'relative';
    badge = host.ownerDocument.createElement('span');
    badge.setAttribute(BADGE_ATTR, '');
    host.append(badge);
    result = 'created';
  }
  badge.textContent = ev.badgeText;
  badge.dataset.priority = ev.priority;
  for (const [prop, value] of Object.entries({ ...BASE, ...COLORS[ev.priority] })) {
    badge.style.setProperty(prop, value, 'important');
  }
  return result;
}
