import { provinceSlug, slug, type ComuneInfo } from '@/core/comuni';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

const BASE = 'https://www.subito.it';

/**
 * Una ricerca per comune: la categoria "immobili" le comprende tutte e advt=0 tiene solo i privati (verificato il
 * 2026-10-17). Dalla pagina si tengono solo le categorie scelte.
 */
export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  return comuni.map((c) => ({
    portal: 'subito' as const, key: `subito|comune:${c.istat}|immobili`, label: `${c.name} · Immobili`, categories: [...categories], mixedCategories: true,
    url: `${BASE}/annunci-${slug(c.province.region)}/vendita/immobili/${provinceSlug(c.province)}/${slug(c.name)}/?advt=0`,
  }));
}

export function pageUrl(first: string, page: number): string {
  const u = new URL(first);
  if (page > 1) u.searchParams.set('o', String(page));
  return u.toString();
}
