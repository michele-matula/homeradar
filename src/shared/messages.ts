import { browser } from 'wxt/browser';
import type { LeadStatus, ListingObservation, Settings } from '@/shared/types';

export const LEADS_CHANGED = 'leadsChanged';

export type Request =
  | { type: 'ingest'; observations: ListingObservation[] }
  | { type: 'listLeads' }
  | { type: 'setLeadState'; listingKey: string; status?: LeadStatus; notes?: string }
  | { type: 'deleteListing'; listingKey: string }
  | { type: 'deleteListings'; listingKeys: string[] }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: Settings }
  | { type: 'parseStatus'; ok: boolean; errors: string[]; source: 'next-data' | 'api' }
  | { type: 'fallbackShown' }
  | { type: 'getDiagnostics' };

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
