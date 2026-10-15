# Ricerca e filtri nel pannello — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nel pannello laterale aggiungere ricerca a testo libero (titolo, indirizzo, città, zona, tipologia), fascia di prezzo in k€ e "Azzera filtri", combinati con badge, sito, ordinamento, "Elimina tutti" ed export.

**Architecture:** La logica sta in un modulo puro `src/core/lead-filters.ts` (normalizzazione, confronto testo, parsing dei k€, fascia di prezzo, descrizione per il tag). `App.tsx` applica la query all'intera lista prima di raggruppare per scheda, così conteggi delle schede, chip, lista, "Elimina tutti" ed export seguono i nuovi filtri. Nessun cambio a Dexie, background o messaggi.

**Tech Stack:** TypeScript, React 18, Vitest + Testing Library (jsdom), CSS semplice in `src/ui/sidepanel/styles.css`.

**Spec:** `docs/superpowers/specs/2026-10-15-ricerca-filtri-design.md`

## Global Constraints

- Nessun cambio allo schema Dexie, al background o ai messaggi: si filtra nel pannello sulla lista di `api.listLeads()`.
- Nessun dato nuovo salvato: l'informativa non cambia, `ONBOARDING_VERSION` resta uguale.
- Filtri solo nello stato React: nessun `localStorage` (l'ordinamento per scheda resta com'è).
- Testi dell'interfaccia in italiano, esattamente: placeholder `Cerca titolo, indirizzo, zona…`; `aria-label` `Cerca nei lead`, `Svuota ricerca`, `Prezzo minimo in migliaia di euro`, `Prezzo massimo in migliaia di euro`; pulsante `Azzera filtri`; suggerimento export `Esporta la vista corrente (N)`.
- Tag dei filtri: badge, siti, poi `"<testo>"` e `150–250 k€` / `da 150 k€` / `fino a 250 k€` (trattino lungo `–`, decimali con virgola), separati da `, ` dentro `«…»`.
- Molti file del repo sono CRLF: modificare con lo strumento Edit, non con `sed`. Messaggi di commit con heredoc in Bash.

## Review Focus

- Conferma di "Elimina tutti" aperta e poi l'agente modifica la ricerca senza che cambi il numero di visibili: la conferma deve annullarsi (altrimenti si eliminerebbe un insieme diverso da quello letto). Test in Task 2.
- Prezzo minimo `0`: è un estremo valido (esclude i lead senza prezzo), non va trattato come "vuoto". Test in Task 1 e Task 2.
- Ricerca di soli spazi o simboli (`"   "`, `"-"`): nessun filtro, nessun tag, nessun "Azzera filtri". Test in Task 1 e Task 2.
- La lista si aggiorna (nuovi lead dal portale, `onLeadsChanged`) mentre un filtro è attivo: i filtri restano e si applicano ai dati nuovi. Test in Task 2.
- Un filtro esclude tutti i lead della scheda aperta ma non di altre: messaggio "Nessun lead «…» in questa scheda." e conteggi delle schede che mostrano dove sono. Test in Task 2.

---

### Task 1: Modulo `lead-filters`

**Files:**
- Create: `src/core/lead-filters.ts`
- Test: `tests/unit/core/lead-filters.test.ts`

**Interfaces:**
- Consumes: `LeadView` da `@/shared/types` (campi usati: `listing.title`, `listing.address`, `listing.city`, `listing.zone`, `listing.typology`, `listing.currentPrice`).
- Produces:
  - `interface LeadQuery { text: string; minPrice: number | null; maxPrice: number | null }` (prezzi in euro)
  - `const EMPTY_QUERY: LeadQuery`
  - `normalize(s: string): string`
  - `matchesText(lead: LeadView, text: string): boolean`
  - `parseThousands(input: string): number | null | 'invalid'`
  - `inPriceRange(lead: LeadView, min: number | null, max: number | null): boolean`
  - `applyQuery(leads: LeadView[], q: LeadQuery): LeadView[]`
  - `isEmptyQuery(q: LeadQuery): boolean`
  - `describeQuery(q: LeadQuery): string[]`

- [ ] **Step 1: Scrivi i test che falliscono**

