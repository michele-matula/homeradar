import type { Evaluation, Priority } from '@/shared/types';

export const BADGE_ATTR = 'data-homeradar-badge';

const BASE: Partial<CSSStyleDeclaration> = {
  position: 'absolute', top: '8px', left: '8px', zIndex: '5', pointerEvents: 'none',
  padding: '3px 8px', borderRadius: '999px', borderWidth: '1px', borderStyle: 'solid',
  font: '600 12px/1.3 system-ui, sans-serif', whiteSpace: 'nowrap',
};

const COLORS: Record<Priority, Partial<CSSStyleDeclaration>> = {
  high: { background: '#fde2e1', color: '#a4161a', borderColor: '#f5a3a0' },
  medium: { background: '#fff1d6', color: '#8a5300', borderColor: '#f3c77a' },
  verify: { background: '#e7eefc', color: '#1d4ed8', borderColor: '#a9c1f5' },
  none: { background: '#f1f1f1', color: '#555555', borderColor: '#dddddd' },
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
  Object.assign(badge.style, BASE, COLORS[ev.priority]);
  return result;
}
