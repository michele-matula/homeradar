import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildSearchHtml } from './fixture-page';

/** Solo dentro panel.evaluate: la pagina del pannello è dell'estensione. */
declare const chrome: { runtime: { sendMessage(msg: unknown): Promise<{ data: Record<string, unknown> }> } };

const base = JSON.parse(readFileSync('tests/fixtures/immobiliare/search-privati.json', 'utf8'));
const agency = {
  realEstate: {
    id: 1, title: 'Bilocale via Esempio 101, Centro, Cassano d’Adda', contract: 'sale', price: { visible: true, value: 200000 },
    properties: [{ surface: '60 m²', rooms: '2', typology: { name: 'Appartamento' }, location: { city: "Cassano d'Adda" } }],
    advertiser: { agency: { type: 'agency' } },
  },
  seo: { url: 'https://www.immobiliare.it/annunci/1/' },
};
/** Pagina 1 di Cassano d'Adda: privati della fixture, poi un'agenzia → il giro si ferma qui. */
function cassanoPage() {
  const nd = structuredClone(base);
  const data = nd.props.pageProps.dehydratedState.queries[0].state.data;
  data.results.push(agency);
  data.currentPage = 1;
  data.maxPages = 1;
  return buildSearchHtml(nd);
}
const CAPTCHA = '<!doctype html><html><body><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe></body></html>';

async function panelWithZone(context: BrowserContext, extensionId: string): Promise<Page> {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(async () => {
    const settings = (await chrome.runtime.sendMessage({ type: 'getSettings' })).data;
    await chrome.runtime.sendMessage({
      type: 'saveSettings',
      settings: {
        ...settings,
        enabledPortals: { immobiliare: true, idealista: false, subito: false },
        searchArea: { comuni: [{ istat: '015059', name: "Cassano d'Adda", province: 'MI' }], categories: ['residential'] },
      },
    });
  });
  await panel.reload();
  return panel;
}

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/)/, (route) => route.abort());
});

test('Cerca: legge la ricerca nella finestra del giro e mostra il riepilogo', async ({ context, extensionId }) => {
  await context.route('https://www.immobiliare.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/vendita-case/cassano-d-adda/') return route.fulfill({ contentType: 'text/html', body: cassanoPage() });
    return route.fulfill({ status: 404, body: '' });
  });
  const panel = await panelWithZone(context, extensionId);
  await panel.getByRole('button', { name: 'Cerca', exact: true }).click();
  await expect(panel.getByText(/^Giro completato/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^[1-9]\d* nuovi · 0 ribassi · 0 non più visti$/)).toBeVisible();
  await panel.getByRole('button', { name: 'Vedi i nuovi' }).click();
  await expect(panel.locator('.lead').first()).toBeVisible();
});

test('verifica di DataDome: il portale si ferma e il pannello lo dice', async ({ context, extensionId }) => {
  await context.route('https://www.immobiliare.it/**', (route) => route.fulfill({ contentType: 'text/html', body: CAPTCHA }));
  const panel = await panelWithZone(context, extensionId);
  await panel.getByRole('button', { name: 'Cerca', exact: true }).click();
  await expect(panel.getByText('Immobiliare.it ha chiesto una verifica: aprilo tu e riprova domani.')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^Giro completato in parte/)).toBeVisible();
});

test('Ferma interrompe il giro', async ({ context, extensionId }) => {
  // Pagina lenta: il giro resta sulla prima pagina abbastanza a lungo da premere Ferma.
  await context.route('https://www.immobiliare.it/**', async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.fulfill({ contentType: 'text/html', body: cassanoPage() });
  });
  const panel = await panelWithZone(context, extensionId);
  await panel.getByRole('button', { name: 'Cerca', exact: true }).click();
  await panel.getByRole('button', { name: 'Ferma' }).click();
  await expect(panel.getByText(/^Giro fermato/)).toBeVisible({ timeout: 10_000 });
});
