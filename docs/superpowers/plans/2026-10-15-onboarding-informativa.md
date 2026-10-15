# Onboarding e informativa privacy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schermata di benvenuto e informativa con conferma obbligatoria e versionata: finché l'agente non conferma, HomeRadar non legge né salva nulla dai portali.

**Architecture:** La conferma è un record `meta.onboarding` scritto dal `LeadService` (fuori dal backup). Il router scarta `ingest`/`parseStatus` finché manca la conferma e risponde a `getPortalState` (`'active' | 'off' | 'onboarding'`), che i content script usano al posto della lettura delle impostazioni. Un componente React condiviso (`Onboarding`) è montato in una pagina dell'estensione aperta all'installazione e nel pannello laterale; avviso sul portale e pallino sull'icona guidano chi non ha confermato.

**Tech Stack:** WXT 0.20 (MV3), React 18, TypeScript, Dexie, Vitest (jsdom + fake-indexeddb), Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-onboarding-informativa-design.md`

## Global Constraints

- Conversazione, testi dell'interfaccia, commenti e messaggi di commit in italiano.
- Nessuna richiesta HTTP verso i portali; nessun nuovo permesso nel manifest (`wxt.config.ts` resta `['sidePanel', 'alarms', 'clipboardWrite', 'downloads', 'offscreen']`).
- Il `LeadService` è l'unico scrittore su Dexie. Schema Dexie invariato (`meta` è chiave/valore).
- La conferma non entra nel file di backup.
- Timestamp sempre in ms epoch UTC.
- `ONBOARDING_VERSION = 1`; `ONBOARDING_CHANGES` vuoto alla versione 1.
- Testi esatti: pulsante "Ho capito, inizia"; avviso "HomeRadar non è ancora attivo: leggi e conferma l'informativa per iniziare" con pulsante "Apri"; dopo "Apri" l'avviso diventa "HomeRadar: dopo aver confermato, ricarica la pagina" con "Ricarica"; titolo dell'icona "HomeRadar: conferma l'informativa per iniziare"; contatto "Per domande, rivolgiti a chi ti ha fornito HomeRadar."
- Commit con trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Molti file del repo sono CRLF: usa lo strumento Edit, non `sed`, per modificarli.

## Review Focus

1. Background irraggiungibile mentre il content script chiede lo stato del portale: deve restare fermo (nessuna lettura, nessun badge). Test nel Task 5 ("se lo stato non si legge non legge nulla").
2. Agente che conferma nella scheda mentre il pannello è aperto: il pannello deve passare alla lista senza riaprirlo. Test nel Task 6 (`onOnboardingChanged`).
3. Record `meta.onboarding` corrotto o di forma inattesa (es. `version` stringa): va trattato come "mai confermato", non come confermato. Test nel Task 1.
4. Avviso di onboarding ripetuto a ogni scansione di Idealista (il MutationObserver chiama `scan` di continuo): deve comparire una sola volta per pagina. Test nel Task 5.
5. Pannello aperto prima dell'installazione completa o con background che fallisce la lettura dello stato: "Errore: …" con "Riprova", mai la lista. Test nel Task 6.

---

### Task 1: Stato della conferma (core e servizio)

**Files:**
- Create: `src/core/onboarding.ts`
- Modify: `src/shared/types.ts` (in fondo al file)
- Modify: `src/core/service.ts` (import e due metodi nuovi dopo `backupStatus`)
- Test: `tests/unit/core/onboarding.test.ts`

**Interfaces:**
- Produces:
  - `ONBOARDING_VERSION: number`, `ONBOARDING_CHANGES: Record<number, string[]>`
  - `needsOnboarding(acceptedVersion: number | null, current?: number): boolean`
  - `changesSince(acceptedVersion: number | null, changes?: Record<number, string[]>, current?: number): string[]`
  - tipi `OnboardingStatus { acceptedVersion: number | null; acceptedAt: number | null; current: number }`, `PortalState = 'active' | 'off' | 'onboarding'`
  - `LeadService.onboardingStatus(): Promise<OnboardingStatus>`, `LeadService.acceptOnboarding(): Promise<OnboardingStatus>`

- [ ] **Step 1: Scrivi i test**

`tests/unit/core/onboarding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { changesSince, needsOnboarding, ONBOARDING_VERSION } from '@/core/onboarding';
import { obs, setup } from './helpers';

describe('needsOnboarding', () => {
  it.each([
    ['mai confermato', null, 1, true],
    ['versione corrente', 1, 1, false],
    ['versione precedente', 1, 2, true],
    ['versione futura (estensione tornata indietro)', 3, 2, false],
  ])('%s', (_name, accepted, current, expected) => {
    expect(needsOnboarding(accepted, current)).toBe(expected);
  });

  it('di default usa la versione corrente', () => {
    expect(needsOnboarding(ONBOARDING_VERSION)).toBe(false);
  });
});

describe('changesSince', () => {
  const changes = { 2: ['Date di ricontatto'], 3: ['Stesso immobile su più portali', 'Altro'] };
  it('elenca le voci delle versioni successive a quella confermata, fino alla corrente', () => {
    expect(changesSince(1, changes, 3)).toEqual(['Date di ricontatto', 'Stesso immobile su più portali', 'Altro']);
    expect(changesSince(2, changes, 3)).toEqual(['Stesso immobile su più portali', 'Altro']);
    expect(changesSince(1, changes, 2)).toEqual(['Date di ricontatto']);
  });
  it('vuoto se mai confermato o già alla versione corrente', () => {
    expect(changesSince(null, changes, 3)).toEqual([]);
    expect(changesSince(3, changes, 3)).toEqual([]);
  });
});

