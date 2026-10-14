import type { LeadService } from '@/core/service';
import type { Request } from '@/shared/messages';
import { PORTALS } from '@/shared/types';

export interface RouterHooks {
  setWarning(on: boolean): void;
  leadsChanged(): void;
}

const PAYLOAD_COUNTERS = { api: 'apiPayloads', 'next-data': 'nextDataPayloads', dom: 'domScans' } as const;

export async function handleRequest(service: LeadService, req: Request, version: string, hooks: RouterHooks): Promise<unknown> {
  switch (req.type) {
    case 'ingest': {
      // Difesa in profondità: anche se un content script invia dati, un portale spento non salva nulla.
      const enabled = (await service.getSettings()).enabledPortals;
      const observations = req.observations.filter((o) => enabled[o.portal]);
      if (!observations.length) return [];
      const hint = req.calibrationHint && enabled[req.calibrationHint.portal] ? req.calibrationHint : undefined;
      const evaluations = await service.ingest(observations, hint);
      await service.bumpCounter('ingested', observations.length);
      if (evaluations.length) hooks.leadsChanged();
      return evaluations;
    }
    case 'listLeads':
      return service.listLeads();
    case 'setLeadState':
      return service.setLeadState(req.listingKey, { status: req.status, notes: req.notes });
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
      const saved = await service.saveSettings(req.settings);
      // Un portale spento non viene più letto: un suo avviso resterebbe acceso per sempre.
      let warning: { any: boolean } | null = null;
      for (const p of PORTALS) if (!saved.enabledPortals[p]) warning = await service.setAdapterWarning(p, false);
      if (warning) hooks.setWarning(warning.any);
      hooks.leadsChanged();
      return saved;
    }
    case 'parseStatus': {
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
    case 'fallbackShown':
      await service.bumpCounter('fallbackShown');
      return null;
    case 'getDiagnostics':
      return service.getDiagnostics(version);
    default:
      throw new Error(`Richiesta sconosciuta: ${(req as { type?: string }).type}`);
  }
}
