import { describe, expect, it } from 'vitest';
import { changesSince, needsOnboarding, ONBOARDING_CHANGES, ONBOARDING_VERSION } from '@/core/onboarding';
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

describe('informativa v2', () => {
  it('la versione 2 annuncia le date di ricontatto', () => {
    expect(ONBOARDING_VERSION).toBe(2);
    expect(ONBOARDING_CHANGES[2]).toEqual([
      'HomeRadar ora salva la data di ricontatto che imposti su un lead: resta sul tuo browser, come stati e note.',
    ]);
  });
});