describe('LeadService: informativa', () => {
  it('stato iniziale: mai confermata', async () => {
    const { svc } = setup();
    expect(await svc.onboardingStatus()).toEqual({ acceptedVersion: null, acceptedAt: null, current: ONBOARDING_VERSION });
  });

  it('la conferma salva versione corrente e data', async () => {
    const { svc, now } = setup();
    expect(await svc.acceptOnboarding()).toEqual({ acceptedVersion: ONBOARDING_VERSION, acceptedAt: now(), current: ONBOARDING_VERSION });
    expect(await svc.onboardingStatus()).toEqual({ acceptedVersion: ONBOARDING_VERSION, acceptedAt: now(), current: ONBOARDING_VERSION });
  });

  it('un record di forma inattesa vale come mai confermato', async () => {
    const { svc, db } = setup();
    await db.meta.put({ key: 'onboarding', value: { version: '1', acceptedAt: 5 } });
    expect((await svc.onboardingStatus()).acceptedVersion).toBeNull();
  });

  it('la conferma non finisce nel file di backup', async () => {
    const { svc } = setup();
    await svc.ingest([obs()]);
    await svc.acceptOnboarding();
    const json = JSON.stringify(await svc.exportBackup('v'));
    expect(json).not.toContain('onboarding');
    expect(json).not.toContain('acceptedAt');
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/onboarding.test.ts`
Expected: FAIL, `Failed to resolve import "@/core/onboarding"`.

- [ ] **Step 3: Implementa**

`src/core/onboarding.ts`:

```ts
/**
 * Versione dell'informativa. Si alza solo se cambia cosa viene salvato o come viene usato
 * (es. nuovi dati del lead): l'agente deve riconfermare. Refusi e legenda non la alzano.
 */
export const ONBOARDING_VERSION = 1;

/** Voci del riquadro "Cosa è cambiato", per versione dell'informativa. */
export const ONBOARDING_CHANGES: Record<number, string[]> = {};

/** Vero se l'informativa non è mai stata confermata o è stata confermata in una versione precedente. */
export function needsOnboarding(acceptedVersion: number | null, current = ONBOARDING_VERSION): boolean {
  return acceptedVersion === null || acceptedVersion < current;
}

/** Novità delle versioni successive a quella confermata; vuoto alla prima conferma. */
export function changesSince(acceptedVersion: number | null, changes = ONBOARDING_CHANGES, current = ONBOARDING_VERSION): string[] {
  if (acceptedVersion === null) return [];
  const out: string[] = [];
  for (let v = acceptedVersion + 1; v <= current; v++) out.push(...(changes[v] ?? []));
  return out;
}
```

In fondo a `src/shared/types.ts`:

```ts
/** Conferma dell'informativa (record `meta.onboarding`, fuori dal backup). */
export interface OnboardingStatus {
  acceptedVersion: number | null;
  acceptedAt: number | null;
  /** Versione dell'informativa di questa build. */
  current: number;
}

/** Cosa deve fare un content script sul suo portale. */
export type PortalState = 'active' | 'off' | 'onboarding';
```

In `src/core/service.ts` aggiungi agli import `import { ONBOARDING_VERSION } from '@/core/onboarding';` e `OnboardingStatus` all'import dei tipi da `@/shared/types`; poi, subito dopo il metodo `backupStatus()`:

```ts
  async onboardingStatus(): Promise<OnboardingStatus> {
    const rec = (await this.db.meta.get('onboarding'))?.value as { version?: unknown; acceptedAt?: unknown } | undefined;
    const version = rec?.version;
    const acceptedAt = rec?.acceptedAt;
    // Un record di forma inattesa non vale come conferma.
    if (typeof version !== 'number' || typeof acceptedAt !== 'number') {
      return { acceptedVersion: null, acceptedAt: null, current: ONBOARDING_VERSION };
    }
    return { acceptedVersion: version, acceptedAt, current: ONBOARDING_VERSION };
  }

  async acceptOnboarding(): Promise<OnboardingStatus> {
    await this.db.meta.put({ key: 'onboarding', value: { version: ONBOARDING_VERSION, acceptedAt: this.clock() } });
    return this.onboardingStatus();
  }
```

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/unit/core/onboarding.test.ts`
Expected: PASS (11 test).

- [ ] **Step 5: Commit**

```bash
git add src/core/onboarding.ts src/shared/types.ts src/core/service.ts tests/unit/core/onboarding.test.ts
git commit -m "feat(core): stato della conferma dell'informativa, versionato e fuori dal backup"
```

---

### Task 2: Stile condiviso dei badge e segnale sull'icona

**Files:**
- Create: `src/shared/badge-style.ts`
- Create: `src/core/action-badge.ts`
- Modify: `src/content/badges.ts:7-23` (costanti `BASE` e `COLORS`)
- Test: `tests/unit/core/action-badge.test.ts`, `tests/unit/shared/badge-style.test.ts`

**Interfaces:**
- Produces:
  - `BADGE_LOOK: Record<string, string>`, `BADGE_COLORS: Record<Priority, Record<string, string>>`, `toReactStyle(css: Record<string, string>): Record<string, string>`
  - `actionBadge(s: { onboarding: boolean; warning: boolean }): ActionBadge` con `ActionBadge { text: string; color: string | null; title: string }`
  - `WARNING_COLOR = '#d97706'`

- [ ] **Step 1: Scrivi i test**

`tests/unit/core/action-badge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { actionBadge, WARNING_COLOR } from '@/core/action-badge';
import { BRAND_COLOR } from '@/shared/logo';

describe('actionBadge', () => {
  it("senza conferma: pallino nel colore del marchio, anche con l'avviso dei portali", () => {
    const expected = { text: '●', color: BRAND_COLOR, title: "HomeRadar: conferma l'informativa per iniziare" };
    expect(actionBadge({ onboarding: true, warning: false })).toEqual(expected);
    expect(actionBadge({ onboarding: true, warning: true })).toEqual(expected);
  });
  it('avviso dei portali: "!" ambra', () => {
    expect(actionBadge({ onboarding: false, warning: true })).toEqual({ text: '!', color: WARNING_COLOR, title: 'HomeRadar' });
  });
  it('tutto in ordine: nessun segnale', () => {
    expect(actionBadge({ onboarding: false, warning: false })).toEqual({ text: '', color: null, title: 'HomeRadar' });
  });
});
```

`tests/unit/shared/badge-style.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BADGE_COLORS, BADGE_LOOK, toReactStyle } from '@/shared/badge-style';

describe('badge-style', () => {
  it('converte le proprietà CSS nei nomi di React', () => {
    expect(toReactStyle({ 'border-color': '#fff', 'box-shadow': 'none', color: '#000' })).toEqual({ borderColor: '#fff', boxShadow: 'none', color: '#000' });
  });
  it("l'aspetto non contiene posizionamento, così la legenda resta in linea", () => {
    expect(BADGE_LOOK).not.toHaveProperty('position');
    expect(BADGE_COLORS.high.background).toBe('#c0262d');
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/action-badge.test.ts tests/unit/shared/badge-style.test.ts`
Expected: FAIL, import non risolti.

- [ ] **Step 3: Implementa**

`src/shared/badge-style.ts`:

```ts
import type { Priority } from '@/shared/types';

/** Aspetto del badge, senza posizionamento: lo usano i badge sulle pagine e la legenda dell'informativa. */
export const BADGE_LOOK: Record<string, string> = {
  display: 'inline-block', 'box-sizing': 'border-box', padding: '4px 10px', 'border-radius': '999px',
  'border-width': '1px', 'border-style': 'solid', font: "600 12px/1.3 Inter, 'Segoe UI', system-ui, sans-serif", 'white-space': 'nowrap',
  'letter-spacing': '0.01em', 'box-shadow': '0 1px 2px rgba(16,24,40,.12), 0 2px 8px rgba(16,24,40,.18)',
};

export const BADGE_COLORS: Record<Priority, Record<string, string>> = {
  high: { background: '#c0262d', color: '#ffffff', 'border-color': '#a01e24' },
  medium: { background: '#fff4e0', color: '#8a3f04', 'border-color': '#f2cf8c' },
  verify: { background: '#eaf1fd', color: '#1d5fd1', 'border-color': '#b6ccf5' },
  none: { background: '#ffffff', color: '#0f4c5c', 'border-color': '#cdd5db' },
};

/** Da proprietà CSS ("border-color") a stile React ("borderColor"). */
export function toReactStyle(css: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(css).map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}
```

In `src/content/badges.ts` sostituisci le righe da `const BASE` fino alla chiusura di `const COLORS` (comprese) con:

```ts
const BASE: Record<string, string> = {
  position: 'absolute', top: '8px', left: '8px', right: 'auto', bottom: 'auto',
  width: 'auto', height: 'auto', 'max-width': 'calc(100% - 16px)', margin: '0', transform: 'none',
  overflow: 'hidden', 'text-overflow': 'ellipsis', 'z-index': '5', 'pointer-events': 'none',
  ...BADGE_LOOK,
};
```

aggiungi `import { BADGE_COLORS, BADGE_LOOK } from '@/shared/badge-style';` e in `renderBadge` sostituisci `COLORS[ev.priority]` con `BADGE_COLORS[ev.priority]`. Il commento sopra `BASE` ("Tutte le proprietà vengono impostate con !important…") resta.

`src/core/action-badge.ts`:

```ts
import { BRAND_COLOR } from '@/shared/logo';

export const WARNING_COLOR = '#d97706';

export interface ActionBadge {
  text: string;
  /** null: il colore non va cambiato (testo vuoto). */
  color: string | null;
  title: string;
}

/** Segnale sull'icona: la conferma dell'informativa mancante ha la precedenza sull'avviso dei portali. */
export function actionBadge({ onboarding, warning }: { onboarding: boolean; warning: boolean }): ActionBadge {
  if (onboarding) return { text: '●', color: BRAND_COLOR, title: "HomeRadar: conferma l'informativa per iniziare" };
  if (warning) return { text: '!', color: WARNING_COLOR, title: 'HomeRadar' };
  return { text: '', color: null, title: 'HomeRadar' };
}
```

- [ ] **Step 4: Verifica che passino, compresi i test dei badge esistenti**

Run: `npx vitest run tests/unit/core/action-badge.test.ts tests/unit/shared/badge-style.test.ts tests/unit/content/badges.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/badge-style.ts src/core/action-badge.ts src/content/badges.ts tests/unit/core/action-badge.test.ts tests/unit/shared/badge-style.test.ts
git commit -m "feat: stile dei badge condiviso e segnale sull'icona con precedenza all'informativa"
```

---

### Task 3: Componente `Onboarding` e pagina di benvenuto

**Files:**
- Modify: `src/shared/messages.ts` (unione `Request`, costante `ONBOARDING_CHANGED`)
- Modify: `src/ui/sidepanel/api.ts`
- Create: `src/ui/onboarding/Onboarding.tsx`, `src/ui/onboarding/onboarding.css`
- Create: `src/entrypoints/onboarding/index.html`, `src/entrypoints/onboarding/main.tsx`
- Modify: `tests/unit/ui/sidepanel.test.tsx` (`fakeApi`), `tests/unit/ui/settings-backup.test.tsx` (`api`)
- Test: `tests/unit/ui/onboarding.test.tsx`

**Interfaces:**
- Consumes: `needsOnboarding`, `changesSince`, `ONBOARDING_CHANGES` (Task 1); `BADGE_LOOK`, `BADGE_COLORS`, `toReactStyle` (Task 2); `OnboardingStatus` (Task 1).
- Produces:
  - richieste `{ type: 'getOnboardingStatus' }`, `{ type: 'acceptOnboarding' }`, `{ type: 'getPortalState'; portal: Portal }`, `{ type: 'openOnboarding' }`; `ONBOARDING_CHANGED = 'onboardingChanged'`
  - `Api.getOnboardingStatus(): Promise<OnboardingStatus>`, `Api.acceptOnboarding(): Promise<OnboardingStatus>`, `Api.onOnboardingChanged(cb: () => void): () => void`
  - `Onboarding({ api, mode, onDone?, changes? })` con `mode: 'confirm' | 'review'`
  - pagina `onboarding.html` (percorso `/onboarding.html` per `browser.runtime.getURL`)

- [ ] **Step 1: Messaggi e API**

In `src/shared/messages.ts` aggiungi in fondo all'unione `Request` (dopo `| { type: 'getBackupStatus' }`, togliendo il `;` da quella riga):

```ts
  | { type: 'getBackupStatus' }
  | { type: 'getOnboardingStatus' }
  | { type: 'acceptOnboarding' }
  | { type: 'getPortalState'; portal: Portal }
  | { type: 'openOnboarding' };
```

e sotto `export const LEADS_CHANGED = 'leadsChanged';`:

```ts
export const ONBOARDING_CHANGED = 'onboardingChanged';
```

In `src/ui/sidepanel/api.ts`: importa `ONBOARDING_CHANGED` insieme a `LEADS_CHANGED` e `OnboardingStatus` insieme agli altri tipi; aggiungi all'interfaccia `Api`:

```ts
  getOnboardingStatus(): Promise<OnboardingStatus>;
  acceptOnboarding(): Promise<OnboardingStatus>;
  onOnboardingChanged(cb: () => void): () => void;
```

e sostituisci l'implementazione di `onLeadsChanged` in `defaultApi` con un aiutante condiviso. Sopra `export const defaultApi`:

```ts
/** Ascolta un messaggio diffuso dal background a tutte le pagine dell'estensione. */
function onBroadcast(type: string, cb: () => void): () => void {
  const listener = (msg: unknown) => {
    if ((msg as { type?: string } | undefined)?.type === type) cb();
  };
  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}
```

e in `defaultApi`:

```ts
  getOnboardingStatus: () => send({ type: 'getOnboardingStatus' }),
  acceptOnboarding: () => send({ type: 'acceptOnboarding' }),
  onLeadsChanged: (cb) => onBroadcast(LEADS_CHANGED, cb),
  onOnboardingChanged: (cb) => onBroadcast(ONBOARDING_CHANGED, cb),
```

Aggiorna i finti `Api` dei test esistenti, che altrimenti non compilano. In `tests/unit/ui/sidepanel.test.tsx`, dentro `fakeApi`, dopo `getBackupStatus`:

```ts
    getOnboardingStatus: vi.fn(async () => ({ acceptedVersion: 1, acceptedAt: 0, current: 1 })),
    acceptOnboarding: vi.fn(async () => ({ acceptedVersion: 1, acceptedAt: 0, current: 1 })),
    onOnboardingChanged: vi.fn(() => () => {}),
```

In `tests/unit/ui/settings-backup.test.tsx`, dentro `api()`, le stesse tre righe dopo `getBackupStatus`.

- [ ] **Step 2: Scrivi i test del componente**

`tests/unit/ui/onboarding.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '@/ui/onboarding/Onboarding';
import { DEFAULT_SETTINGS, type OnboardingStatus } from '@/shared/types';

afterEach(cleanup);

const never: OnboardingStatus = { acceptedVersion: null, acceptedAt: null, current: 1 };
const accepted: OnboardingStatus = { acceptedVersion: 1, acceptedAt: Date.UTC(2026, 9, 15, 10), current: 1 };

function api(status: OnboardingStatus = never, settings = DEFAULT_SETTINGS) {
  return {
    getOnboardingStatus: vi.fn(async () => status),
    acceptOnboarding: vi.fn(async () => accepted),
    getSettings: vi.fn(async () => settings),
  };
}

describe('Onboarding', () => {
  it('mostra informativa e legenda con le soglie attuali delle impostazioni', async () => {
    render(<Onboarding api={api(never, { ...DEFAULT_SETTINGS, minAgeDays: 90, minDropPercent: 5, retentionDays: 60 })} mode="confirm" />);
    expect(await screen.findByRole('heading', { name: 'Benvenuto in HomeRadar' })).toBeTruthy();
    expect(screen.getByText(/indirizzo completo \(via e civico/)).toBeTruthy();
    expect(screen.getByText(/Nomi e numeri di telefono dei venditori/)).toBeTruthy();
    expect(screen.getByText(/non rivedi da 60 giorni/)).toBeTruthy();
    expect(screen.getByText(/finestra di salvataggio/)).toBeTruthy();
    expect(screen.getByText('online da almeno 90 giorni e ribassato di almeno 5%.')).toBeTruthy();
    expect(screen.getByText('● Alta')).toBeTruthy();
    expect(screen.getByText('Per domande, rivolgiti a chi ti ha fornito HomeRadar.')).toBeTruthy();
    expect(screen.queryByText('Cosa è cambiato')).toBeNull();
  });

  it('senza soglia di ribasso dice solo "ribassato"', async () => {
    render(<Onboarding api={api()} mode="confirm" />);
    expect(await screen.findByText('online da almeno 120 giorni e ribassato.')).toBeTruthy();
  });

  it('nella scheda, dopo la conferma, dice che HomeRadar è attivo', async () => {
    const a = api();
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText('HomeRadar è attivo')).toBeTruthy();
    expect(a.acceptOnboarding).toHaveBeenCalledTimes(1);
  });

  it('nel pannello, dopo la conferma, chiama onDone', async () => {
    const onDone = vi.fn();
    render(<Onboarding api={api()} mode="confirm" onDone={onDone} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('se la conferma fallisce mostra l\'errore e lascia il pulsante', async () => {
    const a = api();
    a.acceptOnboarding.mockRejectedValueOnce(new Error('boom'));
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText('Errore: boom')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ho capito, inizia' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('riconferma dopo un aggiornamento: riquadro "Cosa è cambiato" con le novità', async () => {
    render(<Onboarding api={api({ acceptedVersion: 1, acceptedAt: 1, current: 2 })} mode="confirm" changes={{ 2: ['Date di ricontatto sui lead'] }} />);
    expect(await screen.findByText('Cosa è cambiato')).toBeTruthy();
    expect(screen.getByText('Date di ricontatto sui lead')).toBeTruthy();
  });

  it('in sola lettura: data di conferma e "Chiudi", nessun pulsante di conferma', async () => {
    const onDone = vi.fn();
    render(<Onboarding api={api(accepted)} mode="review" onDone={onDone} />);
    expect(await screen.findByText('Confermata il 15/10/2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ho capito, inizia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('se lo stato non si legge mostra l\'errore e "Riprova"', async () => {
    const a = api();
    a.getOnboardingStatus.mockRejectedValueOnce(new Error('Nessuna risposta dal background'));
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('heading', { name: 'Benvenuto in HomeRadar' })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/ui/onboarding.test.tsx`
Expected: FAIL, `Failed to resolve import "@/ui/onboarding/Onboarding"`.

- [ ] **Step 4: Implementa il componente**

`src/ui/onboarding/Onboarding.tsx`:

```tsx
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { changesSince, needsOnboarding, ONBOARDING_CHANGES } from '@/core/onboarding';
import { BADGE_COLORS, BADGE_LOOK, toReactStyle } from '@/shared/badge-style';
import { formatDate, formatPercent } from '@/shared/format';
import type { OnboardingStatus, Priority, Settings } from '@/shared/types';
import type { Api } from '@/ui/sidepanel/api';
import './onboarding.css';

type OnboardingApi = Pick<Api, 'getOnboardingStatus' | 'acceptOnboarding' | 'getSettings'>;

const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

function Badge({ priority, children }: { priority: Priority; children: string }) {
  return <span className="legend__badge" style={toReactStyle({ ...BADGE_LOOK, ...BADGE_COLORS[priority] }) as CSSProperties}>{children}</span>;
}

/**
 * Benvenuto e informativa. `confirm`: con il pulsante di conferma (scheda all'installazione e pannello
 * finché manca la conferma); `review`: in sola lettura dalle impostazioni.
 */
export function Onboarding({ api, mode, onDone, changes = ONBOARDING_CHANGES }: {
  api: OnboardingApi;
  mode: 'confirm' | 'review';
  /** Pannello: torna alla lista o alle impostazioni. Senza, la scheda mostra "HomeRadar è attivo". */
  onDone?: () => void;
  changes?: Record<number, string[]>;
}) {
  const [data, setData] = useState<{ status: OnboardingStatus; settings: Settings } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [status, settings] = await Promise.all([api.getOnboardingStatus(), api.getSettings()]);
      setData({ status, settings });
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const status = await api.acceptOnboarding();
      setData((d) => (d ? { ...d, status } : d));
      if (onDone) onDone();
      else setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="onboarding">
        {error ? (
          <>
            <p className="banner banner--error"><span>{error}</span></p>
            <button type="button" className="btn" onClick={() => void load()}>Riprova</button>
          </>
        ) : (
          <p className="settings__loading">Caricamento…</p>
        )}
      </div>
    );
  }

  const { status, settings } = data;
  if (mode === 'confirm' && (done || !needsOnboarding(status.acceptedVersion, status.current))) {
    return (
      <div className="onboarding">
        <section className="card">
          <h2 className="onboarding__title">HomeRadar è attivo</h2>
          <p>Apri una ricerca su Immobiliare.it, Idealista.it o Subito.it: i badge compaiono sugli annunci dei privati.</p>
          <p>Suggerimento: fissa l'icona di HomeRadar nella barra di Chrome (icona del puzzle, poi la puntina) per aprire il pannello con un clic.</p>
        </section>
      </div>
    );
  }

  const news = changesSince(status.acceptedVersion, changes, status.current);
  const dropped = settings.minDropPercent > 0 ? `ribassato di almeno ${formatPercent(settings.minDropPercent)}%` : 'ribassato';

  return (
    <div className="onboarding">
      {news.length > 0 && (
        <section className="card onboarding__changes">
          <h2 className="onboarding__h">Cosa è cambiato</h2>
          <ul>{news.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}
      <section className="card">
        <h2 className="onboarding__title">Benvenuto in HomeRadar</h2>
        <p>
          Su Immobiliare.it, Idealista.it e Subito.it HomeRadar riconosce gli annunci pubblicati da privati e li segnala, così
          trovi prima i proprietari da contattare. Lavora solo sulle pagine che apri tu: non visita i portali da solo e non fa
          ricerche al posto tuo.
        </p>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Cosa salva</h2>
        <ul>
          <li>
            Gli annunci di privati che vedi nelle ricerche: titolo, indirizzo completo (via e civico, come pubblicato
            nell'annuncio), città e zona, tipologia, m², locali, prezzo e link.
          </li>
          <li>Lo storico dei prezzi, per riconoscere i ribassi.</li>
          <li>Lo stato che dai a ogni lead e le tue note. Le note le scrivi tu: non inserire dati personali che non ti servono.</li>
        </ul>
        <h2 className="onboarding__h">Cosa non salva mai</h2>
        <ul>
          <li>Gli annunci di agenzie.</li>
          <li>Nomi e numeri di telefono dei venditori, anche quando il portale li mostra.</li>
        </ul>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Dove restano i dati</h2>
        <ul>
          <li>Solo nel tuo browser, su questo computer. Non vengono inviati a nessun server, nemmeno a chi ha creato HomeRadar.</li>
          <li>
            {`Gli annunci che non hai mai lavorato (stato "Nuovo") e che non rivedi da ${settings.retentionDays} giorni vengono cancellati da soli; puoi cambiare il periodo nelle impostazioni.`}
          </li>
          <li>
            Una volta a settimana HomeRadar salva un backup nella cartella Download/HomeRadar. Se Chrome è impostato per chiedere
            dove salvare i file, in quel momento vedrai la finestra di salvataggio: confermala. Il backup si può spegnere nelle
            impostazioni.
          </li>
          <li>Puoi cancellare tutto in qualsiasi momento: Impostazioni → Azzera archivio annunci.</li>
        </ul>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Come leggere i badge</h2>
        <ul className="legend">
          <li><Badge priority="high">● Alta</Badge><span>{`online da almeno ${settings.minAgeDays} giorni e ${dropped}.`}</span></li>
          <li><Badge priority="medium">● Media</Badge><span>solo una delle due condizioni.</span></li>
          <li>
            <Badge priority="verify">◐ Da verificare</Badge>
            <Badge priority="verify">◐ Età incerta</Badge>
            <span>l'età è vicina alla soglia e non è certa.</span>
          </li>
          <li><Badge priority="none">Privato</Badge><span>annuncio di un privato senza segnali particolari.</span></li>
          <li>
            <Badge priority="none">~120 gg</Badge>
            <span>età stimata: Idealista e Subito non pubblicano la data dell'annuncio, quindi HomeRadar la stima; su Immobiliare l'età è esatta.</span>
          </li>
          <li><Badge priority="medium">−8%</Badge><span>ribasso rispetto al prezzo più alto visto.</span></li>
        </ul>
      </section>
      <p className="onboarding__contact">Per domande, rivolgiti a chi ti ha fornito HomeRadar.</p>
      {error && <p className="banner banner--error"><span>{error}</span></p>}
      {mode === 'confirm' ? (
        <button type="button" className="btn btn--primary onboarding__cta" disabled={busy} onClick={() => void accept()}>
          Ho capito, inizia
        </button>
      ) : (
        <div className="onboarding__review">
          {status.acceptedAt != null && <span>{`Confermata il ${formatDate(status.acceptedAt)}`}</span>}
          <button type="button" className="btn" onClick={onDone}>Chiudi</button>
        </div>
      )}
    </div>
  );
}
```

`src/ui/onboarding/onboarding.css`:

```css
/* Benvenuto e informativa: pagina all'installazione e vista del pannello. Usa le variabili di sidepanel/styles.css. */
.onboarding-page { max-width: 720px; margin: 0 auto; min-height: 100vh; background: var(--bg); }
.onboarding { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.onboarding p { margin: 0; }
.onboarding ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.onboarding__title { margin: 0; font-size: 17px; color: var(--brand); }
.onboarding__h { margin: 0; font-size: 13px; font-weight: 700; color: var(--text); }
.onboarding__changes { border-color: var(--verify-border); background: var(--verify-soft); }
.onboarding__contact { color: var(--muted); font-size: 12px; }
.onboarding__cta { width: 100%; }
.onboarding__review { display: flex; gap: 10px; align-items: center; justify-content: space-between; color: var(--muted); }
.onboarding .legend { list-style: none; padding-left: 0; gap: 8px; }
.legend li { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
```

- [ ] **Step 5: Pagina di benvenuto**

`src/entrypoints/onboarding/index.html`:

```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Benvenuto in HomeRadar</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/entrypoints/onboarding/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { Onboarding } from '@/ui/onboarding/Onboarding';
import { defaultApi } from '@/ui/sidepanel/api';
import { Logo } from '@/ui/sidepanel/Icons';
import '@/ui/sidepanel/styles.css';

// Scheda aperta dal background all'installazione (e dopo un aggiornamento dell'informativa).
createRoot(document.getElementById('root')!).render(
  <main className="onboarding-page">
    <header className="panel__header">
      <div className="brand">
        <Logo size={28} />
        <div>
          <div className="brand__name">HomeRadar</div>
          <div className="brand__sub">Benvenuto</div>
        </div>
      </div>
    </header>
    <Onboarding api={defaultApi} mode="confirm" />
  </main>,
);
```

- [ ] **Step 6: Verifica**

Run: `npx vitest run tests/unit/ui && npx wxt prepare && npm run typecheck && npm run build`
Expected: test PASS; typecheck pulito; nella build compare `.output/chrome-mv3/onboarding.html`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/messages.ts src/ui/sidepanel/api.ts src/ui/onboarding src/entrypoints/onboarding tests/unit/ui
git commit -m "feat(onboarding): schermata di benvenuto e informativa con legenda dei badge"
```

---

### Task 4: Router e background

**Files:**
- Modify: `src/core/router.ts`
- Modify: `src/entrypoints/background.ts`
- Modify: `tests/unit/core/router.test.ts`

**Interfaces:**
- Consumes: `needsOnboarding` (Task 1), `LeadService.onboardingStatus/acceptOnboarding` (Task 1), `actionBadge` (Task 2), richieste e `ONBOARDING_CHANGED` (Task 3), pagina `/onboarding.html` (Task 3).
- Produces:
  - `RouterHooks { setWarning(on: boolean): void; leadsChanged(): void; onboardingChanged(): void; openOnboarding(): Promise<void> }`
  - `getPortalState` restituisce `PortalState`; `ingest` → `[]` e `parseStatus` → `null` finché manca la conferma.

- [ ] **Step 1: Adegua i test esistenti e scrivi i nuovi**

In `tests/unit/core/router.test.ts`:

1. Sostituisci la funzione `hooks()` con:

```ts
function hooks() {
  return { setWarning: vi.fn(), leadsChanged: vi.fn(), onboardingChanged: vi.fn(), openOnboarding: vi.fn(async () => {}) };
}

/** Servizio con l'informativa già confermata: i test esistenti lavorano su un'estensione attiva. */
async function ready() {
  const s = setup();
  await s.svc.acceptOnboarding();
  return s;
}
```

2. In tutti i test esistenti sostituisci `setup()` con `await ready()` (sono 9 occorrenze: `const { svc } = setup();` e `const other = setup();`). Usa Edit con `replace_all` su `= setup();` → `= await ready();`.

3. Aggiungi in fondo al `describe('handleRequest', …)`, prima di `it('rifiuta richieste sconosciute'…`:

```ts
  it('senza conferma dell\'informativa non salva annunci né avvisi', async () => {
    const { svc } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', h)).toEqual([]);
    expect(await handleRequest(svc, { type: 'parseStatus', portal: 'immobiliare', ok: false, errors: ['x'], source: 'api' }, 'v', h)).toBeNull();
    expect(await svc.listLeads()).toEqual([]);
    const d = await svc.getDiagnostics('v');
    expect(d.errors).toEqual([]);
    expect(d.adapterWarning).toEqual({});
    expect(h.leadsChanged).not.toHaveBeenCalled();
    expect(h.setWarning).not.toHaveBeenCalled();
    // Le richieste del pannello passano comunque.
    expect(await handleRequest(svc, { type: 'getSettings' }, 'v', h)).toEqual(DEFAULT_SETTINGS);
  });

  it('getPortalState: in attesa della conferma, poi acceso o spento', async () => {
    const { svc } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'subito' }, 'v', h)).toBe('onboarding');
    await svc.saveSettings({ ...DEFAULT_SETTINGS, enabledPortals: { ...DEFAULT_SETTINGS.enabledPortals, subito: false } });
    // Finché manca la conferma vince l'informativa, anche su un portale spento.
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'subito' }, 'v', h)).toBe('onboarding');
    await handleRequest(svc, { type: 'acceptOnboarding' }, 'v', h);
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'subito' }, 'v', h)).toBe('off');
    expect(await handleRequest(svc, { type: 'getPortalState', portal: 'immobiliare' }, 'v', h)).toBe('active');
  });

  it('acceptOnboarding salva, avvisa le pagine e sblocca la lettura', async () => {
    const { svc, now } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'getOnboardingStatus' }, 'v', h)).toMatchObject({ acceptedVersion: null });
    expect(await handleRequest(svc, { type: 'acceptOnboarding' }, 'v', h)).toMatchObject({ acceptedVersion: 1, acceptedAt: now() });
    expect(h.onboardingChanged).toHaveBeenCalledTimes(1);
    const evs = (await handleRequest(svc, { type: 'ingest', observations: [obs()] }, 'v', h)) as unknown[];
    expect(evs).toHaveLength(1);
  });

  it('openOnboarding apre la scheda; un errore finisce nel diagnostico', async () => {
    const { svc } = setup();
    const h = hooks();
    expect(await handleRequest(svc, { type: 'openOnboarding' }, 'v', h)).toBeNull();
    expect(h.openOnboarding).toHaveBeenCalledTimes(1);
    h.openOnboarding.mockRejectedValueOnce(new Error('No current window'));
    expect(await handleRequest(svc, { type: 'openOnboarding' }, 'v', h)).toBeNull();
    expect((await svc.getDiagnostics('v')).errors.at(-1)!.message).toBe("Apertura dell'informativa: No current window");
  });
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/router.test.ts`
Expected: FAIL nei 4 test nuovi (`Richiesta sconosciuta: getPortalState`, ingest che salva senza conferma).

- [ ] **Step 3: Implementa il router**

In `src/core/router.ts`:

```ts
import { needsOnboarding } from '@/core/onboarding';
import type { LeadService } from '@/core/service';
import type { Request } from '@/shared/messages';
import { PORTALS, type PortalState } from '@/shared/types';

