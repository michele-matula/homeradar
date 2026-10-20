// HTML sintetico con la struttura verificata su Idealista.it il 2026-10-13 (fixture reali in
// tests/fixtures/idealista/); nomi e testi sono inventati.
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
  /** src dell'img della copertina; null = card senza foto (`item-multimedia_no-pictures`). */
  img?: string | null;
}

const dropHtml = (d?: { from: string; pct: string }) =>
  d ? `<span class="pricedown"><span class="pricedown_price"> ${d.from} </span><span class="pricedown_icon icon-pricedown">${d.pct}</span></span>` : '';

export function card(o: CardOpts = {}): string {
  const id = o.id ?? 37118651;
  const prof = o.professional === undefined ? 'false' : o.professional;
  const title = o.title ?? 'Quadrilocale in Via Esempio, 1, Precotto, Milano';
  return `<article class="item extended-item item-multimedia-container" data-element-id="${id}"${prof === null ? '' : ` data-is-professional-ad="${prof}"`} data-is-offmarket="false">
    ${o.img === null
      ? '<picture class="item-multimedia item-multimedia_no-pictures"></picture>'
      : `<picture class="item-multimedia"><div class="item-multimedia-pictures"><div class="item-multimedia-pictures__container"></div></div><div class="item-gallery"><img src="${o.img ?? 'x.jpg'}" alt="" loading="lazy"></div></picture>`}
    <div class="item-info-container">
      <a href="/immobile/${id}/" role="heading" class="item-link" title="${title}">${title}</a>
      <div class="price-row"><span class="item-price h2-simulated">${o.price ?? '245.000<span class="txt-big">€</span>'}</span><span class="item-price-by-area">2.426 €/m²</span>${dropHtml(o.drop)}</div>
      <div class="item-detail-char">${(o.details ?? ['4 locali', '101 m²', '1º piano con ascensore']).map((d) => `<span class="item-detail">${d}</span>`).join('')}</div>
      <div class="item-description description"><p class="ellipsis">${DESCRIPTION}</p></div>
    </div>
  </article>`;
}

export const AD_SLOT = '<article class="adv noHover" aria-label="Spazio pubblicitario"></article>';

/** Annuncio suggerito di una zona vicina: niente link .item-link né flag privato/agenzia. */
export const GEO_REACH_CARD = `<article class="item geo-reach-card" data-element-id="30490345">
  <div class="geo-reach-card__picture"><picture></picture></div>
  <div class="geo-reach-card__info"><a class="geo-reach-card__address">Bilocale in Via Esempio, 21, Rozzano</a>
  <span class="geo-reach-card__price"><p><strong>230.000</strong><span>€</span></p></span></div>
</article>`;

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
    private: `<div class="professional-name"><div class="name">${SELLER_NAME}</div><span class="particular"><span class="icon-block"></span>Privato</span></div>`,
    agency: '<div class="professional-name"><div class="name">Agenzia Esempio</div><span>Agenzia</span></div>',
    none: '',
  }[o.seller ?? 'private'];
  // Come sul sito: un primo .info-data riassuntivo (senza ribasso) e poi quello con prezzo e ribasso.
  doc.body.innerHTML = `<main class="detail-container">
    <section class="main-info"><p class="info-data txt-big"><span class="price-container"><strong class="price">${o.price ?? '445.000'} €</strong></span><span><span>52</span> m² </span></p></section>
    <div class="info-data"><span class="info-data-price"><span class="txt-bold">${o.price ?? '445.000'}</span> €</span>${dropHtml(o.drop)}</div>
    <div class="info-features"><span>52 m²</span><span>2 locali</span><span>Piano rialzato con ascensore</span></div>
    <div class="comment"><p>${DESCRIPTION}</p></div>
    <aside class="advertiser-name">${seller}</aside>
    <section class="related">${(o.related ?? []).join('')}</section>
  </main>`;
}
