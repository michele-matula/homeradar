# Promemoria di ricontatto — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** data di ricontatto (solo giorno) sui lead, con scheda "Richiami" nel pannello e numero dei richiami da fare sull'icona dell'estensione.

**Architecture:** la logica delle date sta in un modulo puro `src/core/recall.ts`; `LeadState` riceve `recallAt` (mezzanotte locale in ms, indicizzata da Dexie v5); `LeadService` applica le regole e conta i richiami da fare; il background aggiorna il segnale sull'icona su ogni modifica e con un allarme a mezzanotte; il pannello aggiunge la scheda "Richiami" e la riga del richiamo su ogni lead.

**Tech Stack:** WXT (MV3), React, TypeScript, Dexie 4, zod, Vitest (jsdom + fake-indexeddb), Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-15-promemoria-ricontatto-design.md`

## Global Constraints

- Testi dell'interfaccia e messaggi d'errore in italiano.
- Timestamp in ms epoch; `recallAt` è la mezzanotte **locale** del giorno scelto. Per mostrarlo usare sempre i getter locali (`getDate`, `getMonth`…), mai `formatDate` di `src/shared/format.ts`, che lavora in UTC.
- Schema Dexie: aggiungere `version(5)`, non toccare le versioni esistenti.
- Nessun permesso nuovo nel manifest; nessuna richiesta HTTP.
- `ONBOARDING_VERSION` passa a 2, con la voce in `ONBOARDING_CHANGES[2]`.
- `BACKUP_FORMAT_VERSION` resta 1.
- Molti file sono CRLF: modificare con l'editor (Edit), non con `sed`.
- Messaggi di commit: in Bash con heredoc (`git commit -F - <<'EOF'`), terminati da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Lead rimesso a mano su "Nuovo" con un richiamo:** il richiamo resta, e la pulizia automatica non deve cancellare il lead. `purge` salta i lead con `recallAt` (test nel Task 2).
2. **Fuso orario:** un richiamo del 17/10 deve risultare 17/10 in pannello ed export, anche se in UTC la mezzanotte italiana cade il 16 alle 22:00. Si usano i getter locali (test nel Task 1 con `TZ=Europe/Rome`, e nel Task 3 sull'export).
3. **Campo data svuotato o non valido:** se l'agente cancella la data nel campo, non si salva nulla e non compare un errore. `fromDateInput('')` restituisce `null` e il pannello ignora il valore (test nei Task 1 e 6).
4. **Service worker riavviato o PC in sospensione a mezzanotte:** all'avvio l'allarme `recall` si ricrea se manca, e uno scaduto scatta subito. Il conteggio si ricalcola da zero a ogni aggiornamento, quindi non può restare "indietro" (Task 4: `nextRecallCheck` testato nel Task 1).
5. **Backup corrotto o modificato a mano con un richiamo su un lead "Scartato":** all'importazione `recallAt` diventa `null`, così un lead scartato non compare tra i richiami (test nel Task 3).

---

### Task 1: logica pura delle date (`src/core/recall.ts`)

**Files:**
- Create: `src/core/recall.ts`
- Test: `tests/unit/core/recall.test.ts`

**Interfaces:**
- Produces:
  - `startOfLocalDay(ms: number): number`
  - `addDays(dayMs: number, n: number): number`
  - `type RecallKind = 'overdue' | 'today' | 'upcoming'`; `interface RecallStatus { kind: RecallKind; days: number }`
  - `recallStatus(recallAt: number | null | undefined, now: number): RecallStatus | null`
  - `isDue(recallAt: number | null | undefined, now: number): boolean`
  - `recallLabel(s: RecallStatus): string`
  - `formatRecallDate(dayMs: number): string` ("gio 17 ott")
  - `formatLocalDate(dayMs: number): string` ("17/10/2026")
  - `toDateInput(dayMs: number): string` ("2026-10-17"); `fromDateInput(value: string): number | null`
  - `RECALL_SHORTCUTS: readonly { label: string; days: number }[]`
  - `nextRecallCheck(now: number): number` (mezzanotte locale successiva + 1 minuto)

- [ ] **Step 1: scrivi i test che falliscono**

`tests/unit/core/recall.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDays, formatLocalDate, formatRecallDate, fromDateInput, isDue, nextRecallCheck, RECALL_SHORTCUTS, recallLabel,
  recallStatus, startOfLocalDay, toDateInput,
} from '@/core/recall';

// Il fuso dell'agente: le mezzanotti locali non coincidono con quelle UTC e c'è il cambio dell'ora legale.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Rome';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe('date locali', () => {
  it('il fuso dei test è davvero Europe/Rome', () => {
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });

  it('startOfLocalDay porta alla mezzanotte locale, non a quella UTC', () => {
    expect(startOfLocalDay(day(2026, 10, 17, 0) + 30 * 60_000)).toBe(day(2026, 10, 17));
    expect(startOfLocalDay(day(2026, 10, 17, 23))).toBe(day(2026, 10, 17));
    expect(startOfLocalDay(day(2026, 10, 17))).not.toBe(Date.UTC(2026, 9, 17));
  });

  it('addDays somma giorni di calendario anche a cavallo del cambio dell\'ora legale', () => {
    expect(addDays(day(2026, 3, 28), 1)).toBe(day(2026, 3, 29)); // 23 ore
    expect(addDays(day(2026, 3, 28), 2)).toBe(day(2026, 3, 30));
    expect(addDays(day(2026, 10, 24), 2)).toBe(day(2026, 10, 26)); // 25 ore in mezzo
    expect(addDays(day(2026, 10, 15), 30)).toBe(day(2026, 11, 14));
    expect(addDays(day(2026, 10, 15), -1)).toBe(day(2026, 10, 14));
  });

  it('nextRecallCheck: mezzanotte locale successiva più un minuto', () => {
    expect(nextRecallCheck(day(2026, 10, 15, 14))).toBe(day(2026, 10, 16) + 60_000);
    expect(nextRecallCheck(day(2026, 10, 24, 23))).toBe(day(2026, 10, 25) + 60_000);
  });
});

describe('recallStatus / isDue / recallLabel', () => {
  const now = day(2026, 10, 15, 14);

  it('nessun richiamo', () => {
    expect(recallStatus(null, now)).toBeNull();
    expect(recallStatus(undefined, now)).toBeNull();
    expect(isDue(null, now)).toBe(false);
  });

  it.each([
    [day(2026, 10, 13), { kind: 'overdue', days: 2 }, true, 'scaduto da 2 giorni'],
    [day(2026, 10, 14), { kind: 'overdue', days: 1 }, true, 'scaduto ieri'],
    [day(2026, 10, 15), { kind: 'today', days: 0 }, true, 'oggi'],
    [day(2026, 10, 16), { kind: 'upcoming', days: 1 }, false, 'domani'],
    [day(2026, 10, 18), { kind: 'upcoming', days: 3 }, false, 'tra 3 giorni'],
  ])('%s', (recallAt, status, due, label) => {
    expect(recallStatus(recallAt, now)).toEqual(status);
    expect(isDue(recallAt, now)).toBe(due);
    expect(recallLabel(status as never)).toBe(label);
  });

  it('conta i giorni di calendario anche attraverso il cambio dell\'ora legale', () => {
    expect(recallStatus(day(2026, 3, 30), day(2026, 3, 28, 23))).toEqual({ kind: 'upcoming', days: 2 });
    expect(recallStatus(day(2026, 10, 24), day(2026, 10, 26, 1))).toEqual({ kind: 'overdue', days: 2 });
  });
});