export interface RouterHooks {
  setWarning(on: boolean): void;
  leadsChanged(): void;
  /** Conferma dell'informativa cambiata: le pagine dell'estensione si aggiornano. */
  onboardingChanged(): void;
  /** Apre la scheda di benvenuto. */
  openOnboarding(): Promise<void>;
}

/** Finché l'informativa non è confermata non si legge né si salva nulla dai portali. */
async function awaitingOnboarding(service: LeadService): Promise<boolean> {
  const s = await service.onboardingStatus();
  return needsOnboarding(s.acceptedVersion, s.current);
}
```

In `case 'ingest'`, come prima riga del blocco (prima del commento "Difesa in profondità"):

```ts
      if (await awaitingOnboarding(service)) return [];
```

In `case 'parseStatus'`, come prima riga del blocco:

```ts
      if (await awaitingOnboarding(service)) return null;
```

Prima di `default:`:

```ts
    case 'getOnboardingStatus':
      return service.onboardingStatus();
    case 'acceptOnboarding': {
      const status = await service.acceptOnboarding();
      hooks.onboardingChanged();
      return status;
    }
    case 'getPortalState': {
      let state: PortalState = 'onboarding';
      if (!(await awaitingOnboarding(service))) state = (await service.getSettings()).enabledPortals[req.portal] ? 'active' : 'off';
      return state;
    }
    case 'openOnboarding':
      try {
        await hooks.openOnboarding();
      } catch (err) {
        await service.recordError(`Apertura dell'informativa: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
```

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/unit/core/router.test.ts`
Expected: PASS.

- [ ] **Step 5: Cablaggio nel background**

In `src/entrypoints/background.ts`:

Import (aggiungi accanto agli esistenti):

```ts
import { actionBadge } from '@/core/action-badge';
import { warnedPortals } from '@/core/diagnostics';
import { needsOnboarding } from '@/core/onboarding';
import { LEADS_CHANGED, ONBOARDING_CHANGED, type Request } from '@/shared/messages';
```

(sostituisce l'import esistente da `@/shared/messages`).

Sostituisci la costante `hooks` con:

```ts
  /** Un solo punto decide il segnale sull'icona: conferma mancante prima dell'avviso dei portali. */
  async function refreshActionBadge(): Promise<void> {
    const [status, diag] = await Promise.all([service.onboardingStatus(), service.getDiagnostics(version)]);
    const badge = actionBadge({
      onboarding: needsOnboarding(status.acceptedVersion, status.current),
      warning: warnedPortals(diag.adapterWarning).length > 0,
    });
    await browser.action.setBadgeText({ text: badge.text });
    if (badge.color) await browser.action.setBadgeBackgroundColor({ color: badge.color });
    await browser.action.setTitle({ title: badge.title });
  }
  const updateBadge = () => void refreshActionBadge().catch(() => {});

  async function openOnboarding(): Promise<void> {
    await browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
  }

  const hooks: RouterHooks = {
    // L'avviso è già salvato nel diagnostico: il segnale si ricalcola da lì.
    setWarning: () => updateBadge(),
    leadsChanged() {
      browser.runtime.sendMessage({ type: LEADS_CHANGED }).catch(() => {});
    },
    onboardingChanged() {
      browser.runtime.sendMessage({ type: ONBOARDING_CHANGED }).catch(() => {});
      updateBadge();
    },
    openOnboarding,
  };
```

Nel listener `browser.runtime.onMessage`, estendi il filtro iniziale:

```ts
    if (typeof type !== 'string' || type === LEADS_CHANGED || type === ONBOARDING_CHANGED || isOffscreenRequest(msg)) return false;
```

Subito dopo il listener `browser.downloads.onChanged` (registrato al livello principale), aggiungi:

```ts
  // Prima installazione: scheda di benvenuto. Aggiornamento: solo se l'informativa va riconfermata.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void (async () => {
      const status = await service.onboardingStatus();
      if (reason === 'install' || (reason === 'update' && needsOnboarding(status.acceptedVersion, status.current))) await openOnboarding();
    })().catch((err: unknown) =>
      service.recordError(`Apertura dell'informativa: ${err instanceof Error ? err.message : String(err)}`).catch(() => {}),
    );
  });
  updateBadge();
