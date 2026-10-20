import type { UsageStats } from '@/core/usage';

export type Portal = 'immobiliare' | 'idealista' | 'subito' | 'casadaprivato';
export const PORTALS: Portal[] = ['immobiliare', 'idealista', 'subito', 'casadaprivato'];
export const PORTAL_SITES: Record<Portal, string> = { immobiliare: 'Immobiliare.it', idealista: 'Idealista.it', subito: 'Subito.it', casadaprivato: 'CasaDaPrivato.it' };
export const PORTAL_TAGS: Record<Portal, string> = { immobiliare: 'Immobiliare', idealista: 'Idealista', subito: 'Subito', casadaprivato: 'CasaDaPrivato' };
export type SellerType = 'private' | 'agency' | 'constructor' | 'unknown';
export type PageKind = 'search' | 'detail' | 'other';

/** Categoria normalizzata dell'immobile: il confronto con il mercato e lo stesso immobile valgono solo dentro una categoria. */
export type PropertyCategory = 'residential' | 'commercial' | 'land' | 'garage';
export const PROPERTY_CATEGORIES: PropertyCategory[] = ['residential', 'commercial', 'land', 'garage'];
export const CATEGORY_LABELS: Record<PropertyCategory, string> = { residential: 'Residenziale', commercial: 'Commerciale', land: 'Terreni', garage: 'Box' };

/** Comune della zona di lavoro, come salvato nelle impostazioni. */
export interface ComuneRef {
  /** Codice ISTAT, 6 cifre. */
  istat: string;
  name: string;
  /** Sigla della provincia, "BG". */
  province: string;
}

/** Una ricerca del giro: URL della pagina 1 e categorie da tenere. Solo dati: si salva in storage.session. */
export interface SearchSpec {
  portal: Portal;
  /** Stabile tra un giro e l'altro: "immobiliare|comune:015059|case", "subito|comune:015059|immobili". */
  key: string;
  /** Per il pannello: "Treviglio · Case". */
  label: string;
  /** Categorie ammesse: una sola per Immobiliare e Idealista, quelle scelte per Subito. */
  categories: PropertyCategory[];
  /** La pagina porta tutte le categorie (Subito "immobili"): la categoria di un annuncio non si deduce dalla ricerca. */
  mixedCategories?: boolean;
  url: string;
}

export type SweepOutcome = 'completed' | 'partial' | 'stopped' | 'interrupted';
export type PortalSweepOutcome = 'complete' | 'capped' | 'blocked' | 'error' | 'skipped';

export interface PortalSweepStats {
  pages: number;
  privates: number;
  outcome: PortalSweepOutcome;
}

/** Esito dell'ultimo giro, in `meta.sweep` (fuori dal backup). */
export interface SweepResult {
  startedAt: number;
  finishedAt: number;
  outcome: SweepOutcome;
  portals: Partial<Record<Portal, PortalSweepStats>>;
  /** Ricerche che il portale non riconosce: "Treviglio · Case (Idealista)". */
  notFound: string[];
  newCount: number;
  drops: number;
  missing: number;
}

/** Avanzamento del giro in corso, per il pannello. */
export interface SweepProgress {
  startedAt: number;
  total: number;
  done: number;
  current: string | null;
  portals: Partial<Record<Portal, { pages: number; privates: number }>>;
  newCount: number;
  drops: number;
}

export interface SweepStatus {
  running: SweepProgress | null;
  last: SweepResult | null;
}

/** Zona di lavoro: dove e cosa cerca il giro delle ricerche. */
export interface SearchArea {
  comuni: ComuneRef[];
  categories: PropertyCategory[];
}
export type ObservationSource = 'search' | 'detail';

export const DAY_MS = 86_400_000;
/** Due visite più vicine di così sono la stessa visita: `lastSeenAt` non avanza. */
export const VISIT_GAP_MS = 30 * 60_000;

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
  /** Categoria riconosciuta dalla tipologia; null se la tipologia non la dice. */
  category: PropertyCategory | null;
  surfaceM2: number | null;
  rooms: number | null;
  price: number | null;
  sellerType: SellerType;
  portalCreatedAt: number | null;
  lastDrop: ObservedPriceDrop | null;
  /** Foto di copertina su un server immagini ammesso (`core/cover.ts`); null se manca o non è riconosciuta. */
  coverUrl: string | null;
  source: ObservationSource;
}

/** Opzioni di `ingest` per le pagine lette dal giro delle ricerche. */
export interface IngestOptions {
  /** Ricerca del giro che ha letto la pagina. */
  sweepScope?: string;
  /** Categoria della ricerca, usata se la tipologia non dice la categoria. */
  searchCategory?: PropertyCategory | null;
  /** Chiamata per un annuncio già salvato il cui prezzo è sceso o che ha un ribasso nuovo dichiarato dal portale. */
  onDrop?: (listingKey: string) => void;
}

