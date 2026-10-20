import { describe, expect, it } from 'vitest';
import { cdpSlug, pageUrl, searches } from '@/adapters/casadaprivato/search-urls';
import { comuneInfo } from '@/core/comuni';

const cava = comuneInfo('065037')!;

describe('ricerche CasaDaPrivato', () => {
  it('slug con il trattino basso', () => {
    expect(cdpSlug("Cava de' Tirreni")).toBe('cava_de_tirreni');
    expect(cdpSlug("Sant'Egidio del Monte Albino")).toBe('sant_egidio_del_monte_albino');
    expect(cdpSlug('Capaccio Paestum')).toBe('capaccio_paestum');
    expect(cdpSlug('Salerno')).toBe('salerno');
  });
  it('una ricerca immobili per comune', () => {
    expect(searches([cava], ['residential'])).toEqual([{
      portal: 'casadaprivato', key: 'casadaprivato|comune:065037|immobili', label: "Cava de' Tirreni · Immobili", categories: ['residential'], mixedCategories: true,
      url: 'https://www.casadaprivato.it/annunci-vendita/immobili/salerno-cava_de_tirreni',
    }]);
  });
  it('pagine successive', () => {
    expect(pageUrl('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno', 1)).toBe('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno');
    expect(pageUrl('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno', 3)).toBe('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno/pagina-3');
  });
});