```

- [ ] **Step 6: Verifica**

Run: `npm run typecheck && npm test`
Expected: typecheck pulito, tutti gli unit test PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/router.ts src/entrypoints/background.ts tests/unit/core/router.test.ts
git commit -m "feat(background): nessuna lettura dai portali senza conferma; scheda all'installazione e segnale sull'icona"
```

---

### Task 5: Content script: stato del portale e avviso

**Files:**
- Modify: `src/shared/messages.ts` (`isPortalEnabled` → `portalState`)
- Modify: `src/content/banner.ts`
- Modify: `src/content/controller.ts`
- Modify: `src/content/payload-script.ts`, `src/entrypoints/idealista.content.ts`
- Modify: `tests/unit/content/controller.test.ts` (due test esistenti)
- Test: `tests/unit/content/banner.test.ts`, nuovi test in `tests/unit/content/controller.test.ts`

**Interfaces:**
- Consumes: `PortalState` (Task 1), richiesta `getPortalState`/`openOnboarding` (Task 3), router (Task 4).
- Produces:
  - `portalState(portal: Portal): Promise<PortalState>` in `src/shared/messages.ts`
  - `showBanner(doc, text, action?: BannerAction)`, `removeBanner(doc)`, `showOnboardingBanner(doc, open: () => Promise<unknown>)`, `ONBOARDING_TEXT`, `RELOAD_AFTER_ONBOARDING_TEXT`
  - `ControllerDeps.portalState?: () => Promise<PortalState>`, `ControllerDeps.onOnboardingNeeded?: () => void`

