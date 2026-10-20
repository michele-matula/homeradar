import type { z } from 'zod';
import type { PayloadKind, PortalAdapter } from '@/adapters/types';
import { categoryFromTypology } from '@/core/category';
import { coverOrNull, subitoCover } from '@/core/cover';
import type { ListingObservation, ParseResult, SellerType } from '@/shared/types';
import { ApiAdSchema, NextAdSchema, type CommonAd } from './schemas';
import { isInterceptedUrl, listingIdFromHref, pageKind } from './urls';

type Json = Record<string, unknown> | undefined;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
/** boostedItems può essere un oggetto indicizzato invece di un array. */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : obj(v) ? Object.values(obj(v)!) : []);

type Format = 'next' | 'api';
type Normalized = { ad: CommonAd; typology: string; features: Record<string, string | undefined>; day: string | null };

const IMMOBILI = '6';
const ROME_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Giorno "YYYY-MM-DD" a Roma: le date di Subito sono in ora locale italiana. */
export const romeDay = (ms: number) => ROME_DAY.format(ms);

const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ');

/** Solo immobili in vendita; il resto (affitti, auto, …) si ignora senza errore. */
function isRealEstateSale(raw: unknown): boolean {
  const r = obj(raw);
  const cat = obj(r?.category);
  // __NEXT_DATA__: parentId; API di hades: macrocategory_id.
  return obj(r?.type)?.key === 's' && (cat?.parentId ?? cat?.macrocategory_id) === IMMOBILI;
}

/** "250000" → 250000, "5+" → 5; zero o testo → null. */
function intOf(s: string | undefined): number | null {
  const m = s == null ? null : /^(\d+)\+?$/.exec(s.trim());
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? n : null;
}

function normalize(raw: unknown, format: Format): Normalized | string {
  if (format === 'next') {
    const p = NextAdSchema.safeParse(raw);
    if (!p.success) return issues(p.error);
    const { features, date, category, ...ad } = p.data;
    const f = Object.fromEntries(Object.entries(features ?? {}).map(([uri, x]) => [uri, x.values[0]?.key]));
    return { ad, typology: category.label, features: f, day: date?.slice(0, 10) ?? null };
  }
  const p = ApiAdSchema.safeParse(raw);
  if (!p.success) return issues(p.error);
  const { features, dates, category, ...ad } = p.data;
  const f = Object.fromEntries((features ?? []).map((x) => [x.uri, x.values[0]?.key]));
  return { ad, typology: category.value, features: f, day: dates?.display.slice(0, 10) ?? null };
}

function sellerTypeOf(adv: CommonAd['advertiser']): SellerType {
  if (adv.company) return 'agency';
  return adv.type === 0 ? 'private' : 'unknown';
}

function coverOf(images: CommonAd['images']): string | null {
  const base = images?.[0]?.cdnBaseUrl ?? images?.[0]?.cdn_base_url;
  return base ? coverOrNull('subito', subitoCover(base)) : null;
}

function toObservation({ ad, typology, features }: Normalized, portalId: number): ListingObservation {
  return {
    portal: 'subito',
    portalId,
    url: ad.urls.default,
    title: ad.subject,
    address: null,
    city: ad.geo?.town?.value ?? null,
    zone: ad.geo?.zone?.value ?? null,
    typology,
    category: categoryFromTypology(typology),
    surfaceM2: intOf(features['/size']),
    rooms: intOf(features['/room']),
    price: intOf(features['/price']),
    sellerType: sellerTypeOf(ad.advertiser),
    portalCreatedAt: null,
    lastDrop: null,
    coverUrl: coverOf(ad.images),
    source: 'search',
  };
}

export function parseAds(list: unknown, format: Format, now: number): ParseResult {
  if (!Array.isArray(list)) return { observations: [], errors: [`${format}: ads not found`] };
  const out: ParseResult = { observations: [], errors: [] };
  const today = romeDay(now);
  const seen = new Set<number>();
  list.forEach((raw, i) => {
    if (!isRealEstateSale(raw)) return;
    const n = normalize(raw, format);
    if (typeof n === 'string') {
      out.errors.push(`ads[${i}]: ${n}`);
      return;
    }
    const portalId = Number(/:list:(\d+)$/.exec(n.ad.urn)![1]);
    if (seen.has(portalId)) return;
    seen.add(portalId);
    out.observations.push(toObservation(n, portalId));
    // Rinnovato oggi: candidato punto di calibrazione (acceptLearnedPoint scarta i vecchi rinnovati).
    if (n.day === today && (out.newestId == null || portalId > out.newestId)) out.newestId = portalId;
  });
  return out;
}

function parseNextData(json: unknown, url: string, now = Date.now()): ParseResult {
  if (pageKind(url) !== 'search') return { observations: [], errors: [] };
  const items = obj(obj(obj(obj(obj(json)?.props)?.pageProps)?.initialState)?.items);
  if (!Array.isArray(items?.originalList)) return { observations: [], errors: ['next: ads not found'] };
  // Gli annunci in evidenza hanno card in pagina come gli altri: servono anche a hasUnseenListings.
  const result = parseAds([...items.originalList, ...listOf(items.galleryList), ...listOf(items.boostedItems)], 'next', now);
  const total = typeof items.totalPages === 'number' ? items.totalPages : null;
  const page = Number(new URL(url, 'https://www.subito.it').searchParams.get('o') ?? '1') || 1;
  result.page = {
    results: result.observations.length,
    privates: result.observations.filter((o) => o.sellerType === 'private').length,
    lastPage: items.originalList.length === 0 || (total != null && page >= total),
  };
  return result;
}

function parseApi(url: string, json: unknown, now = Date.now()): ParseResult {
  return isInterceptedUrl(url) ? parseAds(obj(json)?.ads, 'api', now) : { observations: [], errors: [] };
}

const AD_LINK = 'article a[href$=".htm"]';

const adapter: PortalAdapter = {
  portal: 'subito',
  pageKind,
  parsePayload: (kind: PayloadKind, url: string, json: unknown) => (kind === 'next-data' ? parseNextData(json, url) : parseApi(url, json)),
  cardFor: (root, id) => root.querySelector<HTMLAnchorElement>(`article a[href$="-${id}.htm"]`)?.closest('article') ?? null,
  // Le classi del sito hanno un hash che cambia a ogni build: si usa la struttura, non le classi.
  // Il contenitore della foto (sfondo, figure, preferiti) è il genitore della figure.
  badgeHost: (card) => card.querySelector('figure')?.parentElement ?? card.querySelector('img')?.parentElement ?? card,
  cardIds: (root) =>
    [...root.querySelectorAll<HTMLAnchorElement>(AD_LINK)]
      .map((a) => listingIdFromHref(a.getAttribute('href') ?? ''))
      .filter((id): id is number => id != null),
};

// Le funzioni in più restano esposte per i test dell'adattatore.
export const subitoAdapter = { ...adapter, parseNextData, parseApi, isInterceptedUrl, listingIdFromHref };
