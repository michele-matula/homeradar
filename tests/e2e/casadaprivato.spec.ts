import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

const read = (name: string) => readFileSync(`tests/fixtures/casadaprivato/${name}`, 'utf8');
const PAGES: Record<string, string> = {
  '/annunci-vendita/immobili/acerno-acerno': read('search-acerno.html'),
  '/annunci-vendita/immobili/salerno-salerno': read('search-salerno.html'),
};

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: il "sito" è servito dalle fixture.
  await context.route(/^https?:\/\/(?!www\.casadaprivato\.it\/)/, (route) => route.abort());
  await context.route('https://www.casadaprivato.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    const body = PAGES[pathname];
    if (body) return route.fulfill({ contentType: 'text/html', body });
    return route.fulfill({ status: 404, body: '' });
  });
});

test('CasaDaPrivato: badge solo sulle card prima dei comuni vicini', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('https://www.casadaprivato.it/annunci-vendita/immobili/acerno-acerno');
  const own = await page.evaluate(() => {
    const h2 = document.querySelector('h2.similar-properties');
    return [...document.querySelectorAll('h3 a[href]')].filter(
      (a) => !h2 || (h2.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING) !== 0,
    ).length;
  });
  expect(own).toBeGreaterThan(0);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await expect(page.locator("[data-homeradar-badge]")).toHaveCount(own);
  const after = await page.evaluate(() => {
    const h2 = document.querySelector('h2.similar-properties');
    return [...document.querySelectorAll('[data-homeradar-badge]')].filter(
      (b) => h2 && (h2.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).length;
  });
  expect(after).toBe(0);
});

test('CasaDaPrivato: i lead compaiono nel pannello con l\'etichetta del portale', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno');
  await page.locator('[data-homeradar-badge]').first().waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead').first()).toBeVisible();
  await expect(panel.locator('.lead .portal-tag').first()).toHaveText('CasaDaPrivato');
});

test('CasaDaPrivato: prezzo riservato mostrato come «Trattativa riservata»', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('https://www.casadaprivato.it/annunci-vendita/immobili/salerno-salerno');
  await page.locator('[data-homeradar-badge]').first().waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByText('Trattativa riservata').first()).toBeVisible();
});
