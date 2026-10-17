import { isoDay } from './api';
import { esc, page, SECURITY_HEADERS } from './html';
import type { Env } from './index';
import { PILOT_CODE_RE, type UsageReport } from './schema';

const DAY_MS = 86_400_000;
const STALE_MS = 3 * DAY_MS;
// 32 caratteri senza 0/O e 1/I: un byte modulo 32 è uniforme.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PORTAL_NAMES: Record<string, string> = { immobiliare: 'Immobiliare', idealista: 'Idealista', subito: 'Subito' };

export function generateCode(): string {
  const chars = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ALPHABET[b % ALPHABET.length]!).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function authorized(req: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  const h = req.headers.get('Authorization') ?? '';
  if (!h.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = atob(h.slice(6));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(':');
  return sep >= 0 && sameSecret(decoded.slice(sep + 1), env.ADMIN_PASSWORD);
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const activeDays = (r: UsageReport) => new Set([...r.usage.browsingDays, ...r.usage.panelDays]);
const daysWithin = (days: Set<string>, now: number, n: number) => {
  const from = isoDay(now - (n - 1) * DAY_MS);
  return [...days].filter((d) => d >= from).length;
};

function strip(days: Set<string>, now: number): string {
  const cells = Array.from({ length: 30 }, (_, i) => {
    const d = isoDay(now - (29 - i) * DAY_MS);
    return `<span class="${days.has(d) ? 'on' : ''}" title="${d}"></span>`;
  });
  return `<div class="strip">${cells.join('')}</div>`;
}

type LastRow = { install_id: string; code: string; version: string; payload: string; received_at: number; agency: string | null };

async function overview(env: Env, now: number): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT r.install_id, r.code, r.version, r.payload, r.received_at, p.agency FROM reports r
     JOIN (SELECT install_id, MAX(day) AS day FROM reports GROUP BY install_id) last ON last.install_id = r.install_id AND last.day = r.day
     LEFT JOIN pilots p ON p.code = r.code ORDER BY p.agency, r.install_id`,
  ).all<LastRow>();
  const rows = results.map((row) => {
    const r = JSON.parse(row.payload) as UsageReport;
    const days = activeDays(r);
    const warn = r.technical.adapterWarning.map((p) => PORTAL_NAMES[p] ?? p).join(', ') || '—';
    return `<tr class="${now - row.received_at > STALE_MS ? 'stale' : ''}">
<td>${esc(row.agency ?? '?')}<br><small>${esc(row.code)}</small></td>
<td><a href="/admin/install/${encodeURIComponent(row.install_id)}">${esc(row.install_id.slice(0, 8))}</a></td>
<td>${esc(row.version)}</td><td>${esc(fmt(row.received_at))}</td>
<td>${daysWithin(days, now, 7)}</td><td>${daysWithin(days, now, 30)}</td><td>${days.size}</td><td>${strip(days, now)}</td>
<td>${r.usage.statusChanges.contacted ?? 0}</td><td>${r.usage.exports.xlsx + r.usage.exports.csv}</td><td>${r.leads.total}</td><td>${r.leads.byPriority.high}</td>
<td>${esc(warn)}</td><td>${r.technical.errors.length}</td></tr>`;
  });
  return page('Panoramica', `<table><thead><tr><th>Agenzia</th><th>Installazione</th><th>Versione</th><th>Ultimo invio (UTC)</th>
<th>Giorni 7</th><th>Giorni 30</th><th>Giorni tot.</th><th>Ultimi 30 giorni</th><th>Contattati</th><th>Export</th><th>Lead</th><th>Alta</th><th>Avvisi</th><th>Errori</th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="14">Nessun report ricevuto</td></tr>'}</tbody></table>`);
}

async function install(env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT day, payload FROM reports WHERE install_id = ? ORDER BY day DESC LIMIT 180')
    .bind(id).all<{ day: string; payload: string }>();
  if (!results.length) return page('Installazione non trovata', '', 404);
  const reports = results.map((r) => ({ day: r.day, r: JSON.parse(r.payload) as UsageReport }));
  const rows = reports.map(({ day, r }) => `<tr><td>${esc(day)}</td><td>${r.leads.total}</td><td>${r.leads.byPriority.high}</td>
<td>${r.usage.statusChanges.contacted ?? 0}</td><td>${r.usage.exports.xlsx + r.usage.exports.csv}</td><td>${r.technical.errors.length}</td></tr>`);
  const last = reports[0]!.r;
  const errors = last.technical.errors.map((e) => `<li>${esc(fmt(e.at))} — ${esc(e.message)}</li>`).join('') || '<li>Nessuno</li>';
  return page(`Installazione ${id.slice(0, 8)}`, `<table><thead><tr><th>Giorno</th><th>Lead</th><th>Alta</th><th>Contattati</th><th>Export</th><th>Errori</th></tr></thead>
<tbody>${rows.join('')}</tbody></table><h2>Ultimi errori</h2><ul>${errors}</ul><h2>Ultimo report</h2><pre>${esc(JSON.stringify(last, null, 2))}</pre>`);
}

async function feedbackList(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT f.created_at, f.code, f.version, f.text, p.agency FROM feedback f LEFT JOIN pilots p ON p.code = f.code ORDER BY f.created_at DESC LIMIT 500',
  ).all<{ created_at: number; code: string; version: string; text: string; agency: string | null }>();
  const rows = results.map((f) => `<tr><td>${esc(fmt(f.created_at))}</td><td>${esc(f.agency ?? '?')}<br><small>${esc(f.code)}</small></td>
<td>${esc(f.version)}</td><td class="text">${esc(f.text)}</td></tr>`);
  return page('Feedback', `<table><thead><tr><th>Data (UTC)</th><th>Agenzia</th><th>Versione</th><th>Testo</th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="4">Nessun feedback</td></tr>'}</tbody></table>`);
}

