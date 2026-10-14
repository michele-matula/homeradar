import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { buildSubitoSearchHtml } from './fixture-page';

const nextData = JSON.parse(readFileSync('tests/fixtures/subito/search-appartamenti.json', 'utf8'));
const api = readFileSync('tests/fixtures/subito/api-page2.json', 'utf8');
const html = buildSubitoSearchHtml(nextData);
const SEARCH = 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/';

type Ad = {
  urn: string;
  advertiser: { company: boolean; type: number };
  type: { key: string };
  category: { parentId?: string; macrocategory_id?: string };
};
// __NEXT_DATA__ ha category.parentId, l'API category.macrocategory_id.
const isPrivateSale = (a: Ad) =>
  !a.advertiser.company && a.advertiser.type === 0 && a.type.key === 's' && (a.category.parentId ?? a.category.macrocategory_id) === '6';
const uniquePrivates = (ads: Ad[]) => new Set(ads.filter(isPrivateSale).map((a) => a.urn)).size;
const items = nextData.props.pageProps.initialState.items;
const pagePrivates = uniquePrivates([...items.originalList, ...items.galleryList, ...items.boostedItems]);
const apiPrivates = uniquePrivates(JSON.parse(api).ads);

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: sito e API sono serviti dalle fixture.
  await context.route(/^https?:\/\/(?!(www|hades)\.subito\.it\/)/, (route) => route.abort());
  await context.route('https://www.subito.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/annunci-')) return route.fulfill({ contentType: 'text/html', body: html });
    return route.fulfill({ status: 404, body: '' });
  });
  await context.route('https://hades.subito.it/v1/search/items**', (route) =>
    route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: api }),
  );
});

test('Subito: badge solo sui privati', async ({ context }) => {
  expect(pagePrivates).toBeGreaterThan(0);
  const page = await context.newPage();
  await page.goto(SEARCH);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(pagePrivates);
});

test('Subito: la pagina 2 caricata in SPA aggiunge i badge senza banner', async ({ context }) => {
  test.skip(apiPrivates === 0, 'la fixture API non contiene privati');
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await page.click('#next');
  await expect(page).toHaveURL(/\?o=2$/);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(apiPrivates);
  await page.waitForTimeout(6000); // oltre il timeout del RouteWatcher
  await expect(page.locator('#homeradar-banner')).toHaveCount(0);
});

test("Subito: i lead compaiono nel pannello con l'etichetta del portale", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead .portal-tag', { hasText: 'Subito' }).first()).toBeVisible();
});

test('Subito spento dalle impostazioni: nessun badge, nessun lead, nessun banner', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.getByRole('button', { name: 'Impostazioni' }).click();
  await panel.getByRole('switch', { name: 'Subito.it' }).click({ force: true });
  await expect(panel.getByText('Subito.it disattivato')).toBeVisible();

  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.click('#next');
  await expect(page).toHaveURL(/\?o=2$/);
  await page.waitForTimeout(6000); // oltre il timeout del RouteWatcher
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(0);
  await expect(page.locator('#homeradar-banner')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Torna ai lead' }).click();
  await expect(panel.getByRole('button', { name: 'Subito (0)' })).toBeVisible();
});
