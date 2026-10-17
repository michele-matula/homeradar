# Misura del pilota — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** report giornaliero automatico (statistiche d'uso anonime ed errori ripuliti) e feedback dalle impostazioni verso un Cloudflare Worker con D1 e pagina admin protetta da password.

**Architecture:** l'estensione tiene contatori d'uso in `meta.usage` (`src/core/usage.ts`, puro, scritto da `PilotStore`), costruisce e ripulisce il report in `src/core/report.ts` (puro), lo invia da `src/background/reporter.ts` (dipendenze iniettate, come `auto-backup.ts`) con l'allarme `report`. Il Worker in `worker/` è un pacchetto separato: `POST /report`, `POST /feedback`, `/admin*` in HTML generato dal server, cron di pulizia. Lo schema del report è in `src/shared/report-schema.ts` e ne esiste una copia identica in `worker/src/schema.ts`.

**Tech Stack:** WXT + React + TypeScript, Dexie, zod 4, Vitest (jsdom + fake-indexeddb); Worker: Cloudflare Workers, D1, wrangler, `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-17-misura-pilota-design.md`

## Global Constraints

- Mai richieste HTTP dell'estensione verso i portali; l'unica destinazione nuova è `WXT_REPORT_URL`.
- Nel report mai titoli, indirizzi, città, zone, prezzi, m², ID e URL degli annunci, testo delle note, date di ricontatto, soglie delle impostazioni.
- Invio solo se: `REPORT_URL` non vuota, informativa confermata nella versione corrente, `settings.reportingEnabled`, `settings.pilotCode` non vuoto; per gli invii automatici anche `codeRejected` falso.
- Codice pilota: maiuscole, spazi tolti, `^[A-Z0-9-]{4,32}$`; vuoto ammesso (= nessun invio).
- Feedback: da 1 a 2000 caratteri dopo `trim`; coda di al massimo 20; parte anche con `reportingEnabled` spento.
- Timeout `fetch` 15 s; invio all'avvio solo se `lastSentAt` manca o ha più di 20 ore; allarme `report` ogni 1440 minuti.
- Worker: report ≤ 64 KB, feedback ≤ 8 KB, 30 feedback per codice nelle ultime 24 ore, report più vecchi di 180 giorni cancellati, Basic Auth con `ADMIN_PASSWORD`, POST admin solo con `Origin` uguale, CSP `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'`, `Cache-Control: no-store`.
- `meta.install`, `meta.usage`, `meta.reporting`, `meta.feedbackQueue` fuori dal backup; `pilotCode` e `reportingEnabled` dentro (facoltativi nello schema: i backup vecchi restano validi; `BACKUP_FORMAT_VERSION` resta 1).
- Nessuna nuova versione dello schema Dexie.
- `ONBOARDING_VERSION = 5` con la voce `5` in `ONBOARDING_CHANGES`.
- Timestamp in ms epoch UTC; giorni d'uso come date locali `AAAA-MM-GG`.
- Testi dell'interfaccia in italiano. File con CRLF: usare l'Edit tool, non `sed`. Commit con heredoc in Bash (le virgolette doppie rompono `git commit -m` in PowerShell).

## Review Focus

1. Messaggi d'errore con apostrofi italiani ("Apertura dell'informativa: …"): la ripulitura delle virgolette non deve mangiarsi il testo tra due apostrofi → test in Task 2.
2. Codice pilota scritto in minuscolo o con spazi nell'informativa, o non valido: si normalizza, oppure si mostra l'errore e la conferma non avviene → test in Task 8.
3. Doppio invio (allarme e avvio insieme, o un nuovo invio dopo un timeout): un solo POST alla volta nel client, upsert per giorno nel Worker → test in Task 5 e Task 9.
4. Nome d'agenzia o testo di feedback con HTML (`<script>`): sempre escapato nella pagina admin → test in Task 10.
5. Feedback con codice mancante o URL non configurata: campo disattivato con la spiegazione, nessuna eccezione → test in Task 7.

---

## Mappa dei file

| File | Responsabilità |
|---|---|
| `src/core/usage.ts` (nuovo) | `UsageStats`, giorni locali, applicazione degli eventi, lettura tollerante |
| `src/shared/report-schema.ts` (nuovo) | schemi zod di report e feedback, `PILOT_CODE_RE`; autosufficiente (copiato nel Worker) |
| `src/core/report.ts` (nuovo) | `sanitizeError`, `buildReport` |
| `src/core/pilot-store.ts` (nuovo) | lettura/scrittura di `meta.install`, `meta.usage`, `meta.reporting`, `meta.feedbackQueue` |
| `src/background/reporter.ts` (nuovo) | condizioni, invio, esiti, coda dei feedback |
| `src/shared/report-config.ts` (nuovo) | `REPORT_URL` dalla build |
| `src/ui/sidepanel/PilotCard.tsx`, `FeedbackCard.tsx` (nuovi) | schede Pilota e Feedback |
| `src/shared/types.ts`, `src/core/settings.ts`, `src/core/backup.ts` | impostazioni nuove |
| `src/core/service.ts`, `src/core/router.ts`, `src/shared/messages.ts`, `src/entrypoints/background.ts`, `wxt.config.ts` | cablaggio |
| `src/core/diagnostics.ts` | righe Uso e Invio nel report copiato |
| `src/ui/sidepanel/{SettingsView,App,ExportBar,api}.tsx/ts`, `src/ui/onboarding/Onboarding.tsx`, `src/core/onboarding.ts` | interfaccia |
| `worker/**` (nuovo) | Worker, migrazioni, test |
| `docs/pilot-reporting.md` (nuovo), `docs/smoke-test.md`, `CLAUDE.md` | documentazione |

---

### Task 1: contatori d'uso (`usage.ts`)

**Files:**
- Create: `src/core/usage.ts`
- Test: `tests/unit/core/usage.test.ts`

**Interfaces:**
- Produces:
  - `interface UsageStats { browsingDays: string[]; panelDays: string[]; statusChanges: Partial<Record<LeadStatus, number>>; recallsSet: number; notesWritten: number; exports: { xlsx: number; csv: number } }`
  - `const EMPTY_USAGE: UsageStats`, `const MAX_USAGE_DAYS = 400`
  - `type UsageEvent = { kind: 'browsing' } | { kind: 'panel' } | { kind: 'export'; format: 'xlsx' | 'csv' } | { kind: 'leadChange'; prev: LeadState; next: LeadState }`
  - `type UsageClientEvent = Extract<UsageEvent, { kind: 'panel' } | { kind: 'export' }>`
  - `localDay(ms: number): string`, `applyUsage(u: UsageStats, e: UsageEvent, now: number): UsageStats`, `normalizeUsage(raw: unknown): UsageStats`, `activeRange(u: UsageStats): { first: string | null; last: string | null }`

- [ ] **Step 1: scrivi i test**

```ts
import { describe, expect, it } from 'vitest';
import { activeRange, applyUsage, EMPTY_USAGE, localDay, MAX_USAGE_DAYS, normalizeUsage } from '@/core/usage';
import type { LeadState } from '@/shared/types';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const state = (p: Partial<LeadState> = {}): LeadState => ({ listingKey: 'immobiliare:1', status: 'new', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null, ...p });

describe('usage', () => {
  it('localDay usa la data locale', () => {
    expect(localDay(at(2026, 10, 17, 0))).toBe('2026-10-17');
    expect(localDay(at(2026, 10, 17, 23))).toBe('2026-10-17');
    expect(localDay(at(2026, 1, 5))).toBe('2026-01-05');
  });

  it('aggiunge il giorno una volta sola, in ordine', () => {
    let u = applyUsage(EMPTY_USAGE, { kind: 'browsing' }, at(2026, 10, 18));
    u = applyUsage(u, { kind: 'browsing' }, at(2026, 10, 17));
    u = applyUsage(u, { kind: 'browsing' }, at(2026, 10, 18, 20));
    u = applyUsage(u, { kind: 'panel' }, at(2026, 10, 19));
    expect(u.browsingDays).toEqual(['2026-10-17', '2026-10-18']);
    expect(u.panelDays).toEqual(['2026-10-19']);
    expect(activeRange(u)).toEqual({ first: '2026-10-17', last: '2026-10-19' });
    expect(activeRange(EMPTY_USAGE)).toEqual({ first: null, last: null });
  });

  it('tiene al massimo gli ultimi 400 giorni', () => {
    let u = EMPTY_USAGE;
    for (let i = 0; i < MAX_USAGE_DAYS + 5; i++) u = applyUsage(u, { kind: 'panel' }, at(2025, 1, 1) + i * 86_400_000);
    expect(u.panelDays).toHaveLength(MAX_USAGE_DAYS);
    expect(u.panelDays[0]).toBe(localDay(at(2025, 1, 1) + 5 * 86_400_000));
  });

  it('conta solo i passaggi di stato reali, i richiami impostati e le note scritte', () => {
    const now = at(2026, 10, 17);
    let u = applyUsage(EMPTY_USAGE, { kind: 'leadChange', prev: state(), next: state({ status: 'contacted' }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ status: 'contacted' }), next: state({ status: 'contacted' }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state(), next: state({ status: 'to_contact', recallAt: 5 }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ recallAt: 5 }), next: state({ recallAt: 5 }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ recallAt: 5 }), next: state({ recallAt: null }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state(), next: state({ notes: 'richiamare' }) }, now);
    u = applyUsage(u, { kind: 'leadChange', prev: state({ notes: 'richiamare' }), next: state({ notes: '  ' }) }, now);
    expect(u.statusChanges).toEqual({ contacted: 1, to_contact: 1 });
    expect(u.recallsSet).toBe(1);
    expect(u.notesWritten).toBe(1);
  });

  it('conta gli export per formato', () => {
    let u = applyUsage(EMPTY_USAGE, { kind: 'export', format: 'xlsx' }, 0);
    u = applyUsage(u, { kind: 'export', format: 'csv' }, 0);
    u = applyUsage(u, { kind: 'export', format: 'xlsx' }, 0);
    expect(u.exports).toEqual({ xlsx: 2, csv: 1 });
  });

  it('normalizeUsage scarta i valori di forma inattesa', () => {
    expect(normalizeUsage(undefined)).toEqual(EMPTY_USAGE);
    expect(normalizeUsage({ browsingDays: ['2026-10-17', 'x', 3], statusChanges: { contacted: 2, bogus: 1, new: -1 }, recallsSet: 'a', exports: { xlsx: 1 } }))
      .toEqual({ ...EMPTY_USAGE, browsingDays: ['2026-10-17'], statusChanges: { contacted: 2 }, exports: { xlsx: 1, csv: 0 } });
  });

  it('non modifica l\'oggetto di partenza', () => {
    applyUsage(EMPTY_USAGE, { kind: 'export', format: 'csv' }, 0);
    expect(EMPTY_USAGE.exports.csv).toBe(0);
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/usage.test.ts`
Expected: FAIL, modulo `@/core/usage` inesistente.

- [ ] **Step 3: implementa `src/core/usage.ts`**

```ts
import { LEAD_STATUSES, type LeadState, type LeadStatus } from '@/shared/types';

/** Contatori d'uso per la misura del pilota. Solo numeri e giorni: nessun dato degli annunci. */
export interface UsageStats {
  /** Giorni locali 'AAAA-MM-GG' con almeno una lettura di un portale. */
  browsingDays: string[];
  /** Giorni locali con il pannello aperto. */
  panelDays: string[];
  /** Passaggi reali allo stato indicato. */
  statusChanges: Partial<Record<LeadStatus, number>>;
  /** Richiami impostati o spostati (non quelli tolti). */
  recallsSet: number;
  /** Note salvate diverse dalla precedente e non vuote. */
  notesWritten: number;
  exports: { xlsx: number; csv: number };
}

export const MAX_USAGE_DAYS = 400;

export const EMPTY_USAGE: UsageStats = Object.freeze({
  browsingDays: [], panelDays: [], statusChanges: {}, recallsSet: 0, notesWritten: 0, exports: { xlsx: 0, csv: 0 },
}) as UsageStats;

export type UsageEvent =
  | { kind: 'browsing' }
  | { kind: 'panel' }
  | { kind: 'export'; format: 'xlsx' | 'csv' }
  | { kind: 'leadChange'; prev: LeadState; next: LeadState };

/** Eventi che il pannello può segnalare al background. */
export type UsageClientEvent = Extract<UsageEvent, { kind: 'panel' } | { kind: 'export' }>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function withDay(days: string[], day: string): string[] {
  if (days.includes(day)) return days;
  return [...days, day].sort().slice(-MAX_USAGE_DAYS);
}

export function applyUsage(u: UsageStats, e: UsageEvent, now: number): UsageStats {
  switch (e.kind) {
    case 'browsing':
      return { ...u, browsingDays: withDay(u.browsingDays, localDay(now)) };
    case 'panel':
      return { ...u, panelDays: withDay(u.panelDays, localDay(now)) };
    case 'export':
      return { ...u, exports: { ...u.exports, [e.format]: u.exports[e.format] + 1 } };
    case 'leadChange': {
      const { prev, next } = e;
      const out = { ...u, statusChanges: { ...u.statusChanges } };
      if (next.status !== prev.status) out.statusChanges[next.status] = (out.statusChanges[next.status] ?? 0) + 1;
      if (next.recallAt != null && next.recallAt !== (prev.recallAt ?? null)) out.recallsSet += 1;
      if (next.notes !== prev.notes && next.notes.trim() !== '') out.notesWritten += 1;
      return out;
    }
  }
}

const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);
const days = (v: unknown) => (Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string' && DAY_RE.test(d)).sort().slice(-MAX_USAGE_DAYS) : []);

/** Lettura tollerante di `meta.usage`: un valore di forma inattesa vale zero. */
export function normalizeUsage(raw: unknown): UsageStats {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sc = (r.statusChanges ?? {}) as Record<string, unknown>;
  const ex = (r.exports ?? {}) as Record<string, unknown>;
  const statusChanges: Partial<Record<LeadStatus, number>> = {};
  for (const s of LEAD_STATUSES) if (count(sc[s]) > 0) statusChanges[s] = count(sc[s]);
  return {
    browsingDays: days(r.browsingDays),
    panelDays: days(r.panelDays),
    statusChanges,
    recallsSet: count(r.recallsSet),
    notesWritten: count(r.notesWritten),
    exports: { xlsx: count(ex.xlsx), csv: count(ex.csv) },
  };
}

export function activeRange(u: UsageStats): { first: string | null; last: string | null } {
  const all = [...u.browsingDays, ...u.panelDays].sort();
  return { first: all[0] ?? null, last: all[all.length - 1] ?? null };
}
```

- [ ] **Step 4: verifica che passino**

