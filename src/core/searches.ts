import * as idealista from '@/adapters/idealista/search-urls';
import * as immobiliare from '@/adapters/immobiliare/search-urls';
import * as subito from '@/adapters/subito/search-urls';
import { comuneInfo, type ComuneInfo } from '@/core/comuni';
import { PORTALS, type ListingObservation, type Portal, type PropertyCategory, type SearchArea, type SearchSpec } from '@/shared/types';

const BUILDERS: Record<Portal, { searches(c: ComuneInfo[], k: PropertyCategory[]): SearchSpec[]; pageUrl(first: string, page: number): string }> = {
  immobiliare, idealista, subito,
  // Provvisorio: l'adattatore di CasaDaPrivato arriva col Task 4, che sostituisce questa voce.
  casadaprivato: { searches: () => [], pageUrl: (first) => first },
};

/** Tempo medio di una ricerca nel giro (prova di ritmo del 2026-10-18: caricamento più pausa). */
const SECONDS_PER_SEARCH = 14;

/** Ricerche del giro per la zona di lavoro, sui portali attivi. Un comune sconosciuto all'elenco ISTAT si salta. */
export function searchesFor(area: SearchArea, enabled: Record<Portal, boolean>): SearchSpec[] {
  const comuni = area.comuni.map((r) => comuneInfo(r.istat)).filter((c): c is ComuneInfo => c != null);
  if (!comuni.length || !area.categories.length) return [];
  return PORTALS.filter((p) => enabled[p]).flatMap((p) => BUILDERS[p].searches(comuni, area.categories));
}

/** Stima per la zona, con tutti i portali: una pagina per ricerca, come nei comuni medi. */
export function estimateMinutes(area: SearchArea): { searches: number; minutes: number } {
  const searches = searchesFor(area, Object.fromEntries(PORTALS.map((p) => [p, true])) as Record<Portal, boolean>).length;
  return { searches, minutes: Math.max(1, Math.round((searches * SECONDS_PER_SEARCH) / 60)) };
}

export function pageUrl(spec: SearchSpec, page: number): string {
  return BUILDERS[spec.portal].pageUrl(spec.url, page);
}

/** Annunci da tenere: categoria scelta o non riconosciuta (la decide la ricerca). */
export function acceptObservation(spec: SearchSpec, o: ListingObservation): boolean {
  return o.category == null || spec.categories.includes(o.category);
}

/** Categoria da usare se la tipologia non la dice; null se la pagina ne porta più di una. */
export function searchCategory(spec: SearchSpec): PropertyCategory | null {
  return !spec.mixedCategories && spec.categories.length === 1 ? spec.categories[0]! : null;
}
