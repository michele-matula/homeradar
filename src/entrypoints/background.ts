import { createFileSaver, isOffscreenRequest } from '@/background/file-saver';
import { runAutoBackup } from '@/core/auto-backup';
import { HomeRadarDB } from '@/core/db';
import { handleRequest, type RouterHooks } from '@/core/router';
import { LeadService } from '@/core/service';
import { LEADS_CHANGED, type Request } from '@/shared/messages';

export default defineBackground(() => {
  const service = new LeadService(new HomeRadarDB());
  const version = browser.runtime.getManifest().version;

  const hooks: RouterHooks = {
    setWarning(on) {
      void browser.action.setBadgeText({ text: on ? '!' : '' });
      if (on) void browser.action.setBadgeBackgroundColor({ color: '#d97706' });
    },
    leadsChanged() {
      browser.runtime.sendMessage({ type: LEADS_CHANGED }).catch(() => {});
    },
  };

  const saveFile = createFileSaver({
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
    onDownloadChanged(listener) {
      browser.downloads.onChanged.addListener(listener);
      return () => browser.downloads.onChanged.removeListener(listener);
    },
  });

  const autoBackup = () =>
    runAutoBackup({
      now: Date.now,
      status: () => service.backupStatus(),
      settings: () => service.getSettings(),
      listingCount: () => service.listingCount(),
      exportJson: async () => JSON.stringify(await service.exportBackup(version)),
      saveFile,
      recordSuccess: (slot) => service.recordBackup(slot),
      recordFailure: (message) => service.recordBackupFailure(message),
    });

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = (msg as { type?: unknown } | undefined)?.type;
    if (typeof type !== 'string' || type === LEADS_CHANGED || isOffscreenRequest(msg)) return false;
    handleRequest(service, msg as Request, version, hooks).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  void (async () => {
    if (!(await browser.alarms.get('purge'))) browser.alarms.create('purge', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
    if (!(await browser.alarms.get('backup'))) browser.alarms.create('backup', { delayInMinutes: 5, periodInMinutes: 24 * 60 });
  })();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'purge') void service.purge();
    if (alarm.name === 'backup') void autoBackup().catch((err: unknown) => service.recordError(`Backup automatico: ${err instanceof Error ? err.message : String(err)}`)).catch(() => {});
  });
});
