import Dexie from 'dexie';
import { acceptLearnedPoint, DEFAULT_CALIBRATION, estimateCreatedAt, LEARN_RATE_PER_DAY, mergeCalibration, utcDay } from '@/core/age';
import { AUTO_BACKUP_SLOTS, buildBackup, mergeBackup, parseBackup, type BackupFile } from '@/core/backup';
import type { HomeRadarDB } from '@/core/db';
import { warnedPortals } from '@/core/diagnostics';
import { buildLeadViews, defaultState, isListed, mergeGroupState, type Archive } from '@/core/lead-groups';
import { leadKeys, sortLeads } from '@/core/leads';
import { ONBOARDING_VERSION } from '@/core/onboarding';
import { addDays, startOfLocalDay } from '@/core/recall';
import { evaluate } from '@/core/rules';
import { groupListings, splitPair } from '@/core/same-property';
import { validateSettings } from '@/core/settings';
import {
  DAY_MS, listingKey, type BackupStatus, type CalibrationHint, type Diagnostics, type Evaluation, type ImportSummary, type LeadState, type LeadStatus, type LeadView,
  type ListingObservation, type ListingRecord, type ObservedPriceDrop, type OnboardingStatus, type Portal, type PriceDrop, type PriceSnapshot, type Settings,
} from '@/shared/types';

export const VISIT_GAP_MS = 30 * 60_000;
export const RECALL_ON_DISCARDED = 'Impossibile impostare un richiamo su un lead scartato';

type LeadPatch = { status?: LeadStatus; notes?: string; recallAt?: number | null };

/** Applica la modifica dell'agente a uno stato: `updatedAt` avanza solo se qualcosa cambia. */
function nextLeadState(prev: LeadState, patch: LeadPatch, now: number): LeadState {
  const next: LeadState = { ...prev, recallAt: prev.recallAt ?? null };
  const recallAt = patch.recallAt == null ? patch.recallAt : startOfLocalDay(patch.recallAt);
  let status = patch.status ?? prev.status;
  if (status === 'discarded' && recallAt != null) throw new Error(RECALL_ON_DISCARDED);
  // Un lead con un richiamo è già in lavorazione: da "Nuovo" passa a "Da contattare".
  if (recallAt != null && status === 'new') status = 'to_contact';
  if (patch.notes !== undefined && patch.notes !== prev.notes) {
    next.notes = patch.notes;
    next.updatedAt = now;
  }
  if (status !== prev.status) {
    next.status = status;
    next.statusChangedAt = now;
    next.updatedAt = now;
  }
  const nextRecall = status === 'discarded' ? null : recallAt === undefined ? next.recallAt : recallAt;
  if (nextRecall !== next.recallAt) {
    next.recallAt = nextRecall;
    next.updatedAt = now;
  }
  return next;
}

const sameState = (a: LeadState, b: LeadState) =>
  a.status === b.status && a.notes === b.notes && (a.recallAt ?? null) === b.recallAt && a.statusChangedAt === b.statusChangedAt;

/** Dà una data al ribasso: quella del portale, quella già registrata per lo stesso ribasso o oggi. */
function resolveDrop(drop: ObservedPriceDrop | null, prev: PriceDrop | null, now: number): PriceDrop | null {
  if (!drop) return null;
  if (drop.date != null) return { ...drop, date: drop.date };
  if (prev && prev.fromPrice === drop.fromPrice && prev.toPrice === drop.toPrice) return prev;
  return { ...drop, date: utcDay(now), dateEstimated: true };
}

export class LeadService {
  constructor(
    private readonly db: HomeRadarDB,
    private readonly clock: () => number = Date.now,
  ) {}

  async getSettings(): Promise<Settings> {
    const rec = await this.db.meta.get('settings');
    return validateSettings((rec?.value ?? {}) as Partial<Settings>);
  }