Run: `npx vitest run tests/unit/core/usage.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/usage.ts tests/unit/core/usage.test.ts
git commit -F - <<'EOF'
feat(core): contatori d'uso per la misura del pilota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: schema del report, ripulitura e costruzione (`report-schema.ts`, `report.ts`)

**Files:**
- Create: `src/shared/report-schema.ts`, `src/core/report.ts`
- Test: `tests/unit/core/report.test.ts`

**Interfaces:**
- Consumes: `UsageStats`, `activeRange` (Task 1); `warnedPortals` da `@/core/diagnostics`; `LeadView`, `Settings`, `Diagnostics`, `PORTALS` da `@/shared/types`.
- Produces:
  - `src/shared/report-schema.ts`: `PILOT_CODE_RE`, `FEEDBACK_MAX = 2000`, `UsageReportSchema`, `type UsageReport`, `FeedbackSchema`, `type FeedbackPayload`
  - `src/core/report.ts`: `sanitizeError(message: string): string`, `interface ReportInput { installId: string; pilotCode: string; version: string; settings: Settings; usage: UsageStats; diagnostics: Diagnostics; leads: LeadView[]; now: number; timezoneOffset: number }`, `buildReport(input: ReportInput): UsageReport`

- [ ] **Step 1: scrivi i test**

```ts
import { describe, expect, it } from 'vitest';
import { buildReport, sanitizeError, type ReportInput } from '@/core/report';
import { EMPTY_USAGE } from '@/core/usage';
import { UsageReportSchema } from '@/shared/report-schema';
import { DEFAULT_SETTINGS, type LeadView, type Portal, type Priority } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 17, 12);
const DAY = 86_400_000;

function lead(portal: Portal, priority: Priority, firstSeenAt: number, others: number[] = []): LeadView {
  const listing = (id: number, seen: number) => ({
    key: `${portal}:${id}`, portal, portalId: id, url: `https://www.${portal}.it/annunci/${id}/`, title: 'Trilocale via Roma 12, Milano',
    address: 'Via Roma 12', city: 'Milano', zone: 'Brera', typology: 'Appartamento', surfaceM2: 80, rooms: 3, currentPrice: 350000,
    portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: seen, lastSeenAt: seen, seenCount: 1,
  });
  const evaluation = { listingKey: `${portal}:1`, portalId: 1, priority, ageDays: 10, ageEstimated: false, ageUncertain: false, dropPercent: 0, dropCount: 0, maxKnownPrice: 350000, reasons: [], badgeText: '' };
  return {
    listing: listing(1, firstSeenAt), evaluation,
    state: { listingKey: `${portal}:1`, status: 'new', notes: 'chiamare il sig. Bianchi 3331234567', statusChangedAt: 0, updatedAt: 0, recallAt: null },
    prices: [], market: null, reposted: false,
    others: others.map((seen, i) => ({ listing: listing(100 + i, seen), evaluation, prices: [], previous: false })),
  };
}

function input(p: Partial<ReportInput> = {}): ReportInput {
  return {
    installId: '7f3c2a8e-1b2d-4c5e-8f90-123456789abc', pilotCode: 'ROSSI-7K2P', version: '0.1.0',
    settings: { ...DEFAULT_SETTINGS, enabledPortals: { immobiliare: true, idealista: false, subito: true } },
    usage: { ...EMPTY_USAGE, browsingDays: ['2026-10-15', '2026-10-17'], panelDays: ['2026-10-16'] },
    diagnostics: { version: '0.1.0', counters: { ingested: 12 }, errors: [], adapterWarning: { idealista: true } },
    leads: [], now: NOW, timezoneOffset: -120, ...p,
  };
}

describe('sanitizeError', () => {
  it.each([
    ['result[3]: price.value Invalid input: expected number, received string', 'result[3]: price.value Invalid input: expected number, received string'],
    ["ads[2]: Invalid option: expected one of 's'|'c'", 'ads[2]: Invalid option: expected one of <testo>|<testo>'],
    ['result[0]: title Invalid input: expected "Trilocale via Roma 12"', 'result[0]: title Invalid input: expected <testo>'],
    ["Apertura dell'informativa: Could not establish connection", "Apertura dell'informativa: Could not establish connection"],
    ['detail: id 128416572 non valido', 'detail: id # non valido'],
    ['prezzo 250.000 € fuori scala', 'prezzo # € fuori scala'],
    ['Fetch fallito https://www.immobiliare.it/annunci/128416572/?x=1', 'Fetch fallito <url>'],
    ['Backup automatico: C:\\Users\\Michele\\Downloads\\HomeRadar\\backup-1.json non scritto', 'Backup automatico: <path> non scritto'],
    ['File /Users/anna/Downloads/x.json mancante', 'File <path> mancante'],
    ['Titolo «Casa al mare» rifiutato', 'Titolo <testo> rifiutato'],
  ])('%s', (raw, clean) => {
    expect(sanitizeError(raw)).toBe(clean);
  });

  it('tronca a 200 caratteri', () => {
    expect(sanitizeError('a'.repeat(500))).toHaveLength(200);
  });
});

