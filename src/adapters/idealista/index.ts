import type { PortalAdapter } from '@/adapters/types';
import { CARD_SELECTOR, hasNextPage, parseDetail, parseSearch } from './parse';
import { isNewestFirst, pageKind } from './urls';

export const idealistaAdapter: PortalAdapter = {
  portal: 'idealista',
  pageKind,
  readDocument(root, url) {
    const kind = pageKind(url);
    if (kind === 'detail') return parseDetail(root, url);
    if (kind !== 'search') return { observations: [], errors: [] };
    const result = parseSearch(root);
    // Senza l'elenco dei risultati (verifica di DataDome, pagina inesistente) la pagina non chiude la ricerca.
    if (root.querySelector('.items-container')) result.page = {
      results: result.observations.length,
      privates: result.observations.filter((o) => o.sellerType === 'private').length,
      lastPage: !hasNextPage(root, url),
    };
    if (isNewestFirst(url) && result.observations.length) {
      result.newestId = Math.max(...result.observations.map((o) => o.portalId));
    }
    return result;
  },
  cardFor: (root, id) => root.querySelector<HTMLElement>(`${CARD_SELECTOR}[data-element-id="${id}"]`),
  badgeHost: (card) => card.querySelector<HTMLElement>('.item-multimedia') ?? card.querySelector('picture')?.parentElement ?? card,
  cardIds: (root) =>
    [...root.querySelectorAll(`${CARD_SELECTOR}[data-element-id]`)]
      .map((a) => Number(a.getAttribute('data-element-id')))
      .filter((id) => id > 0),
};
