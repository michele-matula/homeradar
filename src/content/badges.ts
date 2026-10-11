import type { Evaluation, Priority } from '@/shared/types';

export const BADGE_ATTR = 'data-homeradar-badge';

// Tutte le proprietà vengono impostate con !important: il CSS del sito (es. i figli del
// contenitore foto stirati a tutta larghezza prima del lazy-load) non deve deformare il badge.
const BASE: Record<string, string> = {
  position: 'absolute', top: '8px', left: '8px', right: 'auto', bottom: 'auto',
  width: 'auto', height: 'auto', 'max-width': 'calc(100% - 16px)', margin: '0', transform: 'none',
  display: 'inline-block', 'box-sizing': 'border-box', overflow: 'hidden', 'text-overflow': 'ellipsis',
  'z-index': '5', 'pointer-events': 'none', padding: '3px 8px', 'border-radius': '999px',
  'border-width': '1px', 'border-style': 'solid', font: '600 12px/1.3 system-ui, sans-serif', 'white-space': 'nowrap',
};

const COLORS: Record<Priority, Record<string, string>> = {
  high: { background: '#fde2e1', color: '#a4161a', 'border-color': '#f5a3a0' },
  medium: { background: '#fff1d6', color: '#8a5300', 'border-color': '#f3c77a' },
  verify: { background: '#e7eefc', color: '#1d4ed8', 'border-color': '#a9c1f5' },
  none: { background: '#f1f1f1', color: '#555555', 'border-color': '#dddddd' },
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