  async ingest(observations: ListingObservation[], hint?: CalibrationHint): Promise<Evaluation[]> {
    const now = this.clock();
    const settings = await this.getSettings();
    const { listings, priceSnapshots, leadStates, calibration } = this.db;

    const evaluations = await this.db.transaction('rw', [listings, priceSnapshots, leadStates, calibration], async () => {
      for (const o of observations) {
        if (o.portalCreatedAt != null) await calibration.put({ portal: o.portal, portalId: o.portalId, createdAt: o.portalCreatedAt });
      }
      const learned = await calibration.toArray();
      const pointsFor = (p: Portal) => mergeCalibration(DEFAULT_CALIBRATION[p], learned.filter((x) => x.portal === p));
      const rate = hint && LEARN_RATE_PER_DAY[hint.portal];
      if (hint && rate) {
        const candidate = { portal: hint.portal, portalId: hint.portalId, createdAt: utcDay(now) };
        if (acceptLearnedPoint(candidate, pointsFor(hint.portal), rate)) {
          await calibration.put(candidate);
          learned.push(candidate);
        }
      }

      const out: Evaluation[] = [];
      for (const o of observations) {
        if (o.sellerType !== 'private') continue;
        const key = listingKey(o.portal, o.portalId);
        const prev = await listings.get(key);
        const drop = resolveDrop(o.lastDrop, prev?.lastDrop ?? null, now);
        const record: ListingRecord = {
          key,
          portal: o.portal,
          portalId: o.portalId,
          url: o.url,
          title: o.title,
          address: o.address ?? prev?.address ?? null,
          city: o.city ?? prev?.city ?? null,
          zone: o.zone ?? prev?.zone ?? null,
          typology: o.typology ?? prev?.typology ?? null,
          surfaceM2: o.surfaceM2 ?? prev?.surfaceM2 ?? null,
          rooms: o.rooms ?? prev?.rooms ?? null,
          currentPrice: o.price ?? prev?.currentPrice ?? null,
          portalCreatedAt: o.portalCreatedAt ?? prev?.portalCreatedAt ?? null,
          estimatedCreatedAt: estimateCreatedAt(o.portalId, pointsFor(o.portal)),
          lastDrop: drop ?? prev?.lastDrop ?? null,
          firstSeenAt: prev?.firstSeenAt ?? now,
          lastSeenAt: now,
          seenCount: !prev ? 1 : now - prev.lastSeenAt >= VISIT_GAP_MS ? prev.seenCount + 1 : prev.seenCount,
        };
        // Se la visita precedente è recente, lastSeenAt non avanza: altrimenti visite ravvicinate
        // spezzerebbero all'infinito la finestra di VISIT_GAP_MS.
        if (prev && now - prev.lastSeenAt < VISIT_GAP_MS) record.lastSeenAt = prev.lastSeenAt;
        await listings.put(record);
        await this.recordSnapshots(key, drop, o.price, now);
        if (!(await leadStates.get(key))) {
          await leadStates.add({ listingKey: key, status: 'new', notes: '', statusChangedAt: now, updatedAt: now, recallAt: null });
        }
        const snaps = await priceSnapshots.where('listingKey').equals(key).toArray();
        out.push(evaluate(record, snaps, settings, now));
      }
      return out;
    });
    return this.withGroups(evaluations, settings, now);
  }

  /** Per gli annunci che fanno parte di un gruppo, la card mostra la valutazione del gruppo. */
  private async withGroups(evaluations: Evaluation[], settings: Settings, now: number): Promise<Evaluation[]> {
    if (!evaluations.length) return evaluations;
    const byKey = new Map<string, Evaluation>();
    for (const v of buildLeadViews(await this.archive(), settings, now)) {
      if (v.others.length) for (const k of leadKeys(v)) byKey.set(k, v.evaluation);
    }
    return evaluations.map((e) => {
      const g = byKey.get(e.listingKey);
      return g ? { ...g, listingKey: e.listingKey, portalId: e.portalId } : e;
    });
  }

  private async archive(): Promise<Archive> {
    const [listings, states, snapshots, splits] = await Promise.all([
      this.db.listings.toArray(),
      this.db.leadStates.toArray(),
      this.db.priceSnapshots.toArray(),
      this.db.splits.toArray(),
    ]);
    return { listings, states, snapshots, splits };
  }

  async saveSettings(input: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const s = validateSettings({ ...current, ...input, enabledPortals: { ...current.enabledPortals, ...input.enabledPortals } });
    await this.db.meta.put({ key: 'settings', value: s });
    return s;
  }