describe('buildReport', () => {
  it('produce un report valido con giorni, portali attivi e avvisi', () => {
    const r = buildReport(input());
    expect(UsageReportSchema.parse(r)).toEqual(r);
    expect(r.usage.firstActiveDay).toBe('2026-10-15');
    expect(r.usage.lastActiveDay).toBe('2026-10-17');
    expect(r.enabledPortals).toEqual(['immobiliare', 'subito']);
    expect(r.technical.adapterWarning).toEqual(['idealista']);
    expect(r.technical.counters).toEqual({ ingested: 12 });
    expect(r.sentAt).toBe(NOW);
    expect(r.timezoneOffset).toBe(-120);
  });

  it('conta i lead come li mostra il pannello', () => {
    const leads = [
      lead('immobiliare', 'high', NOW - 2 * DAY, [NOW - 30 * DAY]), // gruppo con un annuncio vecchio: non è nuovo
      lead('subito', 'medium', NOW - 3 * DAY),
      lead('subito', 'none', NOW - 20 * DAY),
    ];
    const r = buildReport(input({ leads }));
    expect(r.leads).toEqual({
      total: 3,
      byPortal: { immobiliare: 1, idealista: 0, subito: 2 },
      byPriority: { high: 1, medium: 1, verify: 0, none: 1 },
      newLast7Days: 1,
    });
  });

  it('ripulisce gli errori e ne tiene al massimo 20', () => {
    const errors = Array.from({ length: 25 }, (_, i) => ({ at: i, message: `result[${i}]: id 12345678 'x'` }));
    const r = buildReport(input({ diagnostics: { version: 'v', counters: {}, errors, adapterWarning: {} } }));
    expect(r.technical.errors).toHaveLength(20);
    expect(r.technical.errors[0]).toEqual({ at: 5, message: 'result[5]: id # <testo>' });
  });

  it('non contiene dati degli annunci', () => {
    const errors = [{ at: 1, message: "Fetch https://www.immobiliare.it/annunci/128416572/ prezzo 350000 titolo 'Trilocale via Roma 12'" }];
    const json = JSON.stringify(buildReport(input({
      leads: [lead('immobiliare', 'high', NOW), lead('subito', 'verify', NOW)],
      diagnostics: { version: 'v', counters: {}, errors, adapterWarning: {} },
    })));
    for (const banned of ['Roma', 'Milano', 'Brera', 'Trilocale', '350000', '3331234567', 'Bianchi', 'annunci', 'http']) expect(json).not.toContain(banned);
    const messages = JSON.stringify(buildReport(input({ diagnostics: { version: 'v', counters: {}, errors, adapterWarning: {} } })).technical.errors);
    expect(messages).not.toMatch(/\d{4}/);
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/report.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: crea `src/shared/report-schema.ts`**

Il file deve importare solo `zod`: è copiato identico in `worker/src/schema.ts` (Task 9).

```ts
// Schema del report e del feedback per la misura del pilota.
// Copiato identico in worker/src/schema.ts: un test fallisce se i due file divergono.
import { z } from 'zod';

export const PILOT_CODE_RE = /^[A-Z0-9-]{4,32}$/;
export const FEEDBACK_MAX = 2000;

const portal = z.enum(['immobiliare', 'idealista', 'subito']);
const priority = z.enum(['high', 'medium', 'verify', 'none']);
const status = z.enum(['new', 'to_contact', 'contacted', 'discarded']);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);
const pilotCode = z.string().regex(PILOT_CODE_RE);
const version = z.string().min(1).max(32);

// Gli schemi sono la lista dei campi ammessi: z.object scarta tutto ciò che non è dichiarato.
export const UsageReportSchema = z.object({
  formatVersion: z.literal(1),
  installId: z.uuid(),
  pilotCode,
  version,
  sentAt: z.number().int(),
  timezoneOffset: z.number().int().min(-900).max(900),
  enabledPortals: z.array(portal).max(3),
  usage: z.object({
    browsingDays: z.array(day).max(400),
    panelDays: z.array(day).max(400),
    statusChanges: z.partialRecord(status, count),
    recallsSet: count,
    notesWritten: count,
    exports: z.object({ xlsx: count, csv: count }),
    firstActiveDay: day.nullable(),
    lastActiveDay: day.nullable(),
  }),
  leads: z.object({
    total: count,
    byPortal: z.record(portal, count),
    byPriority: z.record(priority, count),
    newLast7Days: count,
  }),
  technical: z.object({
    counters: z.record(z.string().max(40), count),
    adapterWarning: z.array(portal).max(3),
    errors: z.array(z.object({ at: z.number().int(), message: z.string().max(200) })).max(20),
  }),
});
export type UsageReport = z.infer<typeof UsageReportSchema>;

export const FeedbackSchema = z.object({
  id: z.uuid(),
  installId: z.uuid(),
  pilotCode,
  version,
  text: z.string().trim().min(1).max(FEEDBACK_MAX),
  createdAt: z.number().int(),
});
export type FeedbackPayload = z.infer<typeof FeedbackSchema>;
```

- [ ] **Step 4: crea `src/core/report.ts`**

```ts
import { warnedPortals } from '@/core/diagnostics';
import { activeRange, type UsageStats } from '@/core/usage';
import type { UsageReport } from '@/shared/report-schema';
import { DAY_MS, PORTALS, type Diagnostics, type LeadView, type Settings } from '@/shared/types';

const MAX_ERRORS = 20;
const MAX_MESSAGE = 200;

/**
 * Toglie da un messaggio d'errore ciò che potrebbe venire da un annuncio: URL, percorsi di file, testi tra
 * virgolette (i valori "received" di zod), numeri di 4 o più cifre. Restano indici brevi e percorsi dei campi.
 */
export function sanitizeError(message: string): string {
  return message
    .replace(/\b(?:https?|chrome-extension):\/\/\S+/g, '<url>')
    .replace(/\b[A-Za-z]:\\[^\s'"«»]*/g, '<path>')
    .replace(/\/(?:Users|home)\/[^\s'"«»]*/g, '<path>')
    // Un apostrofo dopo una lettera (dell'informativa) non apre una citazione.
    .replace(/(^|[^\p{L}\p{N}])(?:'[^']*'|"[^"]*"|`[^`]*`)/gu, '$1<testo>')
    .replace(/«[^»]*»/g, '<testo>')
    .replace(/\d[\d.,]*\d|\d/g, (m) => (m.replace(/\D/g, '').length >= 4 ? '#' : m))
    .slice(0, MAX_MESSAGE);
}

export interface ReportInput {
  installId: string;
  pilotCode: string;
  version: string;
  settings: Settings;
  usage: UsageStats;
  diagnostics: Diagnostics;
  /** Lead come li mostra il pannello: un gruppo vale uno. */
  leads: LeadView[];
  now: number;
  timezoneOffset: number;
}

export function buildReport(i: ReportInput): UsageReport {
  const byPortal = Object.fromEntries(PORTALS.map((p) => [p, 0])) as UsageReport['leads']['byPortal'];
  const byPriority: UsageReport['leads']['byPriority'] = { high: 0, medium: 0, verify: 0, none: 0 };
  let newLast7Days = 0;
  for (const l of i.leads) {
    byPortal[l.listing.portal] += 1;
    byPriority[l.evaluation.priority] += 1;
    const firstSeen = Math.min(l.listing.firstSeenAt, ...l.others.map((o) => o.listing.firstSeenAt));
    if (firstSeen >= i.now - 7 * DAY_MS) newLast7Days += 1;
  }
  const range = activeRange(i.usage);
  return {
    formatVersion: 1,
    installId: i.installId,
    pilotCode: i.pilotCode,
    version: i.version,
    sentAt: i.now,
    timezoneOffset: i.timezoneOffset,
    enabledPortals: PORTALS.filter((p) => i.settings.enabledPortals[p]),
    usage: { ...i.usage, firstActiveDay: range.first, lastActiveDay: range.last },
    leads: { total: i.leads.length, byPortal, byPriority, newLast7Days },
    technical: {
      counters: { ...i.diagnostics.counters },
      adapterWarning: warnedPortals(i.diagnostics.adapterWarning),
      errors: i.diagnostics.errors.slice(-MAX_ERRORS).map((e) => ({ at: e.at, message: sanitizeError(e.message) })),
    },
  };
}
```

- [ ] **Step 5: verifica che passino**

Run: `npx vitest run tests/unit/core/report.test.ts`
Expected: PASS. Se un caso di `sanitizeError` fallisce, correggi l'espressione regolare, non il caso atteso: i casi sono la specifica.

- [ ] **Step 6: commit**

```bash
git add src/shared/report-schema.ts src/core/report.ts tests/unit/core/report.test.ts
git commit -F - <<'EOF'
feat(core): report d'uso con errori ripuliti e schema condiviso col Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: impostazioni `pilotCode` e `reportingEnabled`

**Files:**
- Modify: `src/shared/types.ts:108-124` (`Settings`, `DEFAULT_SETTINGS`)
- Modify: `src/core/settings.ts`
- Modify: `src/core/backup.ts:86-89` (`SettingsSchema`)
- Test: `tests/unit/core/settings.test.ts`, `tests/unit/core/backup.test.ts`

**Interfaces:**
- Consumes: `PILOT_CODE_RE` (Task 2).
- Produces: `Settings.pilotCode: string` (default `''`), `Settings.reportingEnabled: boolean` (default `true`); `validateSettings` normalizza il codice e lancia `Error('Codice pilota non valido: usa da 4 a 32 tra lettere, cifre e trattini')`; `INVALID_PILOT_CODE` esportata da `settings.ts` con quel testo.

- [ ] **Step 1: aggiungi i test a `tests/unit/core/settings.test.ts`**

```ts
it('normalizza il codice pilota e rifiuta quelli non validi', () => {
  expect(validateSettings({ pilotCode: ' rossi-7k2p ' }).pilotCode).toBe('ROSSI-7K2P');
  expect(validateSettings({ pilotCode: 'ro ssi 7k' }).pilotCode).toBe('ROSSI7K');
  expect(validateSettings({}).pilotCode).toBe('');
  expect(validateSettings({}).reportingEnabled).toBe(true);
  expect(() => validateSettings({ pilotCode: 'ab' })).toThrow(INVALID_PILOT_CODE);
  expect(() => validateSettings({ pilotCode: 'ROSSI_7K' })).toThrow(INVALID_PILOT_CODE);
  expect(() => validateSettings({ reportingEnabled: 'sì' as unknown as boolean })).toThrow('Invio statistiche non valido');
});
```

Aggiungi `INVALID_PILOT_CODE` all'import da `@/core/settings`.

E in `tests/unit/core/backup.test.ts` (accanto ai test sulle impostazioni del file):

```ts
it('accetta impostazioni con o senza codice pilota', () => {
  const base = buildBackup({ listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, 0, '0.1.0');
  const old = { ...base, settings: { minAgeDays: 100 } };
  expect(parseBackup(JSON.parse(JSON.stringify(old))).settings).toMatchObject({ minAgeDays: 100, pilotCode: '', reportingEnabled: true });
  const now = { ...base, settings: { pilotCode: 'rossi-7k2p', reportingEnabled: false } };
  expect(parseBackup(JSON.parse(JSON.stringify(now))).settings).toMatchObject({ pilotCode: 'ROSSI-7K2P', reportingEnabled: false });
});
```

(Usa i nomi già importati nel file: se `parseBackup`/`buildBackup` hanno un'altra firma, adatta la chiamata, non il comportamento atteso.)

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/settings.test.ts tests/unit/core/backup.test.ts`
Expected: FAIL.

- [ ] **Step 3: implementa**

In `src/shared/types.ts`, dentro `Settings` dopo `enabledPortals`:

```ts
  /** Codice dell'agenzia per l'invio dei report del pilota; vuoto = nessun invio. */
  pilotCode: string;
  /** Invio giornaliero delle statistiche d'uso anonime al gestore del pilota. */
  reportingEnabled: boolean;
```

e in `DEFAULT_SETTINGS`: `pilotCode: '', reportingEnabled: true,`.

In `src/core/settings.ts`:

```ts
import { PILOT_CODE_RE } from '@/shared/report-schema';
import { DEFAULT_SETTINGS, PORTALS, type Settings } from '@/shared/types';

export const INVALID_PILOT_CODE = 'Codice pilota non valido: usa da 4 a 32 tra lettere, cifre e trattini';
```

e prima del `return s;`:

```ts
  if (typeof s.reportingEnabled !== 'boolean') throw new Error('Invio statistiche non valido');
  s.pilotCode = String(s.pilotCode ?? '').toUpperCase().replace(/\s+/g, '');
  if (s.pilotCode !== '' && !PILOT_CODE_RE.test(s.pilotCode)) throw new Error(INVALID_PILOT_CODE);
```

In `src/core/backup.ts`, `SettingsSchema`: aggiungi `pilotCode: z.string().optional(), reportingEnabled: z.boolean().optional(),`.

- [ ] **Step 4: verifica**

Run: `npm test`
Expected: PASS. Se un test esistente confronta un oggetto impostazioni scritto a mano, aggiungigli i due campi nuovi con i valori di default.

- [ ] **Step 5: commit**

```bash
git add src/shared/types.ts src/core/settings.ts src/core/backup.ts tests/unit/core/settings.test.ts tests/unit/core/backup.test.ts
git commit -F - <<'EOF'
feat(settings): codice pilota e interruttore dell'invio statistiche

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `PilotStore`, contatori nel servizio e nel router

**Files:**
- Create: `src/core/pilot-store.ts`
- Modify: `src/shared/types.ts` (tipi `ReportingStatus`, `QueuedFeedback`, `ReportingInfo`)
- Modify: `src/core/service.ts:173-196` (`setLeadState`), costruttore, nuovo `trackUsage`
- Modify: `src/core/router.ts` (`ingest`, nuovo `trackUsage`)
- Modify: `src/shared/messages.ts` (`trackUsage`)
- Test: `tests/unit/core/pilot-store.test.ts`, `tests/unit/core/router.test.ts`

**Interfaces:**
- Consumes: `UsageStats`, `UsageEvent`, `UsageClientEvent`, `applyUsage`, `normalizeUsage`, `EMPTY_USAGE` (Task 1).
- Produces:
  - in `types.ts`: `interface ReportingStatus { lastSentAt: number | null; lastAttemptAt: number | null; lastError: 'network' | 'server' | 'rejected' | 'invalid' | null; codeRejected: boolean }`, `interface QueuedFeedback { id: string; text: string; createdAt: number; version: string }`, `interface ReportingInfo { configured: boolean; status: ReportingStatus; queued: number }`
  - `class PilotStore { constructor(db: HomeRadarDB, clock?: () => number, uuid?: () => string); installId(): Promise<string>; usage(): Promise<UsageStats>; recordUsage(e: UsageEvent): Promise<void>; reportingStatus(): Promise<ReportingStatus>; updateReporting(fn: (s: ReportingStatus) => void): Promise<ReportingStatus>; feedbackQueue(): Promise<QueuedFeedback[]>; enqueueFeedback(text: string, version: string): Promise<QueuedFeedback>; dropFeedback(id: string): Promise<void> }`
  - `FEEDBACK_QUEUE_MAX = 20`, `FEEDBACK_QUEUE_FULL = 'Troppi messaggi in attesa di invio: riprova più tardi'`
  - `LeadService.pilot: PilotStore`, `LeadService.trackUsage(e: UsageEvent): Promise<void>` (non lancia mai)
  - messaggio `{ type: 'trackUsage'; event: UsageClientEvent }`

- [ ] **Step 1: scrivi `tests/unit/core/pilot-store.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { FEEDBACK_QUEUE_FULL, FEEDBACK_QUEUE_MAX } from '@/core/pilot-store';
import { obs, setup } from './helpers';

describe('PilotStore', () => {
  it('crea l\'ID di installazione una volta sola', async () => {
    const { svc } = setup();
    const id = await svc.pilot.installId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await svc.pilot.installId()).toBe(id);
  });

  it('registra gli eventi d\'uso', async () => {
    const { svc } = setup();
    await svc.pilot.recordUsage({ kind: 'panel' });
    await svc.pilot.recordUsage({ kind: 'export', format: 'csv' });
    const u = await svc.pilot.usage();
    expect(u.panelDays).toHaveLength(1);
    expect(u.exports).toEqual({ xlsx: 0, csv: 1 });
  });

  it('stato dell\'invio: default e aggiornamento', async () => {
    const { svc } = setup();
    expect(await svc.pilot.reportingStatus()).toEqual({ lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false });
    const s = await svc.pilot.updateReporting((r) => { r.codeRejected = true; });
    expect(s.codeRejected).toBe(true);
    expect((await svc.pilot.reportingStatus()).codeRejected).toBe(true);
  });

  it('coda dei feedback con limite', async () => {
    const { svc, now } = setup();
    const f = await svc.pilot.enqueueFeedback('Ottimo', '0.1.0');
    expect(f).toMatchObject({ text: 'Ottimo', version: '0.1.0', createdAt: now() });
    for (let i = 1; i < FEEDBACK_QUEUE_MAX; i++) await svc.pilot.enqueueFeedback(`m${i}`, 'v');
    await expect(svc.pilot.enqueueFeedback('troppo', 'v')).rejects.toThrow(FEEDBACK_QUEUE_FULL);
    await svc.pilot.dropFeedback(f.id);
    expect((await svc.pilot.feedbackQueue()).map((q) => q.text)[0]).toBe('m1');
  });

  it('setLeadState conta una volta per gruppo e non fallisce se i contatori non si scrivono', async () => {
    const { svc } = setup();
    await svc.ingest([obs({ portalId: 1, url: 'https://www.immobiliare.it/annunci/1/' }), obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/' })]);
    await svc.setLeadState(['immobiliare:1', 'immobiliare:2'], { status: 'contacted', notes: 'ok' });
    expect((await svc.pilot.usage()).statusChanges).toEqual({ contacted: 1 });
    expect((await svc.pilot.usage()).notesWritten).toBe(1);
    svc.pilot.recordUsage = async () => { throw new Error('quota'); };
    await expect(svc.setLeadState(['immobiliare:1'], { status: 'discarded' })).resolves.toMatchObject({ status: 'discarded' });
    expect((await svc.getDiagnostics('v')).errors.at(-1)?.message).toBe('Contatori d\'uso: quota');
  });
});
```

In `tests/unit/core/router.test.ts` aggiungi:

```ts
it('ingest accettato segna il giorno di navigazione, trackUsage il pannello e gli export', async () => {
  const { svc } = await ready();
  const h = hooks();
  await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', h);
  await handleRequest(svc, { type: 'trackUsage', event: { kind: 'panel' } }, 'v', h);
  await handleRequest(svc, { type: 'trackUsage', event: { kind: 'export', format: 'xlsx' } }, 'v', h);
  const u = await svc.pilot.usage();
  expect(u.browsingDays).toHaveLength(1);
  expect(u.panelDays).toHaveLength(1);
  expect(u.exports.xlsx).toBe(1);
});

it('ingest scartato (informativa da confermare) non segna il giorno', async () => {
  const { svc } = setup();
  await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', hooks());
  expect((await svc.pilot.usage()).browsingDays).toEqual([]);
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/pilot-store.test.ts tests/unit/core/router.test.ts`
Expected: FAIL.

- [ ] **Step 3: tipi in `src/shared/types.ts`** (dopo `Diagnostics`)

```ts
export interface ReportingStatus {
  lastSentAt: number | null;
  lastAttemptAt: number | null;
  lastError: 'network' | 'server' | 'rejected' | 'invalid' | null;
  /** Il Worker non riconosce il codice pilota: niente invii automatici finché il codice cambia. */
  codeRejected: boolean;
}

export interface QueuedFeedback {
  id: string;
  text: string;
  createdAt: number;
  version: string;
}

/** Per la scheda Pilota: invio configurato nella build, stato, feedback in coda. */
export interface ReportingInfo {
  configured: boolean;
  status: ReportingStatus;
  queued: number;
}
```

- [ ] **Step 4: crea `src/core/pilot-store.ts`**

```ts
import type { HomeRadarDB } from '@/core/db';
import { applyUsage, normalizeUsage, type UsageEvent, type UsageStats } from '@/core/usage';
import type { QueuedFeedback, ReportingStatus } from '@/shared/types';

export const FEEDBACK_QUEUE_MAX = 20;
export const FEEDBACK_QUEUE_FULL = 'Troppi messaggi in attesa di invio: riprova più tardi';

const DEFAULT_STATUS: ReportingStatus = { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false };

/** Dati della misura del pilota in `meta`, fuori dal backup: ID d'installazione, contatori, stato dell'invio, coda dei feedback. */
export class PilotStore {
  constructor(
    private readonly db: HomeRadarDB,
    private readonly clock: () => number = Date.now,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  installId(): Promise<string> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const id = ((await this.db.meta.get('install'))?.value as { id?: unknown } | undefined)?.id;
      if (typeof id === 'string' && id) return id;
      const fresh = this.uuid();
      await this.db.meta.put({ key: 'install', value: { id: fresh } });
      return fresh;
    });
  }

  async usage(): Promise<UsageStats> {
    return normalizeUsage((await this.db.meta.get('usage'))?.value);
  }

  async recordUsage(e: UsageEvent): Promise<void> {
    const now = this.clock();
    await this.db.transaction('rw', this.db.meta, async () => {
      await this.db.meta.put({ key: 'usage', value: applyUsage(await this.usage(), e, now) });
    });
  }

  async reportingStatus(): Promise<ReportingStatus> {
    return { ...DEFAULT_STATUS, ...((await this.db.meta.get('reporting'))?.value as Partial<ReportingStatus> | undefined) };
  }

  updateReporting(fn: (s: ReportingStatus) => void): Promise<ReportingStatus> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const s = await this.reportingStatus();
      fn(s);
      await this.db.meta.put({ key: 'reporting', value: s });
      return s;
    });
  }

  async feedbackQueue(): Promise<QueuedFeedback[]> {
    const v = (await this.db.meta.get('feedbackQueue'))?.value;
    return Array.isArray(v) ? (v as QueuedFeedback[]) : [];
  }

  enqueueFeedback(text: string, version: string): Promise<QueuedFeedback> {
    return this.db.transaction('rw', this.db.meta, async () => {
      const queue = await this.feedbackQueue();
      if (queue.length >= FEEDBACK_QUEUE_MAX) throw new Error(FEEDBACK_QUEUE_FULL);
      const item: QueuedFeedback = { id: this.uuid(), text, createdAt: this.clock(), version };
      await this.db.meta.put({ key: 'feedbackQueue', value: [...queue, item] });
      return item;
    });
  }

  dropFeedback(id: string): Promise<void> {
    return this.db.transaction('rw', this.db.meta, async () => {
      await this.db.meta.put({ key: 'feedbackQueue', value: (await this.feedbackQueue()).filter((q) => q.id !== id) });
    });
  }
}
```

- [ ] **Step 5: `src/core/service.ts`**

Import: `import { PilotStore } from '@/core/pilot-store';` e `import type { UsageEvent } from '@/core/usage';`.

Nel costruttore (le proprietà dei parametri restano):

```ts
  /** Dati della misura del pilota (contatori, invio, feedback), fuori dal backup. */
  readonly pilot: PilotStore;

  constructor(
    private readonly db: HomeRadarDB,
    private readonly clock: () => number = Date.now,
  ) {
    this.pilot = new PilotStore(db, clock);
  }

  /** Registra un evento d'uso; un errore dei contatori non deve mai far fallire l'azione dell'agente. */
  async trackUsage(e: UsageEvent): Promise<void> {
    try {
      await this.pilot.recordUsage(e);
    } catch (err) {
      await this.recordError(`Contatori d'uso: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
    }
  }
```

In `setLeadState`: la transazione restituisce `{ prev, next }` invece di `{ ...next, listingKey }`:

```ts
    const { prev, next } = await this.db.transaction('rw', [listings, leadStates], async () => {
      // … corpo invariato fino a bulkPut …
      await leadStates.bulkPut(list.map((k) => ({ ...next, listingKey: k })));
      return { prev, next };
    });
    // Un gruppo vale un'azione dell'agente: si conta una volta sola.
    await this.trackUsage({ kind: 'leadChange', prev, next });
    return { ...next, listingKey: list[0]! };
```

- [ ] **Step 6: messaggi e router**

In `src/shared/messages.ts`: `import type { UsageClientEvent } from '@/core/usage';` e la variante `| { type: 'trackUsage'; event: UsageClientEvent }`.

In `src/core/router.ts`, caso `ingest`, dopo `bumpCounter('ingested', …)`:

```ts
      await service.trackUsage({ kind: 'browsing' });
```

e il nuovo caso:

```ts
    case 'trackUsage':
      await service.trackUsage(req.event);
      return null;
```

- [ ] **Step 7: verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: commit**

```bash
git add src/core/pilot-store.ts src/core/service.ts src/core/router.ts src/shared/messages.ts src/shared/types.ts tests/unit/core/pilot-store.test.ts tests/unit/core/router.test.ts
git commit -F - <<'EOF'
feat(core): contatori d'uso salvati, dai lead, dalle letture e dal pannello

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: invio del report e dei feedback (`reporter.ts`) e cablaggio

**Files:**
- Create: `src/background/reporter.ts`, `src/shared/report-config.ts`, `src/env.d.ts`
- Modify: `src/core/router.ts` (`RouterHooks.reporter`, casi nuovi, `saveSettings`, `getDiagnostics`)
- Modify: `src/shared/messages.ts`, `src/shared/types.ts` (`Diagnostics` con `usage?`, `reporting?`)
- Modify: `src/entrypoints/background.ts`, `wxt.config.ts`
- Test: `tests/unit/background/reporter.test.ts`, `tests/unit/core/router.test.ts`

**Interfaces:**
- Consumes: `buildReport` (Task 2), `UsageReportSchema`, `FEEDBACK_MAX`, `FeedbackPayload` (Task 2), `PilotStore` (Task 4), `ReportingStatus`, `ReportingInfo`, `QueuedFeedback` (Task 4).
- Produces:
  - `interface ReporterDeps` (sotto), `createReporter(deps): Reporter`
  - `interface Reporter { info(): Promise<ReportingInfo>; preview(): Promise<UsageReport>; sendReport(trigger: 'alarm' | 'startup' | 'manual'): Promise<ReportingInfo>; sendFeedback(text: string): Promise<'sent' | 'queued'>; flushFeedback(): Promise<void> }`
  - `REPORT_MIN_GAP_MS = 20 * 3600_000`, `REPORT_TIMEOUT_MS = 15_000`, `FEEDBACK_EMPTY`, `FEEDBACK_TOO_LONG`, `NOT_CONFIGURED`, `NO_PILOT_CODE`, `REPORTING_OFF`
  - `RouterHooks.reporter: Reporter`
  - messaggi `getReportingInfo`, `sendReportNow`, `previewReport`, `sendFeedback { text }`
  - `Diagnostics.usage?: UsageStats`, `Diagnostics.reporting?: ReportingInfo` (riempiti da `getDiagnostics` del router)
  - `REPORT_URL: string` da `@/shared/report-config`

- [ ] **Step 1: scrivi `tests/unit/background/reporter.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createReporter, FEEDBACK_EMPTY, FEEDBACK_TOO_LONG, NO_PILOT_CODE, NOT_CONFIGURED, REPORT_MIN_GAP_MS, type ReporterDeps } from '@/background/reporter';
import { EMPTY_USAGE } from '@/core/usage';
import { DEFAULT_SETTINGS, type QueuedFeedback, type ReportingStatus, type Settings } from '@/shared/types';

const NOW = Date.UTC(2026, 9, 17, 12);

function deps(p: Partial<Omit<ReporterDeps, 'settings'>> & { settings?: Partial<Settings>; responses?: (number | 'network' | 'timeout')[] } = {}) {
  const { settings: overrides, responses: planned, ...rest } = p;
  let status: ReportingStatus = { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false };
  let queue: QueuedFeedback[] = [];
  const responses = [...(planned ?? [])];
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = responses.shift() ?? 204;
    if (r === 'network') throw new TypeError('Failed to fetch');
    if (r === 'timeout') throw new DOMException('aborted', 'AbortError');
    return new Response(null, { status: r });
  });
  let n = 0;
  const d: ReporterDeps = {
    url: 'https://pilot.example.workers.dev/',
    version: '0.1.0',
    now: () => NOW,
    timezoneOffset: () => -120,
    fetch: fetchFn as unknown as typeof fetch,
    settings: async () => ({ ...DEFAULT_SETTINGS, pilotCode: 'ROSSI-7K2P', ...overrides }),
    onboardingAccepted: async () => true,
    installId: async () => '7f3c2a8e-1b2d-4c5e-8f90-123456789abc',
    usage: async () => EMPTY_USAGE,
    diagnostics: async () => ({ version: '0.1.0', counters: {}, errors: [], adapterWarning: {} }),
    leads: async () => [],
    status: async () => status,
    updateStatus: async (fn) => { status = { ...status }; fn(status); return status; },
    queue: async () => queue,
    enqueue: async (text) => { const q = { id: `00000000-0000-4000-8000-00000000000${++n}`, text, createdAt: NOW, version: '0.1.0' }; queue = [...queue, q]; return q; },
    dropFeedback: async (id) => { queue = queue.filter((q) => q.id !== id); },
    recordError: vi.fn(async () => {}),
    ...rest,
  };
  return { d, calls, fetchFn, getStatus: () => status, getQueue: () => queue, setStatus: (s: Partial<ReportingStatus>) => { status = { ...status, ...s }; } };
}

describe('reporter', () => {
  it('invia il report e registra il successo', async () => {
    const t = deps();
    const info = await createReporter(t.d).sendReport('alarm');
    expect(t.calls[0]!.url).toBe('https://pilot.example.workers.dev/report');
    expect(t.calls[0]!.body).toMatchObject({ formatVersion: 1, pilotCode: 'ROSSI-7K2P' });
    expect(info.status).toMatchObject({ lastSentAt: NOW, lastAttemptAt: NOW, lastError: null, codeRejected: false });
  });

  it.each([
    ['URL vuota', { url: '' }],
    ['informativa da confermare', { onboardingAccepted: async () => false }],
    ['interruttore spento', { settings: { reportingEnabled: false } }],
    ['codice vuoto', { settings: { pilotCode: '' } }],
  ])('non invia con %s', async (_n, p) => {
    const t = deps(p as Parameters<typeof deps>[0]);
    await createReporter(t.d).sendReport('manual');
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('403 segna il codice rifiutato e blocca gli invii automatici, non quello manuale', async () => {
    const t = deps({ responses: [403, 204] });
    const r = createReporter(t.d);
    expect((await r.sendReport('alarm')).status).toMatchObject({ codeRejected: true, lastError: 'rejected', lastSentAt: null });
    await r.sendReport('alarm');
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
    expect((await r.sendReport('manual')).status).toMatchObject({ codeRejected: false, lastSentAt: NOW });
  });

  it.each([
    [400, 'invalid'],
    [500, 'server'],
    ['network', 'network'],
    ['timeout', 'network'],
  ] as const)('esito %s → lastError %s', async (resp, err) => {
    const t = deps({ responses: [resp] });
    const info = await createReporter(t.d).sendReport('alarm');
    expect(info.status).toMatchObject({ lastError: err, lastSentAt: null, lastAttemptAt: NOW, codeRejected: false });
    if (resp === 400) expect(t.d.recordError).toHaveBeenCalledWith('Report rifiutato dal server (HTTP 400)');
  });

  it('all\'avvio invia solo se l\'ultimo invio ha più di 20 ore', async () => {
    const t = deps();
    t.setStatus({ lastSentAt: NOW - REPORT_MIN_GAP_MS + 1 });
    await createReporter(t.d).sendReport('startup');
    expect(t.fetchFn).not.toHaveBeenCalled();
    t.setStatus({ lastSentAt: NOW - REPORT_MIN_GAP_MS - 1 });
    await createReporter(t.d).sendReport('startup');
    expect(t.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('due invii contemporanei fanno un solo POST', async () => {
    const t = deps();
    const r = createReporter(t.d);
    await Promise.all([r.sendReport('alarm'), r.sendReport('startup')]);
    expect(t.calls.filter((c) => c.url.endsWith('/report'))).toHaveLength(1);
  });

  it('il feedback parte subito, anche con l\'invio statistiche spento', async () => {
    const t = deps({ settings: { reportingEnabled: false } });
    expect(await createReporter(t.d).sendFeedback('  Molto utile  ')).toBe('sent');
    expect(t.calls[0]!.url).toBe('https://pilot.example.workers.dev/feedback');
    expect(t.calls[0]!.body).toMatchObject({ text: 'Molto utile', pilotCode: 'ROSSI-7K2P', installId: '7f3c2a8e-1b2d-4c5e-8f90-123456789abc', version: '0.1.0' });
    expect(t.getQueue()).toEqual([]);
  });

  it('feedback senza rete resta in coda e parte dopo il report successivo, in ordine', async () => {
    const t = deps({ responses: ['network', 'network', 204, 204, 204] });
    const r = createReporter(t.d);
    expect(await r.sendFeedback('primo')).toBe('queued');
    expect(await r.sendFeedback('secondo')).toBe('queued');
    // il secondo invio ha provato a svuotare la coda: 'primo' è fallito e ha fermato lo svuotamento
    await r.sendReport('manual');
    expect(t.calls.slice(2).map((c) => (c.body as { text?: string }).text ?? 'report')).toEqual(['report', 'primo', 'secondo']);
    expect(t.getQueue()).toEqual([]);
  });

  it('un feedback rifiutato (400) esce dalla coda, 403 e 429 fermano lo svuotamento', async () => {
    const t = deps({ responses: [400, 429] });
    const r = createReporter(t.d);
    await t.d.enqueue('a');
    await t.d.enqueue('b');
    await t.d.enqueue('c');
    await r.flushFeedback();
    expect(t.getQueue().map((q) => q.text)).toEqual(['b', 'c']);
    expect(t.d.recordError).toHaveBeenCalledWith('Feedback rifiutato dal server (HTTP 400)');
  });

  it('valida il testo e la configurazione del feedback', async () => {
    await expect(createReporter(deps().d).sendFeedback('   ')).rejects.toThrow(FEEDBACK_EMPTY);
    await expect(createReporter(deps().d).sendFeedback('x'.repeat(2001))).rejects.toThrow(FEEDBACK_TOO_LONG);
    await expect(createReporter(deps({ url: '' }).d).sendFeedback('ok')).rejects.toThrow(NOT_CONFIGURED);
    await expect(createReporter(deps({ settings: { pilotCode: '' } }).d).sendFeedback('ok')).rejects.toThrow(NO_PILOT_CODE);
  });

  it('info e anteprima', async () => {
    const t = deps();
    await t.d.enqueue('x');
    const r = createReporter(t.d);
    expect(await r.info()).toMatchObject({ configured: true, queued: 1 });
    expect((await r.preview()).pilotCode).toBe('ROSSI-7K2P');
    expect((await createReporter(deps({ url: '' }).d).info()).configured).toBe(false);
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/background/reporter.test.ts`
Expected: FAIL.

- [ ] **Step 3: crea `src/background/reporter.ts`**

```ts
import { buildReport } from '@/core/report';
import type { UsageStats } from '@/core/usage';
import { FEEDBACK_MAX, UsageReportSchema, type FeedbackPayload, type UsageReport } from '@/shared/report-schema';
import type { Diagnostics, LeadView, QueuedFeedback, ReportingInfo, ReportingStatus, Settings } from '@/shared/types';

export const REPORT_MIN_GAP_MS = 20 * 3600_000;
export const REPORT_TIMEOUT_MS = 15_000;
export const FEEDBACK_EMPTY = 'Scrivi il messaggio prima di inviarlo';
export const FEEDBACK_TOO_LONG = `Il messaggio supera ${FEEDBACK_MAX} caratteri`;
export const NOT_CONFIGURED = 'Invio non configurato in questa versione';
export const NO_PILOT_CODE = 'Inserisci il codice pilota nelle impostazioni';
export const REPORTING_OFF = 'Invio statistiche spento';

export interface ReporterDeps {
  /** URL del Worker dalla build; vuota = invio spento. */
  url: string;
  version: string;
  now(): number;
  timezoneOffset(): number;
  fetch: typeof fetch;
  settings(): Promise<Settings>;
  onboardingAccepted(): Promise<boolean>;
  installId(): Promise<string>;
  usage(): Promise<UsageStats>;
  diagnostics(): Promise<Diagnostics>;
  leads(): Promise<LeadView[]>;
  status(): Promise<ReportingStatus>;
  updateStatus(fn: (s: ReportingStatus) => void): Promise<ReportingStatus>;
  queue(): Promise<QueuedFeedback[]>;
  enqueue(text: string): Promise<QueuedFeedback>;
  dropFeedback(id: string): Promise<void>;
  recordError(message: string): Promise<void>;
}

export interface Reporter {
  info(): Promise<ReportingInfo>;
  /** Il report che partirebbe adesso, già ripulito. */
  preview(): Promise<UsageReport>;
  sendReport(trigger: 'alarm' | 'startup' | 'manual'): Promise<ReportingInfo>;
  sendFeedback(text: string): Promise<'sent' | 'queued'>;
  flushFeedback(): Promise<void>;
}

type PostResult = { kind: 'ok' } | { kind: 'http'; status: number } | { kind: 'network' };

export function createReporter(d: ReporterDeps): Reporter {
  const endpoint = (path: string) => `${d.url.replace(/\/?$/, '/')}${path}`;
  let running: Promise<ReportingInfo> | null = null;

  async function post(path: string, body: unknown): Promise<PostResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REPORT_TIMEOUT_MS);
    try {
      const res = await d.fetch(endpoint(path), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      return res.ok ? { kind: 'ok' } : { kind: 'http', status: res.status };
    } catch {
      return { kind: 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function info(): Promise<ReportingInfo> {
    return { configured: d.url !== '', status: await d.status(), queued: (await d.queue()).length };
  }

  async function preview(): Promise<UsageReport> {
    const settings = await d.settings();
    return buildReport({
      installId: await d.installId(), pilotCode: settings.pilotCode, version: d.version, settings,
      usage: await d.usage(), diagnostics: await d.diagnostics(), leads: await d.leads(), now: d.now(), timezoneOffset: d.timezoneOffset(),
    });
  }

  async function flushFeedback(): Promise<void> {
    const settings = await d.settings();
    if (!d.url || !settings.pilotCode) return;
    const installId = await d.installId();
    for (const q of await d.queue()) {
      const body: FeedbackPayload = { id: q.id, installId, pilotCode: settings.pilotCode, version: q.version, text: q.text, createdAt: q.createdAt };
      const r = await post('feedback', body);
      if (r.kind === 'ok') await d.dropFeedback(q.id);
      else if (r.kind === 'http' && r.status === 400) {
        // Tenerlo bloccherebbe i messaggi successivi.
        await d.recordError('Feedback rifiutato dal server (HTTP 400)');
        await d.dropFeedback(q.id);
      } else return;
    }
  }

  async function doSend(trigger: 'alarm' | 'startup' | 'manual'): Promise<ReportingInfo> {
    const settings = await d.settings();
    if (!d.url || !settings.reportingEnabled || !settings.pilotCode || !(await d.onboardingAccepted())) return info();
    const before = await d.status();
    if (trigger !== 'manual' && before.codeRejected) return info();
    if (trigger === 'startup' && before.lastSentAt != null && d.now() - before.lastSentAt <= REPORT_MIN_GAP_MS) return info();
    const report = await preview();
    const valid = UsageReportSchema.safeParse(report);
    if (!valid.success) {
      await d.recordError(`Report non valido: ${valid.error.issues.map((i) => i.path.join('.')).join(', ')}`);
      return info();
    }
    const r = await post('report', valid.data);
    const now = d.now();
    await d.updateStatus((s) => {
      s.lastAttemptAt = now;
      if (r.kind === 'ok') Object.assign(s, { lastSentAt: now, lastError: null, codeRejected: false });
      else if (r.kind === 'network') s.lastError = 'network';
      else if (r.status === 401 || r.status === 403) Object.assign(s, { lastError: 'rejected', codeRejected: true });
      else if (r.status >= 500) s.lastError = 'server';
      else s.lastError = 'invalid';
    });
    if (r.kind === 'http' && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403) {
      await d.recordError(`Report rifiutato dal server (HTTP ${r.status})`);
    }
    await flushFeedback();
    return info();
  }

  return {
    info,
    preview,
    flushFeedback,
    sendReport(trigger) {
      // Allarme e avvio possono arrivare insieme: un solo invio alla volta.
      running ??= doSend(trigger).finally(() => { running = null; });
      return running;
    },
    async sendFeedback(text) {
      const t = text.trim();
      if (!t) throw new Error(FEEDBACK_EMPTY);
      if (t.length > FEEDBACK_MAX) throw new Error(FEEDBACK_TOO_LONG);
      if (!d.url) throw new Error(NOT_CONFIGURED);
      if (!(await d.settings()).pilotCode) throw new Error(NO_PILOT_CODE);
      const item = await d.enqueue(t);
      await flushFeedback();
      return (await d.queue()).some((q) => q.id === item.id) ? 'queued' : 'sent';
    },
  };
}
```

Nota: nel test "feedback senza rete" la sequenza delle risposte è `network` (primo feedback, al suo invio), `network` (primo feedback, ritentato quando si accoda il secondo: lo svuotamento si ferma lì), poi `204` report, `204` primo, `204` secondo. Se il conteggio dei `calls` non torna, verifica che lo svuotamento si fermi al primo errore di rete.

- [ ] **Step 4: verifica**

Run: `npx vitest run tests/unit/background/reporter.test.ts`
Expected: PASS.

- [ ] **Step 5: configurazione della build**

`src/env.d.ts`:

```ts
interface ImportMetaEnv {
  /** URL del Worker del pilota (es. https://homeradar-pilot.<account>.workers.dev/); vuota = nessun invio. */
  readonly WXT_REPORT_URL?: string;
}
```

`src/shared/report-config.ts`:

```ts
/** Impostata al momento della build da `.env` (WXT_REPORT_URL): chi compila senza non invia nulla. */
export const REPORT_URL: string = import.meta.env.WXT_REPORT_URL ?? '';
```

`wxt.config.ts`:

```ts
import { loadEnv } from 'vite';
import { defineConfig } from 'wxt';

const PORTAL_HOSTS = ['https://www.immobiliare.it/*', 'https://www.idealista.it/*', 'https://www.subito.it/*'];

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ mode }) => {
    // Il dominio del Worker del pilota entra nei permessi solo se la build ha l'URL.
    const url = loadEnv(mode, process.cwd(), 'WXT_').WXT_REPORT_URL;
    return {
      name: 'HomeRadar',
      description: 'Evidenzia gli annunci di privati maturi su Immobiliare.it, Idealista.it e Subito.it',
      permissions: ['sidePanel', 'alarms', 'clipboardWrite', 'downloads', 'offscreen'],
      host_permissions: [...PORTAL_HOSTS, ...(url ? [`${new URL(url).origin}/*`] : [])],
      action: { default_title: 'HomeRadar' },
    };
  },
});
```

Verifica: `npm run build` senza `.env` → `.output/chrome-mv3/manifest.json` ha solo i tre portali. Poi crea un `.env` temporaneo con `WXT_REPORT_URL=http://localhost:8787/`, `npm run build`, controlla che `host_permissions` contenga `http://localhost:8787/*` e che `grep -r "localhost:8787" .output/chrome-mv3/background.js` trovi l'URL; poi cancella `.env`. Se `vite` non si risolve da `wxt.config.ts`, aggiungi `vite` alle devDependencies con la versione già installata (`npm ls vite`).

- [ ] **Step 6: router, messaggi, tipi**

`src/shared/types.ts`, in `Diagnostics`:

```ts
  /** Aggiunti dal router per il report copiato; assenti nel diagnostico salvato. */
  usage?: UsageStats;
  reporting?: ReportingInfo;
```

con `import type { UsageStats } from '@/core/usage';` in testa (solo tipo, nessun ciclo a runtime).

`src/shared/messages.ts`: varianti

```ts
  | { type: 'getReportingInfo' }
  | { type: 'sendReportNow' }
  | { type: 'previewReport' }
  | { type: 'sendFeedback'; text: string }
```

`src/core/router.ts`: `import type { Reporter } from '@/background/reporter';`, in `RouterHooks`:

```ts
  /** Invio dei report e dei feedback del pilota. */
  reporter: Reporter;
```

Casi nuovi:

```ts
    case 'getReportingInfo':
      return hooks.reporter.info();
    case 'sendReportNow':
      return hooks.reporter.sendReport('manual');
    case 'previewReport':
      return hooks.reporter.preview();
    case 'sendFeedback':
      return hooks.reporter.sendFeedback(req.text);
```

`getDiagnostics` diventa:

```ts
    case 'getDiagnostics':
      return { ...(await service.getDiagnostics(version)), usage: await service.pilot.usage(), reporting: await hooks.reporter.info() };
```

`saveSettings`: prima di salvare leggi `const before = (await service.getSettings()).pilotCode;`, dopo:

```ts
      // Un codice nuovo va riprovato: il rifiuto valeva per quello vecchio.
      if (saved.pilotCode !== before) {
        await service.pilot.updateReporting((s) => {
          s.codeRejected = false;
          if (s.lastError === 'rejected') s.lastError = null;
        });
      }
```

In `tests/unit/core/router.test.ts`, `hooks()` aggiunge un reporter finto:

```ts
    reporter: {
      info: vi.fn(async () => ({ configured: true, status: { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false }, queued: 0 })),
      preview: vi.fn(), sendReport: vi.fn(async () => ({ configured: true, status: { lastSentAt: 1, lastAttemptAt: 1, lastError: null, codeRejected: false }, queued: 0 })),
      sendFeedback: vi.fn(async () => 'sent' as const), flushFeedback: vi.fn(async () => {}),
    },
```

e i test:

```ts
it('inoltra le richieste del pilota al reporter', async () => {
  const { svc } = await ready();
  const h = hooks();
  await handleRequest(svc, { type: 'sendReportNow' }, 'v', h);
  expect(h.reporter.sendReport).toHaveBeenCalledWith('manual');
  expect(await handleRequest(svc, { type: 'sendFeedback', text: 'ciao' }, 'v', h)).toBe('sent');
  const d = (await handleRequest(svc, { type: 'getDiagnostics' }, 'v', h)) as { usage: unknown; reporting: unknown };
  expect(d.usage).toBeDefined();
  expect(d.reporting).toMatchObject({ configured: true });
});

it('cambiare il codice pilota azzera il rifiuto', async () => {
  const { svc } = await ready();
  await svc.pilot.updateReporting((s) => { s.codeRejected = true; s.lastError = 'rejected'; });
  await handleRequest(svc, { type: 'saveSettings', settings: { ...DEFAULT_SETTINGS, pilotCode: 'NUOVO-1234' } }, 'v', hooks());
  expect(await svc.pilot.reportingStatus()).toMatchObject({ codeRejected: false, lastError: null });
});
```

- [ ] **Step 7: `src/entrypoints/background.ts`**

Import: `import { createReporter } from '@/background/reporter';`, `import { REPORT_URL } from '@/shared/report-config';`.

Dopo `const service = …` e `const version = …`:

```ts
  const reporter = createReporter({
    url: REPORT_URL,
    version,
    now: Date.now,
    timezoneOffset: () => new Date().getTimezoneOffset(),
    fetch: (input, init) => fetch(input, init),
    settings: () => service.getSettings(),
    onboardingAccepted: async () => {
      const s = await service.onboardingStatus();
      return !needsOnboarding(s.acceptedVersion, s.current);
    },
    installId: () => service.pilot.installId(),
    usage: () => service.pilot.usage(),
    diagnostics: () => service.getDiagnostics(version),
    leads: () => service.listLeads(),
    status: () => service.pilot.reportingStatus(),
    updateStatus: (fn) => service.pilot.updateReporting(fn),
    queue: () => service.pilot.feedbackQueue(),
    enqueue: (text) => service.pilot.enqueueFeedback(text, version),
    dropFeedback: (id) => service.pilot.dropFeedback(id),
    recordError: (m) => service.recordError(m),
  });
  const reportError = (err: unknown) =>
    service.recordError(`Invio del report: ${err instanceof Error ? err.message : String(err)}`).catch(() => {});
```

In `hooks` aggiungi `reporter,`. Nel blocco degli allarmi:

```ts
    if (!(await browser.alarms.get('report'))) browser.alarms.create('report', { delayInMinutes: 10, periodInMinutes: 24 * 60 });
```

Dopo quel blocco: `void reporter.sendReport('startup').catch(reportError);`. In `onAlarm`: `if (alarm.name === 'report') void reporter.sendReport('alarm').catch(reportError);`.

- [ ] **Step 8: verifica**

Run: `npm test && npm run typecheck`
Expected: PASS. Se `typecheck` segnala i fake `Api` dei test UI, verranno completati nel Task 7: aggiungi per ora solo ciò che serve a compilare il router.

- [ ] **Step 9: commit**

```bash
git add src/background/reporter.ts src/shared/report-config.ts src/env.d.ts src/core/router.ts src/shared/messages.ts src/shared/types.ts src/entrypoints/background.ts wxt.config.ts tests/unit/background/reporter.test.ts tests/unit/core/router.test.ts
git commit -F - <<'EOF'
feat(background): invio giornaliero del report e coda dei feedback verso il Worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: righe "Uso" e "Invio" nel report copiato

**Files:**
- Modify: `src/core/diagnostics.ts`
- Test: `tests/unit/core/diagnostics.test.ts`

**Interfaces:**
- Consumes: `Diagnostics.usage?`, `Diagnostics.reporting?` (Task 5), `UsageStats` (Task 1).
- Produces: `formatDiagnostics(d, now)` con due righe in più dopo "Contatori" quando `usage`/`reporting` ci sono.

- [ ] **Step 1: test**

```ts
it('aggiunge uso e invio quando ci sono', () => {
  const text = formatDiagnostics({
    version: '0.1.0', counters: {}, errors: [], adapterWarning: {},
    usage: { browsingDays: ['2026-10-15', '2026-10-16'], panelDays: ['2026-10-16'], statusChanges: { contacted: 3, discarded: 1 }, recallsSet: 2, notesWritten: 4, exports: { xlsx: 1, csv: 0 } },
    reporting: { configured: true, queued: 1, status: { lastSentAt: Date.UTC(2026, 9, 16, 8), lastAttemptAt: Date.UTC(2026, 9, 16, 8), lastError: null, codeRejected: false } },
  }, Date.UTC(2026, 9, 17, 12));
  expect(text).toContain('Uso: navigazione 2 giorni, pannello 1 giorno, contacted=3, discarded=1, richiami 2, note 4, export xlsx=1 csv=0');
  expect(text).toContain('Invio: ultimo il 16/10/2026; feedback in coda 1');
});

it('descrive gli stati dell\'invio', () => {
  const base = { version: 'v', counters: {}, errors: [], adapterWarning: {} };
  const st = { lastSentAt: null, lastAttemptAt: 5, lastError: 'network' as const, codeRejected: false };
  expect(formatDiagnostics({ ...base, reporting: { configured: false, queued: 0, status: st } }, 0)).toContain('Invio: non configurato');
  expect(formatDiagnostics({ ...base, reporting: { configured: true, queued: 0, status: st } }, 0)).toContain('Invio: mai; ultimo errore network');
});
```

- [ ] **Step 2: verifica che falliscano** — `npx vitest run tests/unit/core/diagnostics.test.ts` → FAIL.

- [ ] **Step 3: implementa** — in `formatDiagnostics`, dopo la riga `Contatori: …`:

```ts
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (d.usage) {
    const u = d.usage;
    const states = Object.entries(u.statusChanges).map(([k, v]) => `${k}=${v}`);
    lines.push(`Uso: ${[
      `navigazione ${plural(u.browsingDays.length, 'giorno', 'giorni')}`,
      `pannello ${plural(u.panelDays.length, 'giorno', 'giorni')}`,
      ...states,
      `richiami ${u.recallsSet}`,
      `note ${u.notesWritten}`,
      `export xlsx=${u.exports.xlsx} csv=${u.exports.csv}`,
    ].join(', ')}`);
  }
  if (d.reporting) {
    const { configured, status: s, queued } = d.reporting;
    const parts = !configured ? ['non configurato'] : [
      s.lastSentAt ? `ultimo il ${formatDate(s.lastSentAt)}` : 'mai',
      ...(s.lastError ? [`ultimo errore ${s.lastError}`] : []),
      ...(queued ? [`feedback in coda ${queued}`] : []),
    ];
    lines.push(`Invio: ${parts.join('; ')}`);
  }
```

Sposta `'Ultimi errori:'` e gli errori dopo queste righe (costruisci `lines` in due passi: prima le prime tre righe, poi le righe facoltative, poi gli errori). Il primo test esistente resta invariato perché senza `usage` e `reporting` non compaiono righe nuove.

- [ ] **Step 4: verifica** — `npx vitest run tests/unit/core/diagnostics.test.ts` → PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/diagnostics.ts tests/unit/core/diagnostics.test.ts
git commit -F - <<'EOF'
feat(diagnostics): uso e stato dell'invio nel report copiato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: pannello — schede Pilota e Feedback, tracciamento di pannello ed export

**Files:**
- Create: `src/ui/sidepanel/PilotCard.tsx`, `src/ui/sidepanel/FeedbackCard.tsx`
- Modify: `src/ui/sidepanel/api.ts`, `src/ui/sidepanel/SettingsView.tsx`, `src/ui/sidepanel/App.tsx`, `src/ui/sidepanel/ExportBar.tsx`, `src/ui/sidepanel/styles.css`
- Test: `tests/unit/ui/settings-pilot.test.tsx`; aggiornare i fake in `tests/unit/ui/sidepanel.test.tsx` e `tests/unit/ui/settings-backup.test.tsx`

**Interfaces:**
- Consumes: messaggi del Task 5, `trackUsage` (Task 4), `ReportingInfo`, `UsageReport`, `FEEDBACK_MAX`.
- Produces:
  - `Api.getReportingInfo(): Promise<ReportingInfo>`, `Api.sendReportNow(): Promise<ReportingInfo>`, `Api.previewReport(): Promise<UsageReport>`, `Api.sendFeedback(text: string): Promise<'sent' | 'queued'>`, `Api.trackUsage(event: UsageClientEvent): Promise<void>`
  - `reportingLine(info: ReportingInfo, settings: Settings, now: number): string` (esportata da `PilotCard.tsx`)
  - `ExportBar` prop `onExported?: (format: 'xlsx' | 'csv') => void`

- [ ] **Step 1: test `tests/unit/ui/settings-pilot.test.tsx`**

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportingLine } from '@/ui/sidepanel/PilotCard';
import { SettingsView } from '@/ui/sidepanel/SettingsView';
import type { Api } from '@/ui/sidepanel/api';
import { DEFAULT_SETTINGS, type ReportingInfo, type Settings } from '@/shared/types';

