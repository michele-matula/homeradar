import type { PortalAdapter } from '@/adapters/types';
import { BADGE_COLORS, BADGE_LOOK } from '@/shared/badge-style';
import type { Evaluation } from '@/shared/types';

export const BADGE_ATTR = 'data-homeradar-badge';

// Tutte le proprietà vengono impostate con !important: il CSS del sito (es. i figli del
// contenitore foto stirati a tutta larghezza prima del lazy-load) non deve deformare il badge.
const BASE: Record<string, string> = {
  position: 'absolute', top: '8px', left: '8px', right: 'auto', bottom: 'auto',
  width: 'auto', height: 'auto', 'max-width': 'calc(100% - 16px)', margin: '0', transform: 'none',
  overflow: 'hidden', 'text-overflow': 'ellipsis', 'z-index': '5', 'pointer-events': 'none',
  ...BADGE_LOOK,
};

export function renderBadge(
  root: ParentNode,
  ev: Evaluation,
  adapter: Pick<PortalAdapter, 'cardFor' | 'badgeHost'>,
): 'created' | 'updated' | 'unchanged' | 'no-card' {
  const card = adapter.cardFor(root, ev.portalId);
  if (!card) return 'no-card';

  let badge = card.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);
  if (badge && badge.textContent === ev.badgeText && badge.dataset.priority === ev.priority) return 'unchanged';

  let result: 'created' | 'updated' = 'updated';
  if (!badge) {
    const host = adapter.badgeHost(card);
    const pos = host.ownerDocument.defaultView?.getComputedStyle(host).position;
    if (!pos || pos === 'static') host.style.position = 'relative';
    badge = host.ownerDocument.createElement('span');
    badge.setAttribute(BADGE_ATTR, '');
    host.append(badge);
    result = 'created';
  }
  badge.textContent = ev.badgeText;
  badge.dataset.priority = ev.priority;
  for (const [prop, value] of Object.entries({ ...BASE, ...BADGE_COLORS[ev.priority] })) {
    badge.style.setProperty(prop, value, 'important');
  }
  return result;
}

/** Toglie tutti i badge di HomeRadar (portale spento dalle impostazioni). */
export function removeBadges(root: ParentNode): void {
  for (const badge of root.querySelectorAll(`[${BADGE_ATTR}]`)) badge.remove();
}
