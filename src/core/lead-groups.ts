import { PRIORITY_ORDER } from '@/core/leads';
import { compareToMarket } from '@/core/market';
import { evaluate, evaluateGroup } from '@/core/rules';
import { groupListings } from '@/core/same-property';
import {
  PORTAL_TAGS,
  type LeadSource, type LeadState, type LeadView, type ListingRecord, type PriceSnapshot, type Settings, type SplitPair,
} from '@/shared/types';

/** Tutto ciò che serve per costruire i lead, letto dal database. */
export interface Archive {
  listings: ListingRecord[];
  states: LeadState[];
  snapshots: PriceSnapshot[];
  splits: SplitPair[];
}

export function defaultState(listing: ListingRecord): LeadState {
  return { listingKey: listing.key, status: 'new', notes: '', statusChangedAt: listing.firstSeenAt, updatedAt: listing.firstSeenAt, recallAt: null };
}

export interface MemberState {
  listing: ListingRecord;
  state: LeadState;
}

/** Il campo note è su una riga: le note di portali diversi si separano così. */
export const NOTES_SEPARATOR = ' · ';

/**
 * Stato del lead unito: stato, richiamo e date del membro modificato più di recente. Le note, se diverse,
 * si mostrano tutte con il portale davanti, così nessuna sparisce. `listingKey` è del primo membro (il principale).
 */
export function mergeGroupState(members: MemberState[]): LeadState {
  const latest = members.reduce((best, m) => (m.state.updatedAt > best.state.updatedAt ? m : best));
  const noted = members.filter((m) => m.state.notes.trim());
  const distinct = new Set(noted.map((m) => m.state.notes.trim()));
  const notes =
    distinct.size <= 1
      ? (noted[0]?.state.notes.trim() ?? '')
      : noted.map((m) => `${PORTAL_TAGS[m.listing.portal]}: ${m.state.notes.trim()}`).join(NOTES_SEPARATOR);
  return { ...latest.state, listingKey: members[0]!.listing.key, notes };
}

/** Principale del gruppo: priorità più alta, poi età maggiore, poi visto più di recente, poi chiave. */
function byPrimary(a: LeadSource, b: LeadSource): number {
  const p = PRIORITY_ORDER[a.evaluation.priority] - PRIORITY_ORDER[b.evaluation.priority];
  if (p !== 0) return p;
  const age = (b.evaluation.ageDays ?? -1) - (a.evaluation.ageDays ?? -1);
  if (age !== 0) return age;
  if (a.listing.lastSeenAt !== b.listing.lastSeenAt) return b.listing.lastSeenAt - a.listing.lastSeenAt;
  return a.listing.key < b.listing.key ? -1 : 1;
}

/** Un lead per immobile, senza filtri di visibilità né ordinamento. */
export function buildLeadViews({ listings, states, snapshots, splits }: Archive, settings: Settings, now: number): LeadView[] {
  const stateByKey = new Map(states.map((s) => [s.listingKey, s]));
  const snapsByKey = new Map<string, PriceSnapshot[]>();
  for (const s of snapshots) {
    const list = snapsByKey.get(s.listingKey);
    if (list) list.push(s);
    else snapsByKey.set(s.listingKey, [s]);
  }
  const sources = new Map<string, LeadSource>();
  for (const listing of listings) {
    const prices = (snapsByKey.get(listing.key) ?? []).sort((a, b) => a.at - b.at);
    sources.set(listing.key, { listing, prices, evaluation: evaluate(listing, prices, settings, now) });
  }

  const units: LeadSource[][] = [];
  const grouped = new Set<string>();
  for (const keys of groupListings(listings, splits)) {
    units.push(keys.map((k) => sources.get(k)!).sort(byPrimary));
    for (const k of keys) grouped.add(k);
  }
  for (const s of sources.values()) if (!grouped.has(s.listing.key)) units.push([s]);

  // Mediana sull'archivio intero, prima dei filtri di visibilità, e un solo annuncio per immobile.
  const market = compareToMarket(units.map((u) => u[0]!.listing));
  const stateOf = (l: ListingRecord) => stateByKey.get(l.key) ?? defaultState(l);

  return units.map((members) => {
    const [primary, ...others] = members as [LeadSource, ...LeadSource[]];
    return {
      listing: primary.listing,
      evaluation: others.length ? evaluateGroup(primary.listing, members, settings, now) : primary.evaluation,
      state: others.length ? mergeGroupState(members.map((m) => ({ listing: m.listing, state: stateOf(m.listing) }))) : stateOf(primary.listing),
      prices: primary.prices,
      market: market.get(primary.listing.key) ?? null,
      others,
    };
  });
}

/** Un lead si mostra se ha segnali, è già stato lavorato o ha un richiamo: l'icona lo conta. */
export function isListed(v: LeadView): boolean {
  return v.evaluation.priority !== 'none' || v.state.status !== 'new' || v.state.recallAt != null;
}