afterEach(cleanup);

const status = { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false };
const info = (p: Partial<ReportingInfo> = {}, s: Partial<ReportingInfo['status']> = {}): ReportingInfo => ({ configured: true, queued: 0, ...p, status: { ...status, ...s } });

function api(settings: Partial<Settings> = {}, ri: ReportingInfo = info()): Api {
  let saved = { ...DEFAULT_SETTINGS, ...settings };
  return {
    getSettings: vi.fn(async () => saved),
    saveSettings: vi.fn(async (s: Settings) => { saved = { ...s, pilotCode: s.pilotCode.toUpperCase() }; return saved; }),
    getBackupStatus: vi.fn(async () => ({ lastAt: null, lastAutoFailedAt: null, nextSlot: 1, pending: null })),
    getReportingInfo: vi.fn(async () => ri),
    sendReportNow: vi.fn(async () => info({}, { lastSentAt: Date.now(), lastAttemptAt: Date.now() })),
    previewReport: vi.fn(async () => ({ formatVersion: 1, pilotCode: 'ROSSI-7K2P' })),
    sendFeedback: vi.fn(async () => 'sent' as const),
    getDiagnostics: vi.fn(),
  } as unknown as Api;
}

describe('reportingLine', () => {
  const now = new Date(2026, 9, 17, 15).getTime();
  const s = { ...DEFAULT_SETTINGS, pilotCode: 'ROSSI-7K2P' };
  it.each([
    [info({ configured: false }), s, 'Invio non configurato in questa versione'],
    [info(), { ...s, pilotCode: '' }, "Inserisci il codice pilota per attivare l'invio"],
    [info(), { ...s, reportingEnabled: false }, 'Invio spento'],
    [info({}, { codeRejected: true, lastError: 'rejected' }), s, 'Codice non riconosciuto: controlla il codice che hai ricevuto'],
    [info({}, { lastAttemptAt: now, lastError: 'network' }), s, 'Ultimo tentativo non riuscito (nessuna connessione): si riprova da solo'],
    [info({}, { lastAttemptAt: now, lastError: 'server' }), s, 'Ultimo tentativo non riuscito (server non raggiungibile): si riprova da solo'],
    [info({}, { lastSentAt: new Date(2026, 9, 17, 10, 32).getTime() }), s, 'Ultimo invio: oggi alle 10:32'],
    [info({}, { lastSentAt: new Date(2026, 9, 3, 9, 5).getTime() }), s, 'Ultimo invio: il 03/10 alle 09:05'],
    [info(), s, 'Nessun invio ancora'],
  ])('%#', (i, settings, text) => {
    expect(reportingLine(i, settings, now)).toBe(text);
  });
});

