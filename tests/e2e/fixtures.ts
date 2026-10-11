import path from 'node:path';
import { chromium, test as base, type BrowserContext } from '@playwright/test';

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const ext = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      acceptDownloads: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
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
