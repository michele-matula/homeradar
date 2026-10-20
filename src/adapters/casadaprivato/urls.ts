import type { PageKind, PropertyCategory } from '@/shared/types';

export const BASE = 'https://www.casadaprivato.it';

function pathOf(url: string): string {
  try {
    return new URL(url, BASE).pathname;
  } catch {
    return '';
  }
}

export function pageKind(url: string): PageKind {
  return pathOf(url).startsWith('/annunci-vendita/') ? 'search' : 'other';
}

/** L'ID è il numero finale del percorso: "/appartamenti/qualsiasi-slug-424125". */
export function listingIdFromHref(href: string): number | null {
  const m = /-(\d+)\/?$/.exec(pathOf(href));
  return m ? Number(m[1]) : null;
}

const RESIDENTIAL = new Set(['appartamenti', 'case-indipendenti', 'ville-singole-e-a-schiera', 'attici-mansarde', 'rustici-casali', 'altro-residenziale', 'palazzi-stabili']);

/** Categoria dal primo segmento del link; null se sconosciuto (allora decide la tipologia). */
export function categoryFromPath(href: string): PropertyCategory | null {
  const first = pathOf(href).split('/')[1] ?? '';
  if (RESIDENTIAL.has(first)) return 'residential';
  if (first === 'immobili-attivita-commerciali') return 'commercial';
  if (first === 'terreni') return 'land';
  if (first === 'box-garage-posti-auto') return 'garage';
  return null;
}
