import { priorityLabel } from '@/core/leads';
import { formatDayMonth, formatEuro, formatPercent } from '@/shared/format';
import {
  DAY_MS, type Evaluation, type ListingRecord, type Portal, type PriceSnapshot, type Priority, type Settings,
} from '@/shared/types';

export const UNCERTAINTY_DAYS = 15;

const round1 = (n: number) => Math.round(n * 10) / 10;

// Su Immobiliare la scheda contiene la data vera; su Idealista e Subito no.
const VERIFY_REASON: Record<Portal, string> = {
  immobiliare: "Età da verificare: apri l'annuncio",
  idealista: 'Età stimata vicina alla soglia',
  subito: 'Età stimata vicina alla soglia',
};

export function evaluate(listing: ListingRecord, snapshots: PriceSnapshot[], settings: Settings, now: number): Evaluation {
  // Segnale A: anzianità
  const created = listing.portalCreatedAt ?? listing.estimatedCreatedAt;
  const ageEstimated = listing.portalCreatedAt == null;
  const ageDays = created == null ? null : Math.max(0, Math.floor((now - created) / DAY_MS));
  const ageUncertain =
    ageDays != null &&
    ageEstimated &&
    ageDays >= settings.minAgeDays - UNCERTAINTY_DAYS &&
    ageDays < settings.minAgeDays + UNCERTAINTY_DAYS;
  const signalA = ageDays != null && !ageUncertain && ageDays >= settings.minAgeDays;

  // Segnale B: ribassi rispetto al massimo prezzo noto
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
  const signalB = dropPercent > 0 && dropPercent >= settings.minDropPercent;
  let dropCount = 0;
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.price < ordered[i - 1]!.price) dropCount++;

  let priority: Priority = 'none';
  if (signalA && signalB) priority = 'high';
  else if (signalA || signalB) priority = 'medium';
  else if (ageUncertain) priority = 'verify';

  const agePart = ageDays != null ? `${ageEstimated ? '~' : ''}${ageDays} gg` : null;
  const reasons: string[] = [];
  if (agePart) reasons.push(`Online da ${agePart}`);
  if (ageUncertain) reasons.push(VERIFY_REASON[listing.portal]);
  if (signalB && current != null && maxKnownPrice != null) {
    if (dropCount >= 2) {
      reasons.push(`${dropCount} ribassi, −${formatPercent(dropPercent)}% totale`);
    } else {
      const d = listing.lastDrop;
      const when = d && d.toPrice === current ? ` ${d.dateEstimated ? 'rilevato il' : 'il'} ${formatDayMonth(d.date)}` : '';
      reasons.push(`Ribassato del ${formatPercent(dropPercent)}% (${formatEuro(maxKnownPrice)} → ${formatEuro(current)} €)${when}`);
    }
  }

  const dropPart = signalB ? `−${formatPercent(dropPercent)}%` : null;
  const head = { high: '● Alta', medium: '● Media', verify: `◐ ${priorityLabel('verify', listing.portal)}`, none: 'Privato' }[priority];
  const parts = priority === 'high' || priority === 'medium' ? [head, agePart, dropPart] : [head, agePart];

  return {
    listingKey: listing.key,
    portalId: listing.portalId,
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
