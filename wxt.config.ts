import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

const PORTAL_HOSTS = ['https://www.immobiliare.it/*', 'https://www.idealista.it/*', 'https://www.subito.it/*'];

export default defineConfig({
  srcDir: 'src',
  // La build dei test end-to-end (pause brevissime) non deve mai finire nella cartella che si carica in Chrome.
  outDir: process.env.WXT_SWEEP_FAST === '1' ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => {
    // Il dominio del Worker del pilota entra nei permessi solo se la build ha l'URL.
    const url = loadEnv(mode, process.cwd(), 'WXT_').WXT_REPORT_URL;
    return {
      name: 'HomeRadar',
      description: 'Evidenzia gli annunci di privati maturi su Immobiliare.it, Idealista.it e Subito.it',
      permissions: ['sidePanel', 'alarms', 'clipboardWrite', 'downloads', 'offscreen', 'storage'],
      host_permissions: [...PORTAL_HOSTS, ...(url ? [`${new URL(url).origin}/*`] : [])],
      action: { default_title: 'HomeRadar' },
    };
  },
});
