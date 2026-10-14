import type { LeadService } from '@/core/service';
import type { Request } from '@/shared/messages';

export interface RouterHooks {
  setWarning(on: boolean): void;
  leadsChanged(): void;
}

const PAYLOAD_COUNTERS = { api: 'apiPayloads', 'next-data': 'nextDataPayloads', dom: 'domScans' } as const;

export async function handleRequest(service: LeadService, req: Request, version: string, hooks: RouterHooks): Promise<unknown> {
  switch (req.type) {
    case 'ingest': {
      const evaluations = await service.ingest(req.observations, req.calibrationHint);
      await service.bumpCounter('ingested', req.observations.length);
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
      hooks.leadsChanged();
      return saved;
    }
    case 'parseStatus': {
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
