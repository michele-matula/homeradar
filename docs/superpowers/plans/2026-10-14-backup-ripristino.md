# Backup e ripristino — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** backup automatico settimanale in `Download/HomeRadar/` (rotazione su 4 file), esportazione manuale e importazione con unione dei dati, senza perdere stati, note, storico prezzi e calibrazione.

**Architecture:** la logica pura sta in `src/core/backup.ts` (schema zod come lista dei campi ammessi, costruzione del file, unione) e `src/core/auto-backup.ts` (quando fare il backup, rotazione). `LeadService` resta l'unico scrittore su Dexie ed esegue l'importazione in un'unica transazione. Il background crea il file tramite un documento offscreen (URL `blob:`) e lo salva con `chrome.downloads`; la parte che parla con Chrome è isolata in `src/background/file-saver.ts` dietro un'interfaccia iniettabile.

**Tech Stack:** WXT 0.21 (MV3), TypeScript, React 19, Dexie 4, zod 4, Vitest (jsdom + fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-backup-ripristino-design.md`

## Global Constraints

- Nessuna richiesta HTTP dell'estensione; nessun server: tutto in locale.
- `LeadService` è l'unico scrittore su Dexie; il pannello parla col background solo tramite `src/ui/sidepanel/api.ts`.
- Schema Dexie: si aggiunge `version(4)` con migrazione; le versioni 1–3 non si toccano.
- Lo schema zod del backup è la lista dei campi ammessi: ciò che non è dichiarato viene scartato.
- Timestamp sempre in ms epoch UTC.
- Formato: `format: "homeradar-backup"`, `formatVersion: 1`; snapshot senza `id`; JSON senza indentazione.
- File automatici: `HomeRadar/homeradar-backup-N.json`, N da 1 a 4, `conflictAction: 'overwrite'`, `saveAs: false`. File manuale: `homeradar-backup-AAAA-MM-GG.json`.
- Backup automatico dovuto se: `autoBackup` attivo, ultimo backup riuscito più vecchio di 7 giorni o mai fatto, almeno un annuncio.
- Messaggi esatti: «Il file non è un backup di HomeRadar»; «Backup creato da una versione più recente di HomeRadar: aggiorna l'estensione»; «Backup non valido (<tabella>)» con tabella tra `annunci`, `storico prezzi`, `stati dei lead`, `calibrazione`, `impostazioni`; «Ultimo backup automatico non riuscito».
- Testi dell'interfaccia in italiano; ogni voce delle impostazioni ha il suo `InfoTip`.
- Permessi nuovi nel manifest: `downloads`, `offscreen`.

## Review Focus

1. **File modificato a mano con un URL non del portale** (es. `javascript:` o un dominio estraneo): il link nel pannello non deve diventare un vettore. L'annuncio deve essere rifiutato con «Backup non valido (annunci)». Test nel Task 3.
2. **Stesso annuncio con `lastDrop` scritto con le chiavi in ordine diverso** (Dexie contro output di zod): la reimportazione dello stesso backup deve dare «0 aggiornati», non falsi aggiornamenti. Test nel Task 4.
3. **Reimportazione dello stesso file due volte**: nessun doppione nello storico prezzi e riepilogo tutto «già presenti». Test nel Task 5.
4. **Evento di download completato che arriva prima che `download()` restituisca l'id**: il backup non deve restare appeso fino al timeout. Test nel Task 8.
5. **Selezione dello stesso file due volte di seguito nel selettore**: la seconda importazione deve partire comunque (il valore dell'input va azzerato). Test nel Task 9.

---

## File Structure

- Create `src/core/backup.ts`: tipi del backup, schema e `parseBackup`, `buildBackup`, `mergeBackup`, nomi dei file, testo del riepilogo.
- Create `src/core/auto-backup.ts`: `isBackupDue`, `runAutoBackup` con dipendenze iniettate.
- Create `src/background/file-saver.ts`: messaggi verso l'offscreen e `createFileSaver` (offscreen → download → attesa completamento).
- Create `src/entrypoints/offscreen/index.html`, `src/entrypoints/offscreen/main.ts`: documento offscreen che crea e revoca URL `blob:`.
- Modify `src/shared/types.ts`: `LeadState.updatedAt`, `Settings.autoBackup`, `BackupStatus`, `ImportSummary`.
- Modify `src/core/db.ts`: `version(4)`.
- Modify `src/core/settings.ts`: validazione di `autoBackup`.
- Modify `src/core/service.ts`: `updatedAt`, `listingCount`, `exportBackup`, `importBackup`, `backupStatus`, `recordBackup`, `recordBackupFailure`.
- Modify `src/shared/messages.ts`, `src/core/router.ts`, `src/ui/sidepanel/api.ts`: tre messaggi nuovi.
- Modify `src/shared/format.ts`: `formatDateTime`.
- Modify `src/entrypoints/background.ts`: allarme `backup` e cablaggio del salvataggio.
- Modify `wxt.config.ts`: permessi.
- Modify `src/ui/sidepanel/SettingsView.tsx`, `src/ui/sidepanel/styles.css`: blocco «Backup».
- Tests: `tests/unit/core/backup.test.ts`, `tests/unit/core/backup-merge.test.ts`, `tests/unit/core/service.backup.test.ts`, `tests/unit/core/auto-backup.test.ts`, `tests/unit/core/settings.test.ts`, `tests/unit/background/file-saver.test.ts`, `tests/unit/ui/settings-backup.test.tsx`; modifiche a `tests/unit/core/db.test.ts`, `tests/unit/core/service.leads.test.ts`, `tests/unit/core/router.test.ts`, `tests/unit/shared/format.test.ts`, `tests/e2e/extension.spec.ts`.
- Docs: `docs/smoke-test.md`, `CLAUDE.md`, `docs/roadmap.md`.

---

### Task 1: data di ultima modifica del lead (`updatedAt`) e Dexie v4

**Files:**
- Modify: `src/shared/types.ts` (interfaccia `LeadState`)
- Modify: `src/core/db.ts` (dopo `this.version(3)…`)
- Modify: `src/core/service.ts` (`ingest`, `listLeads`, `setLeadState`)
- Test: `tests/unit/core/db.test.ts`, `tests/unit/core/service.leads.test.ts`
- Fixture da allineare: `tests/unit/core/export.test.ts`, `tests/unit/core/leads.test.ts`, `tests/unit/core/service.ingest.test.ts`, `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Produces: `LeadState { listingKey; status; notes; statusChangedAt: number; updatedAt: number }`. `updatedAt` = ultimo cambio di stato o di note (ms UTC).

- [ ] **Step 1: test della migrazione**, in fondo al `describe` di `tests/unit/core/db.test.ts`:

```ts
  it('v4: inizializza updatedAt dei lead con la data di cambio stato', async () => {
    const name = `mig4-${Math.random()}`;
    const old = new Dexie(name);
    old.version(3).stores({
      listings: 'key, lastSeenAt', priceSnapshots: '++id, listingKey, [listingKey+at]',
      leadStates: 'listingKey, status', calibration: '[portal+portalId], portal', meta: 'key',
    });
    await old.table('leadStates').put({ listingKey: 'immobiliare:1', status: 'contacted', notes: 'x', statusChangedAt: 123 });
    await old.table('leadStates').put({ listingKey: 'immobiliare:2', status: 'new', notes: '' });
    old.close();

    const db = new HomeRadarDB(name);
    expect(await db.leadStates.get('immobiliare:1')).toMatchObject({ status: 'contacted', statusChangedAt: 123, updatedAt: 123 });
    expect(await db.leadStates.get('immobiliare:2')).toMatchObject({ updatedAt: 0 });
  });
```

- [ ] **Step 2: test di `updatedAt` nel servizio**, nel `describe('LeadService.setLeadState')` di `tests/unit/core/service.leads.test.ts` (importa anche `START` da `./helpers`):

```ts
  it('aggiorna updatedAt a ogni cambio di stato o di note, non se nulla cambia', async () => {
    const { db, svc, advance, now } = setup();
    await svc.ingest([obs()]);
    expect((await db.leadStates.get(KEY))!.updatedAt).toBe(START);
    advance(1000);
    expect((await svc.setLeadState(KEY, { status: 'to_contact' })).updatedAt).toBe(now());
    advance(1000);
    expect((await svc.setLeadState(KEY, { notes: 'chiamare sera' })).updatedAt).toBe(now());
    advance(1000);
    expect((await svc.setLeadState(KEY, { notes: 'chiamare sera', status: 'to_contact' })).updatedAt).toBe(now() - 1000);
  });
```

- [ ] **Step 3: verifica che falliscano**

Run: `npx vitest run tests/unit/core/db.test.ts tests/unit/core/service.leads.test.ts`
Expected: FAIL (`updatedAt` undefined).

- [ ] **Step 4: implementazione**

In `src/shared/types.ts`:

```ts
export interface LeadState {
  listingKey: string;
  status: LeadStatus;
  notes: string;
  statusChangedAt: number;
  /** Ultimo cambio di stato o di note: decide quale versione vince quando si importa un backup. */
  updatedAt: number;
}
```

In `src/core/db.ts`, dopo `this.version(3).stores({ idCalibration: null });`:

```ts
    // v4: data di ultima modifica del lead, per risolvere i conflitti all'importazione di un backup.
    this.version(4)
      .stores({ leadStates: 'listingKey, status' })
      .upgrade(async (tx) => {
        await tx.table<Partial<LeadState>>('leadStates').toCollection().modify((s) => {
          s.updatedAt ??= s.statusChangedAt ?? 0;
        });
      });
```

In `src/core/service.ts`:
- in `ingest`: `await leadStates.add({ listingKey: key, status: 'new', notes: '', statusChangedAt: now, updatedAt: now });`
- in `listLeads`, nel fallback: `{ listingKey: listing.key, status: 'new', notes: '', statusChangedAt: listing.firstSeenAt, updatedAt: listing.firstSeenAt }`
- `setLeadState` diventa:

```ts
  async setLeadState(key: string, patch: { status?: LeadStatus; notes?: string }): Promise<LeadState> {
    const now = this.clock();
    return this.db.transaction('rw', [this.db.listings, this.db.leadStates], async () => {
      if (!(await this.db.listings.get(key))) throw new Error('Annuncio non trovato');
      const prev = (await this.db.leadStates.get(key)) ?? { listingKey: key, status: 'new' as LeadStatus, notes: '', statusChangedAt: now, updatedAt: now };
      const next: LeadState = { ...prev };
      if (patch.notes !== undefined && patch.notes !== prev.notes) {
        next.notes = patch.notes;
        next.updatedAt = now;
      }
      if (patch.status !== undefined && patch.status !== prev.status) {
        next.status = patch.status;
        next.statusChangedAt = now;
        next.updatedAt = now;
      }
      await this.db.leadStates.put(next);
      return next;
    });
  }
```

- [ ] **Step 5: allinea le fixture**

Run: `npm run typecheck`
Per ogni errore «Property 'updatedAt' is missing» aggiungi `updatedAt` accanto a `statusChangedAt` con lo stesso valore (es. `statusChangedAt: 0, updatedAt: 0`; in `service.ingest.test.ts:76` `statusChangedAt: 1, updatedAt: 1`; in `sidepanel.test.tsx:42` il `setLeadState` finto restituisce anche `updatedAt: 0`). Ripeti finché `npm run typecheck` passa.

- [ ] **Step 6: verifica**

Run: `npm test`
Expected: PASS, tutti.

- [ ] **Step 7: commit**

```bash
git add src/shared/types.ts src/core/db.ts src/core/service.ts tests/unit
git commit -m "feat(core): data di ultima modifica del lead (Dexie v4)"
```

---

### Task 2: impostazione `autoBackup`, tipi del backup, `formatDateTime`

**Files:**
- Modify: `src/shared/types.ts` (`Settings`, `DEFAULT_SETTINGS`, nuovi tipi)
- Modify: `src/core/settings.ts`
- Modify: `src/shared/format.ts`
- Test: `tests/unit/core/settings.test.ts` (nuovo), `tests/unit/shared/format.test.ts`

**Interfaces:**
- Produces:
  - `Settings.autoBackup: boolean` (default `true`)
  - `interface BackupStatus { lastAt: number | null; lastAutoFailedAt: number | null; nextSlot: number }`
  - `interface ImportSummary { added: number; updated: number; unchanged: number }`
  - `formatDateTime(ms: number): string` → `"12/10 alle 09:30"` in ora **locale**

- [ ] **Step 1: test**

`tests/unit/core/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateSettings } from '@/core/settings';
import { DEFAULT_SETTINGS } from '@/shared/types';

describe('validateSettings', () => {
  it('attiva il backup automatico di default, anche per impostazioni salvate prima', () => {
    expect(DEFAULT_SETTINGS.autoBackup).toBe(true);
    expect(validateSettings({ minAgeDays: 90 }).autoBackup).toBe(true);
    expect(validateSettings({ autoBackup: false }).autoBackup).toBe(false);
  });
  it('rifiuta un valore non booleano', () => {
    expect(() => validateSettings({ autoBackup: 'sì' as unknown as boolean })).toThrow('Backup automatico non valido');
  });
});
```

In `tests/unit/shared/format.test.ts` (aggiungi l'import di `formatDateTime`):

```ts
describe('formatDateTime', () => {
  it('giorno, mese e ora locali', () => {
    expect(formatDateTime(new Date(2026, 9, 12, 9, 5).getTime())).toBe('12/10 alle 09:05');
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/settings.test.ts tests/unit/shared/format.test.ts`
Expected: FAIL.

- [ ] **Step 3: implementazione**

`src/shared/types.ts`: in `Settings` aggiungi

```ts
  /** Backup settimanale automatico nella cartella Download/HomeRadar. */
  autoBackup: boolean;
```

in `DEFAULT_SETTINGS` aggiungi `autoBackup: true,` e in fondo al file:

```ts
export interface BackupStatus {
  /** Ultimo backup riuscito, automatico o manuale. */
  lastAt: number | null;
  /** Ultimo tentativo automatico fallito. */
  lastAutoFailedAt: number | null;
  /** Slot (1–4) del prossimo backup automatico. */
  nextSlot: number;
}

export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
}
```

`src/core/settings.ts`, prima del controllo dei portali:

```ts
  if (typeof s.autoBackup !== 'boolean') throw new Error('Backup automatico non valido');
```

`src/shared/format.ts`, dopo `formatDate`:

```ts
/** Ora locale dell'agente: "12/10 alle 09:30". */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} alle ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 4: verifica**

Run: `npm test && npm run typecheck`
Expected: PASS (`sidepanel.test.tsx:185` usa `...DEFAULT_SETTINGS` e resta valido).

- [ ] **Step 5: commit**

```bash
git add src/shared src/core/settings.ts tests/unit/core/settings.test.ts tests/unit/shared/format.test.ts
git commit -m "feat(settings): impostazione backup automatico e tipi dello stato del backup"
```

---

### Task 3: formato del file — `parseBackup` e `buildBackup`

**Files:**
- Create: `src/core/backup.ts`
- Test: `tests/unit/core/backup.test.ts`, `tests/unit/core/backup-builders.ts`

**Interfaces:**
- Consumes: `validateSettings` (`src/core/settings.ts`), `listingKey`, `PORTALS`, `LEAD_STATUSES`, tipi da `src/shared/types.ts`.
- Produces (da `@/core/backup`):
  - `BACKUP_FORMAT = 'homeradar-backup'`, `BACKUP_FORMAT_VERSION = 1`, `AUTO_BACKUP_SLOTS = 4`
  - `NOT_A_BACKUP`, `TOO_NEW` (stringhe dei messaggi)
  - `type BackupSnapshot = Omit<PriceSnapshot, 'id'>`
  - `interface BackupData { settings?: Settings; listings: ListingRecord[]; priceSnapshots: BackupSnapshot[]; leadStates: LeadState[]; calibration: CalibrationPoint[] }`
  - `interface BackupFile extends BackupData { format: 'homeradar-backup'; formatVersion: number; createdAt: number; extensionVersion: string }`
  - `parseBackup(json: unknown): BackupFile` (lancia `Error` con i messaggi esatti)
  - `buildBackup(data: BackupData, now: number, extensionVersion: string): BackupFile` (toglie `id` dagli snapshot)
  - `backupFileName(now: number): string` → `homeradar-backup-2026-10-14.json`
  - `autoBackupFileName(slot: number): string` → `HomeRadar/homeradar-backup-3.json`
  - `importSummaryText(s: ImportSummary): string`

- [ ] **Step 1: test**

`tests/unit/core/backup-builders.ts` (condiviso con il Task 4):

```ts
import type { ListingRecord } from '@/shared/types';

export const NOW = Date.UTC(2026, 9, 14, 8);

export function listing(o: Partial<ListingRecord> = {}): ListingRecord {
  return {
    key: 'immobiliare:128416572', portal: 'immobiliare', portalId: 128416572, url: 'https://www.immobiliare.it/annunci/128416572/',
    title: 'Bilocale via Esempio 1', address: 'Via Esempio', city: 'Milano', zone: 'Precotto', typology: 'Appartamento',
    surfaceM2: 62, rooms: 2, currentPrice: 235000, portalCreatedAt: null, estimatedCreatedAt: Date.UTC(2026, 3, 20),
    lastDrop: { fromPrice: 249000, toPrice: 235000, percent: 5.6, date: Date.UTC(2026, 8, 21) },
    firstSeenAt: NOW - 1000, lastSeenAt: NOW, seenCount: 2, ...o,
  };
}
```

`tests/unit/core/backup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { autoBackupFileName, backupFileName, buildBackup, importSummaryText, NOT_A_BACKUP, parseBackup, TOO_NEW, type BackupData } from '@/core/backup';
import { DEFAULT_SETTINGS } from '@/shared/types';
import { listing, NOW } from './backup-builders';

function data(): BackupData {
  return {
    settings: { ...DEFAULT_SETTINGS, minAgeDays: 90 },
    listings: [listing()],
    priceSnapshots: [{ listingKey: 'immobiliare:128416572', price: 235000, at: NOW, source: 'observed' }],
    leadStates: [{ listingKey: 'immobiliare:128416572', status: 'to_contact', notes: 'sera', statusChangedAt: 5, updatedAt: 6 }],
    calibration: [{ portal: 'idealista', portalId: 34000000, createdAt: Date.UTC(2026, 9, 1) }],
  };
}

const roundTrip = (d: BackupData) => JSON.parse(JSON.stringify(buildBackup(d, NOW, '0.1.0')));

describe('buildBackup / parseBackup', () => {
  it('il file letto torna uguale ai dati esportati', () => {
    const file = parseBackup(roundTrip(data()));
    expect(file).toEqual({ format: 'homeradar-backup', formatVersion: 1, createdAt: NOW, extensionVersion: '0.1.0', ...data() });
  });

  it('toglie gli id degli snapshot ed esclude le impostazioni mai salvate', () => {
    const d = { ...data(), settings: undefined, priceSnapshots: [{ id: 7, listingKey: 'immobiliare:128416572', price: 1, at: 1, source: 'observed' as const }] };
    const file = buildBackup(d, NOW, 'v');
    expect(file.priceSnapshots).toEqual([{ listingKey: 'immobiliare:128416572', price: 1, at: 1, source: 'observed' }]);
    expect('settings' in JSON.parse(JSON.stringify(file))).toBe(false);
  });

  it('scarta i campi non dichiarati', () => {
    const raw = roundTrip(data());
    raw.listings[0].phone = '333 1234567';
    raw.leadStates[0].sellerName = 'Mario';
    raw.settings.evil = true;
    raw.diagnostics = { errors: [] };
    const file = parseBackup(raw);
    expect(file.listings[0]).not.toHaveProperty('phone');
    expect(file.leadStates[0]).not.toHaveProperty('sellerName');
    expect(file.settings).not.toHaveProperty('evil');
    expect(file).not.toHaveProperty('diagnostics');
  });

  it('senza updatedAt usa la data di cambio stato', () => {
    const raw = roundTrip(data());
    delete raw.leadStates[0].updatedAt;
    expect(parseBackup(raw).leadStates[0]!.updatedAt).toBe(5);
  });

  it.each([['ciao'], [null], [[]], [{ format: 'altro', formatVersion: 1, createdAt: 1, extensionVersion: 'v' }], [{ format: 'homeradar-backup' }]])(
    'rifiuta ciò che non è un backup: %j',
    (json) => expect(() => parseBackup(json)).toThrow(NOT_A_BACKUP),
  );

  it('rifiuta un formato più recente', () => {
    expect(() => parseBackup({ ...roundTrip(data()), formatVersion: 2 })).toThrow(TOO_NEW);
  });

  it.each([
    ['annunci', (r: any) => { r.listings[0].url = 'javascript:alert(1)'; }],
    ['annunci', (r: any) => { r.listings[0].url = 'https://www.evil.example/annunci/1/'; }],
    ['annunci', (r: any) => { r.listings[0].key = 'idealista:128416572'; }],
    ['annunci', (r: any) => { r.listings = 'tanti'; }],
    ['storico prezzi', (r: any) => { r.priceSnapshots[0].source = 'boh'; }],
    ['stati dei lead', (r: any) => { r.leadStates[0].status = 'boh'; }],
    ['calibrazione', (r: any) => { r.calibration[0].portal = 'casa.it'; }],
    ['impostazioni', (r: any) => { r.settings.minAgeDays = 0; }],
  ])('rifiuta il file intero e nomina la tabella: %s', (table, corrupt) => {
    const raw = roundTrip(data());
    corrupt(raw);
    expect(() => parseBackup(raw)).toThrow(`Backup non valido (${table})`);
  });

  it('accetta gli URL di tutti e tre i portali', () => {
    const raw = roundTrip({
      ...data(),
      listings: [
        listing({ key: 'idealista:34000001', portal: 'idealista', portalId: 34000001, url: 'https://www.idealista.it/immobile/34000001/' }),
        listing({ key: 'subito:600000001', portal: 'subito', portalId: 600000001, url: 'https://www.subito.it/appartamenti/bilocale-milano-600000001.htm' }),
      ],
    });
    expect(parseBackup(raw).listings).toHaveLength(2);
  });
});

describe('nomi dei file e riepilogo', () => {
  it('nomi', () => {
    expect(backupFileName(NOW)).toBe('homeradar-backup-2026-10-14.json');
    expect(autoBackupFileName(3)).toBe('HomeRadar/homeradar-backup-3.json');
  });
  it('riepilogo al plurale e al singolare', () => {
    expect(importSummaryText({ added: 120, updated: 34, unchanged: 210 })).toBe('Backup importato: 120 annunci nuovi, 34 aggiornati, 210 già presenti');
    expect(importSummaryText({ added: 1, updated: 1, unchanged: 1 })).toBe('Backup importato: 1 annuncio nuovo, 1 aggiornato, 1 già presente');
  });
});
```

(Il file test usa `any` per corrompere i dati: se il lint lo vieta, usa `Record<string, any>` con un commento.)

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/backup.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: implementazione** — `src/core/backup.ts`:

```ts
import { z } from 'zod';
import { validateSettings } from '@/core/settings';
import {
  LEAD_STATUSES, PORTALS, listingKey,
  type CalibrationPoint, type ImportSummary, type LeadState, type ListingRecord, type Portal, type PriceSnapshot, type Settings,
} from '@/shared/types';

export const BACKUP_FORMAT = 'homeradar-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const AUTO_BACKUP_SLOTS = 4;

export const NOT_A_BACKUP = 'Il file non è un backup di HomeRadar';
export const TOO_NEW = "Backup creato da una versione più recente di HomeRadar: aggiorna l'estensione";

export type BackupSnapshot = Omit<PriceSnapshot, 'id'>;

export interface BackupData {
  settings?: Settings;
  listings: ListingRecord[];
  priceSnapshots: BackupSnapshot[];
  leadStates: LeadState[];
  calibration: CalibrationPoint[];
}

export interface BackupFile extends BackupData {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: number;
  extensionVersion: string;
}

const PORTAL_DOMAINS: Record<Portal, string> = { immobiliare: 'immobiliare.it', idealista: 'idealista.it', subito: 'subito.it' };

/** Il link dell'annuncio viene mostrato nel pannello: solo https verso il dominio del suo portale. */
function isPortalUrl(url: string, portal: Portal): boolean {
  try {
    const u = new URL(url);
    const d = PORTAL_DOMAINS[portal];
    return u.protocol === 'https:' && (u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

// Gli schemi sono la lista dei campi ammessi: z.object scarta tutto ciò che non è dichiarato.
const num = z.number();
const int = z.number().int();
const text = z.string().nullable();
const portal = z.enum(PORTALS);

const DropSchema = z.object({ fromPrice: num, toPrice: num, percent: num, date: num, dateEstimated: z.boolean().optional() });

const ListingSchema = z
  .object({
    key: z.string(), portal, portalId: int, url: z.string(), title: z.string(),
    address: text, city: text, zone: text, typology: text,
    surfaceM2: num.nullable(), rooms: num.nullable(), currentPrice: num.nullable(),
    portalCreatedAt: num.nullable(), estimatedCreatedAt: num.nullable(), lastDrop: DropSchema.nullable(),
    firstSeenAt: num, lastSeenAt: num, seenCount: int.min(1),
  })
  .refine((l) => l.key === listingKey(l.portal, l.portalId) && isPortalUrl(l.url, l.portal));

const SnapshotSchema = z.object({ listingKey: z.string(), price: num, at: num, source: z.enum(['observed', 'declared']) });

const LeadStateSchema = z
  .object({ listingKey: z.string(), status: z.enum(LEAD_STATUSES), notes: z.string(), statusChangedAt: num, updatedAt: num.optional() })
  .transform((s): LeadState => ({ ...s, updatedAt: s.updatedAt ?? s.statusChangedAt }));

const CalibrationSchema = z.object({ portal, portalId: int, createdAt: num });

const SettingsSchema = z.object({
  minAgeDays: num.optional(), minDropPercent: num.optional(), retentionDays: num.optional(), autoBackup: z.boolean().optional(),
  enabledPortals: z.object({ immobiliare: z.boolean().optional(), idealista: z.boolean().optional(), subito: z.boolean().optional() }).optional(),
});

const HeaderSchema = z.object({ format: z.literal(BACKUP_FORMAT), formatVersion: int.min(1), createdAt: num, extensionVersion: z.string() });

function table<T>(raw: Record<string, unknown>, field: string, schema: z.ZodType<T>, label: string): T[] {
  const r = z.array(schema).safeParse(raw[field]);
  if (!r.success) throw new Error(`Backup non valido (${label})`);
  return r.data;
}

export function parseBackup(json: unknown): BackupFile {
  const header = HeaderSchema.safeParse(json);
  if (!header.success) throw new Error(NOT_A_BACKUP);
  if (header.data.formatVersion > BACKUP_FORMAT_VERSION) throw new Error(TOO_NEW);
  const raw = json as Record<string, unknown>;
  const file: BackupFile = {
    ...header.data,
    listings: table(raw, 'listings', ListingSchema, 'annunci'),
    priceSnapshots: table(raw, 'priceSnapshots', SnapshotSchema, 'storico prezzi'),
    leadStates: table(raw, 'leadStates', LeadStateSchema, 'stati dei lead'),
    calibration: table(raw, 'calibration', CalibrationSchema, 'calibrazione'),
  };
  if (raw.settings !== undefined) {
    const s = SettingsSchema.safeParse(raw.settings);
    try {
      if (!s.success) throw new Error();
      file.settings = validateSettings(s.data as Partial<Settings>);
    } catch {
      throw new Error('Backup non valido (impostazioni)');
    }
  }
  return file;
}

export function buildBackup(data: BackupData, now: number, extensionVersion: string): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now,
    extensionVersion,
    ...(data.settings ? { settings: data.settings } : {}),
    listings: data.listings,
    // L'id è una chiave locale autoincrementale: non va nel file.
    priceSnapshots: data.priceSnapshots.map(({ listingKey: k, price, at, source }) => ({ listingKey: k, price, at, source })),
    leadStates: data.leadStates,
    calibration: data.calibration,
  };
}

export function backupFileName(now: number): string {
  return `homeradar-backup-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export function autoBackupFileName(slot: number): string {
  return `HomeRadar/homeradar-backup-${slot}.json`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function importSummaryText(s: ImportSummary): string {
  return `Backup importato: ${count(s.added, 'annuncio nuovo', 'annunci nuovi')}, ${count(s.updated, 'aggiornato', 'aggiornati')}, ${count(s.unchanged, 'già presente', 'già presenti')}`;
}
```

Se `z.enum(PORTALS)` non compila con il tipo `Portal[]`, usa `z.enum(['immobiliare', 'idealista', 'subito'])` (idem per `LEAD_STATUSES` con `['new', 'to_contact', 'contacted', 'discarded']`).

- [ ] **Step 4: verifica**

Run: `npx vitest run tests/unit/core/backup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/backup.ts tests/unit/core/backup.test.ts tests/unit/core/backup-builders.ts
git commit -m "feat(backup): formato del file con schema zod come lista dei campi ammessi"
```

---

### Task 4: regole di unione — `mergeBackup`

**Files:**
- Modify: `src/core/backup.ts`
- Test: `tests/unit/core/backup-merge.test.ts`

**Interfaces:**
- Consumes: `BackupData`, `BackupSnapshot` (Task 3).
- Produces:
  - `interface CurrentData { listings: ListingRecord[]; priceSnapshots: BackupSnapshot[]; leadStates: LeadState[]; calibration: CalibrationPoint[]; settingsSaved: boolean }`
  - `interface MergeResult { listings: ListingRecord[]; priceSnapshots: BackupSnapshot[]; leadStates: LeadState[]; calibration: CalibrationPoint[]; settings: Settings | null; summary: ImportSummary }`; i record di `MergeResult` sono **le sole scritture** da fare (`listings`/`leadStates`/`calibration` con `put`, `priceSnapshots` con `add`).
  - `mergeBackup(current: CurrentData, incoming: BackupData, now: number): MergeResult`

- [ ] **Step 1: test** — `tests/unit/core/backup-merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeBackup, type BackupData, type CurrentData } from '@/core/backup';
import { DEFAULT_SETTINGS, type LeadState } from '@/shared/types';
import { listing, NOW } from './backup-builders';

const K = 'immobiliare:128416572';
const state = (o: Partial<LeadState> = {}): LeadState => ({ listingKey: K, status: 'new', notes: '', statusChangedAt: 1, updatedAt: 1, ...o });
const empty = (): CurrentData => ({ listings: [], priceSnapshots: [], leadStates: [], calibration: [], settingsSaved: false });
const file = (o: Partial<BackupData> = {}): BackupData => ({ listings: [listing()], priceSnapshots: [], leadStates: [state()], calibration: [], ...o });

describe('mergeBackup', () => {
  it('aggiunge un annuncio assente con il suo stato', () => {
    const m = mergeBackup(empty(), file({ leadStates: [state({ status: 'contacted' })] }), NOW);
    expect(m.listings).toEqual([listing()]);
    expect(m.leadStates).toEqual([state({ status: 'contacted' })]);
    expect(m.summary).toEqual({ added: 1, updated: 0, unchanged: 0 });
  });

  it('a un annuncio aggiunto senza stato dà lo stato "new"', () => {
    const m = mergeBackup(empty(), file({ leadStates: [] }), NOW);
    expect(m.leadStates).toEqual([{ listingKey: K, status: 'new', notes: '', statusChangedAt: NOW, updatedAt: NOW }]);
  });

  it('lo stesso contenuto non produce scritture, anche con le chiavi in ordine diverso', () => {
    const l = listing();
    const reordered = { ...l, lastDrop: { date: l.lastDrop!.date, percent: 5.6, toPrice: 235000, fromPrice: 249000 } };
    const cur = { ...empty(), listings: [reordered], leadStates: [state()] };
    const m = mergeBackup(cur, file(), NOW);
    expect(m).toMatchObject({ listings: [], leadStates: [], priceSnapshots: [], summary: { added: 0, updated: 0, unchanged: 1 } });
  });

  it('annuncio del backup più vecchio: tiene i campi del browser, allarga le visite', () => {
    const cur = { ...empty(), listings: [listing({ firstSeenAt: 500, lastSeenAt: NOW, seenCount: 2, currentPrice: 230000 })], leadStates: [state()] };
    const m = mergeBackup(cur, file({ listings: [listing({ firstSeenAt: 100, lastSeenAt: NOW - 5000, seenCount: 7, currentPrice: 240000 })] }), NOW);
    expect(m.listings).toEqual([listing({ firstSeenAt: 100, lastSeenAt: NOW, seenCount: 7, currentPrice: 230000 })]);
    expect(m.summary.updated).toBe(1);
  });

  it('annuncio del backup più recente: prende i suoi campi', () => {
    const cur = { ...empty(), listings: [listing({ lastSeenAt: NOW - 5000, currentPrice: 240000 })], leadStates: [state()] };
    const m = mergeBackup(cur, file({ listings: [listing({ lastSeenAt: NOW, currentPrice: 230000 })] }), NOW);
    expect(m.listings[0]).toMatchObject({ lastSeenAt: NOW, currentPrice: 230000 });
  });

  it('stato: vince updatedAt più alto; a parità resta il browser', () => {
    const cur = { ...empty(), listings: [listing()], leadStates: [state({ status: 'contacted', updatedAt: 10 })] };
    expect(mergeBackup(cur, file({ leadStates: [state({ status: 'discarded', updatedAt: 20 })] }), NOW).leadStates).toEqual([state({ status: 'discarded', updatedAt: 20 })]);
    expect(mergeBackup(cur, file({ leadStates: [state({ status: 'discarded', updatedAt: 5 })] }), NOW).leadStates).toEqual([]);
    const tie = mergeBackup(cur, file({ leadStates: [state({ status: 'discarded', updatedAt: 10 })] }), NOW);
    expect(tie.leadStates).toEqual([]);
    expect(tie.summary).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });

  it('storico prezzi: unione senza doppioni, anche dentro il file', () => {
    const a = { listingKey: K, price: 249000, at: 1, source: 'declared' as const };
    const b = { listingKey: K, price: 235000, at: 2, source: 'observed' as const };
    const cur = { ...empty(), listings: [listing()], leadStates: [state()], priceSnapshots: [{ ...a, id: 9 }] };
    const m = mergeBackup(cur, file({ priceSnapshots: [a, b, b] }), NOW);
    expect(m.priceSnapshots).toEqual([b]);
    expect(m.summary).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });

  it('scarta stati e snapshot di annunci assenti dal file', () => {
    const orphan = 'subito:1';
    const m = mergeBackup(empty(), file({
      leadStates: [state(), state({ listingKey: orphan })],
      priceSnapshots: [{ listingKey: orphan, price: 1, at: 1, source: 'observed' }],
    }), NOW);
    expect(m.leadStates.map((s) => s.listingKey)).toEqual([K]);
    expect(m.priceSnapshots).toEqual([]);
  });

  it('calibrazione: aggiunge i punti nuovi, non sovrascrive quelli del browser', () => {
    const cur = { ...empty(), calibration: [{ portal: 'idealista' as const, portalId: 1, createdAt: 100 }] };
    const m = mergeBackup(cur, file({ calibration: [{ portal: 'idealista', portalId: 1, createdAt: 999 }, { portal: 'subito', portalId: 2, createdAt: 200 }] }), NOW);
    expect(m.calibration).toEqual([{ portal: 'subito', portalId: 2, createdAt: 200 }]);
  });

  it('impostazioni: importate solo se nel browser non sono mai state salvate', () => {
    const settings = { ...DEFAULT_SETTINGS, minAgeDays: 90 };
    expect(mergeBackup(empty(), file({ settings }), NOW).settings).toEqual(settings);
    expect(mergeBackup({ ...empty(), settingsSaved: true }, file({ settings }), NOW).settings).toBeNull();
    expect(mergeBackup(empty(), file(), NOW).settings).toBeNull();
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/backup-merge.test.ts`
Expected: FAIL (`mergeBackup` non esportata).

- [ ] **Step 3: implementazione**, in fondo a `src/core/backup.ts`:

```ts
export interface CurrentData {
  listings: ListingRecord[];
  priceSnapshots: BackupSnapshot[];
  leadStates: LeadState[];
  calibration: CalibrationPoint[];
  /** Le impostazioni sono state salvate almeno una volta in questo browser. */
  settingsSaved: boolean;
}

export interface MergeResult {
  listings: ListingRecord[];
  priceSnapshots: BackupSnapshot[];
  leadStates: LeadState[];
  calibration: CalibrationPoint[];
  settings: Settings | null;
  summary: ImportSummary;
}

/** JSON con le chiavi ordinate: Dexie e zod restituiscono gli stessi oggetti con chiavi in ordine diverso. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

const snapId = (s: BackupSnapshot) => `${s.listingKey}|${s.at}|${s.price}|${s.source}`;
const calId = (c: CalibrationPoint) => `${c.portal}|${c.portalId}`;

/** Unione che non cancella mai nulla: restituisce solo i record da scrivere. */
export function mergeBackup(current: CurrentData, incoming: BackupData, now: number): MergeResult {
  const out: MergeResult = { listings: [], priceSnapshots: [], leadStates: [], calibration: [], settings: null, summary: { added: 0, updated: 0, unchanged: 0 } };
  const curListings = new Map(current.listings.map((l) => [l.key, l]));
  const curStates = new Map(current.leadStates.map((s) => [s.listingKey, s]));
  const incListings = new Map(incoming.listings.map((l) => [l.key, l]));
  const incStates = new Map(incoming.leadStates.filter((s) => incListings.has(s.listingKey)).map((s) => [s.listingKey, s]));
  /** Annunci già presenti a cui l'importazione aggiunge storico o cambia lo stato. */
  const touched = new Set<string>();

  const seenSnaps = new Set(current.priceSnapshots.map(snapId));
  for (const s of incoming.priceSnapshots) {
    if (!incListings.has(s.listingKey) || seenSnaps.has(snapId(s))) continue;
    seenSnaps.add(snapId(s));
    out.priceSnapshots.push(s);
    touched.add(s.listingKey);
  }

  for (const [key, s] of incStates) {
    const cur = curStates.get(key);
    if (cur && (s.updatedAt <= cur.updatedAt || stable(s) === stable(cur))) continue;
    out.leadStates.push(s);
    touched.add(key);
  }

  for (const inc of incListings.values()) {
    const cur = curListings.get(inc.key);
    if (!cur) {
      out.listings.push(inc);
      out.summary.added++;
      if (!incStates.has(inc.key) && !curStates.has(inc.key)) {
        out.leadStates.push({ listingKey: inc.key, status: 'new', notes: '', statusChangedAt: now, updatedAt: now });
      }
      continue;
    }
    const newer = inc.lastSeenAt > cur.lastSeenAt ? inc : cur;
    const merged: ListingRecord = {
      ...newer,
      firstSeenAt: Math.min(cur.firstSeenAt, inc.firstSeenAt),
      lastSeenAt: Math.max(cur.lastSeenAt, inc.lastSeenAt),
      seenCount: Math.max(cur.seenCount, inc.seenCount),
    };
    const changed = stable(merged) !== stable(cur);
    if (changed) out.listings.push(merged);
    if (changed || touched.has(inc.key)) out.summary.updated++;
    else out.summary.unchanged++;
  }

  const seenCal = new Set(current.calibration.map(calId));
  for (const c of incoming.calibration) {
    if (seenCal.has(calId(c))) continue;
    seenCal.add(calId(c));
    out.calibration.push(c);
  }

  if (!current.settingsSaved && incoming.settings) out.settings = incoming.settings;
  return out;
}
```

- [ ] **Step 4: verifica**

Run: `npx vitest run tests/unit/core/backup-merge.test.ts tests/unit/core/backup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/backup.ts tests/unit/core
git commit -m "feat(backup): unione dei dati importati senza cancellare nulla"
```

---

### Task 5: `LeadService` — esportazione, importazione, stato del backup

**Files:**
- Modify: `src/core/service.ts`
- Test: `tests/unit/core/service.backup.test.ts`

**Interfaces:**
- Consumes: `buildBackup`, `parseBackup`, `mergeBackup`, `AUTO_BACKUP_SLOTS`, `BackupFile` (Task 3–4); `BackupStatus`, `ImportSummary` (Task 2).
- Produces (metodi di `LeadService`):
  - `listingCount(): Promise<number>`
  - `exportBackup(extensionVersion: string): Promise<BackupFile>`
  - `importBackup(json: unknown): Promise<ImportSummary>`: tutto o niente
  - `backupStatus(): Promise<BackupStatus>`: default `{ lastAt: null, lastAutoFailedAt: null, nextSlot: 1 }`
  - `recordBackup(slotUsed?: number): Promise<void>`: `lastAt = now`; con `slotUsed`, `nextSlot = slotUsed % 4 + 1`
  - `recordBackupFailure(message: string): Promise<void>`: `lastAutoFailedAt = now` e un errore nel diagnostico `Backup automatico non riuscito: <message>`

- [ ] **Step 1: test** — `tests/unit/core/service.backup.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { LeadService } from '@/core/service';
import { DAY_MS } from '@/shared/types';
import { obs, setup } from './helpers';

const KEY = 'immobiliare:128416572';
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const stripIds = async (svc: LeadService) => (await svc.listLeads()).map((l) => ({ ...l, prices: l.prices.map(({ id: _id, ...p }) => p) }));

async function filled() {
  const a = setup();
  await a.svc.ingest([obs(), obs({ portalId: 120000000, lastDrop: null, price: 500000 })]);
  a.advance(DAY_MS);
  await a.svc.ingest([obs({ price: 230000, lastDrop: null })]);
  await a.svc.setLeadState(KEY, { status: 'to_contact', notes: 'chiamare la sera' });
  await a.svc.saveSettings({ minAgeDays: 90 });
  return a;
}

describe('LeadService backup', () => {
  it('esporta e reimporta in un browser vuoto: stessi lead, stati, storico e impostazioni', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('0.1.0'));
    expect(file).toMatchObject({ format: 'homeradar-backup', formatVersion: 1, extensionVersion: '0.1.0' });

    const b = setup(a.now());
    expect(await b.svc.importBackup(file)).toEqual({ added: 2, updated: 0, unchanged: 0 });
    expect(await b.svc.getSettings()).toEqual(await a.svc.getSettings());
    expect(await stripIds(b.svc)).toEqual(await stripIds(a.svc));
    expect(await b.db.calibration.toArray()).toEqual(await a.db.calibration.toArray());
  });

  it('reimportare lo stesso file non crea doppioni', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('v'));
    const snaps = await a.db.priceSnapshots.count();
    expect(await a.svc.importBackup(file)).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(await a.svc.importBackup(file)).toEqual({ added: 0, updated: 0, unchanged: 2 });
    expect(await a.db.priceSnapshots.count()).toBe(snaps);
  });

  it('non tocca le impostazioni già salvate nel browser', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('v'));
    const b = setup(a.now());
    await b.svc.saveSettings({ minAgeDays: 200 });
    await b.svc.importBackup(file);
    expect((await b.svc.getSettings()).minAgeDays).toBe(200);
  });

  it('un errore di scrittura annulla tutta l\'importazione', async () => {
    const a = await filled();
    const file = json(await a.svc.exportBackup('v'));
    const b = setup(a.now());
    vi.spyOn(b.db.priceSnapshots, 'bulkAdd').mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(b.svc.importBackup(file)).rejects.toThrow('QuotaExceededError');
    expect(await b.db.listings.count()).toBe(0);
    expect(await b.db.leadStates.count()).toBe(0);
  });

  it('un file non valido non scrive nulla', async () => {
    const b = setup();
    await expect(b.svc.importBackup({ format: 'altro' })).rejects.toThrow('Il file non è un backup di HomeRadar');
    expect(await b.db.listings.count()).toBe(0);
  });

  it('stato del backup: ultimo backup, rotazione degli slot, fallimenti nel diagnostico', async () => {
    const { svc, advance, now } = setup();
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: null, nextSlot: 1 });
    await svc.recordBackup(4);
    expect(await svc.backupStatus()).toEqual({ lastAt: now(), lastAutoFailedAt: null, nextSlot: 1 });
    advance(1000);
    await svc.recordBackup();
    expect(await svc.backupStatus()).toMatchObject({ lastAt: now(), nextSlot: 1 });
    await svc.recordBackup(2);
    expect((await svc.backupStatus()).nextSlot).toBe(3);
    advance(1000);
    await svc.recordBackupFailure('download interrotto (FILE_FAILED)');
    expect(await svc.backupStatus()).toMatchObject({ lastAt: now() - 1000, lastAutoFailedAt: now() });
    expect((await svc.getDiagnostics('v')).errors.at(-1)!.message).toBe('Backup automatico non riuscito: download interrotto (FILE_FAILED)');
  });

  it('conta gli annunci salvati', async () => {
    const a = await filled();
    expect(await a.svc.listingCount()).toBe(2);
  });
});
```

Se `vi.spyOn(b.db.priceSnapshots, 'bulkAdd')` non intercetta la chiamata dentro la transazione (Dexie usa la stessa istanza `Table` sul `db`, quindi dovrebbe), sostituisci con `vi.spyOn(Object.getPrototypeOf(b.db.priceSnapshots), 'bulkAdd')` e ripristina con `mockRestore()` alla fine del test.

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.backup.test.ts`
Expected: FAIL (metodi inesistenti).

- [ ] **Step 3: implementazione** in `src/core/service.ts`

Import: `import { AUTO_BACKUP_SLOTS, buildBackup, mergeBackup, parseBackup, type BackupFile } from '@/core/backup';` e aggiungi `BackupStatus`, `ImportSummary` all'import da `@/shared/types`.

Metodi (dopo `purge`):

```ts
  listingCount(): Promise<number> {
    return this.db.listings.count();
  }

  async exportBackup(extensionVersion: string): Promise<BackupFile> {
    const now = this.clock();
    const { listings, priceSnapshots, leadStates, calibration, meta } = this.db;
    return this.db.transaction('r', [listings, priceSnapshots, leadStates, calibration, meta], async () => {
      const saved = await meta.get('settings');
      return buildBackup(
        {
          settings: saved ? validateSettings(saved.value as Partial<Settings>) : undefined,
          listings: await listings.toArray(),
          priceSnapshots: await priceSnapshots.toArray(),
          leadStates: await leadStates.toArray(),
          calibration: await calibration.toArray(),
        },
        now,
        extensionVersion,
      );
    });
  }

  /** Unisce un backup ai dati presenti, in un'unica transazione: o tutto o niente. */
  async importBackup(json: unknown): Promise<ImportSummary> {
    const file = parseBackup(json);
    const now = this.clock();
    const { listings, priceSnapshots, leadStates, calibration, meta } = this.db;
    return this.db.transaction('rw', [listings, priceSnapshots, leadStates, calibration, meta], async () => {
      const m = mergeBackup(
        {
          listings: await listings.toArray(),
          priceSnapshots: await priceSnapshots.toArray(),
          leadStates: await leadStates.toArray(),
          calibration: await calibration.toArray(),
          settingsSaved: Boolean(await meta.get('settings')),
        },
        file,
        now,
      );
      await listings.bulkPut(m.listings);
      await priceSnapshots.bulkAdd(m.priceSnapshots);
      await leadStates.bulkPut(m.leadStates);
      await calibration.bulkPut(m.calibration);
      if (m.settings) await meta.put({ key: 'settings', value: m.settings });
      return m.summary;
    });
  }

  async backupStatus(): Promise<BackupStatus> {
    const rec = await this.db.meta.get('backup');
    return { lastAt: null, lastAutoFailedAt: null, nextSlot: 1, ...(rec?.value as Partial<BackupStatus> | undefined) };
  }

  private async updateBackupStatus(fn: (s: BackupStatus) => void): Promise<void> {
    await this.db.transaction('rw', this.db.meta, async () => {
      const s = await this.backupStatus();
      fn(s);
      await this.db.meta.put({ key: 'backup', value: s });
    });
  }

  /** Backup riuscito; `slotUsed` solo per quelli automatici, che ruotano sugli slot. */
  recordBackup(slotUsed?: number): Promise<void> {
    const at = this.clock();
    return this.updateBackupStatus((s) => {
      s.lastAt = at;
      if (slotUsed !== undefined) s.nextSlot = (slotUsed % AUTO_BACKUP_SLOTS) + 1;
    });
  }

  async recordBackupFailure(message: string): Promise<void> {
    const at = this.clock();
    await this.updateBackupStatus((s) => {
      s.lastAutoFailedAt = at;
    });
    await this.recordError(`Backup automatico non riuscito: ${message}`);
  }
```

`validateSettings` e `Settings` sono già importati in `service.ts`? Se no, aggiungi `import { validateSettings } from '@/core/settings';` e `Settings` all'import dei tipi.

- [ ] **Step 4: verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/service.ts tests/unit/core/service.backup.test.ts
git commit -m "feat(core): esportazione, importazione e stato del backup nel LeadService"
```

---

### Task 6: messaggi, router e API del pannello

**Files:**
- Modify: `src/shared/messages.ts` (union `Request`)
- Modify: `src/core/router.ts`
- Modify: `src/ui/sidepanel/api.ts`
- Modify: `tests/unit/ui/sidepanel.test.tsx` (`fakeApi`)
- Test: `tests/unit/core/router.test.ts`

**Interfaces:**
- Consumes: metodi di `LeadService` del Task 5.
- Produces:
  - `Request` aggiunge `{ type: 'exportBackup' } | { type: 'importBackup'; backup: unknown } | { type: 'getBackupStatus' }`
  - `Api` aggiunge `exportBackup(): Promise<BackupFile>`, `importBackup(backup: unknown): Promise<ImportSummary>`, `getBackupStatus(): Promise<BackupStatus>`

- [ ] **Step 1: test** in `tests/unit/core/router.test.ts`, dentro `describe('handleRequest')`:

```ts
  it('exportBackup registra il backup manuale; importBackup aggiorna il pannello', async () => {
    const { svc } = setup();
    const h = hooks();
    await svc.ingest([obs()]);
    const file = await handleRequest(svc, { type: 'exportBackup' }, '0.1.0', h);
    expect(file).toMatchObject({ format: 'homeradar-backup', extensionVersion: '0.1.0' });
    const status = (await handleRequest(svc, { type: 'getBackupStatus' }, 'v', h)) as { lastAt: number | null; nextSlot: number };
    expect(status.lastAt).not.toBeNull();
    expect(status.nextSlot).toBe(1);

    const other = setup();
    h.leadsChanged.mockClear();
    expect(await handleRequest(other.svc, { type: 'importBackup', backup: JSON.parse(JSON.stringify(file)) }, 'v', h)).toEqual({ added: 1, updated: 0, unchanged: 0 });
    expect(h.leadsChanged).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: verifica che fallisca**

Run: `npx vitest run tests/unit/core/router.test.ts`
Expected: FAIL («Richiesta sconosciuta: exportBackup»).

- [ ] **Step 3: implementazione**

`src/shared/messages.ts`, in fondo alla union `Request` (prima del `;`):

```ts
  | { type: 'exportBackup' }
  | { type: 'importBackup'; backup: unknown }
  | { type: 'getBackupStatus' }
```

`src/core/router.ts`, prima di `default:`:

```ts
    case 'exportBackup': {
      const file = await service.exportBackup(version);
      await service.recordBackup();
      return file;
    }
    case 'importBackup': {
      const summary = await service.importBackup(req.backup);
      hooks.leadsChanged();
      return summary;
    }
    case 'getBackupStatus':
      return service.backupStatus();
```

`src/ui/sidepanel/api.ts`: importa `import type { BackupFile } from '@/core/backup';` e aggiungi `BackupStatus`, `ImportSummary` all'import dei tipi; nell'interfaccia:

```ts
  exportBackup(): Promise<BackupFile>;
  importBackup(backup: unknown): Promise<ImportSummary>;
  getBackupStatus(): Promise<BackupStatus>;
```

in `defaultApi`:

```ts
  exportBackup: () => send({ type: 'exportBackup' }),
  importBackup: (backup) => send({ type: 'importBackup', backup }),
  getBackupStatus: () => send({ type: 'getBackupStatus' }),
```

In `tests/unit/ui/sidepanel.test.tsx`, dentro `fakeApi`:

```ts
    exportBackup: vi.fn(async () => buildBackup({ listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, 0, '0.1.0')),
    importBackup: vi.fn(async () => ({ added: 0, updated: 0, unchanged: 0 })),
    getBackupStatus: vi.fn(async () => ({ lastAt: null, lastAutoFailedAt: null, nextSlot: 1 })),
```

con `import { buildBackup } from '@/core/backup';`.

- [ ] **Step 4: verifica**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/shared/messages.ts src/core/router.ts src/ui/sidepanel/api.ts tests/unit
git commit -m "feat(router): messaggi per esportare, importare e leggere lo stato del backup"
```

---

### Task 7: quando fare il backup automatico — `auto-backup.ts`

**Files:**
- Create: `src/core/auto-backup.ts`
- Test: `tests/unit/core/auto-backup.test.ts`

**Interfaces:**
- Consumes: `autoBackupFileName`, `AUTO_BACKUP_SLOTS` (Task 3); `BackupStatus`, `Settings`, `DAY_MS`; `LeadService` (solo nei test).
- Produces:
  - `AUTO_BACKUP_INTERVAL_MS = 7 * DAY_MS`
  - `isBackupDue(status: BackupStatus, settings: Settings, listingCount: number, now: number): boolean`
  - `interface AutoBackupDeps { now(): number; status(): Promise<BackupStatus>; settings(): Promise<Settings>; listingCount(): Promise<number>; exportJson(): Promise<string>; saveFile(json: string, filename: string): Promise<void>; recordSuccess(slot: number): Promise<void>; recordFailure(message: string): Promise<void> }`
  - `runAutoBackup(deps: AutoBackupDeps): Promise<'skipped' | 'done' | 'failed'>`. `saveFile` si risolve solo a download completato.

- [ ] **Step 1: test** — `tests/unit/core/auto-backup.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AUTO_BACKUP_INTERVAL_MS, isBackupDue, runAutoBackup, type AutoBackupDeps } from '@/core/auto-backup';
import type { LeadService } from '@/core/service';
import { DAY_MS, DEFAULT_SETTINGS } from '@/shared/types';
import { obs, setup } from './helpers';

const NOW = Date.UTC(2026, 9, 14);
const never = { lastAt: null, lastAutoFailedAt: null, nextSlot: 1 };

describe('isBackupDue', () => {
  it.each([
    ['mai fatto', never, DEFAULT_SETTINGS, 5, true],
    ['meno di 7 giorni', { ...never, lastAt: NOW - 6 * DAY_MS }, DEFAULT_SETTINGS, 5, false],
    ['7 giorni esatti', { ...never, lastAt: NOW - AUTO_BACKUP_INTERVAL_MS }, DEFAULT_SETTINGS, 5, true],
    ['database vuoto', never, DEFAULT_SETTINGS, 0, false],
    ['backup automatico spento', never, { ...DEFAULT_SETTINGS, autoBackup: false }, 5, false],
  ])('%s', (_name, status, settings, count, due) => {
    expect(isBackupDue(status, settings, count, NOW)).toBe(due);
  });
});

function deps(svc: LeadService, now: () => number, saveFile: AutoBackupDeps['saveFile']): AutoBackupDeps {
  return {
    now,
    status: () => svc.backupStatus(),
    settings: () => svc.getSettings(),
    listingCount: () => svc.listingCount(),
    exportJson: async () => JSON.stringify(await svc.exportBackup('v')),
    saveFile,
    recordSuccess: (slot) => svc.recordBackup(slot),
    recordFailure: (m) => svc.recordBackupFailure(m),
  };
}

describe('runAutoBackup', () => {
  it('ruota sui 4 file, una volta ogni 7 giorni', async () => {
    const { svc, advance, now } = setup();
    await svc.ingest([obs()]);
    const saveFile = vi.fn(async () => {});
    const d = deps(svc, now, saveFile);
    for (let i = 0; i < 5; i++) {
      expect(await runAutoBackup(d)).toBe('done');
      expect(await runAutoBackup(d)).toBe('skipped');
      advance(AUTO_BACKUP_INTERVAL_MS);
    }
    expect(saveFile.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4, 1].map((n) => `HomeRadar/homeradar-backup-${n}.json`));
    expect(JSON.parse(saveFile.mock.calls[0]![0]).format).toBe('homeradar-backup');
  });

  it('se il salvataggio fallisce non avanza né lo slot né la data e lo registra', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const d = deps(svc, now, vi.fn(async () => { throw new Error('download interrotto (FILE_FAILED)'); }));
    expect(await runAutoBackup(d)).toBe('failed');
    expect(await svc.backupStatus()).toEqual({ lastAt: null, lastAutoFailedAt: now(), nextSlot: 1 });
    // Riprova al prossimo allarme.
    expect(await runAutoBackup({ ...d, saveFile: vi.fn(async () => {}) })).toBe('done');
  });

  it('con il database vuoto non salva nulla', async () => {
    const { svc, now } = setup();
    const saveFile = vi.fn(async () => {});
    expect(await runAutoBackup(deps(svc, now, saveFile))).toBe('skipped');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('uno slot fuori intervallo riparte da 1', async () => {
    const { svc, now } = setup();
    await svc.ingest([obs()]);
    const saveFile = vi.fn(async () => {});
    await runAutoBackup({ ...deps(svc, now, saveFile), status: async () => ({ ...never, nextSlot: 9 }) });
    expect(saveFile.mock.calls[0]![1]).toBe('HomeRadar/homeradar-backup-1.json');
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/core/auto-backup.test.ts`
Expected: FAIL.

- [ ] **Step 3: implementazione** — `src/core/auto-backup.ts`:

```ts
import { AUTO_BACKUP_SLOTS, autoBackupFileName } from '@/core/backup';
import { DAY_MS, type BackupStatus, type Settings } from '@/shared/types';

export const AUTO_BACKUP_INTERVAL_MS = 7 * DAY_MS;

/** Con il database vuoto non si salva: un browser appena pulito non sovrascrive i backup buoni. */
export function isBackupDue(status: BackupStatus, settings: Settings, listingCount: number, now: number): boolean {
  if (!settings.autoBackup || listingCount === 0) return false;
  return status.lastAt === null || now - status.lastAt >= AUTO_BACKUP_INTERVAL_MS;
}

export interface AutoBackupDeps {
  now(): number;
  status(): Promise<BackupStatus>;
  settings(): Promise<Settings>;
  listingCount(): Promise<number>;
  exportJson(): Promise<string>;
  /** Si risolve solo quando il file è davvero scritto su disco. */
  saveFile(json: string, filename: string): Promise<void>;
  recordSuccess(slot: number): Promise<void>;
  recordFailure(message: string): Promise<void>;
}

export async function runAutoBackup(d: AutoBackupDeps): Promise<'skipped' | 'done' | 'failed'> {
  const [status, settings, count] = await Promise.all([d.status(), d.settings(), d.listingCount()]);
  if (!isBackupDue(status, settings, count, d.now())) return 'skipped';
  const slot = Number.isInteger(status.nextSlot) && status.nextSlot >= 1 && status.nextSlot <= AUTO_BACKUP_SLOTS ? status.nextSlot : 1;
  try {
    await d.saveFile(await d.exportJson(), autoBackupFileName(slot));
  } catch (err) {
    await d.recordFailure(err instanceof Error ? err.message : String(err));
    return 'failed';
  }
  await d.recordSuccess(slot);
  return 'done';
}
```

- [ ] **Step 4: verifica**

Run: `npx vitest run tests/unit/core/auto-backup.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add src/core/auto-backup.ts tests/unit/core/auto-backup.test.ts
git commit -m "feat(backup): backup automatico settimanale con rotazione su 4 file"
```

---

### Task 8: salvataggio del file — offscreen, download, cablaggio nel background

**Files:**
- Create: `src/background/file-saver.ts`
- Create: `src/entrypoints/offscreen/index.html`, `src/entrypoints/offscreen/main.ts`
- Modify: `src/entrypoints/background.ts`
- Modify: `wxt.config.ts` (`permissions`)
- Test: `tests/unit/background/file-saver.test.ts`

**Interfaces:**
- Consumes: `runAutoBackup` (Task 7), metodi di `LeadService` (Task 5).
- Produces:
  - `OFFSCREEN_TARGET = 'homeradar-offscreen'`
  - `type OffscreenRequest = { target: typeof OFFSCREEN_TARGET; type: 'createBlobUrl'; json: string } | { target: typeof OFFSCREEN_TARGET; type: 'revokeBlobUrl'; url: string }`
  - `isOffscreenRequest(msg: unknown): msg is OffscreenRequest`
  - `interface DownloadDelta { id: number; state?: { current?: string }; error?: { current?: string } }`
  - `interface SaverPlatform { ensureOffscreen(): Promise<void>; closeOffscreen(): Promise<void>; sendToOffscreen(msg: OffscreenRequest): Promise<unknown>; download(opts: { url: string; filename: string }): Promise<number>; onDownloadChanged(listener: (d: DownloadDelta) => void): () => void }`
  - `createFileSaver(p: SaverPlatform, timeoutMs?: number): (json: string, filename: string) => Promise<void>`

- [ ] **Step 1: test** — `tests/unit/background/file-saver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFileSaver, isOffscreenRequest, OFFSCREEN_TARGET, type DownloadDelta, type SaverPlatform } from '@/background/file-saver';

function platform(onDownload: (emit: (d: DownloadDelta) => void) => void = (emit) => setTimeout(() => emit({ id: 7, state: { current: 'complete' } }))) {
  let listener: ((d: DownloadDelta) => void) | null = null;
  const emit = (d: DownloadDelta) => listener?.(d);
  const p: SaverPlatform = {
    ensureOffscreen: vi.fn(async () => {}),
    closeOffscreen: vi.fn(async () => {}),
    sendToOffscreen: vi.fn(async (msg) => (msg.type === 'createBlobUrl' ? 'blob:chrome-extension://x/1' : null)),
    download: vi.fn(async () => {
      onDownload(emit);
      return 7;
    }),
    onDownloadChanged: vi.fn((l) => {
      listener = l;
      return () => { listener = null; };
    }),
  };
  return p;
}

describe('createFileSaver', () => {
  it('crea il blob nell\'offscreen, scarica e attende il completamento, poi pulisce', async () => {
    const p = platform();
    await createFileSaver(p)('{"a":1}', 'HomeRadar/homeradar-backup-1.json');
    expect(p.sendToOffscreen).toHaveBeenNthCalledWith(1, { target: OFFSCREEN_TARGET, type: 'createBlobUrl', json: '{"a":1}' });
    expect(p.download).toHaveBeenCalledWith({ url: 'blob:chrome-extension://x/1', filename: 'HomeRadar/homeradar-backup-1.json' });
    expect(p.sendToOffscreen).toHaveBeenLastCalledWith({ target: OFFSCREEN_TARGET, type: 'revokeBlobUrl', url: 'blob:chrome-extension://x/1' });
    expect(p.closeOffscreen).toHaveBeenCalled();
  });

  it('non resta appeso se il completamento arriva prima che download() restituisca l\'id', async () => {
    const p = platform((emit) => emit({ id: 7, state: { current: 'complete' } }));
    await expect(createFileSaver(p, 50)('{}', 'f.json')).resolves.toBeUndefined();
  });

  it('ignora i download di altri id', async () => {
    const p = platform((emit) => {
      emit({ id: 3, state: { current: 'interrupted' } });
      setTimeout(() => emit({ id: 7, state: { current: 'complete' } }));
    });
    await expect(createFileSaver(p)('{}', 'f.json')).resolves.toBeUndefined();
  });

  it('rifiuta con il motivo se il download si interrompe, e pulisce comunque', async () => {
    const p = platform((emit) => setTimeout(() => emit({ id: 7, state: { current: 'interrupted' }, error: { current: 'FILE_FAILED' } })));
    await expect(createFileSaver(p)('{}', 'f.json')).rejects.toThrow('download interrotto (FILE_FAILED)');
    expect(p.closeOffscreen).toHaveBeenCalled();
  });

  it('rifiuta allo scadere del tempo', async () => {
    const p = platform(() => {});
    await expect(createFileSaver(p, 20)('{}', 'f.json')).rejects.toThrow('download non completato in tempo');
  });

  it('rifiuta se il documento offscreen non risponde', async () => {
    const p = platform();
    p.sendToOffscreen = vi.fn(async () => undefined);
    await expect(createFileSaver(p)('{}', 'f.json')).rejects.toThrow('documento offscreen non disponibile');
    expect(p.download).not.toHaveBeenCalled();
  });
});

describe('isOffscreenRequest', () => {
  it('riconosce solo i messaggi per l\'offscreen', () => {
    expect(isOffscreenRequest({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json: '' })).toBe(true);
    expect(isOffscreenRequest({ type: 'listLeads' })).toBe(false);
    expect(isOffscreenRequest(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/background/file-saver.test.ts`
Expected: FAIL.

- [ ] **Step 3: implementazione** — `src/background/file-saver.ts`:

```ts
export const OFFSCREEN_TARGET = 'homeradar-offscreen';

export type OffscreenRequest =
  | { target: typeof OFFSCREEN_TARGET; type: 'createBlobUrl'; json: string }
  | { target: typeof OFFSCREEN_TARGET; type: 'revokeBlobUrl'; url: string };

export function isOffscreenRequest(msg: unknown): msg is OffscreenRequest {
  return (msg as { target?: unknown } | undefined)?.target === OFFSCREEN_TARGET;
}

export interface DownloadDelta {
  id: number;
  state?: { current?: string };
  error?: { current?: string };
}

/** Le API di Chrome usate per salvare un file: iniettate, così la logica si testa senza browser. */
export interface SaverPlatform {
  ensureOffscreen(): Promise<void>;
  closeOffscreen(): Promise<void>;
  sendToOffscreen(msg: OffscreenRequest): Promise<unknown>;
  download(opts: { url: string; filename: string }): Promise<number>;
  onDownloadChanged(listener: (d: DownloadDelta) => void): () => void;
}

/**
 * Il service worker non può creare URL blob: lo fa il documento offscreen. Il salvataggio
 * si risolve solo a download completato.
 */
export function createFileSaver(p: SaverPlatform, timeoutMs = 60_000) {
  return async function saveFile(json: string, filename: string): Promise<void> {
    // In ascolto prima di avviare il download: l'evento di completamento può arrivare prima dell'id.
    const deltas: DownloadDelta[] = [];
    let check: (() => void) | null = null;
    const off = p.onDownloadChanged((d) => {
      deltas.push(d);
      check?.();
    });
    let url: string | null = null;
    try {
      await p.ensureOffscreen();
      const res = await p.sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'createBlobUrl', json });
      if (typeof res !== 'string') throw new Error('documento offscreen non disponibile');
      url = res;
      const id = await p.download({ url, filename });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('download non completato in tempo')), timeoutMs);
        check = () => {
          const d = deltas.find((x) => x.id === id && (x.state?.current === 'complete' || x.state?.current === 'interrupted'));
          if (!d) return;
          clearTimeout(timer);
          if (d.state?.current === 'complete') resolve();
          else reject(new Error(`download interrotto (${d.error?.current ?? 'motivo sconosciuto'})`));
        };
        check();
      });
    } finally {
      off();
      if (url) await p.sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'revokeBlobUrl', url }).catch(() => {});
      await p.closeOffscreen().catch(() => {});
    }
  };
}
```

`src/entrypoints/offscreen/index.html`:

```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <title>HomeRadar</title>
  </head>
  <body>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/entrypoints/offscreen/main.ts`:

```ts
import { browser } from 'wxt/browser';
import { isOffscreenRequest } from '@/background/file-saver';

// Documento invisibile aperto dal background solo per creare il file del backup automatico.
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!isOffscreenRequest(msg)) return false;
  if (msg.type === 'createBlobUrl') sendResponse(URL.createObjectURL(new Blob([msg.json], { type: 'application/json' })));
  else {
    URL.revokeObjectURL(msg.url);
    sendResponse(null);
  }
  return false;
});
```

`wxt.config.ts`: `permissions: ['sidePanel', 'alarms', 'clipboardWrite', 'downloads', 'offscreen'],`

`src/entrypoints/background.ts`:
- import:

```ts
import { createFileSaver, isOffscreenRequest } from '@/background/file-saver';
import { runAutoBackup } from '@/core/auto-backup';
```

- dopo `const hooks …`:

```ts
  const saveFile = createFileSaver({
    async ensureOffscreen() {
      const open = await browser.runtime.getContexts({ contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT] });
      if (open.length) return;
      await browser.offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: [browser.offscreen.Reason.BLOBS],
        justification: 'Creare il file del backup automatico di HomeRadar',
      });
    },
    closeOffscreen: () => browser.offscreen.closeDocument(),
    sendToOffscreen: (msg) => browser.runtime.sendMessage(msg),
    download: ({ url, filename }) => browser.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false }),
    onDownloadChanged(listener) {
      browser.downloads.onChanged.addListener(listener);
      return () => browser.downloads.onChanged.removeListener(listener);
    },
  });

  const autoBackup = () =>
    runAutoBackup({
      now: Date.now,
      status: () => service.backupStatus(),
      settings: () => service.getSettings(),
      listingCount: () => service.listingCount(),
      exportJson: async () => JSON.stringify(await service.exportBackup(version)),
      saveFile,
      recordSuccess: (slot) => service.recordBackup(slot),
      recordFailure: (message) => service.recordBackupFailure(message),
    });
```

- nel listener `onMessage`, la prima condizione diventa:

```ts
    if (typeof type !== 'string' || type === LEADS_CHANGED || isOffscreenRequest(msg)) return false;
```

- nel blocco che crea gli allarmi:

```ts
  void (async () => {
    if (!(await browser.alarms.get('purge'))) browser.alarms.create('purge', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
    if (!(await browser.alarms.get('backup'))) browser.alarms.create('backup', { delayInMinutes: 5, periodInMinutes: 24 * 60 });
  })();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'purge') void service.purge();
    if (alarm.name === 'backup') void autoBackup();
  });
```

Se i tipi di `wxt/browser` non espongono `browser.runtime.ContextType` o `browser.offscreen.Reason`, usa i letterali `'OFFSCREEN_DOCUMENT'` e `'BLOBS'` con un cast al tipo atteso dal parametro. `browser.runtime.getURL('/offscreen.html')` è tipizzato dai percorsi generati da WXT: lancia `npx wxt prepare` se il percorso risulta sconosciuto.

- [ ] **Step 4: verifica**

Run: `npx vitest run tests/unit/background/file-saver.test.ts && npm run typecheck && npm run build`
Poi: `node -e "const m=require('./.output/chrome-mv3/manifest.json');console.log(m.permissions)" && ls .output/chrome-mv3/offscreen.html`
Expected: test PASS; i permessi includono `downloads` e `offscreen`; `offscreen.html` esiste.

- [ ] **Step 5: commit**

```bash
git add src/background src/entrypoints wxt.config.ts tests/unit/background
git commit -m "feat(background): salvataggio del backup automatico tramite documento offscreen"
```

---

### Task 9: blocco «Backup» nelle impostazioni

**Files:**
- Modify: `src/ui/sidepanel/SettingsView.tsx`
- Modify: `src/ui/sidepanel/styles.css`
- Test: `tests/unit/ui/settings-backup.test.tsx`

**Interfaces:**
- Consumes: `Api.exportBackup/importBackup/getBackupStatus/saveSettings/getSettings` (Task 6); `backupFileName`, `importSummaryText`, `NOT_A_BACKUP`, `buildBackup` (Task 3); `formatDateTime` (Task 2); `downloadBlob` (`./download`).
- Produces: `SettingsView({ api, onSaved, download? })`, dove `download` è iniettabile (default `downloadBlob`) come in `ExportBar`.

- [ ] **Step 1: test** — `tests/unit/ui/settings-backup.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBackup } from '@/core/backup';
import type { Api } from '@/ui/sidepanel/api';
import { SettingsView } from '@/ui/sidepanel/SettingsView';
import { DEFAULT_SETTINGS, type BackupStatus } from '@/shared/types';

afterEach(cleanup);

function api(status: BackupStatus = { lastAt: null, lastAutoFailedAt: null, nextSlot: 1 }): Api {
  return {
    listLeads: vi.fn(async () => []),
    setLeadState: vi.fn(),
    deleteListing: vi.fn(),
    deleteListings: vi.fn(),
    deleteAllListings: vi.fn(async () => 0),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (s) => s),
    getDiagnostics: vi.fn(),
    onLeadsChanged: vi.fn(() => () => {}),
    exportBackup: vi.fn(async () => buildBackup({ listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, 0, '0.1.0')),
    importBackup: vi.fn(async () => ({ added: 2, updated: 1, unchanged: 0 })),
    getBackupStatus: vi.fn(async () => status),
  } as unknown as Api;
}

const fileInput = () => screen.getByLabelText('Importa backup', { selector: 'input' }) as HTMLInputElement;

describe('impostazioni: backup', () => {
  it('mostra "mai" e spegne il backup automatico salvando subito', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    expect(await screen.findByText('Ultimo backup: mai')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Backup automatico settimanale' }));
    expect(await screen.findByText('Backup automatico disattivato')).toBeTruthy();
    expect(a.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, autoBackup: false });
  });

  it("segnala l'ultimo backup automatico fallito", async () => {
    render(<SettingsView api={api({ lastAt: 1000, lastAutoFailedAt: 2000, nextSlot: 2 })} onSaved={vi.fn()} />);
    expect(await screen.findByText('Ultimo backup automatico non riuscito')).toBeTruthy();
  });

  it('esporta il backup come file JSON e aggiorna la data', async () => {
    const a = api();
    const download = vi.fn();
    render(<SettingsView api={a} onSaved={vi.fn()} download={download} />);
    vi.mocked(a.getBackupStatus).mockResolvedValue({ lastAt: new Date(2026, 9, 12, 9, 30).getTime(), lastAutoFailedAt: null, nextSlot: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta backup ora' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    const [blob, name] = download.mock.calls[0]!;
    expect(name).toMatch(/^homeradar-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(await (blob as Blob).text()).format).toBe('homeradar-backup');
    expect(await screen.findByText('Ultimo backup: 12/10 alle 09:30')).toBeTruthy();
  });

  it('importa un file, mostra il riepilogo e ricarica i lead; lo stesso file si può riscegliere', async () => {
    const a = api();
    const onSaved = vi.fn();
    render(<SettingsView api={a} onSaved={onSaved} />);
    await screen.findByText('Ultimo backup: mai');
    const file = new File(['{"format":"homeradar-backup"}'], 'b.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByText('Backup importato: 2 annunci nuovi, 1 aggiornato, 0 già presenti')).toBeTruthy();
    expect(a.importBackup).toHaveBeenCalledWith({ format: 'homeradar-backup' });
    expect(onSaved).toHaveBeenCalled();
    expect(fileInput().value).toBe('');
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => expect(a.importBackup).toHaveBeenCalledTimes(2));
  });

  it('un file non JSON dà errore senza chiamare il background', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    await screen.findByText('Ultimo backup: mai');
    fireEvent.change(fileInput(), { target: { files: [new File(['ciao'], 'x.json')] } });
    expect(await screen.findByText('Errore: Il file non è un backup di HomeRadar')).toBeTruthy();
    expect(a.importBackup).not.toHaveBeenCalled();
  });

  it("mostra l'errore del background", async () => {
    const a = api();
    vi.mocked(a.importBackup).mockRejectedValue(new Error('Backup non valido (annunci)'));
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    await screen.findByText('Ultimo backup: mai');
    fireEvent.change(fileInput(), { target: { files: [new File(['{}'], 'x.json')] } });
    expect(await screen.findByText('Errore: Backup non valido (annunci)')).toBeTruthy();
  });

  it('ogni voce del backup ha il suo tooltip', async () => {
    render(<SettingsView api={api()} onSaved={vi.fn()} />);
    for (const name of ['Backup automatico settimanale', 'Esporta backup ora', 'Importa backup']) {
      expect(await screen.findByRole('button', { name: `Informazioni: ${name}` })).toBeTruthy();
    }
  });
});
```

Se in jsdom `File.text()` non esiste, nel componente leggi il file con `await new Response(file).text()`.

- [ ] **Step 2: verifica che falliscano**

Run: `npx vitest run tests/unit/ui/settings-backup.test.tsx`
Expected: FAIL.

- [ ] **Step 3: implementazione** in `src/ui/sidepanel/SettingsView.tsx`

Import:

```tsx
import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { backupFileName, importSummaryText, NOT_A_BACKUP } from '@/core/backup';
import { formatDateTime } from '@/shared/format';
import { PORTAL_SITES, PORTALS, type BackupStatus, type Portal, type Settings } from '@/shared/types';
import { downloadBlob } from './download';
```

Firma e stato:

```tsx
export function SettingsView({ api, onSaved, download = downloadBlob }: { api: Api; onSaved(): void; download?: (b: Blob, name: string) => void }) {
  // ...stato esistente...
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  useEffect(() => {
    api.getBackupStatus().then(setBackup, () => {});
  }, [api]);
```

Sostituisci `togglePortal` con un salvataggio immediato comune e due interruttori:

```tsx
  /** Gli interruttori salvano subito, partendo dalle impostazioni salvate e non dai campi in sospeso. */
  async function saveNow(patch: Partial<Settings>, ok: string) {
    try {
      const result = await api.saveSettings({ ...saved!, ...patch });
      setSaved(result);
      setForm((f) => f && { ...f, enabledPortals: result.enabledPortals, autoBackup: result.autoBackup });
      setMessage(ok);
      onSaved();
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function togglePortal(portal: Portal) {
    const on = !form!.enabledPortals[portal];
    return saveNow({ enabledPortals: { ...saved!.enabledPortals, [portal]: on } }, `${PORTAL_SITES[portal]} ${on ? 'attivato' : 'disattivato'}`);
  }

  function toggleAutoBackup() {
    const on = !form!.autoBackup;
    return saveNow({ autoBackup: on }, `Backup automatico ${on ? 'attivato' : 'disattivato'}`);
  }

  async function exportBackup() {
    try {
      const file = await api.exportBackup();
      download(new Blob([JSON.stringify(file)], { type: 'application/json' }), backupFileName(Date.now()));
      setBackup(await api.getBackupStatus());
      setMessage('Backup esportato');
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function importBackup(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Azzerato subito: riscegliere lo stesso file deve riattivare l'importazione.
    input.value = '';
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      setMessage(`Errore: ${NOT_A_BACKUP}`);
      return;
    }
    try {
      const summary = await api.importBackup(json);
      const s = await api.getSettings();
      setSaved(s);
      setForm(s);
      setMessage(importSummaryText(summary));
      onSaved();
    } catch (err) {
      setMessage(`Errore: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const backupFailed = backup?.lastAutoFailedAt != null && (backup.lastAt === null || backup.lastAutoFailedAt > backup.lastAt);
```

Nel JSX, `onChange={() => void togglePortal(p)}` resta invariato. Aggiungi questa card tra «Portali attivi» e «Assistenza»:

```tsx
      <div className="card">
        <h2 className="card__title">Backup</h2>
        <p className="card__text">
          {backup?.lastAt ? `Ultimo backup: ${formatDateTime(backup.lastAt)}` : 'Ultimo backup: mai'}
        </p>
        {backupFailed && <p className="card__text backup__warn">Ultimo backup automatico non riuscito</p>}
        <div className="settings__row switch">
          <label id={`${ids}-autoBackup-label`} htmlFor={`${ids}-autoBackup`} className="switch__label">Backup automatico settimanale</label>
          <InfoTip label="Backup automatico settimanale">
            Una volta a settimana salva una copia di annunci, stati, note e storico prezzi nella cartella
            Download/HomeRadar, a rotazione su 4 file (circa un mese di storia). Il file resta sul tuo computer e
            contiene gli indirizzi degli annunci e le tue note.
          </InfoTip>
          <label className="switch__control">
            <input
              id={`${ids}-autoBackup`}
              type="checkbox"
              role="switch"
              className="switch__input"
              aria-labelledby={`${ids}-autoBackup-label`}
              checked={form.autoBackup}
              onChange={() => void toggleAutoBackup()}
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        </div>
        <div className="settings__row">
          <button type="button" className="btn" onClick={exportBackup}>Esporta backup ora</button>
          <InfoTip label="Esporta backup ora">
            Scarica subito un file di backup, per esempio prima di cambiare computer. Su un altro browser lo riapri con
            «Importa backup».
          </InfoTip>
        </div>
        <div className="settings__row">
          <label className="btn">
            Importa backup
            <input type="file" accept=".json,application/json" className="visually-hidden" onChange={(e) => void importBackup(e)} />
          </label>
          <InfoTip label="Importa backup">
            Unisce un backup ai dati di questo browser senza cancellare nulla: aggiunge gli annunci mancanti e, per
            lo stesso annuncio, tiene lo stato e le note modificati più di recente. Le impostazioni del backup si
            usano solo se qui non le hai mai cambiate.
          </InfoTip>
        </div>
      </div>
```

`src/ui/sidepanel/styles.css` (se `.visually-hidden` non esiste già; controlla con `grep -n visually-hidden src/ui/sidepanel/styles.css`):

```css
.backup__warn { color: var(--high); font-weight: 600; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.btn:focus-within { box-shadow: var(--focus); }
```

- [ ] **Step 4: verifica**

Run: `npm test && npm run typecheck`
Expected: PASS, compresi i test esistenti di `sidepanel.test.tsx` (interruttori dei portali e tooltip).

- [ ] **Step 5: commit**

```bash
git add src/ui/sidepanel tests/unit/ui/settings-backup.test.tsx
git commit -m "feat(settings): blocco Backup con backup automatico, esportazione e importazione"
```

---

### Task 10: e2e, smoke test e documentazione

**Files:**
- Modify: `tests/e2e/extension.spec.ts`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`, `docs/roadmap.md`

- [ ] **Step 1: test e2e**, in fondo a `tests/e2e/extension.spec.ts`:

```ts
test("esporta un backup e lo reimporta dopo aver azzerato l'archivio", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const nuovi = panel.getByRole('tab', { name: /^Nuovi \(\d+\)$/ });
  await expect(panel.getByRole('tab', { name: /^Nuovi \([1-9]\d*\)$/ })).toBeVisible();
  const before = await nuovi.textContent();

  await panel.getByRole('button', { name: 'Impostazioni', exact: true }).click();
  await expect(panel.getByText('Ultimo backup: mai')).toBeVisible();
  const [download] = await Promise.all([panel.waitForEvent('download'), panel.getByRole('button', { name: 'Esporta backup ora', exact: true }).click()]);
  const file = (await download.path())!;
  expect(JSON.parse(readFileSync(file, 'utf8')).format).toBe('homeradar-backup');
  await expect(panel.getByText(/^Ultimo backup: \d{2}\/\d{2} alle \d{2}:\d{2}$/)).toBeVisible();

  await panel.getByRole('button', { name: 'Azzera archivio annunci', exact: true }).click();
  await panel.getByRole('button', { name: 'Conferma: azzera tutto', exact: true }).click();
  await panel.getByLabel('Importa backup', { exact: true }).setInputFiles(file);
  await expect(panel.getByText(/^Backup importato: \d+ annunci nuovi, 0 aggiornati, 0 già presenti$/)).toBeVisible();

  await panel.getByRole('button', { name: 'Torna ai lead', exact: true }).click();
  await expect(nuovi).toHaveText(before!);
});
```

- [ ] **Step 2: esegui**

Run: `npm run test:e2e`
Expected: PASS, compresi i test e2e esistenti.

- [ ] **Step 3: smoke test**, in `docs/smoke-test.md` prima del paragrafo finale «Se il sito è cambiato…», con la numerazione che prosegue da quella esistente (dopo il 25):

```markdown
## Backup

26. Installa la build su un profilo Chrome nuovo e accetta i permessi.
    - [ ] Chrome chiede il permesso "Gestire i download".
27. Naviga una ricerca su un portale finché compaiono lead, poi attendi almeno 5 minuti con il browser aperto.
    - [ ] Compare `Download/HomeRadar/homeradar-backup-1.json`; in Impostazioni "Ultimo backup" ha data e ora di oggi.
28. Attiva in Chrome "Chiedi dove salvare ogni file prima di scaricarlo", azzera lo stato del backup (rimuovi l'estensione e reinstallala), ripeti il punto 27.
    - [ ] Annota se si apre la finestra di salvataggio: se sì, va segnalato nell'onboarding (roadmap, punto 2).
29. Impostazioni → "Esporta backup ora".
    - [ ] Scarica `homeradar-backup-AAAA-MM-GG.json`; il file non contiene nomi né telefoni dei venditori.
30. Su un altro profilo Chrome pulito: Impostazioni → "Importa backup" con quel file.
    - [ ] Riepilogo "Backup importato: N annunci nuovi…"; lead, stati, note, grafici prezzi e impostazioni come nel profilo di origine.
```

- [ ] **Step 4: documentazione**

`CLAUDE.md`, nella sezione Architettura dopo la riga di `src/core/`:

```markdown
- Backup: `src/core/backup.ts` (formato del file con schema zod come lista dei campi ammessi, unione all'importazione: vince l'`updatedAt` più recente del lead, non si cancella mai nulla), `src/core/auto-backup.ts` (settimanale, rotazione su 4 file in `Download/HomeRadar/`), `src/background/file-saver.ts` + `src/entrypoints/offscreen/` (il service worker non crea URL `blob:`: lo fa il documento offscreen, poi `chrome.downloads`). Se cambi la forma di un record salvato, aggiorna anche gli schemi di `backup.ts`; un cambio incompatibile del file alza `BACKUP_FORMAT_VERSION`.
```

`docs/roadmap.md`, riga 1 della tabella: `| 1 | Backup e ripristino | in revisione | |` (il link alla PR si aggiunge quando la PR esiste).

- [ ] **Step 5: verifica finale**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: tutto PASS.

- [ ] **Step 6: commit**

```bash
git add tests/e2e/extension.spec.ts docs/smoke-test.md CLAUDE.md docs/roadmap.md
git commit -m "test(e2e): esportazione e reimportazione del backup; smoke test e documentazione"
```
