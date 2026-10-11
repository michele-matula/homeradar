import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'HomeRadar',
    description: 'Evidenzia gli annunci di privati maturi su Immobiliare.it',
    permissions: ['sidePanel', 'alarms', 'clipboardWrite'],
    host_permissions: ['https://www.immobiliare.it/*'],
    action: { default_title: 'HomeRadar' },
  },
});
