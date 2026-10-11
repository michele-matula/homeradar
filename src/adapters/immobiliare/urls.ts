import type { PageKind } from '@/shared/types';

function pathOf(url: string): string {
  try {
    return new URL(url, 'https://www.immobiliare.it').pathname;
  } catch {
    return '';
  }
}

export function pageKind(url: string): PageKind {
  const path = pathOf(url);
  if (/^\/annunci\/\d+\/?/.test(path)) return 'detail';
  if (/^\/vendita-[a-z-]+\//.test(path)) return 'search';
  return 'other';
}

export function isListingsApiUrl(url: string): boolean {
  return pathOf(url).startsWith('/api-next/search-list/listings/');
}

export function listingIdFromHref(href: string): number | null {
  const m = /\/annunci\/(\d+)\//.exec(href);
  return m ? Number(m[1]) : null;
}