`tests/unit/core/lead-filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyQuery, describeQuery, EMPTY_QUERY, inPriceRange, isEmptyQuery, matchesText, normalize, parseThousands } from '@/core/lead-filters';
import type { LeadView } from '@/shared/types';

type ListingFields = Partial<Pick<LeadView['listing'], 'title' | 'address' | 'city' | 'zone' | 'typology' | 'currentPrice'>>;

function lead(key: string, f: ListingFields = {}): LeadView {
  return {
    listing: { key, title: '', address: null, city: null, zone: null, typology: null, currentPrice: null, ...f } as LeadView['listing'],
    evaluation: { listingKey: key } as LeadView['evaluation'],
    state: { listingKey: key, status: 'new', notes: '', statusChangedAt: 0, updatedAt: 0 },
    prices: [],
  };
}
const keys = (ls: LeadView[]) => ls.map((l) => l.listing.key);

describe('normalize', () => {
  it('toglie accenti, maiuscole, punteggiatura e spazi doppi', () => {
    expect(normalize('  Città  ALTA ')).toBe('citta alta');
    expect(normalize("Sant'Ambrogio")).toBe('sant ambrogio');
    expect(normalize('Via Roma, 12/A')).toBe('via roma 12 a');
    expect(normalize(' - ')).toBe('');
  });
});

describe('matchesText', () => {
  const l = lead('a', { title: 'Trilocale luminoso', address: 'Via Città di Castello 3', city: 'Bologna', zone: 'Navile', typology: 'Appartamento' });

  it('con query vuota o di soli simboli passa tutto', () => {
    expect(matchesText(l, '')).toBe(true);
    expect(matchesText(l, '   ')).toBe(true);
    expect(matchesText(l, '-')).toBe(true);
  });
  it('ogni parola deve comparire in almeno un campo, anche in campi diversi', () => {
    expect(matchesText(l, 'bologna navile')).toBe(true);
    expect(matchesText(l, 'BOLOGNA trilo')).toBe(true);
    expect(matchesText(l, 'bologna milano')).toBe(false);
  });
  it('ignora accenti e apostrofi in entrambe le direzioni', () => {
    expect(matchesText(l, 'citta')).toBe(true);
    expect(matchesText(lead('b', { zone: "Sant'Ambrogio" }), 'sant ambrogio')).toBe(true);
    expect(matchesText(lead('c', { zone: 'Sant Ambrogio' }), "sant'ambrogio")).toBe(true);
  });
  it('cerca anche nella tipologia e ignora i campi null', () => {
    expect(matchesText(l, 'appartamento')).toBe(true);
    expect(matchesText(lead('d', { title: 'Villa' }), 'villa')).toBe(true);
    expect(matchesText(lead('e'), 'villa')).toBe(false);
  });
});

describe('parseThousands', () => {
  it('legge migliaia di euro con virgola o punto', () => {
    expect(parseThousands('150')).toBe(150000);
    expect(parseThousands(' 150,5 ')).toBe(150500);
    expect(parseThousands('150.5')).toBe(150500);
    expect(parseThousands('0')).toBe(0);
  });
  it('vuoto è null, il resto è invalid', () => {
    expect(parseThousands('')).toBeNull();
    expect(parseThousands('  ')).toBeNull();
    expect(parseThousands('-5')).toBe('invalid');
    expect(parseThousands('abc')).toBe('invalid');
    expect(parseThousands('1,5,0')).toBe('invalid');
    expect(parseThousands('150k')).toBe('invalid');
  });
});

describe('inPriceRange', () => {
  const p = (n: number | null) => lead('x', { currentPrice: n });

  it('senza estremi passa tutto, anche senza prezzo', () => {
    expect(inPriceRange(p(null), null, null)).toBe(true);
    expect(inPriceRange(p(5), null, null)).toBe(true);
  });
  it('con un estremo esclude i lead senza prezzo, anche con minimo 0', () => {
    expect(inPriceRange(p(null), 0, null)).toBe(false);
    expect(inPriceRange(p(0), 0, null)).toBe(true);
    expect(inPriceRange(p(null), null, 250000)).toBe(false);
  });
  it('estremi inclusi, con un solo estremo o con entrambi', () => {
    expect(inPriceRange(p(150000), 150000, null)).toBe(true);
    expect(inPriceRange(p(149999), 150000, null)).toBe(false);
    expect(inPriceRange(p(250000), null, 250000)).toBe(true);
    expect(inPriceRange(p(250001), null, 250000)).toBe(false);
    expect(inPriceRange(p(200000), 150000, 250000)).toBe(true);
  });
  it('se min > max li scambia', () => {
    expect(inPriceRange(p(200000), 250000, 150000)).toBe(true);
    expect(inPriceRange(p(300000), 250000, 150000)).toBe(false);
  });
});

describe('applyQuery, isEmptyQuery, describeQuery', () => {
  const leads = [
    lead('a', { zone: 'Navile', currentPrice: 200000 }),
    lead('b', { zone: 'Navile', currentPrice: 400000 }),
    lead('c', { zone: 'Centro', currentPrice: 200000 }),
    lead('d', { zone: 'Navile', currentPrice: null }),
  ];

  it('combina testo e prezzo', () => {
    expect(keys(applyQuery(leads, EMPTY_QUERY))).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(applyQuery(leads, { text: 'navile', minPrice: null, maxPrice: null }))).toEqual(['a', 'b', 'd']);
    expect(keys(applyQuery(leads, { text: 'navile', minPrice: null, maxPrice: 250000 }))).toEqual(['a']);
  });
  it('una query di soli spazi è vuota', () => {
    expect(isEmptyQuery(EMPTY_QUERY)).toBe(true);
    expect(isEmptyQuery({ text: '  ', minPrice: null, maxPrice: null })).toBe(true);
    expect(isEmptyQuery({ text: '', minPrice: 0, maxPrice: null })).toBe(false);
    expect(isEmptyQuery({ text: 'x', minPrice: null, maxPrice: null })).toBe(false);
  });
  it('descrive testo e fascia per il tag', () => {
    expect(describeQuery(EMPTY_QUERY)).toEqual([]);
    expect(describeQuery({ text: '  ', minPrice: null, maxPrice: null })).toEqual([]);
    expect(describeQuery({ text: ' Navile ', minPrice: 150000, maxPrice: 250000 })).toEqual(['"Navile"', '150–250 k€']);
    expect(describeQuery({ text: '', minPrice: 150500, maxPrice: null })).toEqual(['da 150,5 k€']);
    expect(describeQuery({ text: '', minPrice: 0, maxPrice: null })).toEqual(['da 0 k€']);
    expect(describeQuery({ text: '', minPrice: null, maxPrice: 250000 })).toEqual(['fino a 250 k€']);
    expect(describeQuery({ text: '', minPrice: 250000, maxPrice: 150000 })).toEqual(['150–250 k€']);
  });
});
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/lead-filters.test.ts`
Expected: FAIL, il modulo `@/core/lead-filters` non esiste.

