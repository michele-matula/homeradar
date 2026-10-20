import { priorityLabel } from '@/core/leads';
import { formatDayMonth, formatEuro, formatPercent } from '@/shared/format';
import {
  DAY_MS, type Evaluation, type ListingRecord, type Portal, type PriceDrop, type PriceSnapshot, type Priority, type Settings,
} from '@/shared/types';

export const UNCERTAINTY_DAYS = 15;
/** Oltre questa età una stima in giorni suggerirebbe una precisione che l'ID non dà. */
const ESTIMATED_YEARS_FROM_DAYS = 3 * 365;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Su Immobiliare la scheda contiene la data vera; su Idealista e Subito no.
const VERIFY_REASON: Record<Portal, string> = {
  immobiliare: "Età da verificare: apri l'annuncio",
  idealista: 'Età stimata vicina alla soglia',
  subito: 'Età stimata vicina alla soglia',
  casadaprivato: 'Età stimata vicina alla soglia',
};

interface AgeFacts {
  /** Portale dell'annuncio da cui viene l'età: decide i testi dell'età incerta. */
  portal: Portal;
  ageDays: number | null;
  ageEstimated: boolean;
  ageUncertain: boolean;
  /** Segnale A: anzianità. */
  signal: boolean;
}

function ageFacts(listing: ListingRecord, settings: Settings, now: number): AgeFacts {
  const created = listing.portalCreatedAt ?? listing.estimatedCreatedAt;
  const ageEstimated = listing.portalCreatedAt == null;
  const ageDays = created == null ? null : Math.max(0, Math.floor((now - created) / DAY_MS));
  const ageUncertain =
    ageDays != null &&
    ageEstimated &&
    ageDays >= settings.minAgeDays - UNCERTAINTY_DAYS &&
    ageDays < settings.minAgeDays + UNCERTAINTY_DAYS;
  const signal = ageDays != null && !ageUncertain && ageDays >= settings.minAgeDays;
  return { portal: listing.portal, ageDays, ageEstimated, ageUncertain, signal };
}

interface DropFacts {
  current: number | null;
  lastDrop: PriceDrop | null;
  maxKnownPrice: number | null;
  dropPercent: number;
  dropCount: number;
  /** Segnale B: ribasso. */
  signal: boolean;
}

/** Ribassi rispetto al massimo prezzo noto. */
function dropFacts(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings): DropFacts {
  const ordered = [...snapshots].sort((a, b) => a.at - b.at);
  const current = listing.currentPrice;
  const known = ordered.map((s) => s.price);
  if (listing.lastDrop) known.push(listing.lastDrop.fromPrice);
  if (current != null) known.push(current);
  const maxKnownPrice = known.length ? Math.max(...known) : null;
  const dropPercent =
    current != null && maxKnownPrice != null && maxKnownPrice > current
      ? round1(((maxKnownPrice - current) / maxKnownPrice) * 100)
      : 0;
  const signal = dropPercent > 0 && dropPercent >= settings.minDropPercent;
  let dropCount = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.price < ordered[i - 1]!.price) dropCount++;
  return { current, lastDrop: listing.lastDrop, maxKnownPrice, dropPercent, dropCount, signal };
}

/** Cosa aggiunge il gruppo al badge: portali distinti e ripubblicazione. */
interface GroupFacts {
  portals: number;
  reposted: boolean;
}

const SINGLE: GroupFacts = { portals: 1, reposted: false };

/** Priorità, motivi e badge da età e ribasso; il gruppo aggiunge "· N portali" e "· ripubblicato" al badge. */
function compose(target: ListingRecord, age: AgeFacts, drop: DropFacts, group: GroupFacts = SINGLE): Evaluation {
  const { ageDays, ageEstimated, ageUncertain } = age;
  const { current, maxKnownPrice, dropPercent, dropCount } = drop;

  let priority: Priority = 'none';
  if (age.signal && drop.signal) priority = 'high';
  else if (age.signal || drop.signal) priority = 'medium';
  else if (ageUncertain) priority = 'verify';

  const agePart =
    ageDays == null ? null
    : ageEstimated && ageDays >= ESTIMATED_YEARS_FROM_DAYS ? `oltre ${Math.floor(ageDays / 365)} anni`
    : `${ageEstimated ? '~' : ''}${ageDays} gg`;
  const reasons: string[] = [];
  if (agePart) reasons.push(`Online da ${agePart}`);
  if (ageUncertain) reasons.push(VERIFY_REASON[age.portal]);
  if (drop.signal && current != null && maxKnownPrice != null) {
    if (dropCount >= 2) {
      reasons.push(`${dropCount} ribassi, −${formatPercent(dropPercent)}% totale`);
    } else {
      const d = drop.lastDrop;
      const when = d && d.toPrice === current ? ` ${d.dateEstimated ? 'rilevato il' : 'il'} ${formatDayMonth(d.date)}` : '';
      reasons.push(`Ribassato del ${formatPercent(dropPercent)}% (${formatEuro(maxKnownPrice)} → ${formatEuro(current)} €)${when}`);
    }
  }

  const dropPart = drop.signal ? `−${formatPercent(dropPercent)}%` : null;
  const head = { high: '● Alta', medium: '● Media', verify: `◐ ${priorityLabel('verify', age.portal)}`, none: 'Privato' }[priority];
  const parts = priority === 'high' || priority === 'medium' ? [head, agePart, dropPart] : [head, agePart];
  if (group.portals > 1) parts.push(`${group.portals} portali`);
  if (group.reposted) parts.push('ripubblicato');

  return {
    listingKey: target.key,
    portalId: target.portalId,
    priority,
    ageDays,
    ageEstimated,
    ageUncertain,
    dropPercent,
    dropCount,
    maxKnownPrice,
    reasons,
    badgeText: parts.filter(Boolean).join(' · '),
  };
}

export function evaluate(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings, now: number): Evaluation {
  return compose(listing, ageFacts(listing, settings, now), dropFacts(listing, snapshots, settings));
}

export interface GroupMember {
  listing: ListingRecord;
  prices: PriceSnapshot[];
  /** Annuncio sostituito da una ripubblicazione: conta per l'età, non per il ribasso (il suo storico è già nella testa). */
  previous?: boolean;
}

const days = (a: AgeFacts) => a.ageDays ?? -1;

/**
 * Valutazione dello stesso immobile su più portali: le regole di `evaluate` sui fatti del gruppo.
 * Età del membro più vecchio tra quelli con il segnale A (altrimenti del più vecchio), ribasso maggiore tra gli annunci vivi.
 * `listingKey` e `portalId` sono quelli di `target`.
 */
export function evaluateGroup(target: ListingRecord, members: GroupMember[], settings: Settings, now: number): Evaluation {
  const ages = members.map((m) => ageFacts(m.listing, settings, now));
  const pool = ages.some((a) => a.signal) ? ages.filter((a) => a.signal) : ages;
  // A parità di giorni vince l'età esatta.
  const age = pool.reduce((best, a) => (days(a) > days(best) || (days(a) === days(best) && best.ageEstimated && !a.ageEstimated) ? a : best));
  const drop = members
    .filter((m) => !m.previous)
    .map((m) => dropFacts(m.listing, m.prices, settings))
    .reduce((best, d) => ((d.signal && !best.signal) || (d.signal === best.signal && d.dropPercent > best.dropPercent) ? d : best));
  return compose(target, age, drop, { portals: new Set(members.map((m) => m.listing.portal)).size, reposted: members.some((m) => m.previous) });
}
