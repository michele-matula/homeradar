import { browser } from 'wxt/browser';
import { LEADS_CHANGED, ONBOARDING_CHANGED, send } from '@/shared/messages';
import type { BackupFile } from '@/core/backup';
import type { BackupStatus, Diagnostics, ImportSummary, LeadState, LeadStatus, LeadView, OnboardingStatus, Settings } from '@/shared/types';

export interface Api {
  listLeads(): Promise<LeadView[]>;
  setLeadState(listingKey: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState>;
  deleteListing(listingKey: string): Promise<void>;
  deleteListings(listingKeys: string[]): Promise<void>;
  deleteAllListings(): Promise<number>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  getDiagnostics(): Promise<Diagnostics>;
  exportBackup(): Promise<BackupFile>;
  importBackup(backup: unknown): Promise<ImportSummary>;
  getBackupStatus(): Promise<BackupStatus>;
  getOnboardingStatus(): Promise<OnboardingStatus>;
  acceptOnboarding(): Promise<OnboardingStatus>;
  onLeadsChanged(cb: () => void): () => void;
  onOnboardingChanged(cb: () => void): () => void;
}

/** Ascolta un messaggio diffuso dal background a tutte le pagine dell'estensione. */
function onBroadcast(type: string, cb: () => void): () => void {
  const listener = (msg: unknown) => {
    if ((msg as { type?: string } | undefined)?.type === type) cb();
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
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
  exportBackup: () => send({ type: 'exportBackup' }),
  importBackup: (backup) => send({ type: 'importBackup', backup }),
  getBackupStatus: () => send({ type: 'getBackupStatus' }),
  getOnboardingStatus: () => send({ type: 'getOnboardingStatus' }),
  acceptOnboarding: () => send({ type: 'acceptOnboarding' }),
  onLeadsChanged: (cb) => onBroadcast(LEADS_CHANGED, cb),
  onOnboardingChanged: (cb) => onBroadcast(ONBOARDING_CHANGED, cb),
};