- [ ] **Step 3: Implementa il modulo**

`src/core/lead-filters.ts`:

```ts
import type { LeadView } from '@/shared/types';

/** Ricerca e fascia di prezzo del pannello. Prezzi in euro; `null` = nessun limite. */
export interface LeadQuery {
  text: string;
  minPrice: number | null;
  maxPrice: number | null;
}

export const EMPTY_QUERY: LeadQuery = { text: '', minPrice: null, maxPrice: null };

/** Minuscole, senza accenti; ogni carattere che non è lettera o cifra diventa spazio: "Sant'Ambrogio" → "sant ambrogio". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const words = (text: string): string[] => {
  const n = normalize(text);
  return n ? n.split(' ') : [];
};

/** Ogni parola della ricerca deve comparire in almeno uno dei campi testuali dell'annuncio. */
export function matchesText(lead: LeadView, text: string): boolean {
  const ws = words(text);
  if (!ws.length) return true;
  const { title, address, city, zone, typology } = lead.listing;
  const fields = [title, address, city, zone, typology].filter((f): f is string => f != null).map(normalize);
  return ws.every((w) => fields.some((f) => f.includes(w)));
}

/** Migliaia di euro scritte dall'agente ("150", "150,5") in euro. Vuoto = nessun limite. */
export function parseThousands(input: string): number | null | 'invalid' {
  const s = input.trim();
  if (!s) return null;
  if (!/^\d+(?:[.,]\d+)?$/.test(s)) return 'invalid';
  return Math.round(Number(s.replace(',', '.')) * 1000);
}

/** Estremi in ordine crescente: se l'agente scrive "da 250 a 150" vale come 150–250. */
function ordered(min: number | null, max: number | null): [number | null, number | null] {
  return min != null && max != null && min > max ? [max, min] : [min, max];
}

/** Estremi inclusi. Con almeno un estremo impostato, i lead senza prezzo restano fuori. */
export function inPriceRange(lead: LeadView, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  const price = lead.listing.currentPrice;
  if (price == null) return false;
  const [lo, hi] = ordered(min, max);
  return (lo == null || price >= lo) && (hi == null || price <= hi);
}

export function applyQuery(leads: LeadView[], q: LeadQuery): LeadView[] {
  return leads.filter((l) => matchesText(l, q.text) && inPriceRange(l, q.minPrice, q.maxPrice));
}

export function isEmptyQuery(q: LeadQuery): boolean {
  return words(q.text).length === 0 && q.minPrice == null && q.maxPrice == null;
}

const thousands = (euro: number) => String(euro / 1000).replace('.', ',');

/** Parti del tag dei filtri: `"navile"`, `150–250 k€`, `da 150 k€`, `fino a 250 k€`. */
export function describeQuery(q: LeadQuery): string[] {
  const parts: string[] = [];
  if (words(q.text).length) parts.push(`"${q.text.trim()}"`);
  const [lo, hi] = ordered(q.minPrice, q.maxPrice);
  if (lo != null && hi != null) parts.push(`${thousands(lo)}–${thousands(hi)} k€`);
  else if (lo != null) parts.push(`da ${thousands(lo)} k€`);
  else if (hi != null) parts.push(`fino a ${thousands(hi)} k€`);
  return parts;
}
```

