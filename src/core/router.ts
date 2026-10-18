import type { Reporter } from '@/background/reporter';
import { needsOnboarding } from '@/core/onboarding';
import type { LeadService } from '@/core/service';
import type { Request } from '@/shared/messages';
import { PORTALS, type IngestOptions, type ListingObservation, type PageReport, type PortalState, type SweepStatus } from '@/shared/types';

/** Il giro delle ricerche, visto dal router (orchestratore nel background). */
export interface SweepHooks {
  /** Scheda del giro: annunci da salvare e opzioni di ingest; null per le altre schede. */
  intercept(tabId: number | undefined, observations: ListingObservation[], url?: string): Promise<{ observations: ListingObservation[]; options: IngestOptions } | null>;
  pageRead(tabId: number | undefined, report: PageReport): Promise<void>;
  start(): Promise<SweepStatus>;
  stop(): Promise<SweepStatus>;
  status(): Promise<SweepStatus>;
}

export interface RouterHooks {
  setWarning(on: boolean): void;
  leadsChanged(): void;
  /** Un lead ha cambiato stato o richiamo: va ricalcolato il numero sull'icona. */
  recallsChanged(): void;
  /** Conferma dell'informativa cambiata: le pagine dell'estensione si aggiornano. */
  onboardingChanged(): void;
  /** Apre la scheda di benvenuto. */
  openOnboarding(): Promise<void>;
  /** Invio dei report e dei feedback del pilota. */
  reporter: Reporter;
  /** Giro delle ricerche. */
  sweep: SweepHooks;
}

/** Finché l'informativa non è confermata non si legge né si salva nulla dai portali. */
async function awaitingOnboarding(service: LeadService): Promise<boolean> {
  const s = await service.onboardingStatus();
  return needsOnboarding(s.acceptedVersion, s.current);
}

const PAYLOAD_COUNTERS = { api: 'apiPayloads', 'next-data': 'nextDataPayloads', dom: 'domScans' } as const;

export async function handleRequest(
  service: LeadService, req: Request, version: string, hooks: RouterHooks, ctx: { tabId?: number; url?: string } = {},
): Promise<unknown> {
  switch (req.type) {
    case 'ingest': {
      if (await awaitingOnboarding(service)) return [];
      // Difesa in profondità: anche se un content script invia dati, un portale spento non salva nulla.
      const enabled = (await service.getSettings()).enabledPortals;
      const observations = req.observations.filter((o) => enabled[o.portal]);
      if (!observations.length) return [];
      const hint = req.calibrationHint && enabled[req.calibrationHint.portal] ? req.calibrationHint : undefined;
      // Pagine del giro: solo le categorie della ricerca, con la ricerca che le ha lette.
      const sweep = await hooks.sweep.intercept(ctx.tabId, observations, ctx.url);
      const toSave = sweep ? sweep.observations : observations;
      if (!toSave.length) return [];
      const evaluations = await service.ingest(toSave, hint, sweep?.options);
      await service.bumpCounter('ingested', toSave.length);
      await service.trackUsage({ kind: 'browsing' });
      if (evaluations.length) hooks.leadsChanged();
      return evaluations;
    }
    case 'listLeads':
      return service.listLeads();
    case 'setLeadState': {
      const state = await service.setLeadState(req.listingKeys, { status: req.status, notes: req.notes, recallAt: req.recallAt });
      hooks.recallsChanged();
      return state;
    }
    case 'splitListing':
      await service.splitListing(req.listingKey, req.fromKeys);
      // Separare può cambiare il numero dei richiami: un gruppo diventa due lead.
      hooks.recallsChanged();
      return null;
    case 'deleteListing':
      await service.deleteListing(req.listingKey);
      hooks.leadsChanged();
      return null;
    case 'deleteListings':
      await service.deleteListings(req.listingKeys);
      hooks.leadsChanged();
      return null;
    case 'deleteAllListings': {
      const removed = await service.deleteAllListings();
      hooks.leadsChanged();
      return removed;
    }
    case 'getSettings':
      return service.getSettings();
    case 'saveSettings': {
      const before = (await service.getSettings()).pilotCode;
      const saved = await service.saveSettings(req.settings);
      // Un codice nuovo va riprovato: il rifiuto valeva per quello vecchio.
      if (saved.pilotCode !== before) {
        await service.pilot.updateReporting((s) => {
          s.codeRejected = false;
          if (s.lastError === 'rejected') s.lastError = null;
        });
      }
      // Un portale spento non viene più letto: un suo avviso resterebbe acceso per sempre.
      let warning: { any: boolean } | null = null;
      for (const p of PORTALS) if (!saved.enabledPortals[p]) warning = await service.setAdapterWarning(p, false);
      if (warning) hooks.setWarning(warning.any);
      hooks.leadsChanged();
      return saved;
    }
    case 'parseStatus': {
      if (await awaitingOnboarding(service)) return null;
      if (!(await service.getSettings()).enabledPortals[req.portal]) return null;
      await service.bumpCounter(PAYLOAD_COUNTERS[req.source]);
      for (const e of req.errors.slice(0, 5)) await service.recordError(e);
      const warning = await service.setAdapterWarning(req.portal, !req.ok);
      hooks.setWarning(warning.any);
      // Il pannello rilegge l'avviso solo su leadsChanged: senza questo, un avviso spento
      // senza nuovi lead resterebbe a video fino alla riapertura.
      if (warning.changed) hooks.leadsChanged();
      return null;
    }
    case 'pageRead':
      await hooks.sweep.pageRead(ctx.tabId, req.report);
      return null;
    case 'startSweep':
      return hooks.sweep.start();
    case 'stopSweep':
      return hooks.sweep.stop();
    case 'getSweepStatus':
      return hooks.sweep.status();
    case 'fallbackShown':
      await service.bumpCounter('fallbackShown');
      return null;
    case 'getDiagnostics':
      return { ...(await service.getDiagnostics(version)), usage: await service.pilot.usage(), reporting: await hooks.reporter.info() };
    case 'exportBackup': {
      const file = await service.exportBackup(version);
      await service.recordBackup();
      return file;
    }
    case 'importBackup': {
      const summary = await service.importBackup(req.backup);
      hooks.leadsChanged();
      return summary;
    }
    case 'getBackupStatus':
      return service.backupStatus();
    case 'getOnboardingStatus':
      return service.onboardingStatus();
    case 'acceptOnboarding': {
      const status = await service.acceptOnboarding();
      hooks.onboardingChanged();
      return status;
    }
    case 'getPortalState': {
      let state: PortalState = 'onboarding';
      if (!(await awaitingOnboarding(service))) state = (await service.getSettings()).enabledPortals[req.portal] ? 'active' : 'off';
      return state;
    }
    case 'trackUsage':
      await service.trackUsage(req.event);
      return null;
    case 'getReportingInfo':
      return hooks.reporter.info();
    case 'sendReportNow':
      return hooks.reporter.sendReport('manual');
    case 'previewReport':
      return hooks.reporter.preview();
    case 'sendFeedback':
      return hooks.reporter.sendFeedback(req.text);
    case 'openOnboarding':
      try {
        await hooks.openOnboarding();
      } catch (err) {
        await service.recordError(`Apertura dell'informativa: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
    default:
      throw new Error(`Richiesta sconosciuta: ${(req as { type?: string }).type}`);
  }
}
