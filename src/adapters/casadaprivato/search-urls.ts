import { BASE } from '@/adapters/casadaprivato/urls';
import type { ComuneInfo } from '@/core/comuni';
import { normalize } from '@/core/lead-filters';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

/** Nome negli URL di CasaDaPrivato: solo la parte italiana, minuscole, senza accenti, apostrofi e spazi come "_". */
export function cdpSlug(name: string): string {
  return normalize(name.split('/')[0]!).replace(/ /g, '_');
}

/** Province che CasaDaPrivato scrive diversamente dal nome ISTAT (verificare sul sito). */
const CDP_PROVINCE_SLUGS: Record<string, string> = {};

/** Una ricerca per comune: la categoria "immobili" le comprende tutte e il sito ha solo privati. Dalla pagina si tengono solo le categorie scelte. */
export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  return comuni.map((c) => ({
    portal: 'casadaprivato' as const, key: `casadaprivato|comune:${c.istat}|immobili`, label: `${c.name} · Immobili`, categories: [...categories], mixedCategories: true,
    url: `${BASE}/annunci-vendita/immobili/${CDP_PROVINCE_SLUGS[c.province.sigla] ?? cdpSlug(c.province.name)}-${cdpSlug(c.name)}`,
  }));
}

export function pageUrl(first: string, page: number): string {
  return page > 1 ? `${first.replace(/\/$/, '')}/pagina-${page}` : first;
}
