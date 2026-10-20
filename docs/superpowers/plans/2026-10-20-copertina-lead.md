# Copertina nei lead — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ogni lead del pannello mostra la foto di copertina dell'annuncio, caricata dai server delle immagini dei portali, con ripiego sugli altri annunci dello stesso immobile e su un riquadro neutro.

**Architecture:** gli adapter leggono l'URL della copertina e lo filtrano con `src/core/cover.ts` (solo server immagini noti). `LeadService.ingest` lo salva in `ListingRecord.coverUrl` (facoltativo, mai `null`), il backup lo porta, `buildLeadViews` costruisce `LeadView.covers` (ordine di preferenza del gruppo) e il componente `Cover` del pannello le prova in ordine.

**Tech Stack:** WXT (MV3), React, TypeScript, zod 4, Dexie, Vitest (jsdom + fake-indexeddb), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-copertina-lead-design.md`

## Global Constraints

- Mai richieste HTTP dell'estensione verso pagine e API dei portali. Il pannello carica solo la copertina dei lead salvati, dai server delle immagini, con `loading="lazy"` e `referrerPolicy="no-referrer"`.
- Server ammessi: Immobiliare `pwm.im-cdn.it`; Idealista `/^img\d*\.idealista\.it$/`; Subito `images.sbito.it`; solo `https:`.
- Subito: `?rule=vertical-mini-card-1x-auto` (senza `rule` il server risponde 400).
- Si salva solo l'URL, mai l'immagine. `ListingRecord.coverUrl?: string`: presente solo se nota, mai `null`. `ListingObservation.coverUrl: string | null`.
- Un errore nella copertina non fa mai perdere l'annuncio.
- Nessuna `version()` nuova di Dexie; `BACKUP_FORMAT_VERSION` resta 1.
- Idealista: mai leggere `.professional-name`.
- Fixture solo tramite `scripts/sanitize-fixture.mjs`; mai modifiche a mano.
- Testi dell'interfaccia e commenti in italiano; timestamp in ms epoch UTC.
- Comandi: `npm test`, `npx vitest run <file>`, `npm run typecheck`, `npm run test:e2e`.

## Review Focus

1. Il portale cambia la forma della foto (oggetto diverso, numero, stringa): l'annuncio deve essere letto lo stesso, con copertina `null` — test in linea per i tre adapter (Task 2).
2. Una lettura successiva senza foto (scheda Idealista, card senza `img`): la copertina già salvata deve restare — test di `ingest` (Task 3).
3. Record e backup salvati prima di questa funzione (senza `coverUrl`): l'importazione deve funzionare e non segnare "aggiornati" annunci identici — test di `mergeBackup` (Task 3).
4. La foto non si carica (annuncio tolto, offline, server bloccato): il lead passa alla copertina successiva del gruppo e poi al riquadro neutro, senza spostare la lista — test del componente (Task 4) ed e2e con le immagini bloccate (Task 6).
5. URL di un server non ammesso (pagina manomessa, portale che cambia server, backup modificato a mano): non deve mai arrivare a un `<img>` — test di `cover.ts` (Task 1), degli adapter (Task 2) e del backup (Task 3).

---

### Task 1: Server ammessi (`src/core/cover.ts`)

**Files:**
- Create: `src/core/cover.ts`
- Test: `tests/unit/core/cover.test.ts`

**Interfaces:**
- Produces:
  - `isCoverUrl(portal: Portal, url: string): boolean`
  - `coverOrNull(portal: Portal, url: unknown): string | null`
  - `SUBITO_COVER_RULE: 'vertical-mini-card-1x-auto'`
  - `subitoCover(base: string): string | null`

- [ ] **Step 1: Scrivi il test**

`tests/unit/core/cover.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { coverOrNull, isCoverUrl, subitoCover, SUBITO_COVER_RULE } from '@/core/cover';

const IMMO = 'https://pwm.im-cdn.it/image/2030080280/xxs-c.jpg';
const IDEA = 'https://img4.idealista.it/blur/480_360_mq/0/id.pro.it.image.master/4b/6d/bf/780558105.jpg';
const SUB = 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f48389a-ec1a-4435-b055-4b21a05401a8';

describe('isCoverUrl', () => {
  it('accetta i server immagini di ogni portale', () => {
    expect(isCoverUrl('immobiliare', IMMO)).toBe(true);
    expect(isCoverUrl('idealista', IDEA)).toBe(true);
    expect(isCoverUrl('idealista', 'https://img.idealista.it/x.jpg')).toBe(true);
    expect(isCoverUrl('subito', `${SUB}?rule=${SUBITO_COVER_RULE}`)).toBe(true);
  });

  it('rifiuta server di un altro portale, altri host, http e URL non validi', () => {
    expect(isCoverUrl('idealista', IMMO)).toBe(false);
    expect(isCoverUrl('immobiliare', 'https://pwm.im-cdn.it.evil.example/x.jpg')).toBe(false);
    expect(isCoverUrl('idealista', 'https://www.idealista.it/x.jpg')).toBe(false);
    expect(isCoverUrl('immobiliare', IMMO.replace('https:', 'http:'))).toBe(false);
    expect(isCoverUrl('subito', 'x.jpg')).toBe(false);
    expect(isCoverUrl('subito', '')).toBe(false);
  });
});

describe('coverOrNull', () => {
  it("restituisce l'URL ammesso, altrimenti null", () => {
    expect(coverOrNull('immobiliare', IMMO)).toBe(IMMO);
    expect(coverOrNull('immobiliare', 'https://example.com/x.jpg')).toBeNull();
    expect(coverOrNull('immobiliare', 42)).toBeNull();
    expect(coverOrNull('immobiliare', undefined)).toBeNull();
    expect(coverOrNull('immobiliare', null)).toBeNull();
  });
});

describe('subitoCover', () => {
  it('aggiunge la regola della miniatura', () => {
    expect(subitoCover(SUB)).toBe(`${SUB}?rule=vertical-mini-card-1x-auto`);
  });
  it('sostituisce una regola già presente', () => {
    expect(subitoCover(`${SUB}?rule=large-fixed-card-1x-auto`)).toBe(`${SUB}?rule=vertical-mini-card-1x-auto`);
  });
  it('base non valida: null', () => {
    expect(subitoCover('non un url')).toBeNull();
  });
});
```

- [ ] **Step 2: Verifica che fallisca**

Run: `npx vitest run tests/unit/core/cover.test.ts`
Expected: FAIL, modulo `@/core/cover` non trovato.

- [ ] **Step 3: Implementa**

`src/core/cover.ts`:

```ts
import type { Portal } from '@/shared/types';

