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

  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = (msg as { type?: unknown } | undefined)?.type;
    if (typeof type !== 'string' || type === LEADS_CHANGED) return false;
    handleRequest(service, msg as Request, version, hooks).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  void (async () => {
    if (!(await browser.alarms.get('purge'))) browser.alarms.create('purge', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  })();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'purge') void service.purge();
  });
});
