export type Portal = 'immobiliare';
export type SellerType = 'private' | 'agency' | 'constructor' | 'unknown';
export type PageKind = 'search' | 'detail' | 'other';
export type ObservationSource = 'search' | 'detail';

export const DAY_MS = 86_400_000;

export interface PriceDrop {
  fromPrice: number;
  toPrice: number;
  percent: number;
  /** ms epoch, mezzanotte UTC del giorno del ribasso */
  date: number;
}

export interface ListingObservation {
  portal: Portal;
  portalId: number;
  url: string;
  title: string;
  address: string | null;
  city: string | null;
  zone: string | null;
  typology: string | null;
  surfaceM2: number | null;
  rooms: number | null;
  price: number | null;
  sellerType: SellerType;
  portalCreatedAt: number | null;
  lastDrop: PriceDrop | null;
  source: ObservationSource;
}

export interface ParseResult {
  observations: ListingObservation[];
  errors: string[];
}

export interface ListingRecord {
  key: string;
  portal: Portal;
  portalId: number;
  url: string;
  title: string;
  address: string | null;
  city: string | null;
  zone: string | null;
  typology: string | null;
  surfaceM2: number | null;
  rooms: number | null;
  currentPrice: number | null;
  portalCreatedAt: number | null;
  estimatedCreatedAt: number | null;
  lastDrop: PriceDrop | null;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
}

export type SnapshotSource = 'observed' | 'declared';

export interface PriceSnapshot {
  id?: number;
  listingKey: string;
  price: number;
  at: number;
  source: SnapshotSource;
}

export type LeadStatus = 'new' | 'to_contact' | 'contacted' | 'discarded';
export const LEAD_STATUSES: LeadStatus[] = ['new', 'to_contact', 'contacted', 'discarded'];

export interface LeadState {
  listingKey: string;
  status: LeadStatus;
  notes: string;
  statusChangedAt: number;
}

export interface Settings {
  minAgeDays: number;
  minDropPercent: number;
  retentionDays: number;
}

export const DEFAULT_SETTINGS: Settings = { minAgeDays: 120, minDropPercent: 0, retentionDays: 90 };

export interface CalibrationPoint {
  portalId: number;
  createdAt: number;
}

export type Priority = 'high' | 'medium' | 'verify' | 'none';

export interface Evaluation {
  listingKey: string;
  portalId: number;
  priority: Priority;
  ageDays: number | null;
  ageEstimated: boolean;
  ageUncertain: boolean;
  dropPercent: number;
  dropCount: number;
  maxKnownPrice: number | null;
  reasons: string[];
  badgeText: string;
}

export interface LeadView {
  listing: ListingRecord;
  evaluation: Evaluation;
  state: LeadState;
  prices: PriceSnapshot[];
}

export interface Diagnostics {
  version: string;
  counters: Record<string, number>;
  errors: { at: number; message: string }[];
  adapterWarning: boolean;
}

export function listingKey(portal: Portal, portalId: number): string {
  return `${portal}:${portalId}`;
}