  async listLeads(): Promise<LeadView[]> {
    const settings = await this.getSettings();
    const views = buildLeadViews(await this.archive(), settings, this.clock());
    // Un lead con un richiamo resta visibile anche se è "Nuovo" senza segnali: l'icona lo conta.
    return sortLeads(views.filter(isListed));
  }

  /**
   * Stato, note e richiamo di uno o più annunci, in una transazione. Per lo stesso immobile su più portali la modifica
   * parte dallo stato del gruppo e lo stesso stato completo va su tutti i membri, così non restano stati diversi.
   */
  async setLeadState(keys: string | string[], patch: LeadPatch): Promise<LeadState> {
    const now = this.clock();
    const list = Array.isArray(keys) ? keys : [keys];
    if (!list.length) throw new Error('Annuncio non trovato');
    const { listings, leadStates } = this.db;
    return this.db.transaction('rw', [listings, leadStates], async () => {
      const members = [];
      for (const [i, listing] of (await listings.bulkGet(list)).entries()) {
        if (!listing) throw new Error('Annuncio non trovato');
        const own = await leadStates.get(listing.key);
        members.push({ listing, state: own ?? { listingKey: list[i]!, status: 'new' as LeadStatus, notes: '', statusChangedAt: now, updatedAt: now, recallAt: null } });
      }
      const prev = members.length === 1 ? members[0]!.state : mergeGroupState(members);
      const next = nextLeadState(prev, patch, now);
      // Un membro che cambia rispetto al suo stato salvato è una modifica: vale per i conflitti di un backup.
      if (members.some((m) => !sameState(m.state, next))) next.updatedAt = Math.max(next.updatedAt, now);
      await leadStates.bulkPut(list.map((k) => ({ ...next, listingKey: k })));
      return { ...next, listingKey: list[0]! };
    });
  }

  /**
   * Stacca `key` dalle altre fonti del suo gruppo. Prima scrive su tutti lo stato del gruppo, così un annuncio entrato
   * nel gruppo dopo l'ultima modifica non torna "Nuovo"; poi salva le coppie, che non si uniranno più.
   */
  async splitListing(key: string, fromKeys: string[]): Promise<void> {
    const now = this.clock();
    const { listings, leadStates, splits } = this.db;
    const keys = [key, ...fromKeys];
    await this.db.transaction('rw', [listings, leadStates, splits], async () => {
      const members = [];
      for (const listing of await listings.bulkGet(keys)) {
        if (!listing) throw new Error('Annuncio non trovato');
        members.push({ listing, state: (await leadStates.get(listing.key)) ?? defaultState(listing) });
      }
      const merged = mergeGroupState(members);
      await leadStates.bulkPut(keys.map((k) => ({ ...merged, listingKey: k, updatedAt: now })));
      await splits.bulkPut(fromKeys.map((k) => splitPair(key, k, now)));
    });
  }

  /** Richiami da fare oggi o in ritardo, per il numero sull'icona: lo stesso immobile su più portali conta una volta. */
  async dueRecallCount(now: number): Promise<number> {
    const due = await this.db.leadStates
      .where('recallAt')
      .below(addDays(startOfLocalDay(now), 1))
      .filter((s) => s.status !== 'discarded')
      .toArray();
    if (due.length < 2) return due.length;
    const [listings, splits] = await Promise.all([this.db.listings.toArray(), this.db.splits.toArray()]);
    const groupOf = new Map<string, string>();
    for (const g of groupListings(listings, splits)) for (const k of g) groupOf.set(k, g[0]!);
    return new Set(due.map((s) => groupOf.get(s.listingKey) ?? s.listingKey)).size;
  }

  async deleteListing(key: string): Promise<void> {
    await this.deleteListings([key]);
  }

  async deleteListings(keys: string[]): Promise<void> {
    if (!keys.length) return;
    const { listings, priceSnapshots, leadStates, splits } = this.db;
    await this.db.transaction('rw', [listings, priceSnapshots, leadStates, splits], async () => {
      await listings.bulkDelete(keys);
      await priceSnapshots.where('listingKey').anyOf(keys).delete();
      await leadStates.bulkDelete(keys);
      await splits.where('a').anyOf(keys).delete();
      await splits.where('b').anyOf(keys).delete();
    });
  }