describe('formati e campo data', () => {
  it('formatta con i valori locali', () => {
    expect(formatRecallDate(day(2026, 10, 17))).toBe('sab 17 ott');
    expect(formatLocalDate(day(2026, 10, 17))).toBe('17/10/2026');
    expect(formatLocalDate(day(2026, 1, 5))).toBe('05/01/2026');
  });

  it('andata e ritorno con il valore di <input type="date">', () => {
    expect(toDateInput(day(2026, 3, 9))).toBe('2026-03-09');
    expect(fromDateInput('2026-03-09')).toBe(day(2026, 3, 9));
  });

  it('un campo vuoto o non valido non è una data', () => {
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('2026-02-30')).toBeNull();
    expect(fromDateInput('17/10/2026')).toBeNull();
  });

  it('scorciatoie', () => {
    expect(RECALL_SHORTCUTS).toEqual([
      { label: 'Domani', days: 1 },
      { label: 'Tra 3 giorni', days: 3 },
      { label: 'Tra 1 settimana', days: 7 },
      { label: 'Tra 1 mese', days: 30 },
    ]);
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/recall.test.ts`
Expected: FAIL, `Failed to resolve import "@/core/recall"`.

- [ ] **Step 3: implementa**

`src/core/recall.ts`:

```ts
import { DAY_MS } from '@/shared/types';

/** Un richiamo è un giorno: lo si salva come mezzanotte locale in ms epoch. */
export type RecallKind = 'overdue' | 'today' | 'upcoming';
export interface RecallStatus {
  kind: RecallKind;
  /** Giorni di calendario da oggi (sempre positivi; 0 per oggi). */
  days: number;
}

export const RECALL_SHORTCUTS: readonly { label: string; days: number }[] = [
  { label: 'Domani', days: 1 },
  { label: 'Tra 3 giorni', days: 3 },
  { label: 'Tra 1 settimana', days: 7 },
  { label: 'Tra 1 mese', days: 30 },
];

export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Giorni di calendario: con l'ora legale un giorno può durare 23 o 25 ore. */
export function addDays(dayMs: number, n: number): number {
  const d = new Date(dayMs);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Prossimo ricalcolo del segnale sull'icona: subito dopo la mezzanotte locale. */
export function nextRecallCheck(now: number): number {
  return addDays(startOfLocalDay(now), 1) + 60_000;
}

export function recallStatus(recallAt: number | null | undefined, now: number): RecallStatus | null {
  if (recallAt == null) return null;
  // Tra due mezzanotti locali passano N giorni ± un'ora: l'arrotondamento assorbe l'ora legale.
  const diff = Math.round((startOfLocalDay(recallAt) - startOfLocalDay(now)) / DAY_MS);
  if (diff < 0) return { kind: 'overdue', days: -diff };
  if (diff === 0) return { kind: 'today', days: 0 };
  return { kind: 'upcoming', days: diff };
}

/** Da fare: oggi o in ritardo. È ciò che conta il numero sull'icona. */
export function isDue(recallAt: number | null | undefined, now: number): boolean {
  return recallAt != null && recallAt < addDays(startOfLocalDay(now), 1);
}

export function recallLabel(s: RecallStatus): string {
  if (s.kind === 'today') return 'oggi';
  if (s.kind === 'overdue') return s.days === 1 ? 'scaduto ieri' : `scaduto da ${s.days} giorni`;
  return s.days === 1 ? 'domani' : `tra ${s.days} giorni`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const pad = (n: number) => String(n).padStart(2, '0');

export function formatRecallDate(dayMs: number): string {
  const d = new Date(dayMs);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatLocalDate(dayMs: number): string {
  const d = new Date(dayMs);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function toDateInput(dayMs: number): string {
  const d = new Date(dayMs);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Valore di `<input type="date">` → mezzanotte locale; null se vuoto o non è un giorno esistente. */
export function fromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date.getTime() : null;
}
```

- [ ] **Step 4: verifica che passino**

Run: `npx vitest run tests/unit/core/recall.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/recall.ts tests/unit/core/recall.test.ts
git commit -F - <<'EOF'
feat(core): date dei richiami di ricontatto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: dato, schema v5 e regole nel servizio

**Files:**
- Modify: `src/shared/types.ts` (interfaccia `LeadState`)
- Modify: `src/core/db.ts` (nuova `version(5)`)
- Modify: `src/core/service.ts` (stati di default, `setLeadState`, `dueRecallCount`, `purge`)
- Modify: `src/core/backup.ts:202` (stato creato all'importazione: aggiungere `recallAt: null`; lo schema si cambia nel Task 3)
- Modify (fixture con `LeadState` letterali, aggiungere `recallAt: null`): `tests/unit/core/backup-merge.test.ts:7,21`, `tests/unit/core/backup.test.ts:11`, `tests/unit/core/export.test.ts:18`, `tests/unit/core/lead-filters.test.ts:11`, `tests/unit/core/leads.test.ts:9`, `tests/unit/core/service.ingest.test.ts:76`, `tests/unit/ui/sidepanel.test.tsx:27,43`
- Test: `tests/unit/core/db.test.ts`, `tests/unit/core/service.leads.test.ts`

**Interfaces:**
- Consumes: `startOfLocalDay`, `addDays` dal Task 1.
- Produces:
  - `LeadState.recallAt: number | null`
  - `LeadService.setLeadState(key, patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): Promise<LeadState>`
  - `LeadService.dueRecallCount(now: number): Promise<number>`
  - Errore `RECALL_ON_DISCARDED = 'Impossibile impostare un richiamo su un lead scartato'` esportato da `src/core/service.ts`.

- [ ] **Step 1: aggiungi il campo al tipo**

In `src/shared/types.ts`, dentro `interface LeadState`, dopo `updatedAt`:

```ts
  /** Giorno del ricontatto: mezzanotte locale in ms epoch; null se non c'è un richiamo. */
  recallAt: number | null;
```

Poi aggiungi `recallAt: null` a ogni `LeadState` letterale:
- `src/core/service.ts:88` (`leadStates.add({... updatedAt: now, recallAt: null })`), `:121` (stato di default in `listLeads`), `:132` (stato di partenza in `setLeadState`);
- `src/core/backup.ts:202`;
- le fixture dei test elencate sopra. In `sidepanel.test.tsx:43` il mock diventa `({ listingKey: k, status: p.status ?? 'new', notes: p.notes ?? '', statusChangedAt: 0, updatedAt: 0, recallAt: p.recallAt ?? null })`.

Run: `npm run typecheck`
Expected: nessun errore. Se ne restano, sono altri `LeadState` letterali: aggiungi `recallAt: null` anche lì.

- [ ] **Step 2: scrivi i test che falliscono**

In `tests/unit/core/db.test.ts`, dentro il `describe`:

```ts
  it('v5: aggiunge recallAt nullo ai lead senza toccare updatedAt', async () => {
    const name = `mig5-${Math.random()}`;
    const old = new Dexie(name);
    old.version(4).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status', calibration: '[portal+portalId], portal', meta: 'key',
    });
    await old.table('leadStates').put({ listingKey: 'immobiliare:1', status: 'contacted', notes: 'x', statusChangedAt: 123, updatedAt: 456 });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.leadStates.get('immobiliare:1')).toEqual({
      listingKey: 'immobiliare:1', status: 'contacted', notes: 'x', statusChangedAt: 123, updatedAt: 456, recallAt: null,
    });
    expect(await db.leadStates.where('recallAt').below(Infinity).count()).toBe(0);
  });
```

In `tests/unit/core/service.leads.test.ts`, aggiungi agli import `RECALL_ON_DISCARDED` da `@/core/service` e `addDays, startOfLocalDay` da `@/core/recall` (`DAY_MS` e gli helper sono già importati), e in fondo:

```ts
describe('LeadService: richiami', () => {
  const today = startOfLocalDay(START);

  it('un richiamo su un lead "Nuovo" lo porta a "Da contattare" e viene salvato come mezzanotte locale', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    advance(1000);
    const s = await svc.setLeadState(KEY, { recallAt: addDays(today, 3) + 5 * 3600_000 });
    expect(s).toMatchObject({ status: 'to_contact', statusChangedAt: now(), updatedAt: now(), recallAt: addDays(today, 3) });
  });

  it('su "Contattato" lo stato non cambia; "Fatto" toglie la data e aggiorna updatedAt', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    await svc.setLeadState(KEY, { status: 'contacted' });
    advance(1000);
    const set = await svc.setLeadState(KEY, { recallAt: addDays(today, 7) });
    expect(set).toMatchObject({ status: 'contacted', statusChangedAt: now() - 1000, updatedAt: now(), recallAt: addDays(today, 7) });
    advance(1000);
    expect(await svc.setLeadState(KEY, { recallAt: null })).toMatchObject({ recallAt: null, updatedAt: now() });
    advance(1000);
    expect((await svc.setLeadState(KEY, { recallAt: null })).updatedAt).toBe(now() - 1000);
  });

  it('passare a "Scartato" toglie il richiamo; impostarlo su uno scartato è un errore', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, 1) });
    expect(await svc.setLeadState(KEY, { status: 'discarded' })).toMatchObject({ status: 'discarded', recallAt: null });
    await expect(svc.setLeadState(KEY, { recallAt: addDays(today, 1) })).rejects.toThrow(RECALL_ON_DISCARDED);
    await expect(svc.setLeadState(KEY, { status: 'discarded', recallAt: addDays(today, 1) })).rejects.toThrow(RECALL_ON_DISCARDED);
  });

  it('rimesso a mano su "Nuovo", il lead tiene il richiamo', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, 1) });
    expect(await svc.setLeadState(KEY, { status: 'new' })).toMatchObject({ status: 'new', recallAt: addDays(today, 1) });
  });

  it('dueRecallCount conta oggi e i giorni passati, non domani né gli scartati', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs(), obs({ portalId: 2 }), obs({ portalId: 3 }), obs({ portalId: 4 })]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, -2) });
    await svc.setLeadState('immobiliare:2', { recallAt: today });
    await svc.setLeadState('immobiliare:3', { recallAt: addDays(today, 1) });
    // Un dato incoerente (es. da un vecchio backup) non va contato.
    await db.leadStates.put({ listingKey: 'immobiliare:4', status: 'discarded', notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: today });
    expect(await svc.dueRecallCount(START)).toBe(2);
    expect(await svc.dueRecallCount(addDays(today, 1) + 1)).toBe(3);
  });

  it('la pulizia non cancella un lead "Nuovo" con un richiamo', async () => {
    const { db, svc, advance } = setup();
    await svc.ingest([obs(), obs({ portalId: 2 })]);
    await svc.setLeadState(KEY, { recallAt: addDays(today, 200) });
    await svc.setLeadState(KEY, { status: 'new' });
    advance(400 * DAY_MS);
    expect(await svc.purge()).toBe(1);
    expect(await db.listings.toCollection().primaryKeys()).toEqual([KEY]);
  });
});
```

- [ ] **Step 3: verifica che falliscano**

Run: `npx vitest run tests/unit/core/db.test.ts tests/unit/core/service.leads.test.ts`
Expected: FAIL. La v5 non esiste (`recallAt` assente, indice mancante: `KeyPath recallAt on object store leadStates is not indexed`); `RECALL_ON_DISCARDED` non è esportato.

- [ ] **Step 4: implementa schema e servizio**

In `src/core/db.ts`, dopo la `version(4)`:

```ts
    // v5: giorno di ricontatto del lead, indicizzato per contare i richiami da fare.
    this.version(5)
      .stores({ leadStates: 'listingKey, status, recallAt' })
      .upgrade(async (tx) => {
        await tx.table<Partial<LeadState>>('leadStates').toCollection().modify((s) => {
          s.recallAt ??= null;
        });
      });
```

In `src/core/service.ts`: importa `addDays, startOfLocalDay` da `./recall` ed esporta in cima al file

```ts
export const RECALL_ON_DISCARDED = 'Impossibile impostare un richiamo su un lead scartato';
```

Sostituisci `setLeadState` con:

```ts
  async setLeadState(key: string, patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): Promise<LeadState> {
    const now = this.clock();
    return this.db.transaction('rw', [this.db.listings, this.db.leadStates], async () => {
      if (!(await this.db.listings.get(key))) throw new Error('Annuncio non trovato');
      const prev = (await this.db.leadStates.get(key)) ?? { listingKey: key, status: 'new' as LeadStatus, notes: '', statusChangedAt: now, updatedAt: now, recallAt: null };
      const next: LeadState = { ...prev, recallAt: prev.recallAt ?? null };
      const recallAt = patch.recallAt == null ? patch.recallAt : startOfLocalDay(patch.recallAt);
      let status = patch.status ?? prev.status;
      if (status === 'discarded' && recallAt != null) throw new Error(RECALL_ON_DISCARDED);
      // Un lead con un richiamo è già in lavorazione: da "Nuovo" passa a "Da contattare".
      if (recallAt != null && status === 'new') status = 'to_contact';
      if (patch.notes !== undefined && patch.notes !== prev.notes) {
        next.notes = patch.notes;
        next.updatedAt = now;
      }
      if (status !== prev.status) {
        next.status = status;
        next.statusChangedAt = now;
        next.updatedAt = now;
      }
      const nextRecall = status === 'discarded' ? null : recallAt === undefined ? next.recallAt : recallAt;
      if (nextRecall !== next.recallAt) {
        next.recallAt = nextRecall;
        next.updatedAt = now;
      }
      await this.db.leadStates.put(next);
      return next;
    });
  }

  /** Richiami da fare oggi o in ritardo, per il numero sull'icona. */
  dueRecallCount(now: number): Promise<number> {
    return this.db.leadStates
      .where('recallAt')
      .below(addDays(startOfLocalDay(now), 1))
      .filter((s) => s.status !== 'discarded')
      .count();
  }
```

In `purge`, sostituisci la riga del `continue` con:

```ts
      // Un lead lavorato o con un richiamo resta, anche se rimesso a mano su "Nuovo".
      if (state && (state.status !== 'new' || state.recallAt != null)) continue;
```

- [ ] **Step 5: verifica che passino, poi tutta la suite**

Run: `npx vitest run tests/unit/core/db.test.ts tests/unit/core/service.leads.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm test`
Expected: tutto verde.

- [ ] **Step 6: commit**

```bash
git add -A src tests
git commit -F - <<'EOF'
feat(core): data di ricontatto sui lead (schema v5) e conteggio dei richiami da fare

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: backup ed export

**Files:**
- Modify: `src/core/backup.ts:65-67` (`LeadStateSchema`)
- Modify: `src/core/export.ts` (colonna "Richiamo")
- Test: `tests/unit/core/backup.test.ts`, `tests/unit/core/export.test.ts`

**Interfaces:**
- Consumes: `LeadState.recallAt` (Task 2), `formatLocalDate` (Task 1).
- Produces: `EXPORT_COLUMNS` con `'Richiamo'` subito dopo `'Stato'`.

- [ ] **Step 1: scrivi i test che falliscono**

In `tests/unit/core/backup.test.ts`, nel `describe('buildBackup / parseBackup')`:

```ts
  it('conserva il richiamo; un file senza richiamo si legge come null', () => {
    const d = data();
    d.leadStates = [{ ...d.leadStates[0]!, recallAt: Date.UTC(2026, 9, 16, 22) }];
    expect(parseBackup(roundTrip(d)).leadStates[0]!.recallAt).toBe(Date.UTC(2026, 9, 16, 22));
    const raw = roundTrip(data());
    delete raw.leadStates[0].recallAt;
    expect(parseBackup(raw).leadStates[0]!.recallAt).toBeNull();
  });

  it('un lead scartato non porta un richiamo', () => {
    const raw = roundTrip(data());
    raw.leadStates[0].status = 'discarded';
    raw.leadStates[0].recallAt = Date.UTC(2026, 9, 16, 22);
    expect(parseBackup(raw).leadStates[0]!.recallAt).toBeNull();
  });
```

In `tests/unit/core/export.test.ts`, nel test "mappa tutte le colonne" aggiungi `'Richiamo': ''` dopo `'Stato': 'Da contattare'` nell'oggetto atteso, poi aggiungi:

```ts
  it('la colonna Richiamo mostra il giorno locale scelto', () => {
    const recallAt = new Date(2026, 9, 17).getTime();
    expect(toExportRows([{ ...lead, state: { ...lead.state, recallAt } }])[0]!['Richiamo']).toBe('17/10/2026');
    expect(EXPORT_COLUMNS.indexOf('Richiamo')).toBe(EXPORT_COLUMNS.indexOf('Stato') + 1);
  });
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/backup.test.ts tests/unit/core/export.test.ts`
Expected: FAIL. `recallAt` viene scartato da zod (`undefined` invece del valore) e la colonna `Richiamo` manca.

- [ ] **Step 3: implementa**

`src/core/backup.ts`, sostituisci `LeadStateSchema`:

```ts
const LeadStateSchema = z
  .object({
    listingKey: z.string(), status: z.enum(LEAD_STATUSES), notes: z.string(), statusChangedAt: num, updatedAt: num.optional(),
    recallAt: num.nullable().optional(),
  })
  .transform((s): LeadState => ({
    ...s,
    updatedAt: s.updatedAt ?? s.statusChangedAt,
    // Backup precedenti al richiamo, o un lead scartato: nessun richiamo.
    recallAt: s.status === 'discarded' ? null : (s.recallAt ?? null),
  }));
```

`src/core/export.ts`: importa `formatLocalDate` da `@/core/recall`; in `EXPORT_COLUMNS` inserisci `'Richiamo'` dopo `'Stato'`; in `toExportRows` aggiungi dopo `'Stato'`:

```ts
    'Richiamo': s.recallAt != null ? formatLocalDate(s.recallAt) : '',
```

- [ ] **Step 4: verifica che passino**

Run: `npx vitest run tests/unit/core/backup.test.ts tests/unit/core/export.test.ts tests/unit/core/backup-merge.test.ts tests/unit/core/service.backup.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/backup.ts src/core/export.ts tests/unit/core/backup.test.ts tests/unit/core/export.test.ts
git commit -F - <<'EOF'
feat(backup,export): richiamo nel backup e colonna "Richiamo" nell'export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: messaggi, router, segnale sull'icona e allarme

**Files:**
- Modify: `src/shared/messages.ts:12`
- Modify: `src/core/router.ts` (`RouterHooks.recallsChanged`, caso `setLeadState`)
- Modify: `src/ui/sidepanel/api.ts:8`
- Modify: `src/core/action-badge.ts`
- Modify: `src/entrypoints/background.ts`
- Test: `tests/unit/core/router.test.ts`, `tests/unit/core/action-badge.test.ts`

**Interfaces:**
- Consumes: `LeadService.dueRecallCount` (Task 2), `nextRecallCheck` (Task 1).
- Produces:
  - Request `{ type: 'setLeadState'; listingKey: string; status?: LeadStatus; notes?: string; recallAt?: number | null }`
  - `Api.setLeadState(listingKey, patch: { status?: LeadStatus; notes?: string; recallAt?: number | null })`
  - `RouterHooks.recallsChanged(): void`
  - `actionBadge({ onboarding, warning, due }: { onboarding: boolean; warning: boolean; due: number }): ActionBadge`; `RECALL_COLOR = '#dc2626'`

- [ ] **Step 1: scrivi i test che falliscono**

`tests/unit/core/action-badge.test.ts`: nei test esistenti aggiungi `due: 0` a ogni chiamata (`actionBadge({ onboarding: true, warning: false, due: 0 })` ecc.), importa `RECALL_COLOR`, e aggiungi:

```ts
  it('la conferma mancante vince anche sui richiami', () => {
    expect(actionBadge({ onboarding: true, warning: true, due: 3 }).text).toBe('●');
  });
  it('richiami da fare: il numero in rosso, con singolare e plurale', () => {
    expect(actionBadge({ onboarding: false, warning: false, due: 3 })).toEqual({ text: '3', color: RECALL_COLOR, title: 'HomeRadar: 3 richiami da fare' });
    expect(actionBadge({ onboarding: false, warning: false, due: 1 }).title).toBe('HomeRadar: 1 richiamo da fare');
    expect(actionBadge({ onboarding: false, warning: false, due: 120 }).text).toBe('99+');
  });
  it("il numero vince sull'avviso, che resta nel titolo", () => {
    expect(actionBadge({ onboarding: false, warning: true, due: 2 })).toEqual({
      text: '2', color: RECALL_COLOR, title: 'HomeRadar: 2 richiami da fare · un portale ha cambiato struttura, vedi il pannello',
    });
  });
```

`tests/unit/core/router.test.ts`: in `hooks()` aggiungi `recallsChanged: vi.fn()`; aggiungi:

```ts
  it('setLeadState inoltra il richiamo e aggiorna il segnale sull\'icona', async () => {
    const { svc } = await ready();
    const h = hooks();
    await svc.ingest([obs()]);
    const day = new Date(2026, 9, 20).getTime();
    expect(await handleRequest(svc, { type: 'setLeadState', listingKey: 'immobiliare:128416572', recallAt: day }, 'v', h)).toMatchObject({ recallAt: day, status: 'to_contact' });
    expect(h.recallsChanged).toHaveBeenCalledTimes(1);
  });
```

Nello stesso file, alla riga 154 sostituisci `acceptedVersion: 1` con `acceptedVersion: ONBOARDING_VERSION` (import da `@/core/onboarding`): il Task 7 alza la versione.

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/action-badge.test.ts tests/unit/core/router.test.ts`
Expected: FAIL. `RECALL_COLOR` non è esportato e il router non inoltra `recallAt`.

- [ ] **Step 3: implementa**

`src/shared/messages.ts`, riga del tipo:

```ts
  | { type: 'setLeadState'; listingKey: string; status?: LeadStatus; notes?: string; recallAt?: number | null }
```

`src/ui/sidepanel/api.ts`, firma nell'interfaccia:

```ts
  setLeadState(listingKey: string, patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): Promise<LeadState>;
```

`src/core/router.ts`: in `RouterHooks` aggiungi

```ts
  /** Un lead ha cambiato stato o richiamo: va ricalcolato il numero sull'icona. */
  recallsChanged(): void;
```

e il caso diventa:

```ts
    case 'setLeadState': {
      const state = await service.setLeadState(req.listingKey, { status: req.status, notes: req.notes, recallAt: req.recallAt });
      hooks.recallsChanged();
      return state;
    }
```

`src/core/action-badge.ts`:

```ts
import { BRAND_COLOR } from '@/shared/logo';

export const WARNING_COLOR = '#d97706';
export const RECALL_COLOR = '#dc2626';

export interface ActionBadge {
  text: string;
  /** null: il colore non va cambiato (testo vuoto). */
  color: string | null;
  title: string;
}

/**
 * Segnale sull'icona. Precedenza: conferma dell'informativa mancante, poi i richiami da fare
 * (l'avviso dei portali resta nel titolo), poi l'avviso.
 */
export function actionBadge({ onboarding, warning, due }: { onboarding: boolean; warning: boolean; due: number }): ActionBadge {
  if (onboarding) return { text: '●', color: BRAND_COLOR, title: "HomeRadar: conferma l'informativa per iniziare" };
  if (due > 0) {
    const recalls = `${due} ${due === 1 ? 'richiamo' : 'richiami'} da fare`;
    const tail = warning ? ' · un portale ha cambiato struttura, vedi il pannello' : '';
    return { text: due > 99 ? '99+' : String(due), color: RECALL_COLOR, title: `HomeRadar: ${recalls}${tail}` };
  }
  if (warning) return { text: '!', color: WARNING_COLOR, title: 'HomeRadar' };
  return { text: '', color: null, title: 'HomeRadar' };
}
```

`src/entrypoints/background.ts`:
- importa `nextRecallCheck` da `@/core/recall`;
- in `refreshActionBadge` leggi anche il conteggio:

```ts
    const [status, diag, due] = await Promise.all([
      service.onboardingStatus(),
      service.getDiagnostics(version),
      service.dueRecallCount(Date.now()),
    ]);
    const badge = actionBadge({
      onboarding: needsOnboarding(status.acceptedVersion, status.current),
      warning: warnedPortals(diag.adapterWarning).length > 0,
      due,
    });
```

- negli `hooks`, `leadsChanged` chiama anche `updateBadge()` (eliminazioni e importazione cambiano i richiami) e si aggiunge `recallsChanged: () => updateBadge()`:

```ts
    leadsChanged() {
      browser.runtime.sendMessage({ type: LEADS_CHANGED }).catch(() => {});
      updateBadge();
    },
    recallsChanged: () => updateBadge(),
```

- allarme: dopo le due righe di `purge`/`backup` nell'IIFE degli allarmi aggiungi

```ts
    if (!(await browser.alarms.get('recall'))) scheduleRecallCheck();
```

definendo, sopra l'IIFE:

```ts
  // A mezzanotte i richiami di domani diventano di oggi. Non periodico: ricreato a ogni scatto, resta allineato all'ora legale.
  const scheduleRecallCheck = () => void browser.alarms.create('recall', { when: nextRecallCheck(Date.now()) });
```

e nel listener `onAlarm`:

```ts
    if (alarm.name === 'recall') {
      updateBadge();
      scheduleRecallCheck();
    }
```

- [ ] **Step 4: verifica che passino**

Run: `npx vitest run tests/unit/core/action-badge.test.ts tests/unit/core/router.test.ts && npm run typecheck`
Expected: PASS, nessun errore di tipo. (`router.test.ts` riga 154 resterà verde con `ONBOARDING_VERSION` anche dopo il Task 7.)

- [ ] **Step 5: commit**

```bash
git add src/shared/messages.ts src/core/router.ts src/ui/sidepanel/api.ts src/core/action-badge.ts src/entrypoints/background.ts tests/unit/core/router.test.ts tests/unit/core/action-badge.test.ts
git commit -F - <<'EOF'
feat(background): numero dei richiami da fare sull'icona, aggiornato a mezzanotte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: ordinamento e raggruppamento dei richiami (`src/core/leads.ts`)

**Files:**
- Modify: `src/core/leads.ts`
- Test: `tests/unit/core/leads.test.ts`

**Interfaces:**
- Consumes: `recallStatus` (Task 1), `LeadState.recallAt` (Task 2).
- Produces:
  - `SortKey` con `'recall'`, etichetta `'Richiamo più vicino'`, in `SORT_KEYS` subito dopo `'priority'`.
  - `RECALL_GROUP_LABELS: Record<RecallKind, string>` = `{ overdue: 'Scaduti', today: 'Oggi', upcoming: 'Prossimi' }`
  - `groupByRecall(leads: LeadView[], now: number): { kind: RecallKind; leads: LeadView[] }[]` — solo i lead con richiamo, gruppi nell'ordine Scaduti, Oggi, Prossimi, gruppi vuoti omessi, ogni gruppo ordinato con `sortLeadsBy(…, 'recall')`.

- [ ] **Step 1: scrivi i test che falliscono**

In `tests/unit/core/leads.test.ts` aggiungi `recall?: number | null` a `Fields`, e in `item` imposta `state: { ...base.state, statusChangedAt: f.changed ?? 0, recallAt: f.recall ?? null }`. Importa `groupByRecall`. Poi:

```ts
describe('richiami', () => {
  const day = (d: number) => new Date(2026, 9, d).getTime();
  const now = new Date(2026, 9, 15, 14).getTime();

  it('"Richiamo più vicino": data crescente, senza richiamo in fondo, a parità la priorità', () => {
    const sorted = sortLeadsBy([
      item('a', { recall: null, priority: 'high' }),
      item('b', { recall: day(20) }),
      item('c', { recall: day(13), priority: 'medium' }),
      item('d', { recall: day(13), priority: 'high' }),
    ], 'recall');
    expect(sorted.map((l) => l.listing.key)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('raggruppa in Scaduti, Oggi, Prossimi, saltando i gruppi vuoti e i lead senza richiamo', () => {
    const groups = groupByRecall([
      item('futuro', { recall: day(18) }),
      item('nessuno', { recall: null }),
      item('ieri', { recall: day(14) }),
      item('vecchio', { recall: day(2) }),
      item('presto', { recall: day(16) }),
    ], now);
    expect(groups.map((g) => [g.kind, g.leads.map((l) => l.listing.key)])).toEqual([
      ['overdue', ['vecchio', 'ieri']],
      ['upcoming', ['presto', 'futuro']],
    ]);
  });
});
```

Se il file ha un test che fissa `SORT_KEYS`, aggiorna l'array atteso con `'recall'` dopo `'priority'`.

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/leads.test.ts`
Expected: FAIL (`groupByRecall` non esiste; `'recall'` non è un criterio).

- [ ] **Step 3: implementa**

In `src/core/leads.ts`:
- importa `recallStatus, type RecallKind` da `./recall`;
- `SortKey` include `'recall'`; `SORT_KEYS = ['priority', 'recall', 'oldest', …]`; `SORT_LABELS.recall = 'Richiamo più vicino'`;
- in `SORT_VALUES` aggiungi `recall: [(l) => l.state.recallAt, 1],`;
- in fondo:

```ts
export const RECALL_GROUP_LABELS: Record<RecallKind, string> = { overdue: 'Scaduti', today: 'Oggi', upcoming: 'Prossimi' };
const RECALL_KINDS: RecallKind[] = ['overdue', 'today', 'upcoming'];

/** Lead con un richiamo, per la scheda "Richiami": scaduti, di oggi, futuri; ciascun gruppo in ordine di data. */
export function groupByRecall(leads: LeadView[], now: number): { kind: RecallKind; leads: LeadView[] }[] {
  const byKind = new Map<RecallKind, LeadView[]>(RECALL_KINDS.map((k) => [k, []]));
  for (const l of leads) {
    const s = recallStatus(l.state.recallAt, now);
    if (s) byKind.get(s.kind)!.push(l);
  }
  return RECALL_KINDS.filter((k) => byKind.get(k)!.length).map((kind) => ({ kind, leads: sortLeadsBy(byKind.get(kind)!, 'recall') }));
}
```

- [ ] **Step 4: verifica che passino**

Run: `npx vitest run tests/unit/core/leads.test.ts`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/leads.ts tests/unit/core/leads.test.ts
git commit -F - <<'EOF'
feat(core): ordinamento "Richiamo più vicino" e gruppi Scaduti/Oggi/Prossimi

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: pannello — riga del richiamo e scheda "Richiami"

**Files:**
- Modify: `src/ui/sidepanel/LeadItem.tsx`
- Modify: `src/ui/sidepanel/App.tsx`
- Modify: `src/ui/sidepanel/styles.css`
- Test: `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `RECALL_SHORTCUTS`, `recallStatus`, `recallLabel`, `formatRecallDate`, `toDateInput`, `fromDateInput`, `startOfLocalDay`, `addDays`, `isDue` (Task 1); `groupByRecall`, `RECALL_GROUP_LABELS` (Task 5); `Api.setLeadState` con `recallAt` (Task 4).
- Produces: `LeadItem` props `{ lead; now: number; onChange(patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): void; onDelete(): void }`.

- [ ] **Step 1: scrivi i test che falliscono**

In `tests/unit/ui/sidepanel.test.tsx`:
- nel test esistente di `LeadItem` passa `now={Date.now()}` a `<LeadItem … />`;
- aggiungi un helper vicino a `lead()`:

```ts
const today = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const dayOffset = (n: number) => { const d = new Date(today()); d.setDate(d.getDate() + n); return d.getTime(); };
const withRecall = (l: LeadView, recallAt: number | null, status: LeadStatus = 'contacted'): LeadView => ({ ...l, state: { ...l.state, status, recallAt } });
```

- nel `describe` di `LeadItem` aggiungi:

```ts
  it('senza richiamo: "Richiama…" apre data e scorciatoie; una scorciatoia salva il giorno', () => {
    const onChange = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={onChange} onDelete={() => {}} /></ul>);
    expect(screen.queryByLabelText('Data del richiamo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Richiama…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tra 3 giorni' }));
    expect(onChange).toHaveBeenCalledWith({ recallAt: dayOffset(3) });
    expect(screen.queryByLabelText('Data del richiamo')).toBeNull();
  });

  it('il campo data salva il giorno scelto; un campo svuotato non salva nulla', () => {
    const onChange = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={onChange} onDelete={() => {}} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Richiama…' }));
    fireEvent.change(screen.getByLabelText('Data del richiamo'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Data del richiamo'), { target: { value: '2031-03-09' } });
    expect(onChange).toHaveBeenCalledWith({ recallAt: new Date(2031, 2, 9).getTime() });
  });

  it('con un richiamo scaduto: etichetta rossa, "Fatto" lo toglie, "Sposta…" riapre le scorciatoie', () => {
    const onChange = vi.fn();
    const { container } = render(<ul><LeadItem lead={withRecall(lead(1, 'high'), dayOffset(-2))} now={Date.now()} onChange={onChange} onDelete={() => {}} /></ul>);
    expect(screen.getByText(/scaduto da 2 giorni/)).toBeTruthy();
    expect(container.querySelector('.lead--overdue')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fatto' }));
    expect(onChange).toHaveBeenCalledWith({ recallAt: null });
    fireEvent.click(screen.getByRole('button', { name: 'Sposta…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(onChange).toHaveBeenLastCalledWith({ recallAt: dayOffset(1) });
  });

  it('su un lead scartato non c\'è la riga del richiamo', () => {
    render(<ul><LeadItem lead={lead(1, 'high', 'discarded')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByRole('button', { name: 'Richiama…' })).toBeNull();
  });
```

- nel `describe('App')` aggiungi:

```ts
  it('scheda "Richiami": tutti gli stati, gruppi Scaduti/Oggi/Prossimi, senza ordinamento né "Elimina tutti"', async () => {
    const leads = [
      withRecall(lead(1, 'high'), dayOffset(3), 'to_contact'),
      withRecall(lead(2, 'medium'), dayOffset(-1), 'contacted'),
      withRecall(lead(3, 'medium'), today(), 'contacted'),
      lead(4, 'high'),
    ];
    render(<App api={fakeApi(leads)} />);
    // Ci sono richiami da fare: il pannello parte dalla scheda "Richiami".
    const tab = await screen.findByRole('tab', { name: 'Richiami (2 da fare)' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Scaduti', 'Oggi', 'Prossimi']);
    expect(titles()).toEqual(['Bilocale 2', 'Bilocale 3', 'Bilocale 1']);
    expect(screen.queryByText('Ordina per')).toBeNull();
    expect(screen.queryByText(/^Elimina tutti/)).toBeNull();
  });

  it('senza richiami da fare parte da "Nuovi" e la scheda mostra il totale', async () => {
    render(<App api={fakeApi([withRecall(lead(1, 'high'), dayOffset(5)), lead(2, 'high')])} />);
    expect((await screen.findByRole('tab', { name: 'Nuovi (1)' })).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Richiami (1)' }));
    expect(titles()).toEqual(['Bilocale 1']);
  });

  it('scheda "Richiami" vuota: spiega come impostarne uno', async () => {
    render(<App api={fakeApi([lead(1, 'high')])} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Richiami (0)' }));
    expect(screen.getByText('Nessun richiamo. Imposta una data di ricontatto su un lead con «Richiama…».')).toBeTruthy();
  });

  it('un richiamo impostato dal pannello passa al servizio', async () => {
    const api = fakeApi([lead(1, 'high')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Richiama…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(api.setLeadState).toHaveBeenCalledWith('immobiliare:1', { recallAt: dayOffset(1) });
  });
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL (manca il pulsante "Richiama…", manca la scheda "Richiami").

- [ ] **Step 3: implementa `LeadItem`**

In `src/ui/sidepanel/LeadItem.tsx`:
- import: `import { addDays, formatRecallDate, fromDateInput, RECALL_SHORTCUTS, recallLabel, recallStatus, startOfLocalDay, toDateInput } from '@/core/recall';`
- `Props`: `now: number;` e `onChange(patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): void;`
- stato locale `const [picking, setPicking] = useState(false);`
- calcoli:

```tsx
  const recall = recallStatus(state.recallAt, now);
  const pick = (recallAt: number) => {
    setPicking(false);
    onChange({ recallAt });
  };
```

- classe del `<li>`: `` className={`lead lead--${evaluation.priority}${recall?.kind === 'overdue' ? ' lead--overdue' : ''}`} ``
- tra `lead__actions` e il campo note:

```tsx
      {state.status !== 'discarded' && (
        <div className="recall">
          {state.recallAt != null && recall ? (
            <>
              <span className={`recall__tag recall__tag--${recall.kind}`}>
                {`Richiamo ${formatRecallDate(state.recallAt)} · ${recallLabel(recall)}`}
              </span>
              <button type="button" className="btn btn--sm" onClick={() => onChange({ recallAt: null })}>Fatto</button>
              <button type="button" className="btn btn--sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Sposta…</button>
            </>
          ) : (
            <button type="button" className="btn btn--sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Richiama…</button>
          )}
          {picking && (
            <div className="recall__picker">
              <input
                type="date"
                className="field recall__date"
                aria-label="Data del richiamo"
                defaultValue={state.recallAt != null ? toDateInput(state.recallAt) : ''}
                onChange={(e) => {
                  const day = fromDateInput(e.target.value);
                  if (day != null) pick(day);
                }}
              />
              {RECALL_SHORTCUTS.map((s) => (
                <button key={s.days} type="button" className="chip" onClick={() => pick(addDays(startOfLocalDay(now), s.days))}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: implementa la scheda in `App`**

In `src/ui/sidepanel/App.tsx`:
- import: aggiungi `groupByRecall, RECALL_GROUP_LABELS` da `@/core/leads` e `isDue` da `@/core/recall`.
- tipi e etichette:

```ts
type Tab = 'recall' | LeadStatus;
const TABS: Tab[] = ['recall', ...LEAD_STATUSES];
const TAB_LABELS: Record<Tab, string> = { recall: 'Richiami', new: 'Nuovi', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };
```

- stato della scheda: `const [chosenTab, setTab] = useState<Tab | null>(null);` La scheda iniziale si decide al primo caricamento riuscito: in `refresh`, dopo `setLeads(list)`, aggiungi

```ts
      // Si apre su "Richiami" solo se c'è qualcosa da fare oggi; poi decide l'agente.
      setTab((t) => t ?? (list.some((l) => isDue(l.state.recallAt, Date.now())) ? 'recall' : 'new'));
```

e subito dopo gli hook di stato `const tab: Tab = chosenTab ?? 'new';`.
- liste:

```ts
  const now = Date.now();
  const applied = applyQuery(leads, query);
  const groups = groupByStatus(applied);
  const recalls = applied.filter((l) => l.state.recallAt != null);
  const dueCount = recalls.filter((l) => isDue(l.state.recallAt, now)).length;
  const tabLeads = (t: Tab) => (t === 'recall' ? recalls : groups[t]);
  const inPortals = byPortals(tabLeads(tab), portals);
  const filtered = byFilter(inPortals, filter);
  const recallGroups = tab === 'recall' ? groupByRecall(filtered, now) : [];
  // Nella scheda "Richiami" l'ordine è quello dei gruppi; altrove il criterio scelto.
  const visible = tab === 'recall' ? recallGroups.flatMap((g) => g.leads) : sortLeadsBy(filtered, sortByTab[tab]);
```

(sostituiscono le righe di `groups`/`inPortals`/`visible`; nel filtro per sito usa `byFilter(tabLeads(tab), filter)` al posto di `byFilter(groups[tab], filter)`.)
- `setSort`: scrive solo se `tab !== 'recall'`:

```ts
  const setSort = (key: SortKey) => {
    if (tab === 'recall') return;
    setSortByTab((prev) => {
      const next = { ...prev, [tab]: key };
      saveSortByTab(next);
      return next;
    });
  };
```

- schede: itera `TABS`. Per `recall` il conteggio mostrato è `dueCount` se > 0 (classe `tab__count tab__count--due`), altrimenti `recalls.length`; aria-label `Richiami (${dueCount} da fare)` oppure `Richiami (${recalls.length})`. Per gli stati resta `groups[s].length`:

```tsx
                {TABS.map((t) => {
                  const due = t === 'recall' && dueCount > 0;
                  const count = t === 'recall' ? (due ? dueCount : recalls.length) : groups[t].length;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={t === tab}
                      aria-label={`${TAB_LABELS[t]} (${due ? `${count} da fare` : count})`}
                      className={t === tab ? 'tab tab--on' : 'tab'}
                      onClick={() => setTab(t)}
                    >
                      <span className={due ? 'tab__count tab__count--due' : 'tab__count'}>{count}</span>
                      <span className="tab__label">{TAB_LABELS[t]}</span>
                    </button>
                  );
                })}
```

- "Ordina per" e il blocco `bulk` si mostrano solo se `tab !== 'recall'` (il blocco `bulk` diventa `{tab !== 'recall' && visible.length > 0 && (…)}`).
- messaggio della lista vuota:

```tsx
                  <p>
                    {filterTag
                      ? `Nessun lead${filterTag} in questa scheda.`
                      : tab === 'recall'
                        ? 'Nessun richiamo. Imposta una data di ricontatto su un lead con «Richiama…».'
                        : `Nessun lead in questa scheda. Naviga su ${joinList(PORTALS.map((p) => PORTAL_SITES[p]), 'o')} per raccoglierne.`}
                  </p>
```

- lista: nella scheda "Richiami" un'intestazione per gruppo:

```tsx
                <ul className="leads">
                  {(tab === 'recall' ? recallGroups : [{ kind: null, leads: visible }]).map((g) => (
                    <Fragment key={g.kind ?? 'all'}>
                      {g.kind && <li className="leads__group"><h3>{RECALL_GROUP_LABELS[g.kind]}</h3></li>}
                      {g.leads.map((l) => (
                        <LeadItem
                          key={l.listing.key}
                          lead={l}
                          now={now}
                          onChange={(patch) => run(() => api.setLeadState(l.listing.key, patch))}
                          onDelete={() => run(() => api.deleteListing(l.listing.key))}
                        />
                      ))}
                    </Fragment>
                  ))}
                </ul>
```

(importa `Fragment` da `react`). La `useEffect` che azzera `confirmingAll` resta com'è (dipende da `tab`).

- [ ] **Step 5: stili**

In `src/ui/sidepanel/styles.css`, dopo le regole `.lead--verify::before`:

```css
.lead--overdue::before { background: var(--high); }
.tab__count--due { color: var(--high); }
.tab--on .tab__count--due { color: #fff; }
.leads__group { list-style: none; }
.leads__group h3 { margin: 6px 2px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
.recall { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 8px; }
.recall__tag { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); color: var(--muted); }
.recall__tag--overdue { background: var(--high-soft); border-color: var(--high-border); color: var(--high); }
.recall__tag--today { background: var(--medium-soft); border-color: var(--medium-border); color: var(--medium); }
.recall__picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; width: 100%; }
.recall__date { height: 28px; font-size: 12px; }
```

(Verifica che `--medium-soft`, `--medium-border`, `--medium`, `--muted` esistano in `:root`; sono già usati da `.pill--medium` e `.lead__meta`.)

- [ ] **Step 6: verifica che passino, poi tutta la suite**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx`
Expected: PASS. Se un test esistente cerca il primo `tab` per posizione o conta le schede, aggiornalo: ora "Richiami" è la prima.

Run: `npm run typecheck && npm test`
Expected: tutto verde.

- [ ] **Step 7: commit**

```bash
git add src/ui/sidepanel tests/unit/ui/sidepanel.test.tsx
git commit -F - <<'EOF'
feat(sidepanel): scheda "Richiami" e data di ricontatto sui lead

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: informativa, smoke test, documentazione

**Files:**
- Modify: `src/core/onboarding.ts`
- Modify: `src/ui/onboarding/Onboarding.tsx` (sezioni "Cosa salva" e legenda)
- Modify: `docs/smoke-test.md`
- Modify: `CLAUDE.md` (riga su `src/core/`)
- Modify: `docs/superpowers/specs/2026-10-15-promemoria-ricontatto-design.md` (allineamento: hook `recallsChanged`, `purge`, backup scartati)
- Test: `tests/unit/core/onboarding.test.ts`, `tests/unit/ui/onboarding.test.tsx`

**Interfaces:**
- Consumes: niente di nuovo.
- Produces: `ONBOARDING_VERSION = 2`, `ONBOARDING_CHANGES[2]`.

- [ ] **Step 1: scrivi i test che falliscono**

In `tests/unit/core/onboarding.test.ts`, importa `ONBOARDING_CHANGES` e aggiungi:

```ts
describe('informativa v2', () => {
  it('la versione 2 annuncia le date di ricontatto', () => {
    expect(ONBOARDING_VERSION).toBe(2);
    expect(ONBOARDING_CHANGES[2]).toEqual([
      'HomeRadar ora salva la data di ricontatto che imposti su un lead: resta sul tuo browser, come stati e note.',
    ]);
  });
});
```

In `tests/unit/ui/onboarding.test.tsx`, nel primo test che mostra l'informativa completa (con `never`), aggiungi:

```ts
    expect(screen.getByText(/le date di ricontatto/)).toBeTruthy();
    expect(screen.getByText(/richiami da fare oggi o in ritardo/)).toBeTruthy();
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/onboarding.test.ts tests/unit/ui/onboarding.test.tsx`
Expected: FAIL (versione 1, testi mancanti).

- [ ] **Step 3: implementa**

`src/core/onboarding.ts`:

```ts
export const ONBOARDING_VERSION = 2;

/** Voci del riquadro "Cosa è cambiato", per versione dell'informativa. */
export const ONBOARDING_CHANGES: Record<number, string[]> = {
  2: ['HomeRadar ora salva la data di ricontatto che imposti su un lead: resta sul tuo browser, come stati e note.'],
};
```

`src/ui/onboarding/Onboarding.tsx`:
- in "Cosa salva", la terza voce diventa:

```tsx
          <li>
            Lo stato che dai a ogni lead, le date di ricontatto e le tue note. Le note le scrivi tu: non inserire dati personali
            che non ti servono.
          </li>
```

- in "Come leggere i badge", in fondo alla lista `legend`:

```tsx
          <li>
            <Badge priority="high">3</Badge>
            <span>sull'icona di HomeRadar: i richiami da fare oggi o in ritardo. Li trovi nella scheda «Richiami» del pannello.</span>
          </li>
```

- [ ] **Step 4: verifica che passino, poi tutta la suite**

Run: `npx vitest run tests/unit/core/onboarding.test.ts tests/unit/ui/onboarding.test.tsx && npm test`
Expected: PASS. I test che fissano `acceptedVersion: 1, current: 1` nei mock del pannello non dipendono dalla costante e restano verdi.

- [ ] **Step 5: smoke test e documenti**

In `docs/smoke-test.md` aggiungi una sezione "Promemoria di ricontatto", nello stile delle altre:

```markdown
## Promemoria di ricontatto

- [ ] Dopo l'aggiornamento il pannello chiede di riconfermare l'informativa, con il riquadro "Cosa è cambiato" sulle date di ricontatto.
- [ ] Su un lead "Nuovo": "Richiama…" → "Domani". Il lead passa a "Da contattare" e mostra "Richiamo <giorno> · domani".
- [ ] "Richiama…" → campo data → oggi: sull'icona compare "1" in rosso; il tooltip dice "HomeRadar: 1 richiamo da fare".
- [ ] Chiudendo e riaprendo il pannello si apre la scheda "Richiami", con il lead sotto "Oggi".
- [ ] "Sposta…" → "Tra 1 settimana": il lead va sotto "Prossimi", il numero sull'icona sparisce.
- [ ] Con un richiamo di oggi, "Fatto" lo toglie e il numero sull'icona sparisce.
- [ ] Un lead con richiamo passato a "Scartato" perde il richiamo e non ha più "Richiama…".
- [ ] Export CSV dalla scheda "Richiami": la colonna "Richiamo" ha la data giusta (gg/mm/aaaa).
- [ ] Backup manuale, "Azzera archivio", importazione del backup: il richiamo torna con la stessa data e il numero sull'icona si riaggiorna.
```

In `CLAUDE.md`, nella riga di `src/core/`, dopo `lead-filters.ts (…)` aggiungi: `` `recall.ts` (giorni di ricontatto in mezzanotte locale; il numero sull'icona conta quelli di oggi o scaduti, allarme `recall` a mezzanotte) ``.

Nella spec, allinea:
- §5: "`purge` salta anche i lead con un richiamo (un lead rimesso a mano su "Nuovo" lo conserva)";
- §6: il router chiama il nuovo hook `recallsChanged()` dopo `setLeadState`; `leadsChanged` aggiorna anche l'icona;
- §9: all'importazione, un lead "Scartato" non porta un richiamo.

- [ ] **Step 6: verifica finale e commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: tutto verde, build in `.output/chrome-mv3`.

```bash
git add src/core/onboarding.ts src/ui/onboarding/Onboarding.tsx tests/unit/core/onboarding.test.ts tests/unit/ui/onboarding.test.tsx docs/smoke-test.md CLAUDE.md docs/superpowers/specs/2026-10-15-promemoria-ricontatto-design.md
git commit -F - <<'EOF'
feat(onboarding): informativa v2 con le date di ricontatto; smoke test e documenti

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
