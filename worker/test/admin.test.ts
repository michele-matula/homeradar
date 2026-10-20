import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateCode } from '../src/admin';

const AUTH = { Authorization: `Basic ${btoa('admin:test-password')}` };
const get = (path: string, headers: Record<string, string> = AUTH) => exports.default.fetch(`https://pilot.test${path}`, { headers });
const form = (path: string, fields: Record<string, string>, origin = 'https://pilot.test') =>
  exports.default.fetch(`https://pilot.test${path}`, {
    method: 'POST', headers: { ...AUTH, Origin: origin }, body: new URLSearchParams(fields), redirect: 'manual',
  });

const payload = (p: Record<string, unknown> = {}) => JSON.stringify({
  formatVersion: 1, installId: 'i1', pilotCode: 'ROSSI-7K2P', version: '0.1.0', sentAt: 0, timezoneOffset: 0, enabledPortals: [],
  usage: {
    browsingDays: ['2026-10-16', '2026-10-17'], panelDays: ['2026-10-17'], statusChanges: { contacted: 4 }, recallsSet: 0, notesWritten: 0,
    exports: { xlsx: 2, csv: 1 }, firstActiveDay: '2026-10-16', lastActiveDay: '2026-10-17',
  },
  leads: { total: 40, byPortal: { immobiliare: 40, idealista: 0, subito: 0, casadaprivato: 0 }, byPriority: { high: 7, medium: 0, verify: 0, none: 33 }, newLast7Days: 5 },
  technical: { counters: {}, adapterWarning: ['idealista'], errors: [{ at: 0, message: 'result[0]: price <testo>' }] },
  ...p,
});

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM pilots'), env.DB.prepare('DELETE FROM reports'), env.DB.prepare('DELETE FROM feedback')]);
  await env.DB.prepare('INSERT INTO pilots VALUES (?, ?, 1, 0)').bind('ROSSI-7K2P', 'Agenzia <script>alert(1)</script>').run();
  await env.DB.prepare('INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?)').bind('i1', 'ROSSI-7K2P', '2026-10-17', '0.1.0', payload(), Date.now()).run();
  await env.DB.prepare('INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?, ?)').bind('f1', 'i1', 'ROSSI-7K2P', '0.1.0', 'Riga 1\n<b>Riga 2</b>', 0, 0).run();
});

const activeOf = async (code: string) => (await env.DB.prepare('SELECT active FROM pilots WHERE code = ?').bind(code).first<{ active: number }>())!.active;

describe('/admin', () => {
  it('chiede la password', async () => {
    const r = await get('/admin', {});
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toContain('Basic');
    expect((await get('/admin', { Authorization: `Basic ${btoa('admin:sbagliata')}` })).status).toBe(401);
    expect((await get('/admin/feedback', { Authorization: 'Basic !!!' })).status).toBe(401);
  });

  it('panoramica con valori escapati e intestazioni di sicurezza', async () => {
    const r = await get('/admin');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    const html = await r.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Agenzia &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('ROSSI-7K2P');
    expect(html).toContain('<td>40</td>');
    expect(html).toContain('<td>7</td>');
    expect(html).toContain('Idealista');
  });

  it('dettaglio installazione, feedback, codici', async () => {
    expect(await (await get('/admin/install/i1')).text()).toContain('result[0]: price &lt;testo&gt;');
    const fb = await (await get('/admin/feedback')).text();
    expect(fb).toContain('&lt;b&gt;Riga 2&lt;/b&gt;');
    expect(fb).not.toContain('<b>Riga 2</b>');
    expect(await (await get('/admin/pilots')).text()).toContain('ROSSI-7K2P');
    expect((await get('/admin/install/sconosciuto')).status).toBe(404);
  });

  it("crea, disattiva e riattiva un codice; rifiuta POST da un'altra origine", async () => {
    expect((await form('/admin/pilots', { action: 'create', agency: 'Agenzia Verdi', code: 'verdi-1234' }, 'https://evil.test')).status).toBe(403);
    expect((await form('/admin/pilots', { action: 'create', agency: 'Agenzia Verdi', code: 'verdi-1234' })).status).toBe(303);
    expect(await env.DB.prepare('SELECT agency, active FROM pilots WHERE code = ?').bind('VERDI-1234').first()).toEqual({ agency: 'Agenzia Verdi', active: 1 });
    expect((await form('/admin/pilots', { action: 'create', agency: 'Doppione', code: 'VERDI-1234' })).status).toBe(400);
    expect((await form('/admin/pilots', { action: 'create', agency: '', code: '' })).status).toBe(400);
    expect((await form('/admin/pilots', { action: 'create', agency: 'Agenzia X', code: 'ab' })).status).toBe(400);
    await form('/admin/pilots', { action: 'deactivate', code: 'VERDI-1234' });
    expect(await activeOf('VERDI-1234')).toBe(0);
    await form('/admin/pilots', { action: 'activate', code: 'VERDI-1234' });
    expect(await activeOf('VERDI-1234')).toBe(1);
    await form('/admin/pilots', { action: 'create', agency: 'Agenzia Neri', code: '' });
    const generated = await env.DB.prepare('SELECT code FROM pilots WHERE agency = ?').bind('Agenzia Neri').first<{ code: string }>();
    expect(generated!.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('generateCode non usa caratteri ambigui', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});