/**
 * Server delle immagini da cui il pannello può caricare la copertina (verificati il 2026-10-20): risposta senza cookie
 * né DataDome, anche senza referer. Un URL di un altro server non arriva mai a un <img>.
 */
const COVER_HOSTS: Record<Portal, (host: string) => boolean> = {
  immobiliare: (h) => h === 'pwm.im-cdn.it',
  idealista: (h) => /^img\d*\.idealista\.it$/.test(h),
  subito: (h) => h === 'images.sbito.it',
};

/** Regola di Subito per la miniatura (~10 KB): senza `rule` il server risponde 400. */
export const SUBITO_COVER_RULE = 'vertical-mini-card-1x-auto';

export function isCoverUrl(portal: Portal, url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && COVER_HOSTS[portal](u.hostname);
  } catch {
    return false;
  }
}

export function coverOrNull(portal: Portal, url: unknown): string | null {
  return typeof url === 'string' && isCoverUrl(portal, url) ? url : null;
}

/** URL della miniatura di Subito dalla base dell'immagine (`cdnBaseUrl` / `cdn_base_url`). */
export function subitoCover(base: string): string | null {
  try {
    const u = new URL(base);
    u.searchParams.set('rule', SUBITO_COVER_RULE);
    return u.toString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Verifica che passi**

Run: `npx vitest run tests/unit/core/cover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/cover.ts tests/unit/core/cover.test.ts
git commit -m "feat(cover): server immagini ammessi per la copertina dei lead"
```

---

### Task 2: Copertina nelle osservazioni dei tre adapter

**Files:**
- Modify: `src/shared/types.ts` (`ListingObservation`, `ListingRecord`)
- Modify: `src/adapters/immobiliare/schemas.ts`, `src/adapters/immobiliare/index.ts`
- Modify: `src/adapters/idealista/parse.ts`
- Modify: `src/adapters/subito/schemas.ts`, `src/adapters/subito/index.ts`
- Modify: `tests/unit/core/helpers.ts` (`obs`), `tests/unit/adapters/idealista-builders.ts`
- Test: `tests/unit/adapters/immobiliare.test.ts`, `tests/unit/adapters/idealista.test.ts`, `tests/unit/adapters/subito.test.ts`

**Interfaces:**
- Consumes: `coverOrNull`, `subitoCover` (Task 1).
- Produces: `ListingObservation.coverUrl: string | null`; `ListingRecord.coverUrl?: string` (solo il tipo; lo scrive Task 3).

- [ ] **Step 1: Tipi**

In `src/shared/types.ts`, in `ListingObservation` dopo `lastDrop`:

```ts
  /** Foto di copertina su un server immagini ammesso (`core/cover.ts`); null se manca o non è riconosciuta. */
  coverUrl: string | null;
```

In `ListingRecord` dopo `missingSince`:

```ts
  /** Foto di copertina; assente se non nota (mai null: un record senza copertina ha la stessa forma di prima). */
  coverUrl?: string;
```

In `tests/unit/core/helpers.ts`, nella funzione `obs`, aggiungi `coverUrl: null,` prima di `source: 'search',`.

- [ ] **Step 2: Test Immobiliare**

In fondo a `tests/unit/adapters/immobiliare.test.ts`:

```ts
describe('copertina', () => {
  const photo = { id: 1, caption: 'Soggiorno', urls: { small: 'https://pwm.im-cdn.it/image/1/xxs-c.jpg', medium: 'https://pwm.im-cdn.it/image/1/m-c.jpg' } };
  const withPhoto = (p: unknown) => realEstate({ properties: [{ ...realEstate().properties[0], photo: p }] });
  const parse = (re: unknown) => A.parseNextData(searchNextData([searchResult(re)]), SEARCH_URL);

  it('prende la foto piccola della prima proprietà', () => {
    expect(parse(withPhoto(photo)).observations[0]!.coverUrl).toBe('https://pwm.im-cdn.it/image/1/xxs-c.jpg');
  });

  it('anche dalla risposta XHR', () => {
    const r = A.parseIntercepted(API_URL, { results: [searchResult(withPhoto(photo))] });
    expect(r.observations[0]!.coverUrl).toBe('https://pwm.im-cdn.it/image/1/xxs-c.jpg');
  });

  it('senza foto: null', () => {
    expect(parse(realEstate()).observations[0]!.coverUrl).toBeNull();
  });

  it('foto di forma inattesa o su un altro server: annuncio letto, copertina null', () => {
    for (const p of [{ urls: 'x' }, 42, { urls: { small: 'https://evil.example/x.jpg' } }]) {
      const r = parse(withPhoto(p));
      expect(r.errors).toEqual([]);
      expect(r.observations).toHaveLength(1);
      expect(r.observations[0]!.coverUrl).toBeNull();
    }
  });

  it('la didascalia della foto non esce', () => {
    expect(JSON.stringify(parse(withPhoto(photo)).observations)).not.toContain('Soggiorno');
  });
});
```

- [ ] **Step 3: Test Idealista**

In `tests/unit/adapters/idealista-builders.ts`, aggiungi a `CardOpts`:

```ts
  /** src dell'img della copertina; null = card senza foto (`item-multimedia_no-pictures`). */
  img?: string | null;
```

e in `card()` sostituisci la riga `<picture class="item-multimedia">…</picture>` con:

```ts
    ${o.img === null
      ? '<picture class="item-multimedia item-multimedia_no-pictures"></picture>'
      : `<picture class="item-multimedia"><div class="item-multimedia-pictures"><div class="item-multimedia-pictures__container"></div></div><div class="item-gallery"><img src="${o.img ?? 'x.jpg'}" alt="" loading="lazy"></div></picture>`}
```

In fondo a `tests/unit/adapters/idealista.test.ts`:

```ts
describe('copertina', () => {
  const IMG = 'https://img4.idealista.it/blur/480_360_mq/0/id.pro.it.image.master/4b/6d/bf/780558105.jpg';

  it("prende l'src dell'img della card", () => {
    document.body.innerHTML = searchBody([card({ img: IMG })]);
    expect(read().observations[0]!.coverUrl).toBe(IMG);
  });

  it('card senza foto, src relativo o di un altro server: null, annuncio letto', () => {
    document.body.innerHTML = searchBody([
      card({ id: 1, img: null }),
      card({ id: 2, img: 'x.jpg' }),
      card({ id: 3, img: 'https://evil.example/x.jpg' }),
    ]);
    const r = read();
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.coverUrl)).toEqual([null, null, null]);
  });

  it('la scheda annuncio non porta copertina', () => {
    renderDetail(document);
    expect(read(DETAIL_URL).observations[0]!.coverUrl).toBeNull();
  });
});
```

- [ ] **Step 4: Test Subito**

In fondo a `tests/unit/adapters/subito.test.ts`:

```ts
describe('copertina', () => {
  const BASE = 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f48389a-ec1a-4435-b055-4b21a05401a8';
  const COVER = `${BASE}?rule=vertical-mini-card-1x-auto`;

  it('__NEXT_DATA__: cdnBaseUrl della prima immagine con la regola della miniatura', () => {
    const r = A.parseNextData(nextData([nextAd(1, { images: [{ cdnBaseUrl: BASE }, { cdnBaseUrl: `${BASE}2` }] })]), SEARCH_URL, NOW);
    expect(r.observations[0]!.coverUrl).toBe(COVER);
  });

  it('API: cdn_base_url', () => {
    const r = A.parseApi(API_URL, apiResponse([apiAd(1, { images: [{ uri: 'imgid:x', base_url: 'https://s.sbito.it/img/x', cdn_base_url: BASE }] })]), NOW);
    expect(r.observations[0]!.coverUrl).toBe(COVER);
  });

  it('senza immagini, forma inattesa o altro server: null, annuncio letto', () => {
    const r = A.parseNextData(nextData([
      nextAd(1, { images: [] }),
      nextAd(2, { images: undefined }),
      nextAd(3, { images: 'x' }),
      nextAd(4, { images: [{ cdnBaseUrl: 'https://images.example/1' }] }),
    ]), SEARCH_URL, NOW);
    expect(r.errors).toEqual([]);
    expect(r.observations.map((o) => o.coverUrl)).toEqual([null, null, null, null]);
  });
});
```

Nel test esistente "mappa i campi dell'annuncio" (`parseNextData`) aggiungi `coverUrl: null,` all'oggetto atteso dopo `lastDrop: null,` (il builder usa `https://images.example/1`, server non ammesso).

- [ ] **Step 5: Verifica che falliscano**

Run: `npx vitest run tests/unit/adapters`
Expected: FAIL nei nuovi `describe('copertina')` (`coverUrl` undefined).

- [ ] **Step 6: Implementa Immobiliare**

`src/adapters/immobiliare/schemas.ts`: nel commento in testa sostituisci "Telefoni, nomi, descrizioni e foto non sono dichiarati" con "Telefoni, nomi e descrizioni non sono dichiarati; della foto resta solo l'URL piccolo della copertina". In `PropertySchema` aggiungi:

```ts
  // Copertina: solo l'URL piccolo. Una forma inattesa diventa null e non scarta la proprietà.
  photo: z.object({ urls: z.object({ small: z.string() }) }).nullish().catch(null),
```

`src/adapters/immobiliare/index.ts`: importa `import { coverOrNull } from '@/core/cover';` e in `toObservation` aggiungi dopo `lastDrop: …,`:

```ts
    coverUrl: coverOrNull('immobiliare', p.photo?.urls.small),
```

- [ ] **Step 7: Implementa Idealista**

`src/adapters/idealista/parse.ts`: importa `import { coverOrNull } from '@/core/cover';`. Aggiungi il parametro `coverUrl: string | null` a `observation(...)` subito dopo `lastDrop`, e nel ritorno `coverUrl,` prima di `source`:

```ts
function observation(
  id: number, title: string, price: number | null, features: string[], sellerType: SellerType,
  lastDrop: ObservedPriceDrop | null, coverUrl: string | null, source: ObservationSource,
): ListingObservation {
  const t = parseTitle(title);
  return {
    portal: 'idealista', portalId: id, url: listingUrl(id), title, address: t.address, city: t.city, zone: t.zone, typology: t.typology, category: categoryFromTypology(t.typology),
    ...parseFeatures(features), price, sellerType, portalCreatedAt: null, lastDrop, coverUrl, source,
  };
}
```

In `parseSearch`:

```ts
    // Copertina: l'src è già presente anche sulle card non ancora caricate (loading="lazy").
    const cover = coverOrNull('idealista', card.querySelector('picture.item-multimedia img')?.getAttribute('src'));
    out.observations.push(observation(id, title, price, features, sellerOfCard(card), parseDrop(card, price), cover, 'search'));
```

In `parseDetail` passa `null` come copertina: `observation(id, title, price, features, sellerType, parseDrop(info, price), null, 'detail')`.

- [ ] **Step 8: Implementa Subito**

`src/adapters/subito/schemas.ts`: nel commento in testa sostituisci "body (descrizione) e immagini non sono dichiarati." con "body (descrizione) non è dichiarato; delle immagini resta solo la base dell'URL." In `CommonAdSchema` aggiungi:

```ts
  // __NEXT_DATA__: cdnBaseUrl; API di hades: cdn_base_url. Una forma inattesa diventa null e non scarta l'annuncio.
  images: z.array(z.object({ cdnBaseUrl: z.string().optional(), cdn_base_url: z.string().optional() })).nullish().catch(null),
```

`src/adapters/subito/index.ts`: importa `import { coverOrNull, subitoCover } from '@/core/cover';`, aggiungi:

```ts
function coverOf(images: CommonAd['images']): string | null {
  const base = images?.[0]?.cdnBaseUrl ?? images?.[0]?.cdn_base_url;
  return base ? coverOrNull('subito', subitoCover(base)) : null;
}
```

e in `toObservation` dopo `lastDrop: null,`:

```ts
    coverUrl: coverOf(ad.images),
```

- [ ] **Step 9: Verifica**

Run: `npx vitest run tests/unit/adapters`
Expected: PASS.

Run: `npm run typecheck`
Expected: errori solo dove un test costruisce un `ListingObservation` a mano (non con `obs()`), per esempio `tests/unit/adapters/idealista.test.ts`, `tests/unit/content/controller.test.ts`, `tests/unit/core/router.test.ts`. In ciascun letterale aggiungi `coverUrl: null,` prima di `source`. Le aspettative `toEqual` sulle osservazioni degli adapter che falliscono in `npm test` ricevono lo stesso campo: `coverUrl: null` (builder senza foto ammessa). Ripeti finché `npm run typecheck` è pulito.

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/adapters tests/unit
git commit -m "feat(adapters): copertina dell'annuncio da Immobiliare, Idealista e Subito"
```

---

### Task 3: Copertina salvata e nel backup

**Files:**
- Modify: `src/core/service.ts` (`ingest`)
- Modify: `src/core/backup.ts` (`ListingSchema`, `mergeBackup`)
- Test: `tests/unit/core/service.ingest.test.ts`, `tests/unit/core/backup.test.ts`, `tests/unit/core/backup-merge.test.ts`

**Interfaces:**
- Consumes: `ListingObservation.coverUrl`, `ListingRecord.coverUrl?` (Task 2); `coverOrNull` (Task 1).
- Produces: record con `coverUrl` quando nota; backup che la conserva.

- [ ] **Step 1: Test di `ingest`**

In fondo a `tests/unit/core/service.ingest.test.ts` (usa `setup`, `obs` da `./helpers`; aggiungi gli import mancanti):

```ts
describe('ingest: copertina', () => {
  const A = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
  const B = 'https://pwm.im-cdn.it/image/2/xxs-c.jpg';

  it('salva la copertina; senza copertina il campo non esiste', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs({ coverUrl: A }), obs({ portalId: 2, url: 'https://www.immobiliare.it/annunci/2/', coverUrl: null })]);
    expect((await db.listings.get('immobiliare:128416572'))!.coverUrl).toBe(A);
    expect('coverUrl' in (await db.listings.get('immobiliare:2'))!).toBe(false);
  });

  it('una lettura senza copertina tiene quella nota, una nuova la sostituisce', async () => {
    const { db, svc } = setup();
    await svc.ingest([obs({ coverUrl: A })]);
    await svc.ingest([obs({ coverUrl: null })]);
    expect((await db.listings.get('immobiliare:128416572'))!.coverUrl).toBe(A);
    await svc.ingest([obs({ coverUrl: B })]);
    expect((await db.listings.get('immobiliare:128416572'))!.coverUrl).toBe(B);
  });
});
```

- [ ] **Step 2: Test del backup**

In fondo a `tests/unit/core/backup.test.ts` (il file ha già `data()`, `roundTrip(d)` e `listing` da `./backup-builders`):

```ts
describe('backup: copertina', () => {
  const COVER = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
  const withListing = (l: ReturnType<typeof listing>): BackupData => ({ ...data(), listings: [l] });

  it('andata e ritorno con la copertina', () => {
    expect(parseBackup(roundTrip(withListing(listing({ coverUrl: COVER })))).listings[0]!.coverUrl).toBe(COVER);
  });

  it('un file senza copertina si legge senza il campo', () => {
    expect('coverUrl' in parseBackup(roundTrip(data())).listings[0]!).toBe(false);
  });

  it('una copertina su un server non ammesso sparisce, il resto si importa', () => {
    const parsed = parseBackup(roundTrip(withListing(listing({ coverUrl: 'https://evil.example/x.jpg' }))));
    expect(parsed.listings).toHaveLength(1);
    expect('coverUrl' in parsed.listings[0]!).toBe(false);
  });
});
```

In fondo a `tests/unit/core/backup-merge.test.ts`:

```ts
describe('mergeBackup: copertina', () => {
  const COVER = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';

  it('il record più recente senza copertina tiene quella dell\'altro', () => {
    const cur = { ...empty(), listings: [listing({ coverUrl: COVER })], leadStates: [state()] };
    const m = mergeBackup(cur, file({ listings: [listing({ lastSeenAt: NOW + 1000 })] }), NOW);
    expect(m.listings[0]!.coverUrl).toBe(COVER);
  });

  it('record senza copertina da entrambe le parti: nessuna scrittura', () => {
    const cur = { ...empty(), listings: [listing()], leadStates: [state()] };
    const m = mergeBackup(cur, file(), NOW);
    expect(m.summary).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });
});
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/service.ingest.test.ts tests/unit/core/backup.test.ts tests/unit/core/backup-merge.test.ts`
Expected: FAIL nei nuovi test (copertina non salvata, schema del backup che la scarta, unione che la perde).

- [ ] **Step 4: Implementa `ingest`**

In `src/core/service.ts`, subito dopo il blocco `if (prev && now - prev.lastSeenAt < VISIT_GAP_MS) record.lastSeenAt = prev.lastSeenAt;`:

```ts
        // La copertina si scrive solo se nota: una lettura senza foto (scheda, card senza img) non cancella quella salvata.
        const cover = o.coverUrl ?? prev?.coverUrl;
        if (cover) record.coverUrl = cover;