  async deleteAllListings(): Promise<number> {
    const { listings, priceSnapshots, leadStates, splits } = this.db;
    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, splits], async () => {
      const count = await listings.count();
      await Promise.all([listings.clear(), priceSnapshots.clear(), leadStates.clear(), splits.clear()]);
      return count;
    });
  }

  async purge(): Promise<number> {
    const settings = await this.getSettings();
    const cutoff = this.clock() - settings.retentionDays * DAY_MS;
    const stale = await this.db.listings.where('lastSeenAt').below(cutoff).primaryKeys();
    let removed = 0;
    for (const key of stale) {
      const state = await this.db.leadStates.get(key);
      // Un lead lavorato o con un richiamo resta, anche se rimesso a mano su "Nuovo".
      if (state && (state.status !== 'new' || state.recallAt != null)) continue;
      await this.deleteListing(key);
      removed++;
    }
    return removed;
  }

  listingCount(): Promise<number> {
    return this.db.listings.count();
  }

  async exportBackup(extensionVersion: string): Promise<BackupFile> {
    const now = this.clock();
    const { listings, priceSnapshots, leadStates, calibration, meta, splits } = this.db;
    const file = await this.db.transaction('r', [listings, priceSnapshots, leadStates, calibration, meta, splits], async () => {
      const saved = await meta.get('settings');
      return buildBackup(
        {
          settings: saved ? validateSettings(saved.value as Partial<Settings>) : undefined,
          listings: await listings.toArray(),
          priceSnapshots: await priceSnapshots.toArray(),
          leadStates: await leadStates.toArray(),
          calibration: await calibration.toArray(),
          splits: await splits.toArray(),
        },
        now,
        extensionVersion,
      );
    });
    // Un backup che poi non si può ripristinare non deve risultare riuscito: lo si rilegge come farebbe l'importazione.
    try {
      parseBackup(JSON.parse(JSON.stringify(file)));
    } catch (err) {
      throw new Error(`Backup non ripristinabile: ${err instanceof Error ? err.message : String(err)}`);
    }
    return file;
  }

  /** Unisce un backup ai dati presenti, in un'unica transazione: o tutto o niente. */
  async importBackup(json: unknown): Promise<ImportSummary> {
    const file = parseBackup(json);
    const now = this.clock();
    const { listings, priceSnapshots, leadStates, calibration, meta, splits } = this.db;
    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, calibration, meta, splits], async () => {
      const m = mergeBackup(
        {
          listings: await listings.toArray(),
          priceSnapshots: await priceSnapshots.toArray(),
          leadStates: await leadStates.toArray(),
          calibration: await calibration.toArray(),
          splits: await splits.toArray(),
          settingsSaved: Boolean(await meta.get('settings')),
        },
        file,
        now,
      );
      await listings.bulkPut(m.listings);
      await priceSnapshots.bulkAdd(m.priceSnapshots);
      await leadStates.bulkPut(m.leadStates);
      await calibration.bulkPut(m.calibration);
      await splits.bulkPut(m.splits);
      if (m.settings) await meta.put({ key: 'settings', value: m.settings });
      return m.summary;
    });
  }

  async backupStatus(): Promise<BackupStatus> {
    const rec = await this.db.meta.get('backup');
    return { lastAt: null, lastAutoFailedAt: null, nextSlot: 1, pending: null, ...(rec?.value as Partial<BackupStatus> | undefined) };
  }

  async onboardingStatus(): Promise<OnboardingStatus> {
    const rec = (await this.db.meta.get('onboarding'))?.value as { version?: unknown; acceptedAt?: unknown } | undefined;
    const version = rec?.version;
    const acceptedAt = rec?.acceptedAt;
    // Un record di forma inattesa non vale come conferma.
    if (typeof version !== 'number' || typeof acceptedAt !== 'number') {
      return { acceptedVersion: null, acceptedAt: null, current: ONBOARDING_VERSION };
    }
    return { acceptedVersion: version, acceptedAt, current: ONBOARDING_VERSION };
  }

  async acceptOnboarding(): Promise<OnboardingStatus> {
    await this.db.meta.put({ key: 'onboarding', value: { version: ONBOARDING_VERSION, acceptedAt: this.clock() } });
    return this.onboardingStatus();
  }

  private async updateBackupStatus(fn: (s: BackupStatus) => void): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const s = await this.backupStatus();
      fn(s);
      await this.db.meta.put({ key: 'backup', value: s });
    });
  }

  /** Backup automatico avviato: segnato prima del download, che può concludersi in un altro service worker. */
  recordBackupStarted(slot: number, url: string): Promise<void> {
    const at = this.clock();
    return this.updateBackupStatus((s) => {
      s.pending = { slot, url, startedAt: at };
    });
  }

  /** Backup riuscito; `slotUsed` solo per quelli automatici, che ruotano sugli slot e chiudono quello in corso. */
  recordBackup(slotUsed?: number): Promise<void> {
    const at = this.clock();
    return this.updateBackupStatus((s) => {
      s.lastAt = at;
      if (slotUsed !== undefined) {
        s.nextSlot = (slotUsed % AUTO_BACKUP_SLOTS) + 1;
        s.pending = null;
      }
    });
  }

  async recordBackupFailure(message: string): Promise<void> {
    const at = this.clock();
    await this.updateBackupStatus((s) => {
      s.lastAutoFailedAt = at;
      s.pending = null;
    });
    await this.recordError(`Backup automatico non riuscito: ${message}`);
  }

  private async diag(): Promise<Omit<Diagnostics, 'version'>> {
    const rec = await this.db.meta.get('diagnostics');
    type Stored = Partial<Omit<Diagnostics, 'version' | 'adapterWarning'>> & { adapterWarning?: Diagnostics['adapterWarning'] | boolean };
    const raw = (rec?.value ?? {}) as Stored;
    const warning = raw.adapterWarning;
    return {
      counters: raw.counters ?? {},
      errors: raw.errors ?? [],
      // Le versioni precedenti salvavano un booleano: valeva per Immobiliare, l'unico portale.
      adapterWarning: typeof warning === 'boolean' ? (warning ? { immobiliare: true } : {}) : (warning ?? {}),
    };
  }

  private async updateDiag(fn: (d: Omit<Diagnostics, 'version'>) => void): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const d = await this.diag();
      fn(d);
      await this.db.meta.put({ key: 'diagnostics', value: d });
    });
  }

  recordError(message: string): Promise<void> {
    const at = this.clock();
    return this.updateDiag((d) => {
      d.errors = [...d.errors, { at, message }].slice(-20);
    });
  }

  bumpCounter(name: string, by = 1): Promise<void> {
    return this.updateDiag((d) => {
      d.counters[name] = (d.counters[name] ?? 0) + by;
    });
  }

  /**
   * Aggiorna l'avviso del portale. `any`: almeno un portale ha l'avviso acceso;
   * `changed`: l'avviso di questo portale è cambiato.
   */
  async setAdapterWarning(portal: Portal, on: boolean): Promise<{ any: boolean; changed: boolean }> {
    let any = false;
    let changed = false;
    await this.updateDiag((d) => {
      changed = Boolean(d.adapterWarning[portal]) !== on;
      d.adapterWarning = { ...d.adapterWarning, [portal]: on };
      any = warnedPortals(d.adapterWarning).length > 0;
    });
    return { any, changed };
  }

  async getDiagnostics(version: string): Promise<Diagnostics> {
    return { version, ...(await this.diag()) };
  }

  private async recordSnapshots(key: string, drop: PriceDrop | null, price: number | null, now: number): Promise<void> {
    const { priceSnapshots } = this.db;
    if (drop) {
      const declared = [
        { price: drop.fromPrice, at: drop.date - 1 },
        { price: drop.toPrice, at: drop.date },
      ];
      for (const s of declared) {
        const exists = await priceSnapshots.where('[listingKey+at]').equals([key, s.at]).first();
        if (!exists) await priceSnapshots.add({ listingKey: key, price: s.price, at: s.at, source: 'declared' });
      }
    }
    if (price != null) {
      const last = await priceSnapshots.where('[listingKey+at]').between([key, Dexie.minKey], [key, Dexie.maxKey]).last();
      if (!last || last.price !== price) {
        await priceSnapshots.add({ listingKey: key, price, at: now, source: 'observed' });
      }
    }
  }
}
