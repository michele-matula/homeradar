// Funzioni pure sul DOM già mostrato da Idealista. Si leggono solo i nodi elencati qui:
// descrizioni, nome del venditore (.professional-name) e contatti non vengono mai letti.
import { parseEuro } from '@/adapters/immobiliare/format';
import type { ListingObservation, ObservationSource, ObservedPriceDrop, ParseResult, SellerType } from '@/shared/types';
import { listingIdFromHref } from './urls';

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const round1 = (n: number) => Math.round(n * 10) / 10;
const STREET = /^(via|viale|piazza|piazzale|corso|largo|vicolo|strada|località|loc\.|borgo|contrada|lungomare|salita)\b/i;

export const listingUrl = (id: number) => `https://www.idealista.it/immobile/${id}/`;

/** Card degli annunci in elenco; esclude gli annunci suggeriti delle zone vicine (.geo-reach-card), senza flag privato/agenzia. */
export const CARD_SELECTOR = 'article.item:not(.geo-reach-card)';

export interface TitleParts {
  typology: string | null;
  address: string | null;
  zone: string | null;
  city: string | null;
}

/** "Trilocale in Via X, 27, Zona, Milano"; la scheda ha "Bilocale in vendita in …". */
export function parseTitle(title: string): TitleParts {
  const m = /^(.+?) in (?:vendita in )?(.+)$/.exec(title.trim());
  if (!m) return { typology: null, address: null, zone: null, city: null };
  const parts = m[2]!.split(',').map((s) => s.trim()).filter(Boolean);
  const city = parts.pop() ?? null;
  let zone: string | null = null;
  // L'ultima parte prima della città è la zona, a meno che sia un civico o (da sola) una via.
  const last = parts.at(-1);
  if (last && !/^\d/.test(last) && (parts.length > 1 || !STREET.test(last))) zone = parts.pop()!;
  return { typology: m[1]!.trim(), address: parts.length ? parts.join(', ') : null, zone, city };
}

function parseFeatures(items: string[]): { rooms: number | null; surfaceM2: number | null } {
  let rooms: number | null = null;
  let surfaceM2: number | null = null;
  for (const t of items) {
    const r = /^(\d+)\s+local[ei]\b/i.exec(t);
    if (r) rooms = Number(r[1]);
    const s = /^([\d.]+)\s*m²/.exec(t);
    if (s) surfaceM2 = Number(s[1]!.replace(/\./g, ''));
  }
  return { rooms, surfaceM2 };
}

function parseDrop(scope: Element, price: number | null): ObservedPriceDrop | null {
  if (price == null) return null;
  const fromPrice = parseEuro(text(scope.querySelector('.pricedown_price')));
  if (fromPrice == null || !(fromPrice > price)) return null;
  return { fromPrice, toPrice: price, percent: round1(((fromPrice - price) / fromPrice) * 100), date: null };
}

function observation(
  id: number, title: string, price: number | null, features: string[], sellerType: SellerType,
  lastDrop: ObservedPriceDrop | null, source: ObservationSource,
): ListingObservation {
  const t = parseTitle(title);
  return {
    portal: 'idealista', portalId: id, url: listingUrl(id), title, address: t.address, city: t.city, zone: t.zone, typology: t.typology,
    ...parseFeatures(features), price, sellerType, portalCreatedAt: null, lastDrop, source,
  };
}

function sellerOfCard(card: Element): SellerType {
  const v = card.getAttribute('data-is-professional-ad');
  return v === 'false' ? 'private' : v === 'true' ? 'agency' : 'unknown';
}

export function parseSearch(root: ParentNode): ParseResult {
  const out: ParseResult = { observations: [], errors: [] };
  root.querySelectorAll(CARD_SELECTOR).forEach((card, i) => {
    const id = Number(card.getAttribute('data-element-id'));
    const link = card.querySelector('a.item-link');
    const title = link?.getAttribute('title')?.trim() || text(link);
    if (!Number.isInteger(id) || id <= 0 || !title) {
      out.errors.push(`card[${i}]: id o titolo mancanti`);
      return;
    }
    const price = parseEuro(text(card.querySelector('.item-price')));
    const features = [...card.querySelectorAll('.item-detail')].map((d) => text(d));
    out.observations.push(observation(id, title, price, features, sellerOfCard(card), parseDrop(card, price), 'search'));
  });
  return out;
}

function docOf(root: ParentNode): Document {
  return (root as Node).ownerDocument ?? (root as Document);
}

export function parseDetail(root: ParentNode, url: string): ParseResult {
  const id = listingIdFromHref(url);
  const fullTitle = docOf(root).title.split(' — ')[0]!.trim();
  if (!id || !fullTitle) return { observations: [], errors: ['detail: id o titolo mancanti'] };
  if (!fullTitle.includes(' in vendita in ')) return { observations: [], errors: [] }; // solo vendita
  // La scheda ha due .info-data: quello riassuntivo in alto non ha il ribasso; si usa quello con .info-data-price.
  const info = root.querySelector('.info-data-price')?.closest('.info-data');
  if (!info) return { observations: [], errors: ['detail: prezzo non trovato'] };
  const price = parseEuro(text(info.querySelector('.info-data-price')));
  const features = [...root.querySelectorAll('.info-features > span')].map((s) => text(s));
  // Solo presenza dei nodi: il testo di .professional-name è il nome del venditore e non va letto.
  const sellerType: SellerType = root.querySelector('.professional-name .particular')
    ? 'private'
    : root.querySelector('.professional-name') ? 'agency' : 'unknown';
  const title = fullTitle.replace(' in vendita in ', ' in ');
  return { observations: [observation(id, title, price, features, sellerType, parseDrop(info, price), 'detail')], errors: [] };
}
