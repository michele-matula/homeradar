export type Portal = 'immobiliare' | 'idealista' | 'subito';
export const PORTALS: Portal[] = ['immobiliare', 'idealista', 'subito'];
export const PORTAL_SITES: Record<Portal, string> = { immobiliare: 'Immobiliare.it', idealista: 'Idealista.it', subito: 'Subito.it' };
export const PORTAL_TAGS: Record<Portal, string> = { immobiliare: 'Immobiliare', idealista: 'Idealista', subito: 'Subito' };
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
  /** true se il portale non dichiara la data: è il giorno in cui HomeRadar ha visto il ribasso. */
  dateEstimated?: boolean;
}

/** Ribasso come letto dal portale: Idealista non ne dichiara la data. */
export interface ObservedPriceDrop {
  fromPrice: number;
  toPrice: number;
  percent: number;
  date: number | null;
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
  lastDrop: ObservedPriceDrop | null;
  source: ObservationSource;
}

export interface ParseResult {
  observations: ListingObservation[];
  errors: string[];
  /** Pagine "più recenti": ID più alto in pagina, candidato punto di calibrazione. */
  newestId?: number;
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

/** Due annunci che l'agente ha separato: non vanno più uniti. `a < b`, chiavi di listing. */
export interface SplitPair {
  a: string;
  b: string;
  at: number;
}

export type LeadStatus = 'new' | 'to_contact' | 'contacted' | 'discarded';
export const LEAD_STATUSES: LeadStatus[] = ['new', 'to_contact', 'contacted', 'discarded'];

export interface LeadState {
  listingKey: string;
  status: LeadStatus;
  notes: string;
  statusChangedAt: number;
  /** Ultimo cambio di stato o di note: decide quale versione vince quando si importa un backup. */
  updatedAt: number;
  /** Giorno del ricontatto: mezzanotte locale in ms epoch; null se non c'è un richiamo. */
  recallAt: number | null;
}

export interface Settings {
  minAgeDays: number;
  minDropPercent: number;
  retentionDays: number;
  /** Backup settimanale automatico nella cartella Download/HomeRadar. */
  autoBackup: boolean;
  /** Portali su cui l'estensione lavora: su un portale spento non legge né salva nulla. */
  enabledPortals: Record<Portal, boolean>;
}

export const DEFAULT_SETTINGS: Settings = {
  minAgeDays: 120,
  minDropPercent: 0,
  retentionDays: 90,
  autoBackup: true,
  enabledPortals: { immobiliare: true, idealista: true, subito: true },
};

export interface CalibrationPoint {
  portal: Portal;
  portalId: number;
  createdAt: number;
}

/** ID dell'annuncio più recente di una pagina "più recenti": candidato punto "creato oggi". */
export interface CalibrationHint {
  portal: Portal;
  portalId: number;
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

/** Confronto del €/m² di un lead con la mediana dei privati visti nella stessa zona o città. Calcolato, mai salvato. */
export interface MarketComparison {
  scope: 'zone' | 'city';
  /** Zona o città come la scrive il portale del lead. */
  label: string;
  /** Città del lead, per il testo della zona. */
  city: string;
  medianPerM2: number;
  /** Annunci usati per la mediana, escluso il lead. */
  sampleSize: number;
  deltaPercent: number;
}

export interface LeadView {
  listing: ListingRecord;
  evaluation: Evaluation;
  state: LeadState;
  prices: PriceSnapshot[];
  /** Confronto con la mediana €/m² della zona o della città; null se il campione non basta. */
  market: MarketComparison | null;
}

export interface Diagnostics {
  version: string;
  counters: Record<string, number>;
  errors: { at: number; message: string }[];
  adapterWarning: Partial<Record<Portal, boolean>>;
}

export function listingKey(portal: Portal, portalId: number): string {
  return `${portal}:${portalId}`;
}

export interface BackupStatus {
  /** Ultimo backup riuscito, automatico o manuale. */
  lastAt: number | null;
  /** Ultimo tentativo automatico fallito. */
  lastAutoFailedAt: number | null;
  /** Slot (1–4) del prossimo backup automatico. */
  nextSlot: number;
  /** Backup automatico avviato e non ancora concluso (es. finestra "Salva con nome" aperta). */
  pending: PendingBackup | null;
}

export interface PendingBackup {
  slot: number;
  /** URL blob del file: identifica il download anche dopo un riavvio del service worker. */
  url: string;
  startedAt: number;
}

export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
}

/** Conferma dell'informativa (record `meta.onboarding`, fuori dal backup). */
export interface OnboardingStatus {
  acceptedVersion: number | null;
  acceptedAt: number | null;
  /** Versione dell'informativa di questa build. */
  current: number;
}

/** Cosa deve fare un content script sul suo portale. */
export type PortalState = 'active' | 'off' | 'onboarding';