- [ ] **Step 1: Test del banner**

`tests/unit/content/banner.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BANNER_ID, ONBOARDING_TEXT, RELOAD_AFTER_ONBOARDING_TEXT, removeBanner, showBanner, showOnboardingBanner } from '@/content/banner';

const banner = () => document.getElementById(BANNER_ID);
const buttons = () => [...banner()!.querySelectorAll('button')].map((b) => b.textContent);

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('banner', () => {
  it('senza azione mostra "Ricarica"', () => {
    showBanner(document, 'testo');
    expect(banner()!.textContent).toContain('testo');
    expect(buttons()).toEqual(['Ricarica', '✕']);
  });

  it('con azione mostra il suo pulsante e la esegue', () => {
    const onClick = vi.fn();
    showBanner(document, 'testo', { label: 'Apri', onClick });
    expect(buttons()).toEqual(['Apri', '✕']);
    banner()!.querySelector('button')!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('removeBanner lo toglie', () => {
    showBanner(document, 'testo');
    removeBanner(document);
    expect(banner()).toBeNull();
  });

  it('avviso dell\'informativa: "Apri" chiede la scheda e poi invita a ricaricare', () => {
    const open = vi.fn(async () => null);
    showOnboardingBanner(document, open);
    expect(banner()!.textContent).toContain(ONBOARDING_TEXT);
    banner()!.querySelector('button')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(banner()!.textContent).toContain(RELOAD_AFTER_ONBOARDING_TEXT);
    expect(buttons()).toEqual(['Ricarica', '✕']);
  });

  it('se la scheda non si apre l\'avviso cambia comunque, senza eccezioni', async () => {
    showOnboardingBanner(document, vi.fn(async () => { throw new Error('boom'); }));
    banner()!.querySelector('button')!.click();
    await Promise.resolve();
    expect(banner()!.textContent).toContain(RELOAD_AFTER_ONBOARDING_TEXT);
  });
});
```

