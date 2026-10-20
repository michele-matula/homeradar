import { provinceSlug, slug, type ComuneInfo } from '@/core/comuni';
import type { PropertyCategory, SearchSpec } from '@/shared/types';

const BASE = 'https://www.idealista.it';
// Verificato il 2026-10-17: "privati prima" e 30 annunci per pagina. "negozi" = "locali o capannoni".
const SORT = '?ordine=da-privati-asc';
const PATHS: Record<PropertyCategory, string[]> = {
  residential: ['case'],
  commercial: ['negozi', 'uffici'],
  land: ['terreni'],
  garage: ['garage'],
};
const LABELS: Record<string, string> = { case: 'Case', negozi: 'Locali e capannoni', uffici: 'Uffici', garage: 'Box', terreni: 'Terreni' };

/** Una ricerca per comune e percorso di categoria: "/vendita-case/<comune>-<provincia>/". */
export function searches(comuni: ComuneInfo[], categories: PropertyCategory[]): SearchSpec[] {
  return comuni.flatMap((c) =>
    categories.flatMap((category) =>
      PATHS[category].map((path) => ({
        portal: 'idealista' as const, key: `idealista|comune:${c.istat}|${path}`, label: `${c.name} · ${LABELS[path]}`,
        categories: [category], url: `${BASE}/vendita-${path}/${slug(c.name)}-${provinceSlug(c.province)}/${SORT}`,
      })),
    ),
  );
}

/** Pagine successive: ".../lista-2.htm?ordine=…". */
export function pageUrl(first: string, page: number): string {
  const u = new URL(first);
  if (page > 1) u.pathname = u.pathname.replace(/\/$/, `/lista-${page}.htm`);
  return u.toString();
}