```

- [ ] **Step 5: Implementa il backup**

In `src/core/backup.ts` importa `import { coverOrNull } from '@/core/cover';`. In `ListingSchema` aggiungi alla riga dei facoltativi `coverUrl: z.string().nullable().optional(),` e sostituisci il `transform`:

```ts
  .transform(({ coverUrl, ...l }): ListingRecord => {
    // Solo server immagini ammessi: un URL diverso sparisce senza far fallire l'importazione.
    const cover = coverOrNull(l.portal, coverUrl);
    return {
      ...l,
      category: l.category ?? categoryFromTypology(l.typology) ?? 'residential',
      sweepScope: l.sweepScope ?? null,
      missedSweeps: l.missedSweeps ?? 0,
      missingSince: l.missingSince ?? null,
      ...(cover ? { coverUrl: cover } : {}),
    };
  });
```

Nell'unione (`const merged: ListingRecord = { ...newer, … }`), subito dopo la costruzione di `merged`:

```ts
    // Il record più recente può non avere la copertina (backup precedente alla funzione): si tiene quella dell'altro.
    const cover = newer.coverUrl ?? (newer === inc ? cur : inc).coverUrl;
    if (cover) merged.coverUrl = cover;
```

- [ ] **Step 6: Verifica**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add src/core/service.ts src/core/backup.ts tests/unit/core
git commit -m "feat(cover): copertina salvata nell'annuncio e nel backup"
```

