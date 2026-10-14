import { describe, expect, it } from 'vitest';
import { isInterceptedUrl, listingIdFromHref, pageKind } from '@/adapters/subito/urls';

describe('pageKind', () => {
  it('riconosce le ricerche in vendita di qualsiasi area e categoria', () => {
    expect(pageKind('https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/')).toBe('search');
    expect(pageKind('https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/?o=2')).toBe('search');
    expect(pageKind('https://www.subito.it/annunci-italia/vendita/immobili/')).toBe('search');
  });
  it('la scheda, gli affitti e le altre pagine sono "other"', () => {
    expect(pageKind('https://www.subito.it/appartamenti/monolocale-milano-653257640.htm')).toBe('other');
    expect(pageKind('https://www.subito.it/annunci-lombardia/affitto/appartamenti/milano/')).toBe('other');
    expect(pageKind('https://www.subito.it/')).toBe('other');
    expect(pageKind('https://www.immobiliare.it/annunci-lombardia/vendita/x/')).toBe('other');
  });
});

describe('isInterceptedUrl', () => {
  it('solo la ricerca di hades', () => {
    expect(isInterceptedUrl('https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30')).toBe(true);
    expect(isInterceptedUrl('https://hades.subito.it/v1/geo/regions/4/cities/8/towns/015146/zones')).toBe(false);
    expect(isInterceptedUrl('https://www.subito.it/v1/search/items')).toBe(false);
    expect(isInterceptedUrl('non un url')).toBe(false);
  });
});

describe('listingIdFromHref', () => {
  it("legge l'ID alla fine del percorso", () => {
    expect(listingIdFromHref('https://www.subito.it/appartamenti/bilocale-milano-664390119.htm')).toBe(664390119);
    expect(listingIdFromHref('/ville-singole-e-a-schiera/villa-como-650000001.htm?x=1')).toBe(650000001);
    expect(listingIdFromHref('https://www.subito.it/annunci-lombardia/vendita/appartamenti/')).toBeNull();
  });
});