- [ ] **Step 2: Adegua i test del controller e scrivi i nuovi**

In `tests/unit/content/controller.test.ts`:

1. Nel test "su un portale spento non legge nulla…" sostituisci `isPortalEnabled: async () => on` con `portalState: async () => (on ? 'active' : 'off')`.
2. Nel test "su Idealista spento non legge le card" sostituisci `isPortalEnabled: async () => false` con `portalState: async () => 'off'`.
3. Aggiungi dopo il test "su Idealista spento non legge le card":

```ts
  it('senza conferma dell\'informativa non legge, toglie i badge e chiede l\'avviso una volta sola', async () => {
    const send = fakeSend();
    let state: 'active' | 'onboarding' = 'active';
    const onOnboardingNeeded = vi.fn();
    const c = createController({
      adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL, portalState: async () => state, onOnboardingNeeded,
    });
    const payload = searchNextData([searchResult(realEstate())]);
    await c.handle('next-data', SEARCH_URL, payload);
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    state = 'onboarding';
    send.mockClear();
    await c.handle('next-data', SEARCH_URL, payload);
    await c.handle('next-data', SEARCH_URL, payload);
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
    expect(onOnboardingNeeded).toHaveBeenCalledTimes(1);
    expect(await c.isEnabled()).toBe(false);
  });

  it('su Idealista, dopo la conferma, legge alla scansione successiva senza ricaricare', async () => {
    document.body.innerHTML = searchBody([idealistaCard({ id: 1 })]);
    const send = fakeSend();
    let state: 'active' | 'onboarding' = 'onboarding';
    const c = createController({ adapter: idealistaAdapter, send, root: document, getUrl: () => NEWEST_URL, portalState: async () => state });
    await c.scan();
    expect(send).not.toHaveBeenCalled();
    state = 'active';
    await c.scan();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingest' }));
  });

  it('se lo stato del portale non si legge non legge nulla', async () => {
    const send = fakeSend();
    const c = createController({
      adapter: immobiliareAdapter, send, root: document, getUrl: () => SEARCH_URL,
      portalState: async () => { throw new Error('Nessuna risposta dal background'); },
    });
    await expect(c.handle('next-data', SEARCH_URL, searchNextData([searchResult(realEstate())]))).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(0);
  });
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/content`
Expected: FAIL (export del banner mancanti, `portalState` sconosciuto al controller).

- [ ] **Step 4: Implementa**

`src/shared/messages.ts`: sostituisci la funzione `isPortalEnabled` con

```ts
/** Per i content script: leggere (attivo), no (spento) o no e avvisare (informativa da confermare). */
export function portalState(portal: Portal): Promise<PortalState> {
  return send<PortalState>({ type: 'getPortalState', portal });
}
```

e aggiungi `PortalState` all'import dei tipi da `@/shared/types` (`Settings` resta, serve a `saveSettings`).

`src/content/banner.ts`: sotto `FALLBACK_TEXT` aggiungi

```ts
export const ONBOARDING_TEXT = "HomeRadar non è ancora attivo: leggi e conferma l'informativa per iniziare";
export const RELOAD_AFTER_ONBOARDING_TEXT = 'HomeRadar: dopo aver confermato, ricarica la pagina';

export interface BannerAction {
  label: string;
  onClick(): void;
}
```

cambia la firma in `export function showBanner(doc: Document, text: string, action?: BannerAction): void` e sostituisci le due righe del pulsante `reload` con:

```ts
  const act = button(doc, action?.label ?? 'Ricarica', { background: '#fff', color: BRAND_COLOR, fontWeight: '600', padding: '5px 12px' });
  act.addEventListener('click', () => (action ? action.onClick() : doc.defaultView?.location.reload()));
```

e nell'`el.append(...)` sostituisci `reload` con `act`. In fondo al file:

```ts
export function removeBanner(doc: Document): void {
  doc.getElementById(BANNER_ID)?.remove();
}

/**
 * Avviso finché l'informativa non è confermata. "Apri" chiede al background la scheda di benvenuto:
 * i dati della pagina già caricata non tornano, quindi dopo la conferma serve ricaricare.
 */
export function showOnboardingBanner(doc: Document, open: () => Promise<unknown>): void {
  showBanner(doc, ONBOARDING_TEXT, {
    label: 'Apri',
    onClick() {
      open().catch(() => {});
      removeBanner(doc);
      showBanner(doc, RELOAD_AFTER_ONBOARDING_TEXT);
    },
  });
}
```

`src/content/controller.ts`: importa `PortalState` dai tipi; in `ControllerDeps` sostituisci `isPortalEnabled?` (e il suo commento) con

