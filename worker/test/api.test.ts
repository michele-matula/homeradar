import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { purgeOldReports } from '../src/api';

const INSTALL = '7f3c2a8e-1b2d-4c5e-8f90-123456789abc';
const report = (p: Record<string, unknown> = {}) => ({
  formatVersion: 1, installId: INSTALL, pilotCode: 'ROSSI-7K2P', version: '0.1.0', sentAt: Date.now(), timezoneOffset: -120,
  enabledPortals: ['immobiliare'],
  usage: {
    browsingDays: ['2026-10-17'], panelDays: [], statusChanges: { contacted: 1 }, recallsSet: 0, notesWritten: 0,
    exports: { xlsx: 0, csv: 0 }, firstActiveDay: '2026-10-17', lastActiveDay: '2026-10-17',
  },
  leads: { total: 3, byPortal: { immobiliare: 3, idealista: 0, subito: 0, casadaprivato: 0 }, byPriority: { high: 1, medium: 1, verify: 0, none: 1 }, newLast7Days: 2 },
  technical: { counters: { ingested: 10 }, adapterWarning: [], errors: [] },
  ...p,
});
const feedback = (p: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), installId: INSTALL, pilotCode: 'ROSSI-7K2P', version: '0.1.0', text: 'Molto utile', createdAt: Date.now(), ...p,
});
const post = (path: string, body: unknown) =>
  exports.default.fetch(`https://pilot.test${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM pilots'), env.DB.prepare('DELETE FROM reports'), env.DB.prepare('DELETE FROM feedback')]);
  await env.DB.prepare('INSERT INTO pilots (code, agency, active, created_at) VALUES (?, ?, 1, 0), (?, ?, 0, 0)')
    .bind('ROSSI-7K2P', 'Agenzia Rossi', 'SPENTO-0000', 'Agenzia Spenta').run();
});

describe('/report', () => {
  it('salva e sovrascrive la riga dello stesso giorno', async () => {
    expect((await post('/report', report())).status).toBe(204);
    expect((await post('/report', report({ version: '0.2.0' }))).status).toBe(204);
    const rows = await env.DB.prepare('SELECT version, code FROM reports').all();
    expect(rows.results).toEqual([{ version: '0.2.0', code: 'ROSSI-7K2P' }]);
  });

  it('scarta i campi non dichiarati', async () => {
    await post('/report', report({ titolo: 'Via Roma 12' }));
    const row = await env.DB.prepare('SELECT payload FROM reports').first<{ payload: string }>();
    expect(row!.payload).not.toContain('Via Roma');
  });

  it.each([
    ['JSON non valido', '{'],
    ['schema non valido', report({ formatVersion: 2 })],
    ['troppo grande', report({ version: 'x'.repeat(70_000) })],
  ])('400 con %s', async (_n, body) => {
    expect((await post('/report', body)).status).toBe(400);
  });

  it('403 con codice sconosciuto o disattivato', async () => {
    expect((await post('/report', report({ pilotCode: 'NESSUNO-1' }))).status).toBe(403);
    expect((await post('/report', report({ pilotCode: 'SPENTO-0000' }))).status).toBe(403);
  });

  it('404 per percorsi e metodi sconosciuti', async () => {
    expect((await exports.default.fetch('https://pilot.test/report')).status).toBe(404);
    expect((await exports.default.fetch('https://pilot.test/altro')).status).toBe(404);
  });
});

describe('/feedback', () => {
  it('salva e ignora i duplicati', async () => {
    const f = feedback();
    expect((await post('/feedback', f)).status).toBe(204);
    expect((await post('/feedback', f)).status).toBe(204);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback').first<{ n: number }>())!.n).toBe(1);
  });

  it('400, 403 e 429', async () => {
    expect((await post('/feedback', feedback({ text: '   ' }))).status).toBe(400);
    expect((await post('/feedback', feedback({ text: 'x'.repeat(2001) }))).status).toBe(400);
    expect((await post('/feedback', feedback({ pilotCode: 'SPENTO-0000' }))).status).toBe(403);
    const insert = env.DB.prepare('INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?, ?)');
    await env.DB.batch(Array.from({ length: 30 }, () => insert.bind(crypto.randomUUID(), INSTALL, 'ROSSI-7K2P', 'v', 't', 0, Date.now())));
    expect((await post('/feedback', feedback())).status).toBe(429);
  });
});

describe('pulizia', () => {
  it('cancella solo i report oltre 180 giorni', async () => {
    const now = Date.UTC(2026, 9, 17);
    const day = 86_400_000;
    await env.DB.prepare('INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)')
      .bind('a', 'ROSSI-7K2P', '2026-01-01', 'v', '{}', now - 181 * day, 'b', 'ROSSI-7K2P', '2026-05-01', 'v', '{}', now - 179 * day).run();
    await purgeOldReports(env.DB, now);
    expect((await env.DB.prepare('SELECT install_id FROM reports').all()).results).toEqual([{ install_id: 'b' }]);
  });
});
