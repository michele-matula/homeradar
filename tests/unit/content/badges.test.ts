import { beforeEach, describe, expect, it } from 'vitest';
import { BADGE_ATTR, renderBadge } from '@/content/badges';
import type { Evaluation } from '@/shared/types';

const ev = (o: Partial<Evaluation> = {}): Evaluation => ({
  listingKey: 'immobiliare:111', portalId: 111, priority: 'high', ageDays: 173, ageEstimated: false, ageUncertain: false,
  dropPercent: 5.6, dropCount: 1, maxKnownPrice: 249000, reasons: [], badgeText: '● Alta · 173 gg · −5,6%', ...o,
});

beforeEach(() => {
  document.body.innerHTML = `
    <ul>
      <li id="card"><div class="nd-slideshow__content"><img src="x.jpg"></div><a href="https://www.immobiliare.it/annunci/111/">Bilocale</a></li>
      <li><a href="https://www.immobiliare.it/annunci/222/">Senza foto</a></li>
    </ul>`;
});

describe('renderBadge', () => {
  it('crea il badge sopra la foto della card', () => {
    expect(renderBadge(document, ev())).toBe('created');
    const badge = document.querySelector<HTMLElement>(`#card .nd-slideshow__content > [${BADGE_ATTR}]`)!;
    expect(badge.textContent).toBe('● Alta · 173 gg · −5,6%');
    expect(badge.dataset.priority).toBe('high');
    expect(badge.style.position).toBe('absolute');
    expect(badge.style.pointerEvents).toBe('none');
    expect(document.querySelector<HTMLElement>('#card .nd-slideshow__content')!.style.position).toBe('relative');
  });

  it('non tocca il DOM se il badge è già aggiornato', () => {
    renderBadge(document, ev());
    const node = document.querySelector(`[${BADGE_ATTR}]`)!.firstChild;
    expect(renderBadge(document, ev())).toBe('unchanged');
    expect(document.querySelector(`[${BADGE_ATTR}]`)!.firstChild).toBe(node);
  });

  it('aggiorna testo e priorità', () => {
    renderBadge(document, ev());
    expect(renderBadge(document, ev({ priority: 'medium', badgeText: '● Media · 173 gg' }))).toBe('updated');
    expect(document.querySelectorAll(`[${BADGE_ATTR}]`)).toHaveLength(1);
    expect(document.querySelector<HTMLElement>(`[${BADGE_ATTR}]`)!.dataset.priority).toBe('medium');
  });

  it('usa la card intera se manca la foto e salta gli annunci senza card', () => {
    expect(renderBadge(document, ev({ portalId: 222 }))).toBe('created');
    expect(renderBadge(document, ev({ portalId: 999 }))).toBe('no-card');
  });
});
