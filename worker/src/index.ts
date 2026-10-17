import { handleAdmin } from './admin';
import { handleFeedback, handleReport, purgeOldReports } from './api';

export interface Env {
  DB: D1Database;
  ADMIN_PASSWORD: string;
}

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === 'POST' && pathname === '/report') return handleReport(req, env);
    if (req.method === 'POST' && pathname === '/feedback') return handleFeedback(req, env);
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return handleAdmin(req, env);
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_event, env) {
    await purgeOldReports(env.DB, Date.now());
  },
} satisfies ExportedHandler<Env>;