async function pilots(env: Env, error = '', status = 200): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT p.code, p.agency, p.active, p.created_at, COUNT(DISTINCT r.install_id) AS installs FROM pilots p
     LEFT JOIN reports r ON r.code = p.code GROUP BY p.code ORDER BY p.agency`,
  ).all<{ code: string; agency: string; active: number; created_at: number; installs: number }>();
  const rows = results.map((p) => {
    const action = p.active ? 'deactivate' : 'activate';
    return `<tr><td>${esc(p.code)}</td><td>${esc(p.agency)}</td><td>${p.active ? 'attivo' : 'disattivato'}</td><td>${esc(fmt(p.created_at))}</td><td>${p.installs}</td>
<td><form class="inline" method="post"><input type="hidden" name="action" value="${action}"><input type="hidden" name="code" value="${esc(p.code)}">
<button>${p.active ? 'Disattiva' : 'Riattiva'}</button></form></td></tr>`;
  });
  return page('Codici pilota', `${error ? `<p><strong>${esc(error)}</strong></p>` : ''}
<form method="post"><input type="hidden" name="action" value="create">
<label>Agenzia <input name="agency" required maxlength="80"></label>
<label>Codice (vuoto = generato) <input name="code" maxlength="32"></label> <button>Crea</button></form>
<table><thead><tr><th>Codice</th><th>Agenzia</th><th>Stato</th><th>Creato (UTC)</th><th>Installazioni</th><th></th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="6">Nessun codice</td></tr>'}</tbody></table>`, status);
}

async function pilotAction(req: Request, env: Env, now: number): Promise<Response> {
  const data = await req.formData();
  const action = String(data.get('action') ?? '');
  const code = String(data.get('code') ?? '').toUpperCase().replace(/\s+/g, '');
  if (action === 'create') {
    const agency = String(data.get('agency') ?? '').trim();
    const finalCode = code || generateCode();
    if (!agency || agency.length > 80) return pilots(env, 'Nome agenzia mancante o troppo lungo', 400);
    if (!PILOT_CODE_RE.test(finalCode)) return pilots(env, 'Codice non valido: da 4 a 32 tra lettere, cifre e trattini', 400);
    try {
      await env.DB.prepare('INSERT INTO pilots (code, agency, active, created_at) VALUES (?, ?, 1, ?)').bind(finalCode, agency, now).run();
    } catch {
      return pilots(env, 'Codice già esistente', 400);
    }
  } else if (action === 'deactivate' || action === 'activate') {
    await env.DB.prepare('UPDATE pilots SET active = ? WHERE code = ?').bind(action === 'activate' ? 1 : 0, code).run();
  } else {
    return pilots(env, 'Azione sconosciuta', 400);
  }
  return new Response(null, { status: 303, headers: { Location: '/admin/pilots' } });
}

const plain = (text: string, status: number, extra: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS, ...extra } });

export async function handleAdmin(req: Request, env: Env, now = Date.now()): Promise<Response> {
  if (!(await authorized(req, env))) {
    return plain('Autenticazione richiesta', 401, { 'WWW-Authenticate': 'Basic realm="HomeRadar pilota", charset="UTF-8"' });
  }
  const url = new URL(req.url);
  if (req.method === 'POST') {
    // Difesa CSRF: un modulo inviato da un altro sito ha un'altra origine.
    if (req.headers.get('Origin') !== url.origin) return plain('Origine non ammessa', 403);
    if (url.pathname === '/admin/pilots') return pilotAction(req, env, now);
    return plain('Not found', 404);
  }
  if (req.method !== 'GET') return plain('Not found', 404);
  if (url.pathname === '/admin') return overview(env, now);
  if (url.pathname === '/admin/feedback') return feedbackList(env);
  if (url.pathname === '/admin/pilots') return pilots(env);
  const m = /^\/admin\/install\/([^/]+)$/.exec(url.pathname);
  if (m) return install(env, decodeURIComponent(m[1]!));
  return plain('Not found', 404);
}
