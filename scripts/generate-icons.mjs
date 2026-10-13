// Genera public/icon/{16,32,48,128}.png dal logo in src/shared/logo.ts (WXT li registra da solo nel manifest).
// Uso: node scripts/generate-icons.mjs   (richiede Node ≥ 23.6 e il Chromium di Playwright)
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { LOGO_SVG } from '../src/shared/logo.ts';

const SIZES = [16, 32, 48, 128];
const outDir = new URL('../public/icon/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${LOGO_SVG}`);
    await page.locator('svg').screenshot({ path: new URL(`${size}.png`, outDir).pathname.replace(/^\/([A-Za-z]:)/, '$1'), omitBackground: true });
    await page.close();
    console.log(`icon/${size}.png`);
  }
} finally {
  await browser.close();
}
