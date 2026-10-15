import path from 'node:path';
import { chromium, expect as baseExpect, test as base, type BrowserContext, type Page } from '@playwright/test';

/** La scheda di benvenuto, aperta dal background all'installazione. */
export async function onboardingPage(context: BrowserContext): Promise<Page> {
  const find = () => context.pages().find((p) => p.url().endsWith('/onboarding.html'));
  await baseExpect.poll(() => Boolean(find()), { timeout: 10_000 }).toBe(true);
  return find()!;
}

export const test = base.extend<{ onboarded: boolean; context: BrowserContext; extensionId: string }>({
  // Di default l'informativa è confermata: i test sull'onboarding la lasciano da confermare.
  onboarded: [true, { option: true }],
  context: async ({ onboarded }, use) => {
    const ext = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      acceptDownloads: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    if (onboarded) {
      const welcome = await onboardingPage(context);
      await welcome.getByRole('button', { name: 'Ho capito, inizia' }).click();
      await welcome.getByText('HomeRadar è attivo').waitFor();
      await welcome.close();
    }
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2]!);
  },
});

export const expect = test.expect;
