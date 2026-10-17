import type { Env } from './index';
import { FeedbackSchema, UsageReportSchema } from './schema';

export const REPORT_MAX_BYTES = 64 * 1024;
export const FEEDBACK_MAX_BYTES = 8 * 1024;
export const FEEDBACK_PER_DAY = 30;
export const RETENTION_DAYS = 180;
const DAY_MS = 86_400_000;

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const reply = (status: number, error?: string) => (error ? Response.json({ error }, { status }) : new Response(null, { status }));

/** Legge al massimo `max` byte di JSON; null se troppo grande o non valido. */
async function readJson(req: Request, max: number): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  const text = await req.text();
  if (new TextEncoder().encode(text).length > max) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function activePilot(db: D1Database, code: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS ok FROM pilots WHERE code = ? AND active = 1').bind(code).first()) !== null;
}

export async function handleReport(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const parsed = UsageReportSchema.safeParse(await readJson(req, REPORT_MAX_BYTES));
  if (!parsed.success) return reply(400, 'invalid');
  const r = parsed.data;
  if (!(await activePilot(env.DB, r.pilotCode))) return reply(403, 'unknown_code');
  await env.DB.prepare(
    `INSERT INTO reports (install_id, code, day, version, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (install_id, day) DO UPDATE SET code = excluded.code, version = excluded.version, payload = excluded.payload, received_at = excluded.received_at`,
  ).bind(r.installId, r.pilotCode, isoDay(now), r.version, JSON.stringify(r), now).run();
  return reply(204);
}

export async function handleFeedback(req: Request, env: Env, now = Date.now()): Promise<Response> {
  const parsed = FeedbackSchema.safeParse(await readJson(req, FEEDBACK_MAX_BYTES));
  if (!parsed.success) return reply(400, 'invalid');
  const f = parsed.data;
  if (!(await activePilot(env.DB, f.pilotCode))) return reply(403, 'unknown_code');
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE code = ? AND received_at > ?')
    .bind(f.pilotCode, now - DAY_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= FEEDBACK_PER_DAY) return reply(429, 'too_many');
  await env.DB.prepare('INSERT OR IGNORE INTO feedback (id, install_id, code, version, text, created_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(f.id, f.installId, f.pilotCode, f.version, f.text, f.createdAt, now).run();
  return reply(204);
}

export async function purgeOldReports(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM reports WHERE received_at < ?').bind(now - RETENTION_DAYS * DAY_MS).run();
}
