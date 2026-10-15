import { describe, expect, it } from 'vitest';
import { actionBadge, RECALL_COLOR, WARNING_COLOR } from '@/core/action-badge';
import { BRAND_COLOR } from '@/shared/logo';

describe('actionBadge', () => {
  it("senza conferma: pallino nel colore del marchio, anche con l'avviso dei portali", () => {
    const expected = { text: '●', color: BRAND_COLOR, title: "HomeRadar: conferma l'informativa per iniziare" };
    expect(actionBadge({ onboarding: true, warning: false, due: 0 })).toEqual(expected);
    expect(actionBadge({ onboarding: true, warning: true, due: 0 })).toEqual(expected);
  });
  it('avviso dei portali: "!" ambra', () => {
    expect(actionBadge({ onboarding: false, warning: true, due: 0 })).toEqual({ text: '!', color: WARNING_COLOR, title: 'HomeRadar' });
  });
  it('tutto in ordine: nessun segnale', () => {
    expect(actionBadge({ onboarding: false, warning: false, due: 0 })).toEqual({ text: '', color: null, title: 'HomeRadar' });
  });
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
});
