import type { LeadService } from '@/core/service';
import type { Request } from '@/shared/messages';

export interface RouterHooks {
  setWarning(on: boolean): void;
  leadsChanged(): void;
}

export async function handleRequest(service: LeadService, req: Request, version: string, hooks: RouterHooks): Promise<unknown> {
  switch (req.type) {
    case 'ingest': {
      const evaluations = await service.ingest(req.observations);
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
    case 'getSettings':
      return service.getSettings();
    case 'saveSettings': {
      const saved = await service.saveSettings(req.settings);
      hooks.leadsChanged();
      return saved;
    }
    case 'parseStatus':
      await service.bumpCounter(req.source === 'api' ? 'apiPayloads' : 'nextDataPayloads');
      for (const e of req.errors.slice(0, 5)) await service.recordError(e);
      await service.setAdapterWarning(!req.ok);
      hooks.setWarning(!req.ok);
      return null;
    case 'fallbackShown':
      await service.bumpCounter('fallbackShown');
      return null;
    case 'getDiagnostics':
      return service.getDiagnostics(version);
    default:
      throw new Error(`Richiesta sconosciuta: ${(req as { type?: string }).type}`);
  }
}
