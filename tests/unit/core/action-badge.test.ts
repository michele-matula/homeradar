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
