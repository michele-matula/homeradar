import { browser } from 'wxt/browser';
import { LEADS_CHANGED, ONBOARDING_CHANGED, send, SWEEP_CHANGED } from '@/shared/messages';
import type { BackupFile } from '@/core/backup';
import type { UsageClientEvent } from '@/core/usage';
import type { UsageReport } from '@/shared/report-schema';
import type { BackupStatus, Diagnostics, ImportSummary, LeadState, LeadStatus, LeadView, OnboardingStatus, ReportingInfo, Settings, SweepStatus } from '@/shared/types';

export interface Api {
  listLeads(): Promise<LeadView[]>;
  setLeadState(listingKeys: string[], patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): Promise<LeadState>;
  splitListing(listingKey: string, fromKeys: string[]): Promise<void>;
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
  getReportingInfo(): Promise<ReportingInfo>;
  sendReportNow(): Promise<ReportingInfo>;
  previewReport(): Promise<UsageReport>;
  sendFeedback(text: string): Promise<'sent' | 'queued'>;
  trackUsage(event: UsageClientEvent): Promise<void>;
  onLeadsChanged(cb: () => void): () => void;
  onOnboardingChanged(cb: () => void): () => void;
  startSweep(): Promise<SweepStatus>;
  stopSweep(): Promise<SweepStatus>;
  getSweepStatus(): Promise<SweepStatus>;
  onSweepChanged(cb: () => void): () => void;
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
  setLeadState: (listingKeys, patch) => send({ type: 'setLeadState', listingKeys, ...patch }),
  splitListing: (listingKey, fromKeys) => send({ type: 'splitListing', listingKey, fromKeys }),
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
  getReportingInfo: () => send({ type: 'getReportingInfo' }),
  sendReportNow: () => send({ type: 'sendReportNow' }),
  previewReport: () => send({ type: 'previewReport' }),
  sendFeedback: (text) => send({ type: 'sendFeedback', text }),
  trackUsage: (event) => send({ type: 'trackUsage', event }),
  onLeadsChanged: (cb) => onBroadcast(LEADS_CHANGED, cb),
  onOnboardingChanged: (cb) => onBroadcast(ONBOARDING_CHANGED, cb),
  startSweep: () => send({ type: 'startSweep' }),
  stopSweep: () => send({ type: 'stopSweep' }),
  getSweepStatus: () => send({ type: 'getSweepStatus' }),
  onSweepChanged: (cb) => onBroadcast(SWEEP_CHANGED, cb),
};
