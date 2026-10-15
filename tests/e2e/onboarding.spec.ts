import { readFileSync } from 'node:fs';
import { expect, onboardingPage, test } from './fixtures';
import { buildSearchHtml } from './fixture-page';

const nextData = JSON.parse(readFileSync('tests/fixtures/immobiliare/search-privati.json', 'utf8'));
const apiText = readFileSync('tests/fixtures/immobiliare/api-listings.json', 'utf8');
const SEARCH = 'https://www.immobiliare.it/vendita-case/milano/da-privati/';

test.use({ onboarded: false });

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/)/, (route) => route.abort());
  await context.route('https://www.immobiliare.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/api-next/search-list/listings/')) return route.fulfill({ contentType: 'application/json', body: apiText });
    if (pathname.startsWith('/vendita-case/')) return route.fulfill({ contentType: 'text/html', body: buildSearchHtml(nextData) });
    return route.fulfill({ status: 404, body: '' });
  });
});

test("all'installazione si apre l'informativa; prima della conferma nessun badge, dopo sì", async ({ context }) => {
  const welcome = await onboardingPage(context);
  await expect(welcome.getByRole('heading', { name: 'Benvenuto in HomeRadar' })).toBeVisible();
  const page = await context.newPage();
  await page.goto(SEARCH);
  await expect(page.locator('#homeradar-banner')).toContainText('HomeRadar non è ancora attivo');
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(0);
  await welcome.getByRole('button', { name: 'Ho capito, inizia' }).click();
  await expect(welcome.getByText('HomeRadar è attivo')).toBeVisible();
  // I dati della pagina già caricata non tornano: la pagina successiva sì.
  await page.click('#next');
  await expect(page.locator('[data-homeradar-badge]').first()).toBeVisible();
});

test('"Apri" nell\'avviso riapre l\'informativa e invita a ricaricare', async ({ context }) => {
  await (await onboardingPage(context)).close();
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('#homeradar-banner').getByRole('button', { name: 'Apri' }).click();
  await onboardingPage(context);
  await expect(page.locator('#homeradar-banner')).toContainText('dopo aver confermato, ricarica la pagina');
});
