import type { PayloadKind, PortalAdapter } from '@/adapters/types';
import { categoryFromTypology } from '@/core/category';
import type {
  ListingObservation, ObservationSource, ParseResult, PriceDrop, SellerType,
} from '@/shared/types';
import { parseEuro, parseItalianDate, parseItalianDecimal, parseRooms, parseSurface } from './format';
import { RealEstateSchema, SearchResultSchema, type RealEstate } from './schemas';
import { isListingsApiUrl, listingIdFromHref, pageKind } from './urls';

type Json = Record<string, unknown> | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);

function sellerTypeOf(adv: RealEstate['advertiser']): SellerType {
  if (adv?.agency) return adv.agency.type === 'constructor' ? 'constructor' : 'agency';
  if (adv?.supervisor?.type === 'user') return 'private';
  return 'unknown';
}

function toLastDrop(lp: NonNullable<RealEstate['price']['loweredPrice']> | null | undefined): PriceDrop | null {
  if (!lp) return null;
  const fromPrice = parseEuro(lp.originalPrice);
  const toPrice = parseEuro(lp.currentPrice);
  const date = parseItalianDate(lp.date);
  if (fromPrice == null || toPrice == null || date == null || !(fromPrice > toPrice)) return null;
  const percent = parseItalianDecimal(lp.discountPercentage) ?? Math.round(((fromPrice - toPrice) / fromPrice) * 1000) / 10;
  return { fromPrice, toPrice, percent, date };
}

function toObservation(re: RealEstate, url: string, source: ObservationSource): ListingObservation {
  const p = re.properties[0]!;
  const loc = p.location;
  const price = re.price.visible === false ? null : (re.price.value ?? null);
  return {
    portal: 'immobiliare',
    portalId: re.id,
    url,
    title: re.title,
    address: loc?.address ?? null,
    city: loc?.city ?? null,
    zone: loc?.microzone ?? loc?.macrozone ?? null,
    typology: p.typology?.name ?? null,
    category: categoryFromTypology(p.typology?.name),
    surfaceM2: p.surface ? parseSurface(p.surface) : null,
    rooms: p.rooms ? parseRooms(p.rooms) : null,
    price,
    sellerType: sellerTypeOf(re.advertiser),
    portalCreatedAt: re.createdAt != null ? re.createdAt * 1000 : null,
    lastDrop: price == null ? null : toLastDrop(re.price.loweredPrice),
    source,
  };
}

const listingUrl = (id: number) => `https://www.immobiliare.it/annunci/${id}/`;

export function parseSearchData(data: unknown, source: ObservationSource = 'search'): ParseResult {
  const results = obj(data)?.results;
  if (!Array.isArray(results)) return { observations: [], errors: ['search data not found'] };
  const out: ParseResult = { observations: [], errors: [] };
  results.forEach((raw, i) => {
    const parsed = SearchResultSchema.safeParse(raw);
    if (!parsed.success) {
      out.errors.push(`result[${i}]: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
      return;
    }
    const re = parsed.data.realEstate;
    if (re.contract !== 'sale') return; // solo vendita: gli affitti vengono ignorati
    out.observations.push(toObservation(re, parsed.data.seo?.url ?? listingUrl(re.id), source));
  });
  return out;
}

export function parseDetailData(detailData: unknown): ParseResult {
  const raw = obj(detailData)?.realEstate;
  if (!raw) return { observations: [], errors: ['detail data not found'] };
  const parsed = RealEstateSchema.safeParse(raw);
  if (!parsed.success) {
    return { observations: [], errors: [`detail: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`] };
  }
  if (parsed.data.contract !== 'sale') return { observations: [], errors: [] }; // solo vendita
  return { observations: [toObservation(parsed.data, listingUrl(parsed.data.id), 'detail')], errors: [] };
}

function findSearchData(json: unknown): unknown {
  const queries = obj(obj(obj(obj(json)?.props)?.pageProps)?.dehydratedState)?.queries;
  if (!Array.isArray(queries)) return undefined;
  const q = queries.find((x) => Array.isArray(obj(obj(obj(x)?.state)?.data)?.results));
  return obj(obj(q)?.state)?.data;
}

function parseNextData(json: unknown, url: string): ParseResult {
  const kind = pageKind(url);
  if (kind === 'search') return parseSearchData(findSearchData(json));
  if (kind === 'detail') return parseDetailData(obj(obj(obj(json)?.props)?.pageProps)?.detailData);
  return { observations: [], errors: [] };
}

function parseIntercepted(url: string, json: unknown): ParseResult {
  return isListingsApiUrl(url) ? parseSearchData(json) : { observations: [], errors: [] };
}

const adapter: PortalAdapter = {
  portal: 'immobiliare',
  pageKind,
  parsePayload: (kind: PayloadKind, url: string, json: unknown) =>
    kind === 'next-data' ? parseNextData(json, url) : parseIntercepted(url, json),
  cardFor: (root: ParentNode, id: number) => root.querySelector<HTMLAnchorElement>(`a[href*="/annunci/${id}/"]`)?.closest('li') ?? null,
  badgeHost(card: HTMLElement): HTMLElement {
    const img = card.querySelector('img');
    return img?.closest<HTMLElement>('.nd-slideshow__content') ?? img?.parentElement ?? card;
  },
  cardIds: (root: ParentNode) =>
    [...root.querySelectorAll<HTMLAnchorElement>('li a[href*="/annunci/"]')]
      .map((a) => listingIdFromHref(a.getAttribute('href') ?? ''))
      .filter((id): id is number => id != null),
};

// Le funzioni in più restano esposte per i test dell'adattatore.
export const immobiliareAdapter = { ...adapter, parseNextData, parseIntercepted, isInterceptedUrl: isListingsApiUrl, listingIdFromHref };
