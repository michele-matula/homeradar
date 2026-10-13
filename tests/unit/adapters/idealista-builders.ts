// HTML sintetico con la struttura verificata su Idealista.it il 2026-10-13; nomi e testi sono inventati.
export const SEARCH_URL = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc';
export const NEWEST_URL = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=pubblicazione-desc';
export const DETAIL_URL = 'https://www.idealista.it/immobile/37118651/';
export const SELLER_NAME = 'Graziella Esempio';
export const DESCRIPTION = 'Descrizione scritta dal venditore, da non salvare';

export interface CardOpts {
  id?: number;
  /** valore di data-is-professional-ad; null = attributo assente */
  professional?: 'true' | 'false' | null;
  title?: string;
  price?: string;
  details?: string[];
  drop?: { from: string; pct: string };
}

const dropHtml = (d?: { from: string; pct: string }) =>
  d ? `<span class="pricedown"><span class="pricedown_price"> ${d.from} </span><span class="pricedown_icon icon-pricedown">${d.pct}</span></span>` : '';

export function card(o: CardOpts = {}): string {
  const id = o.id ?? 37118651;
  const prof = o.professional === undefined ? 'false' : o.professional;
  const title = o.title ?? 'Quadrilocale in Via Esempio, 1, Precotto, Milano';
  return `<article class="item extended-item item-multimedia-container" data-element-id="${id}"${prof === null ? '' : ` data-is-professional-ad="${prof}"`} data-is-offmarket="false">
    <div class="item-multimedia"><div class="mask"><div class="placeholder"><picture><img src="x.jpg" alt=""></picture></div></div></div>
    <div class="item-info-container">
      <a href="/immobile/${id}/" role="heading" class="item-link" title="${title}">${title}</a>
      <div class="price-row"><span class="item-price h2-simulated">${o.price ?? '245.000<span class="txt-big">€</span>'}</span>${dropHtml(o.drop)}</div>
      <div class="item-detail-char">${(o.details ?? ['4 locali', '101 m²', '1º piano con ascensore']).map((d) => `<span class="item-detail">${d}</span>`).join('')}</div>
      <div class="item-description description"><p class="ellipsis">${DESCRIPTION}</p></div>
    </div>
  </article>`;
}

export const AD_SLOT = '<article class="adv noHover" aria-label="Spazio pubblicitario"></article>';

export function searchBody(cards: string[]): string {
  return `<main id="main-content"><section class="items-container items-list">${cards.join('')}</section></main>`;
}

export interface DetailOpts {
  title?: string;
  price?: string;
  drop?: { from: string; pct: string };
  seller?: 'private' | 'agency' | 'none';
  related?: string[];
}

/** Imposta document.title e il body come una scheda annuncio. */
export function renderDetail(doc: Document, o: DetailOpts = {}): void {
  doc.title = `${o.title ?? 'Bilocale in vendita in Via Esempio, 2, Mercalli - Quadronno, Milano'} — idealista, N.1 in Italia`;
  const seller = {
    private: `<div class="professional-name"><span class="particular">${SELLER_NAME}</span></div>`,
    agency: '<div class="professional-name"><span>Agenzia Esempio</span></div>',
    none: '',
  }[o.seller ?? 'private'];
  doc.body.innerHTML = `<main class="detail-container">
    <div class="info-data"><span class="info-data-price"><span class="txt-bold">${o.price ?? '445.000'}</span> €</span>${dropHtml(o.drop)}</div>
    <div class="info-features"><span>52 m²</span><span>2 locali</span><span>Piano rialzato con ascensore</span></div>
    <div class="comment"><p>${DESCRIPTION}</p></div>
    <aside class="advertiser-name">${seller}</aside>
    <section class="related">${(o.related ?? []).join('')}</section>
  </main>`;
}