```ts
  /**
   * Stato del portale, chiesto a ogni lettura: così interruttore e conferma dell'informativa valgono subito
   * anche sulle schede già aperte. Predefinito: attivo (il background scarta comunque i dati).
   */
  portalState?: () => Promise<PortalState>;
  /** Informativa da confermare: chiamata al massimo una volta per pagina (avviso sul portale). */
  onOnboardingNeeded?: () => void;
```

nella firma di `createController` sostituisci `isPortalEnabled = async () => true` con `portalState = async () => 'active', onOnboardingNeeded`; aggiungi `let onboardingNotified = false;` dopo `let scannedUrl…` e sostituisci `isEnabled` con

```ts
  /** Solo un portale attivo si legge; altrimenti via i badge già mostrati. */
  async function isEnabled(): Promise<boolean> {
    const state = await portalState();
    if (state !== 'active' && evaluations.size) {
      evaluations.clear();
      removeBadges(root);
    }
    if (state === 'onboarding' && !onboardingNotified) {
      onboardingNotified = true;
      onOnboardingNeeded?.();
    }
    return state === 'active';
  }
```

`src/content/payload-script.ts`: import `import { FALLBACK_TEXT, showBanner, showOnboardingBanner } from '@/content/banner';` e `import { portalState, send } from '@/shared/messages';`; nel `createController`:

```ts
  const controller = createController({
    adapter, send, root: document, getUrl: () => location.href,
    portalState: () => portalState(adapter.portal),
    onOnboardingNeeded: () => showOnboardingBanner(document, () => send({ type: 'openOnboarding' })),
  });
```

e aggiorna il commento in `onMissing` da "Su un portale spento i dati non si leggono apposta: nessun banner." a "Su un portale spento o in attesa dell'informativa i dati non si leggono apposta: nessun banner.".

`src/entrypoints/idealista.content.ts`: import `import { showOnboardingBanner } from '@/content/banner';` e `import { portalState, send } from '@/shared/messages';`; nel `createController`:

```ts
    const controller = createController({
      adapter: idealistaAdapter, send, root: document, getUrl: () => location.href,
      portalState: () => portalState('idealista'),
      onOnboardingNeeded: () => showOnboardingBanner(document, () => send({ type: 'openOnboarding' })),
    });
```

- [ ] **Step 5: Verifica**

Run: `npx vitest run tests/unit/content && npm run typecheck`
Expected: PASS; typecheck pulito (nessun riferimento residuo a `isPortalEnabled`: verifica con `grep -rn isPortalEnabled src tests`, nessun risultato).

- [ ] **Step 6: Commit**

```bash
git add src/shared/messages.ts src/content src/entrypoints/idealista.content.ts tests/unit/content
git commit -m "feat(content): stato del portale con informativa da confermare e avviso con \"Apri\""
```

---

### Task 6: Pannello laterale e impostazioni

**Files:**
- Modify: `src/ui/sidepanel/App.tsx`
- Modify: `src/ui/sidepanel/SettingsView.tsx`
- Test: `tests/unit/ui/sidepanel.test.tsx` (nuovo `describe`)

**Interfaces:**
- Consumes: `Onboarding` (Task 3), `Api.getOnboardingStatus/onOnboardingChanged` (Task 3), `needsOnboarding` (Task 1).
- Produces: `SettingsView` accetta `onOpenGuide?: () => void`.

- [ ] **Step 1: Scrivi i test**

In fondo a `tests/unit/ui/sidepanel.test.tsx`:

```tsx
describe('App: informativa', () => {
  const never = { acceptedVersion: null, acceptedAt: null, current: 1 };

  it('senza conferma mostra l\'informativa al posto della lista e nasconde le impostazioni', async () => {
    const api = fakeApi([lead(1, 'high')]);
    vi.mocked(api.getOnboardingStatus).mockResolvedValue(never);
    render(<App api={api} />);
    expect(await screen.findByRole('button', { name: 'Ho capito, inizia' })).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Impostazioni' })).toBeNull();
  });

  it('confermando nel pannello passa alla lista', async () => {
    const api = fakeApi([lead(1, 'high')]);
    // Due letture "mai confermata": quella del pannello e quella della schermata; poi confermata.
    vi.mocked(api.getOnboardingStatus).mockResolvedValueOnce(never).mockResolvedValueOnce(never);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText('Bilocale 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Impostazioni' })).toBeTruthy();
  });

  it('passa alla lista quando la conferma arriva dalla scheda di benvenuto', async () => {
    const api = fakeApi([lead(1, 'high')]);
    let notify = () => {};
    vi.mocked(api.onOnboardingChanged).mockImplementation((cb) => {
      notify = cb;
      return () => {};
    });
    vi.mocked(api.getOnboardingStatus).mockResolvedValueOnce(never).mockResolvedValueOnce(never);
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Ho capito, inizia' });
    notify();
    expect(await screen.findByText('Bilocale 1')).toBeTruthy();
  });

  it('se lo stato non si legge mostra l\'errore e "Riprova", mai la lista', async () => {
    const api = fakeApi([lead(1, 'high')]);
    vi.mocked(api.getOnboardingStatus).mockRejectedValueOnce(new Error('Nessuna risposta dal background'));
    render(<App api={api} />);
    expect(await screen.findByText('Errore: Nessuna risposta dal background')).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Bilocale 1')).toBeTruthy();
  });

  it('dalle impostazioni si rivede l\'informativa in sola lettura e si torna indietro', async () => {
    const api = fakeApi([lead(1, 'high')]);
    vi.mocked(api.getOnboardingStatus).mockResolvedValue({ acceptedVersion: 1, acceptedAt: Date.UTC(2026, 9, 15), current: 1 });
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    fireEvent.click(screen.getByRole('button', { name: 'Impostazioni' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rivedi informativa' }));
    expect(await screen.findByText('Confermata il 15/10/2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ho capito, inizia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(await screen.findByRole('button', { name: 'Rivedi informativa' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL nei 5 test nuovi.

- [ ] **Step 3: Implementa `App`**

In `src/ui/sidepanel/App.tsx`:

Import:

```ts
import { needsOnboarding } from '@/core/onboarding';
import { Onboarding } from '@/ui/onboarding/Onboarding';
```

Sostituisci `const [view, setView] = useState<'leads' | 'settings'>('leads');` con

```ts
  const [view, setView] = useState<'leads' | 'settings' | 'guide'>('leads');
  /** Conferma dell'informativa: finché non è 'ok' la lista non si mostra. */
  const [gate, setGate] = useState<'loading' | 'needed' | 'ok' | { error: string }>('loading');
```

Dopo l'`useEffect` che chiama `refresh()`:

```ts
  const checkGate = useCallback(async () => {
    try {
      const s = await api.getOnboardingStatus();
      setGate(needsOnboarding(s.acceptedVersion, s.current) ? 'needed' : 'ok');
    } catch (e) {
      setGate({ error: errorText(e) });
    }
  }, [api]);

  useEffect(() => {
    void checkGate();
    // La conferma può arrivare dalla scheda di benvenuto mentre il pannello è aperto.
    return api.onOnboardingChanged(() => void checkGate());
  }, [api, checkGate]);
```

Nel `return`:

- sottotitolo: sostituisci `{view === 'leads' ? 'Lead da privati' : 'Impostazioni'}` con
  `{gate !== 'ok' ? 'Benvenuto' : { leads: 'Lead da privati', settings: 'Impostazioni', guide: 'Informativa' }[view]}`;
- pulsante dell'intestazione: racchiudi l'intero ternario `view === 'leads' ? (<button …Impostazioni…>) : (<button …Torna ai lead…>)` in `{gate === 'ok' && (…)}`;
- corpo: tutto ciò che segue `</header>` fino a `</main>` (avvisi, errore, viste) va in

```tsx
      {gate !== 'ok' ? (
        gate === 'loading' ? (
          <p className="settings__loading">Caricamento…</p>
        ) : gate === 'needed' ? (
          <Onboarding api={api} mode="confirm" onDone={() => void checkGate()} />
        ) : (
          <div className="onboarding">
            <p className="banner banner--error">
              <AlertIcon />
              <span>{gate.error}</span>
            </p>
            <button type="button" className="btn" onClick={() => void checkGate()}>Riprova</button>
          </div>
        )
      ) : (
        <>
          {/* qui il contenuto esistente: avviso dei portali, errore, viste */}
        </>
      )}
