declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ADMIN_PASSWORD: string;
    TEST_MIGRATIONS: import('@cloudflare/vitest-plugin').D1Migration[];
  }
  // Tipi di `exports` di cloudflare:workers: il modulo principale è il Worker.
  interface GlobalProps {
    mainModule: typeof import('../src/index');
  }
}