/** Riassunto di una pagina di ricerca, per la condizione di fine del giro. */
export interface PageInfo {
  /** Annunci letti in pagina, agenzie comprese. */
  results: number;
  privates: number;
  lastPage: boolean;
}

/** Pagina di ricerca letta da un content script, mandata al giro con `pageRead`. */
export interface PageReport extends PageInfo {
  portal: Portal;
  url: string;
  /** Verifica di DataDome ("non sei un robot"). */
  blocked: boolean;
  /** Il portale dice che la pagina non esiste (comune o percorso sbagliato). */
  notFound: boolean;
  /** Annunci non letti o con venditore non riconosciuto: la pagina non può dire che la ricerca è completa. */
  parseErrors: number;
}

export interface ParseResult {
  observations: ListingObservation[];
  errors: string[];
  /** Pagine "più recenti": ID più alto in pagina, candidato punto di calibrazione. */
  newestId?: number;
  /** Pagine di ricerca: riassunto per il giro delle ricerche. */
  page?: PageInfo;
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
  category: PropertyCategory;
  surfaceM2: number | null;
  rooms: number | null;
  currentPrice: number | null;
  portalCreatedAt: number | null;
  estimatedCreatedAt: number | null;
  lastDrop: PriceDrop | null;
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
  /** `key` dell'ultima ricerca del giro in cui l'annuncio è stato visto; null se visto solo navigando a mano. */
  sweepScope: string | null;
  /** Giri consecutivi in cui la sua ricerca è stata completa e l'annuncio non c'era. */
  missedSweeps: number;
  /** Inizio del primo di quei giri; null se l'annuncio è stato visto nell'ultimo giro. */
  missingSince: number | null;
  /** Foto di copertina; assente se non nota (mai null: un record senza copertina ha la stessa forma di prima). */
  coverUrl?: string;
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
  /** Codice dell'agenzia per l'invio dei report del pilota; vuoto = nessun invio. */
  pilotCode: string;
  /** Invio giornaliero delle statistiche d'uso anonime al gestore del pilota. */
  reportingEnabled: boolean;
  /** Comuni e categorie del giro delle ricerche; senza comuni «Cerca» resta spento. */
  searchArea: SearchArea;
}

export const DEFAULT_SETTINGS: Settings = {
  minAgeDays: 120,
  minDropPercent: 0,
  retentionDays: 90,
  autoBackup: true,
  enabledPortals: { immobiliare: true, idealista: true, subito: true, casadaprivato: true },
  pilotCode: '',
  reportingEnabled: true,
  // Di default solo le case: le altre categorie allungano il giro (una ricerca in più per comune e categoria).
  searchArea: { comuni: [], categories: ['residential'] },
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

/** Un annuncio del lead, con la sua valutazione e il suo storico prezzi. */
export interface LeadSource {
  listing: ListingRecord;
  evaluation: Evaluation;
  prices: PriceSnapshot[];
  /** Vero per un annuncio sostituito da una ripubblicazione sullo stesso portale. */
  previous: boolean;
}

export interface LeadView {
  listing: ListingRecord;
  evaluation: Evaluation;
  state: LeadState;
  /** Storico prezzi del principale e degli annunci che ha sostituito, in ordine di tempo. */
  prices: PriceSnapshot[];
  /** Confronto con la mediana €/m² della zona o della città; null se il campione non basta. */
  market: MarketComparison | null;
  /** Altre fonti dello stesso immobile (altri portali e annunci precedenti), senza il principale (`listing`); vuoto se il lead è da solo. */
  others: LeadSource[];
  /** Vero se il lead contiene almeno un annuncio sostituito da una ripubblicazione. */
  reposted: boolean;
  /** Non più visto nei giri: data del primo giro mancato; null se almeno un annuncio principale c'è ancora. */
  missing: number | null;
  /** Portali da cui l'immobile è sparito mentre resta visibile su un altro. */
  missingPortals: Portal[];
  /** Copertine del gruppo in ordine di preferenza (principale, altre fonti vive, annunci precedenti); vuoto se nessuna. */
  covers: string[];
}

export interface Diagnostics {
  version: string;
  counters: Record<string, number>;
  errors: { at: number; message: string }[];
  adapterWarning: Partial<Record<Portal, boolean>>;
  /** Aggiunti dal router per il report copiato; assenti nel diagnostico salvato. */
  usage?: UsageStats;
  reporting?: ReportingInfo;
}

export interface ReportingStatus {
  lastSentAt: number | null;
  lastAttemptAt: number | null;
  lastError: 'network' | 'server' | 'rejected' | 'invalid' | null;
  /** Il Worker non riconosce il codice pilota: niente invii automatici finché il codice cambia. */
  codeRejected: boolean;
}

export interface QueuedFeedback {
  id: string;
  text: string;
  createdAt: number;
  version: string;
}

/** Per la scheda Pilota: invio configurato nella build, stato, feedback in coda. */
export interface ReportingInfo {
  configured: boolean;
  status: ReportingStatus;
  queued: number;
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
