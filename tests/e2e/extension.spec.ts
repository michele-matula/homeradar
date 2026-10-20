import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { buildSearchHtml } from './fixture-page';

const nextData = JSON.parse(readFileSync('tests/fixtures/immobiliare/search-privati.json', 'utf8'));
// Le fixture contengono solo privati: aggiungiamo un'agenzia e un costruttore sintetici,
// così l'assenza di badge sulle agenzie viene davvero verificata.
const synthetic = (id: number, type: string) => ({
  realEstate: {
    id,
    title: `Bilocale via Esempio ${id + 100}, Centro, Milano`,
    contract: 'sale',
    price: { visible: true, value: 200000 },
    properties: [{ surface: '60 m²', rooms: '2', typology: { name: 'Appartamento' }, location: { address: `Via Esempio ${id + 100}`, city: 'Milano', microzone: 'Centro' } }],
    advertiser: { agency: { type } },
  },
  seo: { url: `https://www.immobiliare.it/annunci/${id}/` },
});
nextData.props.pageProps.dehydratedState.queries[0].state.data.results.push(synthetic(1, 'agency'), synthetic(2, 'constructor'));
const apiText = readFileSync('tests/fixtures/immobiliare/api-listings.json', 'utf8');
type R = { realEstate: { advertiser?: { agency?: unknown; supervisor?: { type?: string } } } };
const privates = (results: R[]) => results.filter((r) => !r.realEstate.advertiser?.agency && r.realEstate.advertiser?.supervisor?.type === 'user').length;
const SEARCH = 'https://www.immobiliare.it/vendita-case/milano/da-privati/';

test.beforeEach(async ({ context }) => {
  // Nessuna richiesta esce verso internet: il "sito" è servito dalle fixture.
  await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/)/, (route) => route.abort());
  await context.route('https://www.immobiliare.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/api-next/search-list/listings/')) return route.fulfill({ contentType: 'application/json', body: apiText });
    if (pathname.startsWith('/vendita-case/')) return route.fulfill({ contentType: 'text/html', body: buildSearchHtml(nextData) });
    return route.fulfill({ status: 404, body: '' });
  });
});

test('mostra un badge su ogni annuncio di privato e su nessuna agenzia', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  const expected = privates(nextData.props.pageProps.dehydratedState.queries[0].state.data.results);
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(expected);
  await expect(page.locator('[data-homeradar-badge]').first()).toHaveText(/^(● Alta|● Media|◐ Da verificare|Privato)/);
});

test('intercetta la risposta della pagina successiva senza banner', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await page.click('#next');
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(privates(JSON.parse(apiText).results));
  await page.waitForTimeout(6000);
  await expect(page.locator('#homeradar-banner')).toHaveCount(0);
});

test('mostra il banner di riserva se dopo un cambio pagina non arrivano dati', async ({ context }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();
  await page.waitForTimeout(3500);
  await page.click('#nav-no-data');
  await expect(page.locator('#homeradar-banner')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#homeradar-banner')).toContainText('ricarica la pagina');
});

test('il pannello elenca i lead ed esporta il CSV', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('tab', { name: /^Nuovi \([1-9]\d*\)$/ })).toBeVisible();
  await expect(panel.locator('.lead').first()).toBeVisible();

  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'CSV', exact: true }).click()]);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('Priorità;Stato;Richiamo;Portale;Titolo;Indirizzo');
  expect(csv).toContain(';Età stimata;Ripubblicato;Prima visita;');
  expect(csv).not.toMatch(/\b3\d{2}[ .]?\d{3}[ .]?\d{3,4}\b/);
});

test("esporta un backup e lo reimporta dopo aver azzerato l'archivio", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const nuovi = panel.getByRole('tab', { name: /^Nuovi \(\d+\)$/ });
  await expect(panel.getByRole('tab', { name: /^Nuovi \([1-9]\d*\)$/ })).toBeVisible();

  // Il primo lead passa a «Da contattare» con una nota: dopo il ripristino devono esserci ancora.
  const first = panel.getByRole('listitem').first();
  await first.getByLabel('Note', { exact: true }).fill('richiamare giovedì');
  await first.getByLabel('Note', { exact: true }).blur();
  await first.getByLabel('Stato', { exact: true }).selectOption({ label: 'Da contattare' });
  await expect(panel.getByRole('tab', { name: /^Da contattare \(1\)$/ })).toBeVisible();
  const before = await nuovi.textContent();

  await panel.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(panel.getByText('Ultimo backup: mai')).toBeVisible();
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Esporta backup ora', exact: true }).click()]);
  const file = (await download.path())!;
  expect(JSON.parse(readFileSync(file, 'utf8')).format).toBe('homeradar-backup');
  await expect(panel.getByText(/^Ultimo backup: \d{2}\/\d{2} alle \d{2}:\d{2}$/)).toBeVisible();

  await panel.getByRole('button', { name: 'Azzera archivio annunci', exact: true }).click();
  await panel.getByRole('button', { name: 'Conferma: azzera tutto', exact: true }).click();
  await panel.getByLabel('Importa backup', { exact: true }).setInputFiles(file);
  await expect(panel.getByText(/^Backup importato: \d+ annunci nuovi, 0 aggiornati, 0 già presenti$/)).toBeVisible();

  await panel.getByRole('button', { name: 'Torna ai lead', exact: true }).click();
  await expect(nuovi).toHaveText(before!);
  await panel.getByRole('tab', { name: /^Da contattare \(1\)$/ }).click();
  await expect(panel.getByLabel('Note', { exact: true })).toHaveValue('richiamare giovedì');
  await expect(panel.getByLabel('Stato', { exact: true })).toHaveValue('to_contact');
});

test('il pannello mostra una miniatura per ogni lead; foto non raggiungibile → riquadro neutro', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead').first()).toBeVisible();
  const leads = await panel.locator('.lead').count();
  await expect(panel.locator('.lead .lead__body .cover')).toHaveCount(leads);
  // Le fixture di Milano non hanno foto e le immagini sono bloccate: ogni miniatura è il riquadro neutro.
  await expect(panel.locator('.lead .cover--empty')).toHaveCount(leads);
});
