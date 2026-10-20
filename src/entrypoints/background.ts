import { createFileSaver, isOffscreenRequest } from '@/background/file-saver';
import { createReporter } from '@/background/reporter';
import { createSweepRunner, type RunnerState } from '@/background/sweep-runner';
import { actionBadge } from '@/core/action-badge';
import { runAutoBackup, settleAutoBackup, type AutoBackupDeps } from '@/core/auto-backup';
import { HomeRadarDB } from '@/core/db';
import { warnedPortals } from '@/core/diagnostics';
import { needsOnboarding } from '@/core/onboarding';
import { nextRecallCheck } from '@/core/recall';
import { handleRequest, type RouterHooks } from '@/core/router';
import { searchesFor } from '@/core/searches';
import { LeadService } from '@/core/service';
import { LEADS_CHANGED, ONBOARDING_CHANGED, SWEEP_CHANGED, type Request } from '@/shared/messages';
import { REPORT_URL } from '@/shared/report-config';

export default defineBackground(() => {
  const service = new LeadService(new HomeRadarDB());
  const version = browser.runtime.getManifest().version;

  const reporter = createReporter({
    url: REPORT_URL,
    version,
    now: Date.now,
    timezoneOffset: () => new Date().getTimezoneOffset(),
    fetch: (input, init) => fetch(input, init),
    settings: () => service.getSettings(),
    onboardingAccepted: async () => {
      const s = await service.onboardingStatus();
      return !needsOnboarding(s.acceptedVersion, s.current);
    },
    installId: () => service.pilot.installId(),
    usage: () => service.pilot.usage(),
    diagnostics: () => service.getDiagnostics(version),
    leads: () => service.listLeads(),
    status: () => service.pilot.reportingStatus(),
    updateStatus: (fn) => service.pilot.updateReporting(fn),
    queue: () => service.pilot.feedbackQueue(),
    enqueue: (text) => service.pilot.enqueueFeedback(text, version),
    dropFeedback: (id) => service.pilot.dropFeedback(id),
    recordError: (m) => service.recordError(m),
  });
  const reportError = (err: unknown) =>
    service.recordError(`Invio del report: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});

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

  const sweep = createSweepRunner({
    now: Date.now,
    random: Math.random,
    uuid: () => crypto.randomUUID(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    // Una chiamata alle API ogni 20 s tiene acceso il service worker durante il giro.
    keepAlive: () => {
      const h = setInterval(() => void browser.runtime.getPlatformInfo(), 20_000);
      return () => clearInterval(h);
    },
    // Finestra vuota, poi la prima pagina: così anche la prima è una navigazione della scheda come le altre
    // (e nei test end-to-end passa dalle pagine finte invece che dal sito vero).
    async openWindow(url) {
      const w = await browser.windows.create({ url: 'about:blank', state: 'minimized', focused: false, type: 'normal' });
      const ids = { windowId: w!.id!, tabId: w!.tabs![0]!.id! };
      await browser.tabs.update(ids.tabId, { url });
      return ids;
    },
    navigate: async (tabId, url) => {
      await browser.tabs.update(tabId, { url });
    },
    closeWindow: async (windowId) => {
      await browser.windows.remove(windowId);
    },
    loadState: async () => ((await browser.storage.session.get('sweep')).sweep as RunnerState | undefined) ?? null,
    saveState: async (s) => {
      if (s) await browser.storage.session.set({ sweep: s });
      else await browser.storage.session.remove('sweep');
    },
    plan: async () => {
      const s = await service.getSettings();
      return searchesFor(s.searchArea, s.enabledPortals);
    },
    blockReason: async () => {
      const status = await service.onboardingStatus();
      if (needsOnboarding(status.acceptedVersion, status.current)) return "Conferma prima l'informativa";
      if (!(await service.getSettings()).searchArea.comuni.length) return 'Imposta prima la tua zona di lavoro';
      return null;
    },
    enabledPortals: async () => (await service.getSettings()).enabledPortals,
    finish: async (s) => {
      const result = await service.finishSweep(s);
      hooks.leadsChanged();
      return result;
    },
    countNew: (since) => service.countNewSince(since),
    lastResult: () => service.lastSweep(),
    changed: () => {
      browser.runtime.sendMessage({ type: SWEEP_CHANGED }).catch(() => {});
    },
  });

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
    reporter,
    sweep,
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

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const type = (msg as { type?: unknown } | undefined)?.type;
    if (typeof type !== 'string' || type === LEADS_CHANGED || type === ONBOARDING_CHANGED || type === SWEEP_CHANGED || isOffscreenRequest(msg)) return false;
    handleRequest(service, msg as Request, version, hooks, { tabId: sender.tab?.id, url: sender.url }).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  // L'agente chiude la finestra del giro: giro interrotto, i dati letti restano.
  browser.windows.onRemoved.addListener((windowId) => void sweep.windowRemoved(windowId).catch(() => {}));
  // Worker riavviato a giro in corso (raro): lo stato in storage.session si chiude come interrotto.
  void sweep.recover().catch((err: unknown) =>
    service.recordError(`Giro delle ricerche: ${err instanceof Error ? err.message : String(err)}`).catch(() => {}),
  );

  // A mezzanotte i richiami di domani diventano di oggi. Non periodico: ricreato a ogni scatto, resta allineato all'ora legale.
  const scheduleRecallCheck = () => void browser.alarms.create('recall', { when: nextRecallCheck(Date.now()) });

  void (async () => {
    if (!(await browser.alarms.get('recall'))) scheduleRecallCheck();
    if (!(await browser.alarms.get('purge'))) browser.alarms.create('purge', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
    if (!(await browser.alarms.get('backup'))) browser.alarms.create('backup', { delayInMinutes: 5, periodInMinutes: 24 * 60 });
    if (!(await browser.alarms.get('report'))) browser.alarms.create('report', { delayInMinutes: 10, periodInMinutes: 24 * 60 });
  })();
  // Chrome spegne il worker spesso: all'avvio si recupera l'invio se l'ultimo ha più di 20 ore.
  void reporter.sendReport('startup').catch(reportError);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'purge') void service.purge();
    if (alarm.name === 'backup') void runAutoBackup(backupDeps).catch(backupError);
    if (alarm.name === 'report') void reporter.sendReport('alarm').catch(reportError);
    if (alarm.name === 'recall') {
      // Anche il pannello aperto ricalcola gruppi ed etichette: "domani" diventa "oggi".
      hooks.leadsChanged();
      scheduleRecallCheck();
    }
  });
});
