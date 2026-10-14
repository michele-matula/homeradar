// Annunci sintetici con la forma verificata su Subito.it il 2026-10-13
// (__NEXT_DATA__ → props.pageProps.initialState.items; risposta di hades.subito.it/v1/search/items).
export const SEARCH_URL = 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/';
export const API_URL = 'https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30';
/** 13/10/2026 12:00 a Roma. */
export const NOW = Date.UTC(2026, 9, 13, 10, 0);

type Over = Record<string, unknown>;

const base = (id: number) => ({
  kind: 'AdItem',
  urn: `id:ad:00000000-0000-0000-0000-000000000000:list:${id}`,
  type: { key: 's', value: 'In vendita' },
  category: { id: '7', label: 'Appartamenti', parentId: '6', friendlyName: 'appartamenti' },
  subject: 'Bilocale in Via Esempio 1',
  body: 'Descrizione lunga del privato',
  images: [{ cdnBaseUrl: 'https://images.example/1' }],
  geo: {
    region: { id: '4', value: 'Lombardia' },
    city: { id: '8', value: 'Milano', shortName: 'MI' },
    town: { id: '015146', value: 'Milano' },
    zone: { id: '1', value: 'Città Studi' },
  },
  urls: { default: `https://www.subito.it/appartamenti/annuncio-${id}.htm` },
});

const feats = { '/price': '250000', '/size': '65', '/room': '2' };

export function nextAd(id = 664390119, over: Over = {}) {
  return {
    ...base(id),
    date: '2026-10-12 14:31:05',
    features: Object.fromEntries(Object.entries(feats).map(([uri, key]) => [uri, { uri, values: [{ key, value: key }] }])),
    advertiser: { name: 'Mario', type: 0, userId: '7029983', company: false },
    ...over,
  };
}

export function apiAd(id = 664304986, over: Over = {}) {
  return {
    ...base(id),
    // Nell'API la categoria ha un'altra forma: value invece di label, macrocategory_id invece di parentId.
    category: { key: '7', value: 'Appartamenti', friendly_name: 'appartamenti', macrocategory_id: '6', weight: 9 },
    dates: { display: '2026-10-12 20:53:01', expiration: '2027-10-12 20:53:01', display_iso8601: '2026-10-12T20:53:01.136+0200' },
    features: Object.entries(feats).map(([uri, key]) => ({ uri, values: [{ key, value: key }] })),
    advertiser: { user_id: '1', name: 'Mario', phone: '3331234567', company: false, type: 0, shop_id: null, shop_name: null },
    ...over,
  };
}

export const nextData = (originalList: unknown[], extra: Over = {}) => ({
  props: { pageProps: { initialState: { items: { total: originalList.length, originalList, galleryList: [], boostedItems: [], ...extra } } } },
});

export const apiResponse = (ads: unknown[]) => ({ count_all: ads.length, lines: ads.length, start: 30, ads });

/**
 * Card con la struttura del DOM di Subito verificata il 2026-10-13 (classi con hash omesse):
 * contenitore foto (sfondo + figure + preferiti), link sovrapposto vuoto, testi.
 */
export const cardHtml = (id: number) =>
  `<article><div><img src="data:,"><figure><img src="data:,"><span></span></figure><button></button></div><a href="https://www.subito.it/appartamenti/annuncio-${id}.htm"></a><section><h3>Titolo</h3></section></article>`;