---

### Task 4: Miniatura nel pannello

**Files:**
- Modify: `src/shared/types.ts` (`LeadView`)
- Modify: `src/core/lead-groups.ts`
- Create: `src/ui/sidepanel/Cover.tsx`
- Modify: `src/ui/sidepanel/Icons.tsx`, `src/ui/sidepanel/LeadItem.tsx`, `src/ui/sidepanel/styles.css`
- Test: `tests/unit/core/lead-groups.test.ts`, `tests/unit/ui/cover.test.tsx`, `tests/unit/ui/sidepanel.test.tsx`

**Interfaces:**
- Consumes: `ListingRecord.coverUrl?` (Task 2/3).
- Produces: `LeadView.covers: string[]`; `coversOf(members: LeadSource[]): string[]` (esportata da `lead-groups.ts`); componente `Cover({ covers, href })`; `HouseIcon`.

- [ ] **Step 1: Test di `covers`**

In `tests/unit/core/lead-groups.test.ts`, dentro `describe('buildLeadViews: ripubblicazioni', …)` dopo l'ultimo `it`:

```ts
  it('copertine: principale, altre teste, poi annunci precedenti; senza vuoti né doppioni', () => {
    const c = (n: number) => `https://pwm.im-cdn.it/image/${n}/xxs-c.jpg`;
    const twin = rec('idealista', 9, { currentPrice: 272000, firstSeenAt: NOW - 5 * DAY_MS, lastSeenAt: NOW, coverUrl: 'https://img4.idealista.it/9.jpg' });
    const [v] = buildLeadViews(
      { listings: [{ ...before, coverUrl: c(1) }, { ...head, coverUrl: c(2) }, twin], states: [], snapshots, splits: [] },
      DEFAULT_SETTINGS, NOW,
    );
    const heads = [v!.listing, ...v!.others.filter((o) => !o.previous).map((o) => o.listing)].map((l) => l.coverUrl);
    expect(v!.covers).toEqual([...heads, c(1)]);
  });

  it('nessuna copertina: lista vuota; doppioni tolti', () => {
    expect(buildLeadViews(archive([rec('subito', 3)]), DEFAULT_SETTINGS, NOW)[0]!.covers).toEqual([]);
    const same = 'https://pwm.im-cdn.it/image/7/xxs-c.jpg';
    const [v] = buildLeadViews({ listings: [{ ...before, coverUrl: same }, { ...head, coverUrl: same }], states: [], snapshots, splits: [] }, DEFAULT_SETTINGS, NOW);
    expect(v!.covers).toEqual([same]);
  });
