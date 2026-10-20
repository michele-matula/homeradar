import type { PortalAdapter } from '@/adapters/types';
import { hasNextPage, ownCards, parseSearch } from './parse';
import { listingIdFromHref, pageKind } from './urls';

const idOf = (card: Element) => listingIdFromHref(card.querySelector('h3 a[href]')?.getAttribute('href') ?? '');

export const casadaprivatoAdapter: PortalAdapter = {
  portal: 'casadaprivato',
  pageKind,
  readDocument(root, url) {
    if (pageKind(url) !== 'search') return { observations: [], errors: [] };
    const result = parseSearch(root, url);
    // Senza l'elenco (pagina inesistente) la pagina non chiude la ricerca.
    if (root.querySelector('#property-listing')) {
      const n = ownCards(root).length;
      result.page = { results: n, privates: n, lastPage: !hasNextPage(root, url) };
    }
    return result;
  },
  cardFor: (root, id) => (ownCards(root).find((c) => idOf(c) === id) as HTMLElement | undefined) ?? null,
  badgeHost: (card) => card.querySelector<HTMLElement>('.image') ?? card,
  cardIds: (root) => ownCards(root).map(idOf).filter((id): id is number => id != null && id > 0),
};
