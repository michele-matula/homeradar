const STORAGE_KEY = 'homeradar.filtersOpen';

/** Riquadro «Filtri» aperto o chiuso. Comodità della vista, come l'ordinamento: se manca o non si legge, chiuso. */
export function loadFiltersOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveFiltersOpen(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // Archivio non disponibile: la scelta vale solo finché il pannello resta aperto.
  }
}
