import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

// La fixture "da privati" contiene solo privati: aggiungiamo una card di agenzia sintetica,
// così l'assenza di badge sulle agenzie viene davvero verificata.
const AGENCY_CARD = `<article class="item extended-item item-multimedia-container" data-element-id="1" data-is-professional-ad="true">
<picture class="item-multimedia"></picture>
<div class="item-info-container"><a href="/immobile/1/" class="item-link" title="Bilocale in Via Esempio 100, Centro, Milano">Bilocale in Via Esempio 100, Centro, Milano</a>
<div class="price-row"><span class="item-price h2-simulated">300.000<span class="txt-big">€</span></span></div></div></article>`;
const html = readFileSync('tests/fixtures/idealista/search-privati.html', 'utf8').replace('</main>', `${AGENCY_CARD}</main>`);
const privates = (html.match(/data-is-professional-ad="false"/g) ?? []).length;
const SEARCH = 'https://www.idealista.it/vendita-case/milano-milano/?ordine=da-privati-asc';

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: il "sito" è servito dalla fixture.
  await context.route(/^https?:\/\/(?!www\.idealista\.it\/)/, (route) => route.abort());
  await context.route('https://www.idealista.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/vendita-case/')) return route.fulfill({ contentType: 'text/html', body: html });
    return route.fulfill({ status: 404, body: '' });
  });
});

test('Idealista: badge solo sui privati', async ({ context }) => {
  expect(privates).toBeGreaterThan(0);
  const page = await context.newPage();
  await page.goto(SEARCH);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(privates);
  await expect(page.locator('article[data-is-professional-ad="true"] [data-homeradar-badge]')).toHaveCount(0);
  await expect(page.locator('article.geo-reach-card [data-homeradar-badge]')).toHaveCount(0);
});

test("Idealista: i lead compaiono nel pannello con l'etichetta del portale", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead').first()).toBeVisible();
  await expect(panel.locator('.lead .portal-tag').first()).toHaveText('Idealista');
});
