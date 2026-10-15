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

  it("avviso dell'informativa: \"Apri\" chiede la scheda e poi invita a ricaricare", () => {
    const open = vi.fn(async () => null);
    showOnboardingBanner(document, open);
    expect(banner()!.textContent).toContain(ONBOARDING_TEXT);
    banner()!.querySelector('button')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(banner()!.textContent).toContain(RELOAD_AFTER_ONBOARDING_TEXT);
    expect(buttons()).toEqual(['Ricarica', '✕']);
  });

  it("se la scheda non si apre l'avviso cambia comunque, senza eccezioni", async () => {
    showOnboardingBanner(document, vi.fn(async () => { throw new Error('boom'); }));
    banner()!.querySelector('button')!.click();
    await Promise.resolve();
    expect(banner()!.textContent).toContain(RELOAD_AFTER_ONBOARDING_TEXT);
  });
});
