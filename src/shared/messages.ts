import { browser } from 'wxt/browser';
import type { CalibrationHint, LeadStatus, ListingObservation, Portal, PortalState, Settings } from '@/shared/types';

export const LEADS_CHANGED = 'leadsChanged';
export const ONBOARDING_CHANGED = 'onboardingChanged';

export type ParseSource = 'next-data' | 'api' | 'dom';

export type Request =
  | { type: 'ingest'; observations: ListingObservation[]; calibrationHint?: CalibrationHint }
  | { type: 'listLeads' }
  | { type: 'setLeadState'; listingKey: string; status?: LeadStatus; notes?: string; recallAt?: number | null }
  | { type: 'deleteListing'; listingKey: string }
  | { type: 'deleteListings'; listingKeys: string[] }
  | { type: 'deleteAllListings' }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: Settings }
  | { type: 'parseStatus'; portal: Portal; ok: boolean; errors: string[]; source: ParseSource }
  | { type: 'fallbackShown' }
  | { type: 'getDiagnostics' }
  | { type: 'exportBackup' }
  | { type: 'importBackup'; backup: unknown }
  | { type: 'getBackupStatus' }
  | { type: 'getOnboardingStatus' }
  | { type: 'acceptOnboarding' }
  | { type: 'getPortalState'; portal: Portal }
  | { type: 'openOnboarding' };

/** Per i content script: leggere (attivo), no (spento) o no e avvisare (informativa da confermare). */
export function portalState(portal: Portal): Promise<PortalState> {
  return send<PortalState>({ type: 'getPortalState', portal });
}

export type Response<T> = { ok: true; data: T } | { ok: false; error: string };

const TRANSIENT = /Receiving end does not exist|Could not establish connection|Nessuna risposta dal background/;

export async function send<T>(req: Request, attempts = 2): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = (await browser.runtime.sendMessage(req)) as Response<T> | undefined;
      if (!res) throw new Error('Nessuna risposta dal background');
      if (!res.ok) throw new Error(res.error);
      return res.data;
    } catch (err) {
      if (i >= attempts || !TRANSIENT.test(err instanceof Error ? err.message : String(err))) throw err;
    }
  }
}