```

- [ ] **Step 2: Test del componente**

`tests/unit/ui/cover.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Cover } from '@/ui/sidepanel/Cover';

afterEach(cleanup);
const HREF = 'https://www.immobiliare.it/annunci/1/';
const A = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
const B = 'https://img4.idealista.it/2.jpg';

describe('Cover', () => {
  it('mostra la prima copertina, pigra e senza referrer, dentro il link all\'annuncio', () => {
    const { container } = render(<Cover covers={[A, B]} href={HREF} />);
    const link = screen.getByRole('link', { name: "Apri l'annuncio" });
    expect(link.getAttribute('href')).toBe(HREF);
    expect(link.getAttribute('rel')).toBe('noreferrer');
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(A);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('se la foto non si carica passa alla successiva, poi al riquadro neutro', () => {
    const { container } = render(<Cover covers={[A, B]} href={HREF} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')!.getAttribute('src')).toBe(B);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cover--empty svg')).not.toBeNull();
  });

  it('senza copertine: riquadro neutro', () => {
    const { container } = render(<Cover covers={[]} href={HREF} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.cover--empty')).not.toBeNull();
  });
});
```

In `tests/unit/ui/sidepanel.test.tsx`, nella funzione `lead(...)` aggiungi `covers: [],` dopo `others: [],`, e in fondo al file:

```tsx
describe('LeadItem: copertina', () => {
  it('ogni lead ha la miniatura: foto se c\'è, altrimenti riquadro neutro', () => {
    const cover = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
    const { container, rerender } = render(<LeadItem lead={{ ...lead(1, 'high'), covers: [cover] }} now={0} onChange={() => {}} onDelete={() => {}} />);
    expect(container.querySelector('.lead__body .cover img')!.getAttribute('src')).toBe(cover);
    rerender(<LeadItem lead={lead(2, 'high')} now={0} onChange={() => {}} onDelete={() => {}} />);
    expect(container.querySelector('.lead__body .cover--empty')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Verifica che falliscano**

Run: `npx vitest run tests/unit/core/lead-groups.test.ts tests/unit/ui/cover.test.tsx tests/unit/ui/sidepanel.test.tsx`
Expected: FAIL (`covers` undefined, modulo `Cover` mancante).

- [ ] **Step 4: Implementa `covers`**

`src/shared/types.ts`, in `LeadView` dopo `missingPortals`:

```ts
  /** Copertine del gruppo in ordine di preferenza (principale, altre fonti vive, annunci precedenti); vuoto se nessuna. */
  covers: string[];
```

`src/core/lead-groups.ts`, prima di `buildLeadViews`:

```ts
/** Copertine del gruppo: principale, poi le altre fonti vive, poi gli annunci precedenti; senza vuoti né doppioni. */
export function coversOf(members: LeadSource[]): string[] {
  const ordered = [...members.filter((m) => !m.previous), ...members.filter((m) => m.previous)];
  return [...new Set(ordered.map((m) => m.listing.coverUrl).filter((u): u is string => !!u))];
}
```

e nell'oggetto restituito da `units.map(...)` aggiungi `covers: coversOf(members),` dopo `missingPortals`.

Run: `npm run typecheck` e aggiungi `covers: [],` a ogni altro letterale `LeadView` segnalato nei test.

- [ ] **Step 5: Implementa icona e componente**

`src/ui/sidepanel/Icons.tsx`, in fondo:

```tsx
export const HouseIcon = () => (
  <Icon size={24}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </Icon>
);
```

`src/ui/sidepanel/Cover.tsx`:

```tsx
import { useState } from 'react';
import { HouseIcon } from './Icons';

interface Props {
  /** Copertine in ordine di preferenza (`LeadView.covers`). */
  covers: string[];
  /** Annuncio principale, aperto al clic come «Apri». */
  href: string;
}

/**
 * Miniatura del lead: prova le copertine in ordine e, se nessuna si carica, mostra un riquadro neutro della stessa
 * misura. La foto arriva dal server immagini del portale solo quando il lead è visibile, senza referrer.
 * Chi la usa la monta con `key` sulle copertine, così un elenco nuovo riparte dalla prima.
 */
export function Cover({ covers, href }: Props) {
  const [index, setIndex] = useState(0);
  const src = covers[index];
  return (
    <a className={`cover${src ? '' : ' cover--empty'}`} href={href} target="_blank" rel="noreferrer" aria-label="Apri l'annuncio">
      {src ? (
        <img
          key={src}
          className="cover__img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
        />
      ) : (
        <HouseIcon />
      )}
    </a>
  );
}
```

- [ ] **Step 6: Implementa `LeadItem` e stili**

`src/ui/sidepanel/LeadItem.tsx`: importa `import { Cover } from './Cover';` e sostituisci i due blocchi

```tsx
      <div className="lead__head">
        <div className="lead__title">{listing.title}</div>
        <div className="lead__price">{price}</div>
      </div>
      <div className="lead__meta">{[...evaluation.reasons, visits].join(' · ')}</div>
```

con

```tsx
      <div className="lead__body">
        <Cover key={lead.covers.join(' ')} covers={lead.covers} href={listing.url} />
        <div className="lead__main">
          <div className="lead__head">
            <div className="lead__title">{listing.title}</div>
            <div className="lead__price">{price}</div>
          </div>
          <div className="lead__meta">{[...evaluation.reasons, visits].join(' · ')}</div>
        </div>
      </div>
```

`src/ui/sidepanel/styles.css`, subito dopo la regola `.lead__meta`:

```css
/* Miniatura a sinistra di titolo e prezzo: stessa misura con o senza foto, così la lista non si sposta. */
.lead__body { display: flex; align-items: flex-start; gap: 10px; }
.lead__main { flex: 1; min-width: 0; }
.cover {
  flex: none; display: flex; align-items: center; justify-content: center; width: 96px; height: 72px; margin: 8px 0 10px;
  border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; background: var(--surface-muted); color: var(--subtle);
}
.cover__img { display: block; width: 100%; height: 100%; object-fit: cover; }
@media (max-width: 299px) { .cover { width: 72px; height: 54px; } }
```

- [ ] **Step 7: Verifica**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: nessun errore.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/core/lead-groups.ts src/ui/sidepanel tests/unit
git commit -m "feat(sidepanel): miniatura della copertina nei lead"
```

---

### Task 5: Sanitizer e fixture con le copertine

**Files:**
- Modify: `scripts/sanitize-fixture.mjs`
- Create: `tests/fixtures/immobiliare/search-salerno.json`, `tests/fixtures/immobiliare/api-salerno.json`, `tests/fixtures/idealista/search-salerno.html` (dal sanitizer)
- Modify: `tests/fixtures/subito/*.json` (rigenerate dal sanitizer)
- Test: `tests/unit/adapters/cover.fixtures.test.ts`, `tests/unit/adapters/subito.fixtures.test.ts`

**Interfaces:**
- Consumes: adapter con `coverUrl` (Task 2).
- Produces: fixture reali con URL finti sui server ammessi.

> **Nota per chi esegue:** lo Step 1 richiede un browser reale sui portali. Fermati e chiedi all'utente di eseguirlo navigando normalmente in Chrome (non con automazione), e di confermare quando i file sono in `fixtures-raw/`.

- [ ] **Step 1: Catture grezze di Salerno (utente)**

Chiedi all'utente:
1. Aprire `https://www.immobiliare.it/vendita-case/salerno/?criterio=privateFirst`; nella console di DevTools eseguire `copy(document.getElementById('__NEXT_DATA__').textContent)` e incollare in `fixtures-raw/immobiliare-salerno-search.json`.
2. Con DevTools → Network aperto (filtro `search-list/listings`), andare a pagina 2 dai link del sito; sulla richiesta → Response → copiare tutto in `fixtures-raw/immobiliare-salerno-api.json`.
3. Aprire `https://www.idealista.it/vendita-case/salerno-salerno/?ordine=da-privati-asc`. Con Ctrl+U cercare `id.pro.it.image.master` e dire se compare dentro le card (`<picture class="item-multimedia`): serve a sapere se la foto è nell'HTML del server. Poi nella console `copy(document.documentElement.outerHTML)` e incollare in `fixtures-raw/idealista-salerno-search.html`.

Se al punto 3 la foto **non** è nell'HTML del server, fermati e segnalalo: il content script legge ogni card una volta sola (`controller.scan`, insieme `sent`) e potrebbe leggere la card prima dell'`img`. Serve una decisione prima di proseguire.

- [ ] **Step 2: Test delle fixture**

`tests/unit/adapters/cover.fixtures.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { idealistaAdapter } from '@/adapters/idealista';
import { immobiliareAdapter } from '@/adapters/immobiliare';
import { subitoAdapter } from '@/adapters/subito';
import type { ParseResult } from '@/shared/types';

const read = (path: string) => readFileSync(`tests/fixtures/${path}`, 'utf8');
const privates = (r: ParseResult) => r.observations.filter((o) => o.sellerType === 'private');

/** Quasi tutti i privati hanno la copertina (Salerno, 2026-10-20: 23/25, 29/30, 25/31) e tutte sono URL finti. */
function expectCovers(r: ParseResult, fake: RegExp) {
  expect(r.errors).toEqual([]);
  const p = privates(r);
  expect(p.length).toBeGreaterThan(0);
  const withCover = p.filter((o) => o.coverUrl);
  expect(withCover.length / p.length).toBeGreaterThanOrEqual(0.7);
  for (const o of withCover) expect(o.coverUrl).toMatch(fake);
}

describe('copertine sulle fixture reali', () => {
  it('Immobiliare, pagina di ricerca', () => {
    const r = immobiliareAdapter.parseNextData(JSON.parse(read('immobiliare/search-salerno.json')), 'https://www.immobiliare.it/vendita-case/salerno/?criterio=privateFirst');
    expectCovers(r, /^https:\/\/pwm\.im-cdn\.it\/image\/\d{1,3}\/xxs-c\.jpg$/);
  });

  it('Immobiliare, risposta XHR', () => {
    const r = immobiliareAdapter.parseIntercepted('https://www.immobiliare.it/api-next/search-list/listings/?pag=2', JSON.parse(read('immobiliare/api-salerno.json')));
    expectCovers(r, /^https:\/\/pwm\.im-cdn\.it\/image\/\d{1,3}\/xxs-c\.jpg$/);
  });

  it('Idealista, pagina di ricerca', () => {
    const doc = new DOMParser().parseFromString(read('idealista/search-salerno.html'), 'text/html');
    const r = idealistaAdapter.readDocument!(doc, 'https://www.idealista.it/vendita-case/salerno-salerno/?ordine=da-privati-asc');
    expectCovers(r, /^https:\/\/img4\.idealista\.it\/blur\/480_360_mq\/0\/id\.pro\.it\.image\.master\/00\/00\/00\/\d{1,3}\.jpg$/);
  });

  it('Subito, pagina di ricerca e API', () => {
    const fake = /^https:\/\/images\.sbito\.it\/api\/v1\/sbt-ads-images-pro\/images\/00\/00000000-0000-0000-0000-\d{12}\?rule=vertical-mini-card-1x-auto$/;
    expectCovers(subitoAdapter.parseNextData(JSON.parse(read('subito/search-appartamenti.json')), 'https://www.subito.it/annunci-lombardia/vendita/appartamenti/milano/milano/', Date.UTC(2026, 9, 13, 10)), fake);
    expectCovers(subitoAdapter.parseApi('https://hades.subito.it/v1/search/items?c=7&r=4&t=s&start=30', JSON.parse(read('subito/api-page2.json')), Date.UTC(2026, 9, 13, 10)), fake);
  });

  it('nessun URL di foto reale nelle fixture', () => {
    for (const f of ['immobiliare/search-salerno.json', 'immobiliare/api-salerno.json', 'idealista/search-salerno.html', 'subito/search-appartamenti.json', 'subito/api-page2.json', 'subito/search-altra-categoria.json']) {
      const text = read(f);
      expect(text).not.toMatch(/pwm\.im-cdn\.it\/image\/\d{4,}/);
      expect(text).not.toMatch(/id\.pro\.it\.image\.master\/(?!00\/00\/00\/)/);
      expect(text).not.toMatch(/images\/[0-9a-f]{2}\/(?!00000000-0000-0000-0000-)[0-9a-f-]{36}/);
      expect(text).not.toContain('s.sbito.it');
    }
  });
});
```

In `tests/unit/adapters/subito.fixtures.test.ts` togli `'"images"'` dall'elenco delle chiavi vietate nel test "non contiene dati personali".

- [ ] **Step 3: Verifica che fallisca**

Run: `npx vitest run tests/unit/adapters/cover.fixtures.test.ts`
Expected: FAIL (fixture di Salerno mancanti; copertine di Subito assenti).

- [ ] **Step 4: Sanitizer — Immobiliare**

In `scripts/sanitize-fixture.mjs`, nella parte Immobiliare, sostituisci `anonymizeResults` con:

```js
// La copertina resta come URL finto sullo stesso server, numerato per annuncio: l'adattatore la legge.
const withCover = (re, original, n) => {
  if (!original?.properties?.[0]?.photo?.urls?.small || !re.properties?.[0]) return re;
  const [first, ...rest] = re.properties;
  return { ...re, properties: [{ ...first, photo: { urls: { small: `https://pwm.im-cdn.it/image/${n}/xxs-c.jpg` } } }, ...rest] };
};
const anonymizeResults = (results) => results.map((r, i) => {
  const s = scrub(r);
  return { ...s, realEstate: withCover(anonymize(s.realEstate, i + 1), r.realEstate, i + 1) };
});
```

e cambia le due chiamate `anonymizeResults(scrub(d.results))` → `anonymizeResults(d.results)` e `anonymizeResults(scrub(raw.results))` → `anonymizeResults(raw.results)`.

- [ ] **Step 5: Sanitizer — Idealista**

Nel ramo `idealista-search`, dentro la `map` delle card, sostituisci `return scrubNode(c).outerHTML;` con:

```js
      // La copertina resta come URL finto sullo stesso server (lo scrub toglie tutte le img).
      const hasCover = /^https:\/\//.test(c.querySelector('picture.item-multimedia img')?.getAttribute('src') ?? '');
      const clean = scrubNode(c);
      const pic = clean.querySelector('picture.item-multimedia');
      if (hasCover && pic) pic.innerHTML = `<img src="https://img4.idealista.it/blur/480_360_mq/0/id.pro.it.image.master/00/00/00/${i + 1}.jpg">`;
      return clean.outerHTML;
```

- [ ] **Step 6: Sanitizer — Subito**

Nel ramo Subito, prima di `const ad = …`:

```js
  // Solo la prima immagine, come URL finto sullo stesso server: l'adattatore la usa come copertina.
  const fakeImage = (n) => `https://images.sbito.it/api/v1/sbt-ads-images-pro/images/00/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
```

e dentro `ad`, prima di `if (api) {`:

```js
    if (x.images?.length) out.images = [api ? { cdn_base_url: fakeImage(n) } : { cdnBaseUrl: fakeImage(n) }];
```

- [ ] **Step 7: Rigenera le fixture**

```bash
node scripts/sanitize-fixture.mjs search fixtures-raw/immobiliare-salerno-search.json tests/fixtures/immobiliare/search-salerno.json
node scripts/sanitize-fixture.mjs api fixtures-raw/immobiliare-salerno-api.json tests/fixtures/immobiliare/api-salerno.json
node scripts/sanitize-fixture.mjs idealista-search fixtures-raw/idealista-salerno-search.html tests/fixtures/idealista/search-salerno.html
node scripts/sanitize-fixture.mjs subito-search fixtures-raw/subito-search.html tests/fixtures/subito/search-appartamenti.json
node scripts/sanitize-fixture.mjs subito-search fixtures-raw/subito-search-altra.html tests/fixtures/subito/search-altra-categoria.json
node scripts/sanitize-fixture.mjs subito-api fixtures-raw/subito-api.json tests/fixtures/subito/api-page2.json
```

Controlla:
- nessun avviso "possibili numeri di telefono";
- `git diff --stat tests/fixtures/subito` e `git diff tests/fixtures/subito | grep '^[-+]' | grep -v images | grep -v '^[-+][-+]'`: le sole righe cambiate riguardano `images`. Se cambia altro, le catture grezze non corrispondono alle fixture: fermati e segnalalo.
- rigenera anche le fixture di Milano di Immobiliare per controllo (`search` da `fixtures-raw/search.json`, `api` da `fixtures-raw/api.json`) in un file temporaneo dello scratchpad e confrontale con `tests/fixtures/immobiliare/`: devono essere identiche (le catture grezze di Milano non hanno foto).

- [ ] **Step 8: Verifica**

Run: `npm test`
Expected: PASS, compresi i test esistenti delle fixture (dati personali, titoli sintetici) sui file nuovi solo se elencati: aggiungi `'search-salerno.json', 'api-salerno.json'` al `describe.each` di `immobiliare.fixtures.test.ts` e `'search-salerno.html'` a quello di `idealista.fixtures.test.ts`, poi riesegui.

- [ ] **Step 9: Commit**

```bash
git add scripts/sanitize-fixture.mjs tests/fixtures tests/unit/adapters
git commit -m "test(fixture): copertine finte nel sanitizer e fixture di Salerno"
```

---

### Task 6: e2e — miniature nel pannello

**Files:**
- Modify: `tests/e2e/extension.spec.ts`

**Interfaces:**
- Consumes: fixture Immobiliare (Task 5) — l'e2e usa `search-privati.json` di Milano, senza foto; il test aggiunge la foto ai risultati sintetici.

- [ ] **Step 1: Test**

In `tests/e2e/extension.spec.ts`, la `beforeEach` blocca già ogni host diverso da `www.immobiliare.it` (quindi anche `pwm.im-cdn.it`). Aggiungi in fondo:

```ts
test('il pannello mostra una miniatura per ogni lead; foto non raggiungibile → riquadro neutro', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(SEARCH);
  await page.locator('[data-homeradar-badge]').first().waitFor();

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.locator('.lead').first()).toBeVisible();
  const leads = await panel.locator('.lead').count();
  await expect(panel.locator('.lead .lead__body .cover')).toHaveCount(leads);
  // Le fixture di Milano non hanno foto e le immagini sono bloccate: ogni miniatura è il riquadro neutro.
  await expect(panel.locator('.lead .cover--empty')).toHaveCount(leads);
});
```

- [ ] **Step 2: Esegui**

Run: `npm run test:e2e`
Expected: PASS, compreso il test nuovo.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/extension.spec.ts
git commit -m "test(e2e): miniatura dei lead nel pannello"
```

---

### Task 7: Vincolo, informativa e documenti

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/core/onboarding.ts`, `src/ui/onboarding/Onboarding.tsx`
- Modify: `docs/smoke-test.md`
- Test: `tests/unit/core/onboarding.test.ts`

- [ ] **Step 1: Test dell'informativa**

In `tests/unit/core/onboarding.test.ts`, sostituisci il `describe('v6', …)` con:

```ts
describe('v6', () => {
  it('il giro delle ricerche richiede una nuova conferma', () => {
    expect(ONBOARDING_VERSION).toBeGreaterThanOrEqual(6);
    expect(changesSince(5).join(' ')).toContain('«Cerca»');
  });
});

describe('v7', () => {
  it('la copertina dei lead richiede una nuova conferma', () => {
    expect(ONBOARDING_VERSION).toBe(7);
    expect(changesSince(6)).toEqual([
      'HomeRadar ora salva il link della foto di copertina degli annunci e la mostra nel pannello: la foto si carica dai server delle immagini del portale quando apri il pannello, non viene copiata sul tuo computer.',
    ]);
  });
});
```

Run: `npx vitest run tests/unit/core/onboarding.test.ts`
Expected: FAIL (`ONBOARDING_VERSION` è 6).

- [ ] **Step 2: Informativa**

`src/core/onboarding.ts`: `ONBOARDING_VERSION = 7` e in `ONBOARDING_CHANGES`:

```ts
  7: [
    'HomeRadar ora salva il link della foto di copertina degli annunci e la mostra nel pannello: la foto si carica dai server delle immagini del portale quando apri il pannello, non viene copiata sul tuo computer.',
  ],
```

`src/ui/onboarding/Onboarding.tsx`, sezione «Cosa salva», primo punto: sostituisci "tipologia, m², locali, prezzo e link." con "tipologia, m², locali, prezzo, link e link della foto di copertina." Nella sezione «Dove restano i dati», dopo il primo punto, aggiungi:

```tsx
          <li>
            Il pannello mostra la foto di copertina dei tuoi lead caricandola dai server delle immagini del portale, come
            fa la pagina di ricerca. La foto non viene copiata sul tuo computer.
          </li>
```

Run: `npm test`
Expected: PASS (se un test dell'interfaccia controlla il testo esatto del primo punto, aggiornalo con il testo nuovo).

- [ ] **Step 3: CLAUDE.md**

Nel paragrafo «Vincoli da rispettare», sostituisci la prima frase "Mai richieste HTTP dell'estensione verso il portale (DataDome; rischio legale)." con:

"Mai richieste HTTP dell'estensione verso le pagine e le API del portale (DataDome; rischio legale). Il pannello può mostrare la copertina dei lead salvati dai server delle immagini dei portali (`src/core/cover.ts`)."

Nell'elenco dell'architettura, dopo la voce di `src/adapters/types.ts`, aggiungi:

"- Copertina: `src/core/cover.ts` (server immagini ammessi per portale; Subito vuole `?rule=`). Gli adapter leggono l'URL (Immobiliare `properties[0].photo.urls.small`, Idealista `picture.item-multimedia img[src]`, Subito `images[0].cdnBaseUrl`/`cdn_base_url`), `ListingRecord.coverUrl` è facoltativo e mai `null`, `LeadView.covers` ha l'ordine di ripiego del gruppo, `src/ui/sidepanel/Cover.tsx` la mostra (pigra, senza referrer, riquadro neutro se non si carica)."

- [ ] **Step 4: Smoke test**

In `docs/smoke-test.md`, in ciascuna delle sezioni Immobiliare.it, Idealista.it e Subito.it, dopo la riga che controlla l'etichetta del portale nel pannello, aggiungi:

"    - [ ] Il lead ha la miniatura della foto dell'annuncio; un annuncio senza foto ha il riquadro con la casa."

- [ ] **Step 5: Verifica finale**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: tutto PASS.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/core/onboarding.ts src/ui/onboarding/Onboarding.tsx docs/smoke-test.md tests/unit/core/onboarding.test.ts
git commit -m "docs: vincolo sulle immagini, informativa v7 e smoke test della copertina"
```

---

### Task 8: Prova sul campo (Salerno)

> **Nota per chi esegue:** richiede l'utente e Chrome reale.

- [ ] **Step 1:** `npm run build`, poi chiedi all'utente di ricaricare l'estensione da `.output/chrome-mv3`, confermare l'informativa v7 e fare un giro «Cerca» su Salerno.
- [ ] **Step 2:** Chiedi di controllare nel pannello: miniature per lead di tutti e tre i portali; un lead senza foto con il riquadro; un lead unito tra portali con la foto. Riporta il risultato nella PR.
