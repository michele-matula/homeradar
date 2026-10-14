import type { PageKind } from '@/shared/types';

// Niente zod qui: il modulo è usato anche dal bridge nel contesto della pagina.
const BASE = 'https://www.subito.it';

function urlOf(url: string): URL | null {
  try {
    return new URL(url, BASE);
  } catch {
    return null;
  }
}

/** Solo le ricerche in vendita: la scheda non viene letta (nessun dato in più, payload RSC fragile). */
export function pageKind(url: string): PageKind {
  const u = urlOf(url);
  if (!u || u.hostname !== 'www.subito.it') return 'other';
  return /^\/annunci-[a-z-]+\/vendita\//.test(u.pathname) ? 'search' : 'other';
}

/** Chiamata che il sito fa da sé per la paginazione in SPA. */
export function isInterceptedUrl(url: string): boolean {
  const u = urlOf(url);
  return !!u && u.hostname === 'hades.subito.it' && u.pathname.startsWith('/v1/search/items');
}

export function listingIdFromHref(href: string): number | null {
  const m = /-(\d+)\.htm(?:[?#]|$)/.exec(href);
  return m ? Number(m[1]) : null;
}