describe('impostazioni: pilota e feedback', () => {
  it('salva il codice, invia ora e mostra l\'anteprima', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Codice pilota'), { target: { value: 'rossi-7k2p' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva codice' }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ pilotCode: 'rossi-7k2p' })));
    expect(await screen.findByDisplayValue('ROSSI-7K2P')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia ora' }));
    expect(await screen.findByText(/Ultimo invio: oggi alle/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostra cosa viene inviato' }));
    expect(await screen.findByText(/"pilotCode": "ROSSI-7K2P"/)).toBeTruthy();
  });

  it('l\'interruttore spegne l\'invio salvando subito e disattiva "Invia ora"', async () => {
    const a = api({ pilotCode: 'ROSSI-7K2P' });
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: "Invia statistiche d'uso anonime" }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ reportingEnabled: false })));
    expect(await screen.findByText('Invio spento')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Invia ora' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('il salvataggio generale non sovrascrive il codice salvato dalla scheda Pilota', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Codice pilota'), { target: { value: 'ROSSI-7K2P' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva codice' }));
    await screen.findByText('Codice pilota salvato');
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ pilotCode: 'ROSSI-7K2P' })));
  });

  it('feedback: invio, conteggio e messaggio in coda', async () => {
    const a = api({ pilotCode: 'ROSSI-7K2P' });
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    const box = await screen.findByLabelText('Il tuo messaggio');
    fireEvent.change(box, { target: { value: 'Mi piace' } });
    expect(screen.getByText('8/2000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia feedback' }));
    expect(await screen.findByText('Inviato, grazie')).toBeTruthy();
    expect(a.sendFeedback).toHaveBeenCalledWith('Mi piace');
    expect((box as HTMLTextAreaElement).value).toBe('');
    (a.sendFeedback as ReturnType<typeof vi.fn>).mockResolvedValueOnce('queued');
    fireEvent.change(box, { target: { value: 'Secondo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia feedback' }));
    expect(await screen.findByText('Salvato: verrà inviato appena possibile')).toBeTruthy();
  });

  it('feedback disattivato senza codice o senza configurazione', async () => {
    render(<SettingsView api={api()} onSaved={vi.fn()} />);
    expect(await screen.findByText('Inserisci il codice pilota per inviare un feedback')).toBeTruthy();
    expect((screen.getByLabelText('Il tuo messaggio') as HTMLTextAreaElement).disabled).toBe(true);
    cleanup();
    render(<SettingsView api={api({ pilotCode: 'ROSSI-7K2P' }, info({ configured: false }))} onSaved={vi.fn()} />);
    expect(await screen.findByText('Invio non configurato in questa versione', { selector: '.feedback__hint' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: verifica che falliscano** — `npx vitest run tests/unit/ui/settings-pilot.test.tsx` → FAIL.

- [ ] **Step 3: `api.ts`**

Nell'interfaccia `Api`:

```ts
  getReportingInfo(): Promise<ReportingInfo>;
  sendReportNow(): Promise<ReportingInfo>;
  previewReport(): Promise<UsageReport>;
  sendFeedback(text: string): Promise<'sent' | 'queued'>;
  trackUsage(event: UsageClientEvent): Promise<void>;
```

In `defaultApi`:

```ts
  getReportingInfo: () => send({ type: 'getReportingInfo' }),
  sendReportNow: () => send({ type: 'sendReportNow' }),
  previewReport: () => send({ type: 'previewReport' }),
  sendFeedback: (text) => send({ type: 'sendFeedback', text }),
  trackUsage: (event) => send({ type: 'trackUsage', event }),
```

con gli import di `ReportingInfo`, `UsageReport` (`@/shared/report-schema`), `UsageClientEvent` (`@/core/usage`).

- [ ] **Step 4: `PilotCard.tsx`**

```tsx
import { useId, useState } from 'react';
import type { UsageReport } from '@/shared/report-schema';
import type { ReportingInfo, Settings } from '@/shared/types';
import type { Api } from './api';
import { InfoTip } from './InfoTip';

const pad = (n: number) => String(n).padStart(2, '0');
function when(ms: number, now: number): string {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? `oggi alle ${time}` : `il ${pad(d.getDate())}/${pad(d.getMonth() + 1)} alle ${time}`;
}

const FAILURE: Record<'network' | 'server' | 'invalid', string> = {
  network: 'nessuna connessione',
  server: 'server non raggiungibile',
  invalid: 'dati rifiutati',
};

export function reportingLine(info: ReportingInfo, settings: Settings, now: number): string {
  const s = info.status;
  if (!info.configured) return 'Invio non configurato in questa versione';
  if (!settings.pilotCode) return "Inserisci il codice pilota per attivare l'invio";
  if (!settings.reportingEnabled) return 'Invio spento';
  if (s.codeRejected) return 'Codice non riconosciuto: controlla il codice che hai ricevuto';
  if (s.lastError && s.lastError !== 'rejected' && s.lastAttemptAt != null && (s.lastSentAt == null || s.lastAttemptAt > s.lastSentAt)) {
    return `Ultimo tentativo non riuscito (${FAILURE[s.lastError]}): si riprova da solo`;
  }
  return s.lastSentAt != null ? `Ultimo invio: ${when(s.lastSentAt, now)}` : 'Nessun invio ancora';
}

export function PilotCard({ api, settings, info, onSettings, onInfo, onMessage }: {
  api: Api;
  settings: Settings;
  info: ReportingInfo | null;
  onSettings(s: Settings): void;
  onInfo(i: ReportingInfo): void;
  onMessage(m: string): void;
}) {
  const ids = useId();
  const [code, setCode] = useState(settings.pilotCode);
  const [preview, setPreview] = useState<UsageReport | null>(null);
  const err = (e: unknown) => onMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
  const configured = info?.configured ?? false;

  async function save(patch: Partial<Settings>, ok: string) {
    try {
      const s = await api.saveSettings({ ...settings, ...patch });
      onSettings(s);
      setCode(s.pilotCode);
      onInfo(await api.getReportingInfo());
      onMessage(ok);
    } catch (e) {
      err(e);
    }
  }

  async function sendNow() {
    try {
      onInfo(await api.sendReportNow());
    } catch (e) {
      err(e);
    }
  }

  async function togglePreview() {
    if (preview) return setPreview(null);
    try {
      setPreview(await api.previewReport());
    } catch (e) {
      err(e);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">Pilota</h2>
      {info && <p className="card__text">{reportingLine(info, settings, Date.now())}</p>}
      <div className="settings__field">
        <div className="settings__row">
          <label htmlFor={`${ids}-code`}>Codice pilota</label>
          <InfoTip label="Codice pilota">Il codice che ti ha dato chi gestisce il pilota. Identifica la tua agenzia nei report.</InfoTip>
        </div>
        <div className="settings__row">
          <input id={`${ids}-code`} className="field" value={code} disabled={!configured} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="btn" disabled={!configured} onClick={() => void save({ pilotCode: code }, 'Codice pilota salvato')}>Salva codice</button>
        </div>
      </div>
      <div className="settings__row switch">
        <label id={`${ids}-rep-label`} htmlFor={`${ids}-rep`} className="switch__label">Invia statistiche d'uso anonime</label>
        <InfoTip label="Invia statistiche d'uso anonime">
          Una volta al giorno invia al gestore del pilota: giorni d'uso, numero di lead per portale e priorità, passaggi di
          stato, richiami e note (solo quanti), export ed errori tecnici. Non invia mai annunci, indirizzi, prezzi, note o
          nomi. L'interruttore ha effetto subito.
        </InfoTip>
        <label className="switch__control">
          <input
            id={`${ids}-rep`}
            type="checkbox"
            role="switch"
            className="switch__input"
            aria-labelledby={`${ids}-rep-label`}
            checked={settings.reportingEnabled}
            disabled={!configured}
            onChange={() => void save({ reportingEnabled: !settings.reportingEnabled }, settings.reportingEnabled ? 'Invio statistiche disattivato' : 'Invio statistiche attivato')}
          />
          <span className="switch__track" aria-hidden="true" />
        </label>
      </div>
      <div className="settings__row">
        <button type="button" className="btn" disabled={!configured || !settings.reportingEnabled || !settings.pilotCode} onClick={() => void sendNow()}>Invia ora</button>
        <button type="button" className="btn" onClick={() => void togglePreview()}>{preview ? 'Nascondi' : 'Mostra cosa viene inviato'}</button>
      </div>
      {preview && <pre className="pilot__preview">{JSON.stringify(preview, null, 2)}</pre>}
    </div>
  );
}
```

- [ ] **Step 5: `FeedbackCard.tsx`**

```tsx
import { useId, useState } from 'react';
import { FEEDBACK_MAX } from '@/shared/report-schema';
import type { ReportingInfo, Settings } from '@/shared/types';
import type { Api } from './api';

export function FeedbackCard({ api, settings, info, onInfo }: {
  api: Api;
  settings: Settings;
  info: ReportingInfo | null;
  onInfo(i: ReportingInfo): void;
}) {
  const ids = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = !info?.configured ? 'Invio non configurato in questa versione' : !settings.pilotCode ? 'Inserisci il codice pilota per inviare un feedback' : null;

  async function send() {
    setBusy(true);
    try {
      const r = await api.sendFeedback(text);
      setText('');
      setResult(r === 'sent' ? 'Inviato, grazie' : 'Salvato: verrà inviato appena possibile');
      onInfo(await api.getReportingInfo());
    } catch (e) {
      setResult(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">Feedback</h2>
      <p className="card__text">Cosa funziona, cosa manca, cosa non torna: arriva a chi gestisce il pilota. Non scrivere nomi o telefoni dei privati.</p>
      {hint && <p className="card__text feedback__hint">{hint}</p>}
      <label htmlFor={`${ids}-fb`} className="visually-hidden">Il tuo messaggio</label>
      <textarea
        id={`${ids}-fb`}
        className="field feedback__text"
        rows={4}
        maxLength={FEEDBACK_MAX}
        value={text}
        disabled={hint !== null}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="settings__row">
        <span className="feedback__count">{`${text.length}/${FEEDBACK_MAX}`}</span>
        <button type="button" className="btn btn--primary" disabled={hint !== null || busy || !text.trim()} onClick={() => void send()}>Invia feedback</button>
      </div>
      {result && <p className="card__text">{result}</p>}
      {info && info.queued > 0 && <p className="card__text">{`${info.queued} ${info.queued === 1 ? 'messaggio' : 'messaggi'} in attesa di invio`}</p>}
    </div>
  );
}
```

- [ ] **Step 6: `SettingsView.tsx`**

- Stato: `const [info, setInfo] = useState<ReportingInfo | null>(null);` e `useEffect(() => { api.getReportingInfo().then(setInfo, () => {}); }, [api]);`
- Funzione condivisa per gli interruttori e la scheda Pilota (sostituisce il corpo di `saveNow` dopo `api.saveSettings`):

```ts
  /** Impostazioni salvate subito (interruttori, codice): aggiornano anche i campi, senza toccare quelli in sospeso. */
  function applySaved(result: Settings) {
    setSaved(result);
    setForm((f) => f && { ...f, enabledPortals: result.enabledPortals, autoBackup: result.autoBackup, pilotCode: result.pilotCode, reportingEnabled: result.reportingEnabled });
  }
```

  In `saveNow`: `applySaved(result);` al posto delle due righe `setSaved`/`setForm`. In `save()`, `importBackup` e `reset` non cambia nulla.
- Prima della scheda "Assistenza":

```tsx
      <PilotCard api={api} settings={saved!} info={info} onSettings={(s) => { applySaved(s); onSaved(); }} onInfo={setInfo} onMessage={setMessage} />
      <FeedbackCard api={api} settings={saved!} info={info} onInfo={setInfo} />
```

`saved` è valorizzato insieme a `form`, quindi è definito dopo il controllo `if (!form) return …`.

- [ ] **Step 7: `App.tsx` ed `ExportBar.tsx`**

`ExportBar`: aggiungi la prop `onExported?: (format: 'xlsx' | 'csv') => void` e chiamala dopo `download(...)` in entrambi i pulsanti (`onExported?.('xlsx')`, `onExported?.('csv')`).

`App.tsx`:

```ts
  useEffect(() => {
    // Giorno con il pannello aperto, per la misura del pilota. Un errore non deve disturbare l'agente.
    api.trackUsage({ kind: 'panel' }).catch(() => {});
  }, [api]);
```

e `<ExportBar leads={visible} onExported={(format) => void api.trackUsage({ kind: 'export', format }).catch(() => {})} />`.

Aggiungi a `tests/unit/ui/sidepanel.test.tsx`:

```tsx
it('segna l\'apertura del pannello e gli export', async () => {
  const api = fakeApi([lead(1, 'high')]);
  render(<App api={api} />);
  await waitFor(() => expect(api.trackUsage).toHaveBeenCalledWith({ kind: 'panel' }));
  fireEvent.click(await screen.findByRole('button', { name: /CSV/ }));
  expect(api.trackUsage).toHaveBeenCalledWith({ kind: 'export', format: 'csv' });
});
```

(Se il click sul CSV in jsdom fallisce per `URL.createObjectURL`, usa lo stesso stub che il file usa già per gli altri test di export.)

- [ ] **Step 8: fake dei test esistenti**

In `fakeApi` di `tests/unit/ui/sidepanel.test.tsx` e in `api()` di `tests/unit/ui/settings-backup.test.tsx` aggiungi:

```ts
    getReportingInfo: vi.fn(async () => ({ configured: true, queued: 0, status: { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false } })),
    sendReportNow: vi.fn(),
    previewReport: vi.fn(),
    sendFeedback: vi.fn(async () => 'sent' as const),
    trackUsage: vi.fn(async () => {}),
```

- [ ] **Step 9: stili** — in `src/ui/sidepanel/styles.css`:

```css
.pilot__preview { max-height: 240px; overflow: auto; font-size: 11px; background: var(--surface-2, #f5f5f5); padding: 8px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
.feedback__text { width: 100%; resize: vertical; font: inherit; }
.feedback__count { font-size: 12px; opacity: 0.7; margin-right: auto; }
```

(Usa le variabili di colore già definite nel file al posto di `--surface-2` se ha un nome diverso.)

- [ ] **Step 10: verifica** — `npm test && npm run typecheck` → PASS.

- [ ] **Step 11: commit**

```bash
git add src/ui/sidepanel tests/unit/ui
git commit -F - <<'EOF'
feat(sidepanel): schede Pilota e Feedback, apertura del pannello ed export contati

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: informativa v5 con il codice pilota

**Files:**
- Modify: `src/core/onboarding.ts`, `src/ui/onboarding/Onboarding.tsx`
- Modify: `src/entrypoints/onboarding/*` (solo se passa un'`api` ristretta: aggiungere `saveSettings`)
- Test: `tests/unit/core/onboarding.test.ts`, `tests/unit/ui/onboarding.test.tsx`

**Interfaces:**
- Consumes: `Settings.pilotCode` (Task 3), `INVALID_PILOT_CODE` (Task 3).
- Produces: `ONBOARDING_VERSION = 5`; `OnboardingApi = Pick<Api, 'getOnboardingStatus' | 'acceptOnboarding' | 'getSettings' | 'saveSettings'>`.

- [ ] **Step 1: test**

In `tests/unit/core/onboarding.test.ts` cambia `expect(ONBOARDING_VERSION).toBe(4)` in `toBe(5)` e aggiungi:

```ts
it('la voce 5 racconta l\'invio dei report', () => {
  expect(ONBOARDING_CHANGES[5]!.join(' ')).toMatch(/statistiche d'uso anonime/);
});
```

In `tests/unit/ui/onboarding.test.tsx` (adatta il fake già presente aggiungendo `saveSettings: vi.fn(async (s) => ({ ...s, pilotCode: s.pilotCode.trim().toUpperCase() }))`):

```tsx
it('salva il codice pilota prima di confermare, normalizzato dal background', async () => {
  const a = fakeOnboardingApi({ acceptedVersion: null });
  render(<Onboarding api={a} mode="confirm" />);
  fireEvent.change(await screen.findByLabelText('Codice pilota (facoltativo)'), { target: { value: ' rossi-7k2p ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ho capito, inizia' }));
  await waitFor(() => expect(a.acceptOnboarding).toHaveBeenCalled());
  expect(a.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ pilotCode: ' rossi-7k2p ' }));
});

it('con un codice non valido mostra l\'errore e non conferma', async () => {
  const a = fakeOnboardingApi({ acceptedVersion: null });
  (a.saveSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Codice pilota non valido: usa da 4 a 32 tra lettere, cifre e trattini'));
  render(<Onboarding api={a} mode="confirm" />);
  fireEvent.change(await screen.findByLabelText('Codice pilota (facoltativo)'), { target: { value: 'ab' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ho capito, inizia' }));
  expect(await screen.findByText(/Codice pilota non valido/)).toBeTruthy();
  expect(a.acceptOnboarding).not.toHaveBeenCalled();
});

it('senza codice conferma senza salvare le impostazioni', async () => {
  const a = fakeOnboardingApi({ acceptedVersion: null });
  render(<Onboarding api={a} mode="confirm" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
  await waitFor(() => expect(a.acceptOnboarding).toHaveBeenCalled());
  expect(a.saveSettings).not.toHaveBeenCalled();
});

it('dichiara l\'invio giornaliero e non mostra il campo in sola lettura', async () => {
  render(<Onboarding api={fakeOnboardingApi({ acceptedVersion: 5 })} mode="review" onDone={() => {}} />);
  expect(await screen.findByText(/Ogni giorno HomeRadar invia al gestore del pilota/)).toBeTruthy();
  expect(screen.getByText(/Annunci, stati e note restano solo nel tuo browser/)).toBeTruthy();
  expect(screen.queryByLabelText('Codice pilota (facoltativo)')).toBeNull();
});
```

(`fakeOnboardingApi` è il nome di comodo: usa la funzione fake già presente nel file, estendendola con un parametro per lo stato.)

- [ ] **Step 2: verifica che falliscano** — `npx vitest run tests/unit/core/onboarding.test.ts tests/unit/ui/onboarding.test.tsx` → FAIL.

- [ ] **Step 3: `src/core/onboarding.ts`**

`ONBOARDING_VERSION = 5` e in `ONBOARDING_CHANGES`:

```ts
  5: [
    "HomeRadar ora invia ogni giorno al gestore del pilota statistiche d'uso anonime ed errori tecnici, con il codice pilota della tua agenzia: mai annunci, indirizzi, prezzi o note. Puoi spegnere l'invio dalle impostazioni, dove trovi anche il modulo per mandare un feedback.",
  ],
```

- [ ] **Step 4: `Onboarding.tsx`**

- `type OnboardingApi = Pick<Api, 'getOnboardingStatus' | 'acceptOnboarding' | 'getSettings' | 'saveSettings'>;`
- Stato `const [code, setCode] = useState('');` e, in `load`, dopo `setData`: `setCode(settings.pilotCode);`
- `accept()`: prima di `api.acceptOnboarding()`:

```ts
      if (code.trim() !== data!.settings.pilotCode) {
        const settings = await api.saveSettings({ ...data!.settings, pilotCode: code });
        setData((d) => (d ? { ...d, settings } : d));
      }
```

  Un errore di `saveSettings` cade nel `catch` esistente e la conferma non avviene.
- Sezione "Dove restano i dati": il primo `<li>` diventa

```tsx
          <li>Annunci, stati e note restano solo nel tuo browser, su questo computer: non vengono inviati a nessun server, nemmeno a chi ha creato HomeRadar.</li>
          <li>
            Ogni giorno HomeRadar invia al gestore del pilota statistiche d'uso anonime (giorni d'uso, numero di lead, passaggi
            di stato, export) e gli errori tecnici, con il codice pilota della tua agenzia. Non invia mai annunci, indirizzi,
            prezzi, note o nomi. Puoi spegnere l'invio dalle impostazioni.
          </li>
```

- Prima del pulsante di conferma, solo in `mode === 'confirm'`:

```tsx
        <div className="settings__field onboarding__code">
          <label htmlFor="onboarding-code">Codice pilota (facoltativo)</label>
          <input id="onboarding-code" className="field" value={code} onChange={(e) => setCode(e.target.value)} />
          <span className="onboarding__hint">Te lo dà chi gestisce il pilota. Puoi inserirlo anche dopo, nelle impostazioni.</span>
        </div>
```

- Se l'entrypoint `src/entrypoints/onboarding/` passa un oggetto `api` costruito a mano, aggiungi `saveSettings: (settings) => send({ type: 'saveSettings', settings })`; se passa `defaultApi`, non serve nulla.

- [ ] **Step 5: verifica** — `npm test && npm run typecheck` → PASS. Aggiorna gli altri test che fissano la versione 4 (es. `current: 4`) a 5.

- [ ] **Step 6: commit**

```bash
git add src/core/onboarding.ts src/ui/onboarding src/entrypoints/onboarding tests/unit
git commit -F - <<'EOF'
feat(onboarding): informativa v5 con invio dei report e codice pilota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Worker — pacchetto, migrazione, `/report`, `/feedback`, pulizia

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`, `worker/vitest.config.ts`, `worker/migrations/0001_init.sql`, `worker/src/index.ts`, `worker/src/api.ts`, `worker/src/schema.ts`, `worker/test/apply-migrations.ts`, `worker/test/env.d.ts`, `worker/test/api.test.ts`, `worker/.gitignore`
- Modify: `tsconfig.json` (escludere `worker`)
- Test: `tests/unit/shared/report-schema-sync.test.ts`

**Interfaces:**
- Consumes: `src/shared/report-schema.ts` (copia identica).
- Produces: `interface Env { DB: D1Database; ADMIN_PASSWORD: string }`; `handleReport(req, env, now?)`, `handleFeedback(req, env, now?)`, `purgeOldReports(db, now)`; `REPORT_MAX_BYTES = 65536`, `FEEDBACK_MAX_BYTES = 8192`, `FEEDBACK_PER_DAY = 30`, `RETENTION_DAYS = 180`; `isoDay(ms)`.

- [ ] **Step 1: pacchetto**

```bash
mkdir -p worker/src worker/test worker/migrations
cp src/shared/report-schema.ts worker/src/schema.ts
cd worker && npm init -y && npm install zod@^4 && npm install -D wrangler @cloudflare/vitest-pool-workers @cloudflare/workers-types vitest typescript
```

`@cloudflare/vitest-pool-workers` richiede una versione di `vitest` precisa: se `npm install` segnala un conflitto, installa la versione di `vitest` indicata dal messaggio. Poi in `worker/package.json` imposta `"private": true`, `"type": "module"` e gli script:

```json
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
```

`worker/.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars`.

`worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`worker/wrangler.toml`:

```toml
name = "homeradar-pilot"
main = "src/index.ts"
compatibility_date = "2026-10-01"

[[d1_databases]]
binding = "DB"
database_name = "homeradar-pilot"
# Sostituire con l'ID restituito da `npx wrangler d1 create homeradar-pilot` (vedi docs/pilot-reporting.md).
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

[triggers]
crons = ["17 3 * * *"]
```

Nel `tsconfig.json` della radice aggiungi:

```json
  "exclude": ["node_modules", ".output", "worker"]
```

(I percorsi sono relativi al `tsconfig.json` della radice; ripetono le esclusioni di `.wxt/tsconfig.json`, che `exclude` sostituisce.)

- [ ] **Step 2: migrazione `worker/migrations/0001_init.sql`**

```sql
CREATE TABLE pilots (
  code TEXT PRIMARY KEY,
  agency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE reports (
  install_id TEXT NOT NULL,
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (install_id, day)
);
CREATE INDEX reports_received ON reports (received_at);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX feedback_code_received ON feedback (code, received_at);
```

- [ ] **Step 3: configurazione dei test**

`worker/vitest.config.ts`:

```ts
import path from 'node:path';
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: { bindings: { TEST_MIGRATIONS: migrations, ADMIN_PASSWORD: 'test-password' } },
        },
      },
    },
  };
});
```

`worker/test/env.d.ts`:

```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    ADMIN_PASSWORD: string;
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

`worker/test/apply-migrations.ts`:

```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Se la versione installata di `@cloudflare/vitest-pool-workers` ha un'API di configurazione diversa (es. un plugin al posto di `defineWorkersConfig`), segui il README del pacchetto installato mantenendo le stesse tre cose: wrangler.toml, binding `TEST_MIGRATIONS` e `ADMIN_PASSWORD`, migrazioni applicate nel setup.

- [ ] **Step 4: test `worker/test/api.test.ts`**

```ts
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { purgeOldReports } from '../src/api';

const INSTALL = '7f3c2a8e-1b2d-4c5e-8f90-123456789abc';
const report = (p: Record<string, unknown> = {}) => ({
  formatVersion: 1, installId: INSTALL, pilotCode: 'ROSSI-7K2P', version: '0.1.0', sentAt: Date.now(), timezoneOffset: -120,
  enabledPortals: ['immobiliare'],
  usage: { browsingDays: ['2026-10-17'], panelDays: [], statusChanges: { contacted: 1 }, recallsSet: 0, notesWritten: 0, exports: { xlsx: 0, csv: 0 }, firstActiveDay: '2026-10-17', lastActiveDay: '2026-10-17' },
  leads: { total: 3, byPortal: { immobiliare: 3, idealista: 0, subito: 0 }, byPriority: { high: 1, medium: 1, verify: 0, none: 1 }, newLast7Days: 2 },
  technical: { counters: { ingested: 10 }, adapterWarning: [], errors: [] },
  ...p,
});
const feedback = (p: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(), installId: INSTALL, pilotCode: 'ROSSI-7K2P', version: '0.1.0', text: 'Molto utile', createdAt: Date.now(), ...p,
});
const post = (path: string, body: unknown) =>
  SELF.fetch(`https://pilot.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(async () => {
  await env.DB.exec('DELETE FROM pilots; DELETE FROM reports; DELETE FROM feedback;');
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
    expect((await SELF.fetch('https://pilot.test/report')).status).toBe(404);
    expect((await SELF.fetch('https://pilot.test/altro')).status).toBe(404);
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
    for (let i = 0; i < 30; i++) {
      await env.DB.prepare('INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), INSTALL, 'ROSSI-7K2P', 'v', 't', 0, Date.now()).run();
    }
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
```

- [ ] **Step 5: verifica che falliscano** — `npm --prefix worker test` → FAIL (moduli mancanti).

- [ ] **Step 6: `worker/src/api.ts`**

```ts
import { FeedbackSchema, UsageReportSchema } from './schema';
import type { Env } from './index';

export const REPORT_MAX_BYTES = 64 * 1024;
export const FEEDBACK_MAX_BYTES = 8 * 1024;
export const FEEDBACK_PER_DAY = 30;
export const RETENTION_DAYS = 180;
const DAY_MS = 86_400_000;

export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const reply = (status: number, error?: string) =>
  error ? Response.json({ error }, { status }) : new Response(null, { status });

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
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE code = ? AND received_at > ?').bind(f.pilotCode, now - DAY_MS).first<{ n: number }>();
  if ((recent?.n ?? 0) >= FEEDBACK_PER_DAY) return reply(429, 'too_many');
  await env.DB.prepare('INSERT OR IGNORE INTO feedback (id, install_id, code, version, text, created_at, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(f.id, f.installId, f.pilotCode, f.version, f.text, f.createdAt, now).run();
  return reply(204);
}

export async function purgeOldReports(db: D1Database, now: number): Promise<void> {
  await db.prepare('DELETE FROM reports WHERE received_at < ?').bind(now - RETENTION_DAYS * DAY_MS).run();
}
```

Nota: il controllo del 429 conta anche un duplicato che verrebbe ignorato; è accettabile (un nuovo invio dello stesso feedback oltre il limite resta in coda nel client e riparte il giorno dopo).

- [ ] **Step 7: `worker/src/index.ts`** (l'admin arriva nel Task 10; per ora risponde 404)

```ts
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
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_event, env) {
    await purgeOldReports(env.DB, Date.now());
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 8: test di sincronia dello schema nell'estensione** — `tests/unit/shared/report-schema-sync.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('schema del report', () => {
  it('estensione e Worker usano lo stesso file', () => {
    expect(read('worker/src/schema.ts')).toBe(read('src/shared/report-schema.ts'));
  });
});
```

- [ ] **Step 9: verifica**

Run: `npm --prefix worker test && npm --prefix worker run typecheck && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: commit**

```bash
git add worker tsconfig.json tests/unit/shared/report-schema-sync.test.ts
git commit -F - <<'EOF'
feat(worker): ricezione di report e feedback con codici pilota e pulizia su D1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

(Controlla con `git status` che `worker/node_modules` e `worker/.wrangler` non siano tra i file aggiunti.)

---

### Task 10: Worker — pagina admin

**Files:**
- Create: `worker/src/admin.ts`, `worker/src/html.ts`, `worker/test/admin.test.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `Env`, `isoDay`, `PILOT_CODE_RE`, `UsageReport` (da `./schema`).
- Produces: `handleAdmin(req: Request, env: Env, now?: number): Promise<Response>`; `esc(s: unknown): string`; `generateCode(): string` (formato `XXXX-XXXX`, alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).

- [ ] **Step 1: test `worker/test/admin.test.ts`**

```ts
import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateCode } from '../src/admin';

const AUTH = { Authorization: `Basic ${btoa('admin:test-password')}` };
const get = (path: string, headers: Record<string, string> = AUTH) => SELF.fetch(`https://pilot.test${path}`, { headers });
const form = (path: string, fields: Record<string, string>, origin = 'https://pilot.test') =>
  SELF.fetch(`https://pilot.test${path}`, { method: 'POST', headers: { ...AUTH, Origin: origin }, body: new URLSearchParams(fields), redirect: 'manual' });

const payload = (p: Record<string, unknown> = {}) => JSON.stringify({
  formatVersion: 1, installId: 'i1', pilotCode: 'ROSSI-7K2P', version: '0.1.0', sentAt: 0, timezoneOffset: 0, enabledPortals: [],
  usage: { browsingDays: ['2026-10-16', '2026-10-17'], panelDays: ['2026-10-17'], statusChanges: { contacted: 4 }, recallsSet: 0, notesWritten: 0, exports: { xlsx: 2, csv: 1 }, firstActiveDay: '2026-10-16', lastActiveDay: '2026-10-17' },
  leads: { total: 40, byPortal: { immobiliare: 40, idealista: 0, subito: 0 }, byPriority: { high: 7, medium: 0, verify: 0, none: 33 }, newLast7Days: 5 },
  technical: { counters: {}, adapterWarning: ['idealista'], errors: [{ at: 0, message: 'result[0]: price <testo>' }] },
  ...p,
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM pilots; DELETE FROM reports; DELETE FROM feedback;');
  await env.DB.prepare('INSERT INTO pilots VALUES (?, ?, 1, 0)').bind('ROSSI-7K2P', 'Agenzia <script>alert(1)</script>').run();
  await env.DB.prepare('INSERT INTO reports VALUES (?, ?, ?, ?, ?, ?)').bind('i1', 'ROSSI-7K2P', '2026-10-17', '0.1.0', payload(), Date.now()).run();
  await env.DB.prepare('INSERT INTO feedback VALUES (?, ?, ?, ?, ?, ?, ?)').bind('f1', 'i1', 'ROSSI-7K2P', '0.1.0', 'Riga 1\n<b>Riga 2</b>', 0, 0).run();
});

describe('/admin', () => {
  it('chiede la password', async () => {
    const r = await get('/admin', {});
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toContain('Basic');
    expect((await get('/admin', { Authorization: `Basic ${btoa('admin:sbagliata')}` })).status).toBe(401);
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
    expect(html).toContain('>40<'); // lead totali
    expect(html).toContain('>7<'); // Alta
    expect(html).toContain('Idealista');
  });

  it('dettaglio installazione, feedback, codici', async () => {
    expect(await (await get('/admin/install/i1')).text()).toContain('result[0]: price &lt;testo&gt;');
    const fb = await (await get('/admin/feedback')).text();
    expect(fb).toContain('&lt;b&gt;Riga 2&lt;/b&gt;');
    expect(await (await get('/admin/pilots')).text()).toContain('ROSSI-7K2P');
    expect((await get('/admin/install/sconosciuto')).status).toBe(404);
  });

  it('crea, disattiva e riattiva un codice; rifiuta POST da un\'altra origine', async () => {
    expect((await form('/admin/pilots', { action: 'create', agency: 'Agenzia Verdi', code: 'verdi-1234' }, 'https://evil.test')).status).toBe(403);
    expect((await form('/admin/pilots', { action: 'create', agency: 'Agenzia Verdi', code: 'verdi-1234' })).status).toBe(303);
    expect(await env.DB.prepare('SELECT agency, active FROM pilots WHERE code = ?').bind('VERDI-1234').first()).toEqual({ agency: 'Agenzia Verdi', active: 1 });
    expect((await form('/admin/pilots', { action: 'create', agency: 'Doppione', code: 'VERDI-1234' })).status).toBe(400);
    expect((await form('/admin/pilots', { action: 'create', agency: '', code: '' })).status).toBe(400);
    await form('/admin/pilots', { action: 'deactivate', code: 'VERDI-1234' });
    expect((await env.DB.prepare('SELECT active FROM pilots WHERE code = ?').bind('VERDI-1234').first<{ active: number }>())!.active).toBe(0);
    await form('/admin/pilots', { action: 'activate', code: 'VERDI-1234' });
    expect((await env.DB.prepare('SELECT active FROM pilots WHERE code = ?').bind('VERDI-1234').first<{ active: number }>())!.active).toBe(1);
    await form('/admin/pilots', { action: 'create', agency: 'Agenzia Neri', code: '' });
    expect((await env.DB.prepare('SELECT code FROM pilots WHERE agency = ?').bind('Agenzia Neri').first<{ code: string }>())!.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('generateCode non usa caratteri ambigui', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});
```

- [ ] **Step 2: verifica che falliscano** — `npm --prefix worker test` → FAIL.

- [ ] **Step 3: `worker/src/html.ts`**

```ts
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

export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · HomeRadar pilota</title><style>${STYLE}</style></head><body>
<nav><a href="/admin">Panoramica</a><a href="/admin/feedback">Feedback</a><a href="/admin/pilots">Codici pilota</a></nav>
<h1>${esc(title)}</h1>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
```

- [ ] **Step 4: `worker/src/admin.ts`**

```ts
import { isoDay } from './api';
import { esc, page } from './html';
import type { Env } from './index';
import { PILOT_CODE_RE, type UsageReport } from './schema';

const DAY_MS = 86_400_000;
const STALE_MS = 3 * DAY_MS;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PORTAL_NAMES: Record<string, string> = { immobiliare: 'Immobiliare', idealista: 'Idealista', subito: 'Subito' };

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]!).join('');
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
    const exports = r.usage.exports.xlsx + r.usage.exports.csv;
    const warn = r.technical.adapterWarning.map((p) => PORTAL_NAMES[p] ?? p).join(', ') || '—';
    return `<tr class="${now - row.received_at > STALE_MS ? 'stale' : ''}">
<td>${esc(row.agency ?? '?')}<br><small>${esc(row.code)}</small></td>
<td><a href="/admin/install/${encodeURIComponent(row.install_id)}">${esc(row.install_id.slice(0, 8))}</a></td>
<td>${esc(row.version)}</td><td>${esc(fmt(row.received_at))}</td>
<td>${daysWithin(days, now, 7)}</td><td>${daysWithin(days, now, 30)}</td><td>${days.size}</td><td>${strip(days, now)}</td>
<td>${r.usage.statusChanges.contacted ?? 0}</td><td>${exports}</td><td>${r.leads.total}</td><td>${r.leads.byPriority.high}</td>
<td>${esc(warn)}</td><td>${r.technical.errors.length}</td></tr>`;
  });
  return page('Panoramica', `<table><thead><tr><th>Agenzia</th><th>Installazione</th><th>Versione</th><th>Ultimo invio (UTC)</th>
<th>Giorni 7</th><th>Giorni 30</th><th>Giorni tot.</th><th>Ultimi 30 giorni</th><th>Contattati</th><th>Export</th><th>Lead</th><th>Alta</th><th>Avvisi</th><th>Errori</th></tr></thead>
<tbody>${rows.join('') || '<tr><td colspan="14">Nessun report ricevuto</td></tr>'}</tbody></table>`);
}

async function install(env: Env, id: string): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT day, payload FROM reports WHERE install_id = ? ORDER BY day DESC LIMIT 180').bind(id).all<{ day: string; payload: string }>();
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

export async function handleAdmin(req: Request, env: Env, now = Date.now()): Promise<Response> {
  if (!(await authorized(req, env))) {
    return new Response('Autenticazione richiesta', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="HomeRadar pilota", charset="UTF-8"', 'Cache-Control': 'no-store' } });
  }
  const url = new URL(req.url);
  if (req.method === 'POST') {
    // Difesa CSRF: un modulo inviato da un altro sito ha un'altra origine.
    if (req.headers.get('Origin') !== url.origin) return new Response('Origine non ammessa', { status: 403 });
    if (url.pathname === '/admin/pilots') return pilotAction(req, env, now);
    return new Response('Not found', { status: 404 });
  }
  if (req.method !== 'GET') return new Response('Not found', { status: 404 });
  if (url.pathname === '/admin') return overview(env, now);
  if (url.pathname === '/admin/feedback') return feedbackList(env);
  if (url.pathname === '/admin/pilots') return pilots(env);
  const m = /^\/admin\/install\/([^/]+)$/.exec(url.pathname);
  if (m) return install(env, decodeURIComponent(m[1]!));
  return new Response('Not found', { status: 404 });
}
```

Nota: `alphabet.length` è 32, quindi `b % 32` è uniforme su un byte.

- [ ] **Step 5: `index.ts`** — prima del 404: `if (pathname === '/admin' || pathname.startsWith('/admin/')) return handleAdmin(req, env);` con `import { handleAdmin } from './admin';`.

- [ ] **Step 6: verifica** — `npm --prefix worker test && npm --prefix worker run typecheck` → PASS. Se `crypto.subtle.timingSafeEqual` non è nei tipi installati, è comunque disponibile nel runtime: aggiungi un `// @ts-expect-error` solo se `typecheck` lo richiede, con un commento che lo spiega.

- [ ] **Step 7: commit**

```bash
git add worker/src worker/test
git commit -F - <<'EOF'
feat(worker): pagina admin con panoramica, dettaglio, feedback e codici pilota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: documentazione

**Files:**
- Create: `docs/pilot-reporting.md`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`

- [ ] **Step 1: `docs/pilot-reporting.md`**

```markdown
# Report del pilota: Worker Cloudflare

Il Worker in `worker/` riceve i report giornalieri e i feedback delle estensioni del pilota e li mostra in una pagina admin. Specifica: `docs/superpowers/specs/2026-10-17-misura-pilota-design.md`.

## Primo deploy

Da `worker/`:

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create homeradar-pilot` e copia `database_id` in `wrangler.toml`.
4. `npx wrangler d1 migrations apply homeradar-pilot --remote`
5. `npx wrangler secret put ADMIN_PASSWORD` (una password lunga, solo tua).
6. `npx wrangler deploy`: annota l'indirizzo `https://homeradar-pilot.<account>.workers.dev/`.

## Build dell'estensione per il pilota

Nella radice del repository crea `.env` (ignorato da git):

    WXT_REPORT_URL=https://homeradar-pilot.<account>.workers.dev/

poi `npm run zip`. Senza `.env` l'estensione non invia nulla e la scheda Pilota dice "Invio non configurato".

## Codici pilota

Apri `https://homeradar-pilot.<account>.workers.dev/admin/pilots` (utente qualsiasi, la password di `ADMIN_PASSWORD`), crea un codice per agenzia e consegnalo insieme allo zip. Un codice disattivato smette di essere accettato: le estensioni mostrano "Codice non riconosciuto".

## Consultare i dati

- `/admin`: una riga per installazione, giorni d'uso, attività degli ultimi 30 giorni, contattati, export, lead, avvisi ed errori. Le righe senza invii da più di 3 giorni sono evidenziate.
- `/admin/install/<id>`: andamento giorno per giorno, errori e ultimo report completo.
- `/admin/feedback`: i messaggi degli agenti.

## Cancellare dati

    npx wrangler d1 execute homeradar-pilot --remote --command "DELETE FROM reports WHERE install_id = '<id>'"
    npx wrangler d1 execute homeradar-pilot --remote --command "DELETE FROM feedback WHERE code = '<CODICE>'"

I report più vecchi di 180 giorni si cancellano da soli ogni notte.

## Prova in locale

1. `cd worker && npx wrangler d1 migrations apply homeradar-pilot --local`
2. `echo ADMIN_PASSWORD=prova > .dev.vars` e `npx wrangler dev` (porta 8787)
3. `npx wrangler d1 execute homeradar-pilot --local --command "INSERT INTO pilots VALUES ('PROVA-0001', 'Prova', 1, 0)"`
4. nella radice, `.env` con `WXT_REPORT_URL=http://localhost:8787/`, poi `npm run build` e ricarica l'estensione.
```

- [ ] **Step 2: `docs/smoke-test.md`** — nuova sezione prima della riga finale "Se il sito è cambiato":

```markdown
## Misura del pilota

Con il Worker in locale (`docs/pilot-reporting.md`, "Prova in locale") e un'estensione compilata con `WXT_REPORT_URL=http://localhost:8787/`.

58. Da un'installazione con l'informativa confermata alla versione precedente, apri il pannello.
    - [ ] Il pannello chiede di riconfermare; "Cosa è cambiato" cita le statistiche d'uso anonime; c'è il campo "Codice pilota (facoltativo)".
59. Inserisci `prova-0001` e conferma. Impostazioni → Pilota.
    - [ ] Il codice è `PROVA-0001`; "Invia ora" porta a "Ultimo invio: oggi alle …"; in `/admin` compare la riga dell'agenzia "Prova".
60. "Mostra cosa viene inviato".
    - [ ] Il JSON non contiene titoli, indirizzi, prezzi, ID o URL degli annunci, né il testo delle note.
61. Cambia il codice in `SBAGLIATO-1` e premi "Invia ora".
    - [ ] "Codice non riconosciuto: controlla il codice che hai ricevuto". Rimetti `PROVA-0001`.
62. Ferma `wrangler dev` e premi "Invia ora".
    - [ ] "Ultimo tentativo non riuscito (nessuna connessione): si riprova da solo". Riavvialo e premi "Invia ora": invio riuscito.
63. Con `wrangler dev` fermo scrivi un feedback e invialo.
    - [ ] "Salvato: verrà inviato appena possibile" e "1 messaggio in attesa di invio"; riavviato il Worker, "Invia ora" lo manda e compare in `/admin/feedback`.
64. Spegni "Invia statistiche d'uso anonime".
    - [ ] "Invio spento", "Invia ora" disattivato; un feedback parte lo stesso.
65. "Copia report diagnostico".
    - [ ] Ci sono le righe "Uso:" e "Invio:".
```

- [ ] **Step 3: `CLAUDE.md`**

Nella sezione Comandi aggiungi:

```bash
npm --prefix worker test                        # test del Worker del pilota (workerd + D1 locale)
npm --prefix worker run dev                     # Worker in locale su :8787 (vedi docs/pilot-reporting.md)
```

Nell'Architettura, dopo il punto sul Backup:

```markdown
- Misura del pilota: `src/core/usage.ts` (contatori d'uso puri: giorni locali di navigazione e di pannello, passaggi di stato, richiami, note, export), `src/core/pilot-store.ts` (`meta.install`, `meta.usage`, `meta.reporting`, `meta.feedbackQueue`, fuori dal backup), `src/core/report.ts` (`buildReport` e `sanitizeError`: nel report mai dati degli annunci), `src/background/reporter.ts` (invio giornaliero con l'allarme `report` e all'avvio dopo 20 ore, coda dei feedback). L'URL del Worker viene da `WXT_REPORT_URL` nel `.env` al momento della build: senza, nessun invio. Lo schema del report sta in `src/shared/report-schema.ts`, copiato identico in `worker/src/schema.ts` (un test controlla che coincidano: se lo cambi, copia il file). Il Worker (`worker/`, pacchetto separato) riceve `/report` e `/feedback` solo con codici pilota attivi e serve `/admin` con Basic Auth (`ADMIN_PASSWORD`). Se cambi cosa contiene il report, aggiorna l'informativa e alza `ONBOARDING_VERSION`.
```

Nei Vincoli, il primo punto diventa:

```markdown
- Mai richieste HTTP dell'estensione verso il portale (DataDome; rischio legale). Niente crawling. L'unica richiesta in uscita è il report del pilota verso `WXT_REPORT_URL`.
```

Nei Documenti aggiungi `- Report del pilota (deploy e consultazione del Worker): docs/pilot-reporting.md`.

- [ ] **Step 4: verifica finale**

Run: `npm test && npm run typecheck && npm --prefix worker test && npm --prefix worker run typecheck && npm run test:e2e`
Expected: tutto PASS. Gli e2e girano su una build senza `.env`: la scheda Pilota dice "Invio non configurato" e non partono richieste.

- [ ] **Step 5: commit**

```bash
git add docs/pilot-reporting.md docs/smoke-test.md CLAUDE.md
git commit -F - <<'EOF'
docs: guida al Worker del pilota, smoke test e CLAUDE.md per la misura del pilota

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Dopo l'implementazione

1. Revisione finale dell'intero branch.
2. L'utente esegue i punti 58–65 di `docs/smoke-test.md`.
3. Push, `gh pr create`; nella stessa PR la riga 8 di `docs/roadmap.md` diventa "fatto" con il link alla PR.