```

  dove il commento va sostituito con il contenuto esistente invariato, salvo il ternario delle viste, che diventa:

```tsx
          {view === 'settings' ? (
            <SettingsView api={api} onSaved={() => void refresh()} onOpenGuide={() => setView('guide')} />
          ) : view === 'guide' ? (
            <Onboarding api={api} mode="review" onDone={() => setView('settings')} />
          ) : (
            <>
              {/* lista dei lead esistente, invariata */}
            </>
          )}
```

  (anche qui il commento sta per il frammento esistente della lista, da lasciare com'è).

- [ ] **Step 4: Implementa `SettingsView`**

In `src/ui/sidepanel/SettingsView.tsx` cambia la firma:

```tsx
export function SettingsView({ api, onSaved, download = downloadBlob, onOpenGuide }: {
  api: Api;
  onSaved(): void;
  download?: (b: Blob, name: string) => void;
  /** Apre l'informativa in sola lettura. */
  onOpenGuide?: () => void;
}) {
```

e subito prima di `<div className="card">` con `<h2 className="card__title">Assistenza</h2>`:

```tsx
      <div className="card">
        <h2 className="card__title">Informativa e guida</h2>
        <p className="card__text">Cosa fa HomeRadar, cosa salva e come leggere i badge.</p>
        <div className="settings__row">
          <button type="button" className="btn" onClick={onOpenGuide}>Rivedi informativa</button>
        </div>
      </div>
```

- [ ] **Step 5: Verifica**

Run: `npx vitest run tests/unit/ui && npm run typecheck`
Expected: PASS; typecheck pulito.

- [ ] **Step 6: Commit**

```bash
git add src/ui/sidepanel/App.tsx src/ui/sidepanel/SettingsView.tsx tests/unit/ui/sidepanel.test.tsx
git commit -m "feat(sidepanel): informativa al posto della lista finché manca la conferma; \"Rivedi informativa\""
```

---

### Task 7: E2E, smoke test e documentazione

**Files:**
- Modify: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/onboarding.spec.ts`
- Modify: `docs/smoke-test.md`, `CLAUDE.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: tutto il resto (build completa).
- Produces: opzione Playwright `onboarded` (predefinita `true`), funzione `onboardingPage(context)`.

- [ ] **Step 1: Fixture**

`tests/e2e/fixtures.ts` diventa:

```ts
import path from 'node:path';
import { chromium, expect as baseExpect, test as base, type BrowserContext, type Page } from '@playwright/test';

/** La scheda di benvenuto, aperta dal background all'installazione. */
export async function onboardingPage(context: BrowserContext): Promise<Page> {
  const find = () => context.pages().find((p) => p.url().endsWith('/onboarding.html'));
  await baseExpect.poll(() => Boolean(find()), { timeout: 10_000 }).toBe(true);
  return find()!;
}

export const test = base.extend<{ onboarded: boolean; context: BrowserContext; extensionId: string }>({
  // Di default l'informativa è confermata: i test sull'onboarding la lasciano da confermare.
  onboarded: [true, { option: true }],
  context: async ({ onboarded }, use) => {
    const ext = path.resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      acceptDownloads: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    if (onboarded) {
      const welcome = await onboardingPage(context);
      await welcome.getByRole('button', { name: 'Ho capito, inizia' }).click();
      await welcome.getByText('HomeRadar è attivo').waitFor();
      await welcome.close();
    }
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(worker.url().split('/')[2]!);
  },
});

export const expect = test.expect;
```

- [ ] **Step 2: Test e2e dell'onboarding**

`tests/e2e/onboarding.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { expect, onboardingPage, test } from './fixtures';
import { buildSearchHtml } from './fixture-page';

const nextData = JSON.parse(readFileSync('tests/fixtures/immobiliare/search-privati.json', 'utf8'));
const apiText = readFileSync('tests/fixtures/immobiliare/api-listings.json', 'utf8');
const SEARCH = 'https://www.immobiliare.it/vendita-case/milano/da-privati/';

test.use({ onboarded: false });

test.beforeEach(async ({ context }) => {
  await context.route(/^https?:\/\/(?!www\.immobiliare\.it\/)/, (route) => route.abort());
  await context.route('https://www.immobiliare.it/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/api-next/search-list/listings/')) return route.fulfill({ contentType: 'application/json', body: apiText });
    if (pathname.startsWith('/vendita-case/')) return route.fulfill({ contentType: 'text/html', body: buildSearchHtml(nextData) });
    return route.fulfill({ status: 404, body: '' });
  });
});

test("all'installazione si apre l'informativa; prima della conferma nessun badge, dopo sì", async ({ context }) => {
  const welcome = await onboardingPage(context);
  await expect(welcome.getByRole('heading', { name: 'Benvenuto in HomeRadar' })).toBeVisible();
  const page = await context.newPage();
  await page.goto(SEARCH);
  await expect(page.locator('#homeradar-banner')).toContainText('HomeRadar non è ancora attivo');
  await expect(page.locator('[data-homeradar-badge]')).toHaveCount(0);
  await welcome.getByRole('button', { name: 'Ho capito, inizia' }).click();
  await expect(welcome.getByText('HomeRadar è attivo')).toBeVisible();
  // I dati della pagina già caricata non tornano: la pagina successiva sì.
  await page.click('#next');
  await expect(page.locator('[data-homeradar-badge]').first()).toBeVisible();
});

test('"Apri" nell\'avviso riapre l\'informativa e invita a ricaricare', async ({ context }) => {
  await (await onboardingPage(context)).close();
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('#homeradar-banner').getByRole('button', { name: 'Apri' }).click();
  await onboardingPage(context);
  await expect(page.locator('#homeradar-banner')).toContainText('dopo aver confermato, ricarica la pagina');
});
```

- [ ] **Step 3: Esegui gli e2e**

Run: `npm run test:e2e`
Expected: 13 test PASS (gli 11 esistenti, che ora confermano l'informativa nella fixture, più i 2 nuovi).

- [ ] **Step 4: Smoke test, CLAUDE.md, roadmap**

In `docs/smoke-test.md`, prima della riga finale "Se il sito è cambiato: …", aggiungi:

```markdown
## Onboarding e informativa

31. Installa la build su un profilo Chrome nuovo.
    - [ ] Si apre da sola la scheda "Benvenuto in HomeRadar"; la legenda mostra le soglie delle impostazioni (120 giorni di default).
    - [ ] L'icona dell'estensione ha un pallino; passandoci sopra: "HomeRadar: conferma l'informativa per iniziare".
32. Chiudi la scheda senza confermare e apri una ricerca su Immobiliare.it.
    - [ ] Nessun badge; compare l'avviso "HomeRadar non è ancora attivo…" con "Apri".
    - [ ] Il pannello laterale mostra l'informativa, senza lista e senza pulsante Impostazioni.
33. Premi "Apri" nell'avviso.
    - [ ] Si apre la scheda di benvenuto; l'avviso diventa "dopo aver confermato, ricarica la pagina".
34. Premi "Ho capito, inizia" nella scheda.
    - [ ] La scheda dice "HomeRadar è attivo"; il pannello, se aperto, passa da solo alla lista; il pallino sull'icona sparisce.
    - [ ] Ricaricando la ricerca compaiono i badge. Su Idealista compaiono anche senza ricaricare, scorrendo i risultati.
35. Impostazioni → "Rivedi informativa".
    - [ ] Stessa schermata in sola lettura, con "Confermata il" e la data di oggi; "Chiudi" torna alle impostazioni.
```

In `CLAUDE.md`, dopo il punto sui portali attivi (`- Portali attivi: …`), aggiungi:

```markdown
- Informativa: `src/core/onboarding.ts` (`ONBOARDING_VERSION`), conferma in `meta.onboarding` (fuori dal backup). Finché manca, il router scarta `ingest`/`parseStatus` e `getPortalState` risponde `'onboarding'` (i content script mostrano l'avviso). Schermata in `src/ui/onboarding/`, montata nella pagina `src/entrypoints/onboarding/` (aperta all'installazione) e nel pannello. Se un punto nuovo cambia cosa viene salvato o come viene usato, aggiorna il testo, alza `ONBOARDING_VERSION` e aggiungi la voce in `ONBOARDING_CHANGES`.
```

e nella riga del flusso Immobiliare/Subito non serve altro. In `docs/roadmap.md` cambia la riga del punto 2 in:

```markdown
| 2 | Onboarding e informativa privacy | in revisione | |
```

- [ ] **Step 5: Verifica finale**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: tutto verde.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e docs/smoke-test.md CLAUDE.md docs/roadmap.md
git commit -m "test(e2e): informativa all'installazione e avviso sul portale; smoke test e documentazione"
```
