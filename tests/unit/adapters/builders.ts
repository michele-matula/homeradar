export const SEARCH_URL = 'https://www.immobiliare.it/vendita-case/milano/da-privati/';
export const DETAIL_URL = 'https://www.immobiliare.it/annunci/128416572/';
export const API_URL = 'https://www.immobiliare.it/api-next/search-list/listings/?pag=2';

export function realEstate(overrides: Record<string, unknown> = {}) {
  return {
    id: 128416572,
    title: 'Bilocale via Esempio 1, Precotto, Milano',
    contract: 'sale',
    price: {
      visible: true,
      value: 235000,
      formattedValue: '€ 235.000',
      loweredPrice: {
        originalPrice: '€ 249.000',
        currentPrice: '€ 235.000',
        discountPercentage: '5,6',
        priceDecreasedBy: '€ 14.000',
        passedDays: 19,
        date: '21/09/2026',
        typologiesCount: 0,
      },
    },
    properties: [
      {
        surface: '62 m²',
        rooms: '2',
        typology: { id: 14, name: 'Appartamento' },
        description: 'Testo lungo della descrizione',
        location: { address: 'Via Esempio', city: 'Milano', macrozone: 'Turro', microzone: 'Precotto' },
      },
    ],
    advertiser: {
      supervisor: { type: 'user', phones: [{ type: 'tel1', value: '333 123 4567' }], label: 'privato' },
      hasCallNumbers: true,
    },
    ...overrides,
  };
}

export const agencyAdvertiser = {
  agency: { id: 1, type: 'agency', displayName: 'Agenzia X', phones: [{ type: 'tel1', value: '02 1234567' }] },
  supervisor: { type: 'agent' },
};

export function searchResult(re: unknown, id = 128416572) {
  return { realEstate: re, seo: { url: `https://www.immobiliare.it/annunci/${id}/` }, idGeoHash: 'x' };
}

export function searchNextData(results: unknown[]) {
  return {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            { queryKey: ['geo'], state: { data: { foo: 1 } } },
            { queryKey: ['real-estate-list'], state: { data: { count: results.length, currentPage: 1, results } } },
          ],
        },
      },
    },
  };
}

export function detailNextData(re: unknown) {
  return { props: { pageProps: { detailData: { realEstate: re } } } };
}