- [ ] **Step 4: Verifica che passino**

Run: `npx vitest run tests/unit/core/lead-filters.test.ts`
Expected: PASS (tutti i test del file).

Run: `npm run typecheck`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/core/lead-filters.ts tests/unit/core/lead-filters.test.ts
git commit -F - <<'EOF'
feat(core): ricerca a testo e fascia di prezzo per i lead

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Ricerca, prezzo e "Azzera filtri" nel pannello

**Files:**
- Modify: `src/ui/sidepanel/App.tsx` (stato dei filtri, calcolo di `groups`/`filterTag`, effetto che annulla la conferma, JSX sotto le schede)
- Modify: `src/ui/sidepanel/Icons.tsx` (`SearchIcon` con `size`, nuova `CloseIcon`)
- Modify: `src/ui/sidepanel/ExportBar.tsx` (suggerimento con il numero di lead)
- Modify: `src/ui/sidepanel/styles.css` (righe ricerca e prezzo, campo non valido)
- Modify: `docs/smoke-test.md`, `CLAUDE.md`
- Test: `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes (Task 1): `LeadQuery`, `parseThousands`, `applyQuery`, `isEmptyQuery`, `describeQuery` da `@/core/lead-filters`.
- Produces: `SearchIcon({ size }: { size?: number })` (default 28, invariato per gli usi esistenti), `CloseIcon()`.

- [ ] **Step 1: Scrivi i test che falliscono**

In `tests/unit/ui/sidepanel.test.tsx`:

1. Cambia l'import di Testing Library in:

```ts
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
```

2. Dentro `describe('App', …)`, subito dopo `const withPrice = …`, aggiungi:

```ts
  const at = (l: LeadView, listing: Partial<LeadView['listing']>): LeadView => ({ ...l, listing: { ...l.listing, ...listing } });
