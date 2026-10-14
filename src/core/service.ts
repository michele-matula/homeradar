import Dexie from 'dexie';
import { acceptLearnedPoint, DEFAULT_CALIBRATION, estimateCreatedAt, LEARN_RATE_PER_DAY, mergeCalibration, utcDay } from '@/core/age';
import type { HomeRadarDB } from '@/core/db';
import { warnedPortals } from '@/core/diagnostics';
import { sortLeads } from '@/core/leads';
import { evaluate } from '@/core/rules';
import { validateSettings } from '@/core/settings';
import {
  DAY_MS, listingKey, type CalibrationHint, type Diagnostics, type Evaluation, type LeadState, type LeadStatus, type LeadView,
  type ListingObservation, type ListingRecord, type ObservedPriceDrop, type Portal, type PriceDrop, type PriceSnapshot, type Settings,
} from '@/shared/types';

export const VISIT_GAP_MS = 30 * 60_000;

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

    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, calibration], async () => {
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

      const evaluations: Evaluation[] = [];
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
          await leadStates.add({ listingKey: key, status: 'new', notes: '', statusChangedAt: now });
        }
        const snaps = await priceSnapshots.where('listingKey').equals(key).toArray();
        evaluations.push(evaluate(record, snaps, settings, now));
      }
      return evaluations;
    });
  }

  async saveSettings(input: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const s = validateSettings({ ...current, ...input, enabledPortals: { ...current.enabledPortals, ...input.enabledPortals } });
    await this.db.meta.put({ key: 'settings', value: s });
    return s;
  }

  async listLeads(): Promise<LeadView[]> {
    const now = this.clock();
    const settings = await this.getSettings();
    const [listings, states, snaps] = await Promise.all([
      this.db.listings.toArray(),
      this.db.leadStates.toArray(),
      this.db.priceSnapshots.toArray(),
    ]);
    const stateByKey = new Map(states.map((s) => [s.listingKey, s]));
    const snapsByKey = new Map<string, PriceSnapshot[]>();
    for (const s of snaps) snapsByKey.set(s.listingKey, [...(snapsByKey.get(s.listingKey) ?? []), s]);

    const views = listings.map((listing): LeadView => {
      const prices = (snapsByKey.get(listing.key) ?? []).sort((a, b) => a.at - b.at);
      return {
        listing,
        evaluation: evaluate(listing, prices, settings, now),
        state: stateByKey.get(listing.key) ?? { listingKey: listing.key, status: 'new', notes: '', statusChangedAt: listing.firstSeenAt },
        prices,
      };
    });
    return sortLeads(views.filter((v) => v.evaluation.priority !== 'none' || v.state.status !== 'new'));
  }

  async setLeadState(key: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState> {
    const now = this.clock();
    return this.db.transaction('rw', [this.db.listings, this.db.leadStates], async () => {
      if (!(await this.db.listings.get(key))) throw new Error('Annuncio non trovato');
      const prev = (await this.db.leadStates.get(key)) ?? { listingKey: key, status: 'new' as LeadStatus, notes: '', statusChangedAt: now };
      const next: LeadState = { ...prev };
      if (patch.notes !== undefined) next.notes = patch.notes;
      if (patch.status !== undefined && patch.status !== prev.status) {
        next.status = patch.status;
        next.statusChangedAt = now;
      }
      await this.db.leadStates.put(next);
      return next;
    });
  }

  async deleteListing(key: string): Promise<void> {
    await this.deleteListings([key]);
  }

  async deleteListings(keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.db.transaction('rw', [this.db.listings, this.db.priceSnapshots, this.db.leadStates], async () => {
      await this.db.listings.bulkDelete(keys);
      await this.db.priceSnapshots.where('listingKey').anyOf(keys).delete();
      await this.db.leadStates.bulkDelete(keys);
    });
  }

  async deleteAllListings(): Promise<number> {
    return this.db.transaction('rw', [this.db.listings, this.db.priceSnapshots, this.db.leadStates], async () => {
      const count = await this.db.listings.count();
      await Promise.all([this.db.listings.clear(), this.db.priceSnapshots.clear(), this.db.leadStates.clear()]);
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
      if (state && state.status !== 'new') continue;
      await this.deleteListing(key);
      removed++;
    }
    return removed;
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
