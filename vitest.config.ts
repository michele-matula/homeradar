import { defineConfig } from 'vitest/config';
// WXT 0.20. Se la versione installata non espone questo percorso, usa `import { WxtVitest } from 'wxt/testing'`.
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
    setupFiles: ['fake-indexeddb/auto'],
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    passWithNoTests: true,
  },
});
