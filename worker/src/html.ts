const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const STYLE = `
body{font:14px/1.4 system-ui,sans-serif;margin:16px;color:#1d1d1f;background:#fff}
nav a{margin-right:12px}
table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
tr.stale td{background:#fff4e5}
.strip{display:flex;gap:2px}.strip span{width:8px;height:14px;background:#e5e5e5;border-radius:2px}.strip span.on{background:#2e7d32}
pre{white-space:pre-wrap;word-break:break-word;background:#f5f5f5;padding:8px;border-radius:6px}
.text{white-space:pre-wrap}
form.inline{display:inline}
@media (prefers-color-scheme: dark){body{background:#111;color:#eee}th,td{border-color:#333}tr.stale td{background:#3a2a10}pre{background:#222}.strip span{background:#333}}
`;

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · HomeRadar pilota</title><style>${STYLE}</style></head><body>
<nav><a href="/admin">Panoramica</a><a href="/admin/feedback">Feedback</a><a href="/admin/pilots">Codici pilota</a></nav>
<h1>${esc(title)}</h1>${body}</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
}
