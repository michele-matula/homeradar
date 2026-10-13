import type { PortalAdapter } from '@/adapters/types';
import { parseDetail, parseSearch } from './parse';
import { isNewestFirst, pageKind } from './urls';

export const idealistaAdapter: PortalAdapter = {
  portal: 'idealista',
  pageKind,
  readDocument(root, url) {
    const kind = pageKind(url);
    if (kind === 'detail') return parseDetail(root, url);
    if (kind !== 'search') return { observations: [], errors: [] };
    const result = parseSearch(root);
    if (isNewestFirst(url) && result.observations.length) {
      result.newestId = Math.max(...result.observations.map((o) => o.portalId));
    }
    return result;
  },
  cardFor: (root, id) => root.querySelector<HTMLElement>(`article.item[data-element-id="${id}"]`),
  badgeHost: (card) => card.querySelector<HTMLElement>('.item-multimedia') ?? card.querySelector('picture')?.parentElement ?? card,
  cardIds: (root) =>
    [...root.querySelectorAll('article.item[data-element-id]')]
      .map((a) => Number(a.getAttribute('data-element-id')))
      .filter((id) => id > 0),
};
