import type { PageKind } from '@/shared/types';

const BASE = 'https://www.idealista.it';

function urlOf(url: string): URL | null {
  try {
    return new URL(url, BASE);
  } catch {
    return null;
  }
}

export function pageKind(url: string): PageKind {
  const path = urlOf(url)?.pathname ?? '';
  if (/^\/immobile\/\d+\/?$/.test(path)) return 'detail';
  if (/^\/vendita-[a-z-]+\//.test(path)) return 'search';
  return 'other';
}

export function listingIdFromHref(href: string): number | null {
  const m = /\/immobile\/(\d+)\//.exec(href);
  return m ? Number(m[1]) : null;
}

/** Prima pagina dell'ordinamento "più recenti": gli annunci in cima sono di oggi. */
export function isNewestFirst(url: string): boolean {
  const u = urlOf(url);
  return !!u && pageKind(url) === 'search' && u.searchParams.get('ordine') === 'pubblicazione-desc' && !/\/lista-\d+\.htm$/.test(u.pathname);
}
