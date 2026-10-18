import { slug, type ComuneInfo } from '@/core/comuni';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

const BASE = 'https://www.immobiliare.it';
// Verificati il 2026-10-17: "privati prima" vale per tutte le categorie; /da-privati/ solo per le case.
const SORT = '?criterio=privateFirst';
const PATHS: Record<PropertyCategory, string[]> = {
  residential: ['case'],
  commercial: ['negozi', 'uffici', 'capannoni'],
  land: ['terreni'],
  garage: ['garage'],
};
const LABELS: Record<string, string> = { case: 'Case', negozi: 'Negozi', uffici: 'Uffici', capannoni: 'Capannoni', garage: 'Box', terreni: 'Terreni' };

/** Una ricerca per comune e percorso di categoria. */
export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  return comuni.flatMap((c) =>
    categories.flatMap((category) =>
      PATHS[category].map((path) => ({
        portal: 'immobiliare' as const, key: `immobiliare|comune:${c.istat}|${path}`, label: `${c.name} · ${LABELS[path]}`,
        categories: [category], url: `${BASE}/vendita-${path}/${slug(c.name)}/${SORT}`,
      })),
    ),
  );
}

export function pageUrl(first: string, page: number): string {
  const u = new URL(first);
  if (page > 1) u.searchParams.set('pag', String(page));
  return u.toString();
}