```

3. In fondo a `describe('App', …)` (prima della sua `});` di chiusura) aggiungi:

```ts
  it('la ricerca filtra lista e conteggi delle schede, su più campi e senza accenti', async () => {
    const leads = [
      at(lead(1, 'high'), { zone: 'Navile' }),
      at(lead(2, 'high'), { city: 'Bologna', zone: 'Navile', typology: 'Trilocale' }),
      lead(3, 'high'),
      at(lead(4, 'high', 'contacted'), { address: 'Via Città di Castello 3' }),
    ];
    render(<App api={fakeApi(leads)} />);
    const search = await screen.findByLabelText('Cerca nei lead');
    fireEvent.change(search, { target: { value: 'navile' } });
    expect(screen.getByRole('tab', { name: 'Nuovi (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contattati (0)' })).toBeTruthy();
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2']);
    fireEvent.change(search, { target: { value: 'Bologna  NAVILE' } });
    expect(titles()).toEqual(['Bilocale 2']);
    fireEvent.change(search, { target: { value: 'trilocale' } });
    expect(titles()).toEqual(['Bilocale 2']);
    fireEvent.change(search, { target: { value: 'citta' } });
    expect(screen.getByRole('tab', { name: 'Nuovi (0)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contattati (1)' })).toBeTruthy();
    expect(screen.getByText('Nessun lead «"citta"» in questa scheda.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Svuota ricerca' }));
    expect(screen.getByRole('tab', { name: 'Nuovi (3)' })).toBeTruthy();
    expect((screen.getByLabelText('Cerca nei lead') as HTMLInputElement).value).toBe('');
  });

  it('la fascia di prezzo in k€ esclude i lead fuori fascia e senza prezzo; un valore non valido non filtra', async () => {
    const leads = [withPrice(lead(1, 'high'), 150000), withPrice(lead(2, 'high'), 250000), withPrice(lead(3, 'high'), 300000), at(lead(4, 'high'), { currentPrice: null })];
    render(<App api={fakeApi(leads)} />);
    const min = await screen.findByLabelText('Prezzo minimo in migliaia di euro');
    const max = screen.getByLabelText('Prezzo massimo in migliaia di euro');
    expect(titles()).toHaveLength(4);
    fireEvent.change(min, { target: { value: '0' } });
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2', 'Bilocale 3']);
    fireEvent.change(min, { target: { value: '150' } });
    fireEvent.change(max, { target: { value: '250' } });
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2']);
    expect(screen.getByText('Elimina tutti «150–250 k€» (2)')).toBeTruthy();
    fireEvent.change(max, { target: { value: 'abc' } });
    expect(max.getAttribute('aria-invalid')).toBe('true');
    expect(min.getAttribute('aria-invalid')).toBe('false');
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2', 'Bilocale 3']);
  });

  it('"Elimina tutti" riporta ricerca e prezzo, elimina solo i visibili e la conferma si annulla se cambia la ricerca', async () => {
    const api = fakeApi([
      at(withPrice(lead(1, 'high'), 200000), { zone: 'Navile' }),
      at(withPrice(lead(2, 'high'), 400000), { zone: 'Navile' }),
      withPrice(lead(3, 'high'), 200000),
    ]);
    render(<App api={api} />);
    fireEvent.change(await screen.findByLabelText('Cerca nei lead'), { target: { value: 'navile' } });
    fireEvent.change(screen.getByLabelText('Prezzo massimo in migliaia di euro'), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Elimina tutti «"navile", fino a 250 k€» (1)'));
    expect(screen.getByText(/^Conferma: elimina/)).toBeTruthy();
    // Stesso numero di visibili, ricerca diversa: la conferma non deve sopravvivere.
    fireEvent.change(screen.getByLabelText('Cerca nei lead'), { target: { value: 'navil' } });
    expect(screen.queryByText(/^Conferma: elimina/)).toBeNull();
    fireEvent.click(screen.getByText('Elimina tutti «"navil", fino a 250 k€» (1)'));
    fireEvent.click(screen.getByText('Conferma: elimina 1 annuncio «"navil", fino a 250 k€»'));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:1']);
  });

  it('"Azzera filtri" compare solo con un filtro attivo e riporta tutto allo stato iniziale', async () => {
    render(<App api={fakeApi([lead(1, 'high'), lead(2, 'medium')])} />);
    const search = await screen.findByLabelText('Cerca nei lead');
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
    fireEvent.change(search, { target: { value: '   ' } });
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
    expect(screen.getByText('Elimina tutti (2)')).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Prezzo minimo in migliaia di euro'), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Azzera filtri' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'bilocale' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Alta (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Immobiliare (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Azzera filtri' }));
    expect((screen.getByLabelText('Cerca nei lead') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Prezzo minimo in migliaia di euro') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('radio', { name: 'Tutti (2)' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tutti i siti' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
  });

  it('i filtri restano attivi quando la lista si aggiorna e l\'export indica la vista filtrata', async () => {
    let notify = () => {};
    const api = fakeApi([at(lead(1, 'high'), { zone: 'Navile' }), lead(2, 'high')]);
    api.onLeadsChanged = vi.fn((cb: () => void) => {
      notify = cb;
      return () => {};
    });
    render(<App api={api} />);
    fireEvent.change(await screen.findByLabelText('Cerca nei lead'), { target: { value: 'navile' } });
    await act(async () => notify());
    expect(titles()).toEqual(['Bilocale 1']);
    expect((screen.getByLabelText('Cerca nei lead') as HTMLInputElement).value).toBe('navile');
    expect(screen.getByText('Esporta la vista corrente (1)')).toBeTruthy();
  });
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL nei 5 test nuovi (nessun elemento con label "Cerca nei lead" / "Prezzo minimo…"); gli altri test passano.

- [ ] **Step 3: Icone**

In `src/ui/sidepanel/Icons.tsx` sostituisci `SearchIcon` e aggiungi `CloseIcon` subito dopo:

```tsx
export const SearchIcon = ({ size = 28 }: { size?: number }) => (
  <Icon size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </Icon>
);

export const CloseIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
```

- [ ] **Step 4: Suggerimento dell'export**

In `src/ui/sidepanel/ExportBar.tsx` sostituisci:

```tsx
      <span className="export__hint">Esporta la vista corrente</span>
```

con:

```tsx
      <span className="export__hint">{`Esporta la vista corrente (${leads.length})`}</span>
```

- [ ] **Step 5: Stato, calcoli e conferma in `App.tsx`**

5a. Import: aggiungi

```ts
import { applyQuery, describeQuery, isEmptyQuery, parseThousands, type LeadQuery } from '@/core/lead-filters';
```

e cambia l'import delle icone in:

```ts
import { AlertIcon, BackIcon, CloseIcon, Logo, SearchIcon, SettingsIcon } from './Icons';
```

5b. Dopo `const [sortByTab, setSortByTab] = useState<SortByTab>(loadSortByTab);` aggiungi:

```ts
  // Ricerca e prezzo valgono per tutte le schede e si azzerano alla chiusura del pannello, come badge e sito.
  const [text, setText] = useState('');
  const [minInput, setMinInput] = useState('');
  const [maxInput, setMaxInput] = useState('');
```

5c. Sostituisci il blocco da `const groups = groupByStatus(leads);` fino a `const filterTag = …;` incluso con:

```ts
  const minPrice = parseThousands(minInput);
  const maxPrice = parseThousands(maxInput);
  // Un prezzo non valido non filtra: il campo è segnato in rosso.
  const query: LeadQuery = { text, minPrice: minPrice === 'invalid' ? null : minPrice, maxPrice: maxPrice === 'invalid' ? null : maxPrice };
  // Ricerca e prezzo agiscono prima delle schede, così anche i loro conteggi li seguono.
  const groups = groupByStatus(applyQuery(leads, query));
  const inPortals = byPortals(groups[tab], portals);
  const visible = sortLeadsBy(byFilter(inPortals, filter), sortByTab[tab]);
  const tagParts = [
    ...(filter === 'all' ? [] : [FILTER_LABELS[filter]]),
    ...(portals.length ? [joinList(portals.map((p) => PORTAL_TAGS[p]), 'e')] : []),
    ...describeQuery(query),
  ];
  const filterTag = tagParts.length ? ` «${tagParts.join(', ')}»` : '';
  const anyFilter = filter !== 'all' || portals.length > 0 || !isEmptyQuery(query) || minPrice === 'invalid' || maxPrice === 'invalid';
  const resetFilters = () => {
    setText('');
    setMinInput('');
    setMaxInput('');
    setFilter('all');
    setPortals([]);
  };
```

5d. Sostituisci

```ts
  useEffect(() => setConfirmingAll(false), [tab, filter, portals, visible.length]);
```

con

```ts
  useEffect(() => setConfirmingAll(false), [tab, filter, portals, visible.length, text, query.minPrice, query.maxPrice]);
```

- [ ] **Step 6: JSX in `App.tsx`**

Subito dopo la chiusura `</nav>` delle schede (prima di `<div className="filters" role="radiogroup" …>`) inserisci:

```tsx
              <div className="search">
                <SearchIcon size={16} />
                <input
                  type="search"
                  className="field search__input"
                  aria-label="Cerca nei lead"
                  placeholder="Cerca titolo, indirizzo, zona…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                {text && (
                  <button type="button" className="icon-btn search__clear" aria-label="Svuota ricerca" title="Svuota ricerca" onClick={() => setText('')}>
                    <CloseIcon />
                  </button>
                )}
              </div>
              <div className="price">
                <span className="price__label">Prezzo da</span>
                <input
                  className="field price__input"
                  inputMode="decimal"
                  aria-label="Prezzo minimo in migliaia di euro"
                  aria-invalid={minPrice === 'invalid'}
                  value={minInput}
                  onChange={(e) => setMinInput(e.target.value)}
                />
                <span className="price__label">a</span>
                <input
                  className="field price__input"
                  inputMode="decimal"
                  aria-label="Prezzo massimo in migliaia di euro"
                  aria-invalid={maxPrice === 'invalid'}
                  value={maxInput}
                  onChange={(e) => setMaxInput(e.target.value)}
                />
                <span className="price__label">k€</span>
                {anyFilter && (
                  <button type="button" className="btn btn--sm price__reset" onClick={resetFilters}>Azzera filtri</button>
                )}
              </div>
```

- [ ] **Step 7: Stili**

In `src/ui/sidepanel/styles.css`, subito prima della riga `.filters { display: flex; …`, aggiungi:

```css
.search { position: relative; display: flex; align-items: center; padding: 8px 12px 0; }
.search > .icon { position: absolute; left: 21px; color: var(--subtle); pointer-events: none; }
.search__input { flex: 1; min-width: 0; padding-left: 30px; padding-right: 34px; }
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear { position: absolute; right: 15px; width: 26px; height: 26px; }
.price { display: flex; align-items: center; gap: 6px; padding: 8px 12px 0; }
.price__label { color: var(--muted); font-size: 12px; white-space: nowrap; }
.price__input { width: 64px; height: 28px; font-size: 12px; text-align: right; }
.price__reset { margin-left: auto; white-space: nowrap; }
.field[aria-invalid='true'] { border-color: var(--high); }
```

- [ ] **Step 8: Verifica**

Run: `npx vitest run tests/unit/ui/sidepanel.test.tsx`
Expected: PASS, compresi i 5 test nuovi.

Run: `npm test` e `npm run typecheck`
Expected: tutto verde, nessun errore di tipo.

- [ ] **Step 9: Documentazione**

`docs/smoke-test.md` (file CRLF: usa Edit). Dopo la riga
`   - [ ] Con un filtro attivo il pulsante dice "Elimina tutti «…» (n)" e n è il numero dei lead filtrati (premi "Annulla", non confermare).`
aggiungi:

```markdown
   - [ ] Ricerca: scrivi il nome di una zona o di una via che vedi nei lead (anche senza accenti); lista e numeri sulle schede si aggiornano mentre scrivi; la ✕ svuota la ricerca e torna tutto come prima.
   - [ ] Prezzo da/a in k€ (es. 150 e 250): restano solo i lead nella fascia, senza quelli privi di prezzo; un valore come "abc" si colora di rosso e non filtra; "Azzera filtri" riporta ricerca, prezzo, badge e siti a "Tutti".
   - [ ] Con ricerca o prezzo attivi, "Elimina tutti «…»" li riporta nel testo (premi "Annulla").
```

e sostituisci
`   - [ ] Con un filtro attivo il file contiene solo i lead filtrati.`
con
`   - [ ] Con un filtro attivo (badge, sito, ricerca o prezzo) il file contiene solo i lead filtrati e il numero accanto a "Esporta la vista corrente" corrisponde.`

`CLAUDE.md` (Edit): nella voce `src/core/`, dopo `` `export.ts` `` aggiungi `` , `lead-filters.ts` (ricerca a testo e fascia di prezzo del pannello, applicate prima del raggruppamento per scheda) ``, in modo che la frase resti: `` … `router.ts` (dispatch dei messaggi), `export.ts`, `lead-filters.ts` (…). ``

- [ ] **Step 10: Commit**

```bash
git add src/ui/sidepanel/App.tsx src/ui/sidepanel/Icons.tsx src/ui/sidepanel/ExportBar.tsx src/ui/sidepanel/styles.css tests/unit/ui/sidepanel.test.tsx docs/smoke-test.md CLAUDE.md
git commit -F - <<'EOF'
feat(sidepanel): ricerca, fascia di prezzo e "Azzera filtri"

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Verifica finale e build

**Files:** nessuna modifica attesa.

- [ ] **Step 1:** Run `npm test`, `npm run typecheck`, `npm run build`. Expected: tutto verde; build in `.output/chrome-mv3`.
- [ ] **Step 2:** Run `npm run test:e2e`. Expected: PASS (gli e2e non toccano il pannello filtrato, ma verificano che nulla si sia rotto).
- [ ] **Step 3:** L'utente esegue le nuove voci di `docs/smoke-test.md` su `.output/chrome-mv3` prima della PR. La riga 3 di `docs/roadmap.md` passa a "fatto" con il link alla PR al momento di aprirla.
