import { createFileSaver, isOffscreenRequest } from '@/background/file-saver';
import { actionBadge } from '@/core/action-badge';
import { runAutoBackup, settleAutoBackup, type AutoBackupDeps } from '@/core/auto-backup';
import { HomeRadarDB } from '@/core/db';
import { warnedPortals } from '@/core/diagnostics';
import { needsOnboarding } from '@/core/onboarding';
import { nextRecallCheck } from '@/core/recall';
import { handleRequest, type RouterHooks } from '@/core/router';
import { LeadService } from '@/core/service';
import { LEADS_CHANGED, ONBOARDING_CHANGED, type Request } from '@/shared/messages';

export default defineBackground(() => {
  const service = new LeadService(new HomeRadarDB());
  const version = browser.runtime.getManifest().version;

  /** Un solo punto decide il segnale sull'icona: conferma mancante prima dell'avviso dei portali. */
  async function refreshActionBadge(): Promise<void> {
    const [status, diag, due] = await Promise.all([
      service.onboardingStatus(),
      service.getDiagnostics(version),
      service.dueRecallCount(Date.now()),
    ]);
    const badge = actionBadge({
      onboarding: needsOnboarding(status.acceptedVersion, status.current),
      warning: warnedPortals(diag.adapterWarning).length > 0,
      due,
    });
    await browser.action.setBadgeText({ text: badge.text });
    if (badge.color) await browser.action.setBadgeBackgroundColor({ color: badge.color });
    await browser.action.setTitle({ title: badge.title });
  }
  const updateBadge = () => void refreshActionBadge().catch(() => {});

  async function openOnboarding(): Promise<void> {
    await browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  }

  const hooks: RouterHooks = {
    // L'avviso è già salvato nel diagnostico: il segnale si ricalcola da lì.
    setWarning: () => updateBadge(),
    leadsChanged() {
      browser.runtime.sendMessage({ type: LEADS_CHANGED }).catch(() => {});
      // Eliminazioni e importazione di un backup cambiano anche i richiami.
      updateBadge();
    },
    recallsChanged: () => updateBadge(),
    onboardingChanged() {
      browser.runtime.sendMessage({ type: ONBOARDING_CHANGED }).catch(() => {});
      updateBadge();
    },
    openOnboarding,
  };

  const saver = createFileSaver({
    async ensureOffscreen() {
      const open = await browser.runtime.getContexts({ contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT] });
      if (open.length) return;
      await browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: [browser.offscreen.Reason.BLOBS],
        justification: 'Creare il file del backup automatico di HomeRadar',
      });
    },
    closeOffscreen: () => browser.offscreen.closeDocument(),
    sendToOffscreen: (msg) => browser.runtime.sendMessage(msg),
    download: ({ url, filename }) => browser.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false }),
    findDownload: async (url) => (await browser.downloads.search({ url }))[0],
  });

  const backupDeps: AutoBackupDeps = {
    now: Date.now,
    status: () => service.backupStatus(),
    settings: () => service.getSettings(),
    listingCount: () => service.listingCount(),
    exportJson: async () => JSON.stringify(await service.exportBackup(version)),
    ...saver,
    recordStarted: (slot, url) => service.recordBackupStarted(slot, url),
    recordSuccess: (slot) => service.recordBackup(slot),
    recordFailure: (message) => service.recordBackupFailure(message),
  };
  const backupError = (err: unknown) =>
    service.recordError(`Backup automatico: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});

  // Registrato subito: l'evento riaccende il service worker spento mentre la finestra "Salva con nome" era aperta.
  browser.downloads.onChanged.addListener((delta) => {
    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') void settleAutoBackup(backupDeps).catch(backupError);
  });

  // Prima installazione: scheda di benvenuto. Aggiornamento: solo se l'informativa va riconfermata.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void (async () => {
      const status = await service.onboardingStatus();
      if (reason === 'install' || (reason === 'update' && needsOnboarding(status.acceptedVersion, status.current))) await openOnboarding();
    })().catch((err: unknown) =>
      service.recordError(`Apertura dell'informativa: ${err instanceof Error ? err.message : String(err)}`).catch(() => {}),
    );
  });
  updateBadge();

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = (msg as { type?: unknown } | undefined)?.type;
    if (typeof type !== 'string' || type === LEADS_CHANGED || type === ONBOARDING_CHANGED || isOffscreenRequest(msg)) return false;
    handleRequest(service, msg as Request, version, hooks).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  // A mezzanotte i richiami di domani diventano di oggi. Non periodico: ricreato a ogni scatto, resta allineato all'ora legale.
  const scheduleRecallCheck = () => void browser.alarms.create('recall', { when: nextRecallCheck(Date.now()) });

  void (async () => {
    if (!(await browser.alarms.get('recall'))) scheduleRecallCheck();
    if (!(await browser.alarms.get('purge'))) browser.alarms.create('purge', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
    if (!(await browser.alarms.get('backup'))) browser.alarms.create('backup', { delayInMinutes: 5, periodInMinutes: 24 * 60 });
  })();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'purge') void service.purge();
    if (alarm.name === 'backup') void runAutoBackup(backupDeps).catch(backupError);
    if (alarm.name === 'recall') {
      updateBadge();
      scheduleRecallCheck();
    }
  });
});
