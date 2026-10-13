import { browser } from 'wxt/browser';
import { LEADS_CHANGED, send } from '@/shared/messages';
import type { Diagnostics, LeadState, LeadStatus, LeadView, Settings } from '@/shared/types';

export interface Api {
  listLeads(): Promise<LeadView[]>;
  setLeadState(listingKey: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState>;
  deleteListing(listingKey: string): Promise<void>;
  deleteListings(listingKeys: string[]): Promise<void>;
  deleteAllListings(): Promise<number>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  getDiagnostics(): Promise<Diagnostics>;
  onLeadsChanged(cb: () => void): () => void;
}

export const defaultApi: Api = {
  listLeads: () => send({ type: 'listLeads' }),
  setLeadState: (listingKey, patch) => send({ type: 'setLeadState', listingKey, ...patch }),
  deleteListing: (listingKey) => send({ type: 'deleteListing', listingKey }),
  deleteListings: (listingKeys) => send({ type: 'deleteListings', listingKeys }),
  deleteAllListings: () => send({ type: 'deleteAllListings' }),
  getSettings: () => send({ type: 'getSettings' }),
  saveSettings: (settings) => send({ type: 'saveSettings', settings }),
  getDiagnostics: () => send({ type: 'getDiagnostics' }),
  onLeadsChanged(cb) {
    const listener = (msg: unknown) => {
      if ((msg as { type?: string } | undefined)?.type === LEADS_CHANGED) cb();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  },
};
