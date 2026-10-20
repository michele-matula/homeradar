// HTML sintetico con la struttura verificata su CasaDaPrivato.it il 2026-10-20 (fixture sanificate in
// tests/fixtures/casadaprivato/); nomi e testi sono inventati.
export const URL = 'https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno';
export const DESCRIPTION = 'Descrizione scritta dal venditore, chiamare il 333 123 4567';

export interface CardOpts {
  id?: number;
  /** primo segmento del link (tipologia) */
  path?: string;
  /** parte libera del link prima dell'ID: sul sito reale è uno slug del titolo, non "annuncio" */
  slug?: string;
  title?: string;
  price?: string;
  amenities?: string[];
  /** data-src della copertina; null = attributo assente */
  dataSrc?: string | null;
  src?: string;
}

export function card(o: CardOpts = {}): string {
  const id = o.id ?? 424125;
  const href = `/${o.path ?? 'appartamenti'}/${o.slug ?? 'annuncio'}-${id}`;
  const title = o.title ?? 'Trilocale da Privato a Salerno, Via Esempio 1';
  const price = o.price ?? '€ 190.000';
  const priceHtml = /^trattativa/i.test(price) ? `<span><small>${price}</small></span>` : `<span>${price}</span>`;
  return `<div class="item col-md-12"><div class="image"><a href="${href}"></a><img class="lazyload" src="${o.src ?? '/images/no-thumb.svg'}"${o.dataSrc === null ? '' : ` data-src="${o.dataSrc ?? ''}"`}></div><div class="price">${priceHtml}</div><div class="info"><h3><a href="${href}">${title}</a></h3><small class="subtitle">Immobile in vendita, tel 333 123 4567</small><ul class="amenities">${(o.amenities ?? ['3 locali', '80 mq']).map((a) => `<li>${a}</li>`).join('')}</ul><p>${DESCRIPTION}</p></div></div>`;
}

export const similarHeading = (comune: string) => `<h2 class="similar-properties section-title">Immobili e case simili nelle vicinanze di ${comune}</h2>`;

export function searchBody(cards: string[], pager: number[] = []): string {
  const pages = pager.map((n) => `<li><a href="/annunci-vendita/immobili/salerno-salerno/pagina-${n}">${n}</a></li>`).join('');
  return `<h1 class="page-title">Case in vendita da Privati a Salerno</h1><div id="property-listing"><div class="row">${cards.join('')}</div>${pages ? `<ul class="pagination">${pages}</ul>` : ''}</div>`;
}
