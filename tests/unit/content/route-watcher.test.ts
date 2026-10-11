import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteWatcher } from '@/content/route-watcher';

let url = 'https://www.immobiliare.it/vendita-case/milano/';
const onMissing = vi.fn();
const make = () => new RouteWatcher({
  getUrl: () => url,
  isRelevant: (u) => u.includes('/vendita-'),
  timeoutMs: 5000,
  graceMs: 3000,
  onMissing,
});

beforeEach(() => {
  vi.useFakeTimers();
  onMissing.mockReset();
  url = 'https://www.immobiliare.it/vendita-case/milano/';
});
afterEach(() => vi.useRealTimers());

describe('RouteWatcher', () => {
  it('nessun banner se i dati arrivano dopo il cambio rotta', () => {
    const w = make();
    w.check();
    vi.advanceTimersByTime(2000);
    w.notifyPayload();
    vi.advanceTimersByTime(5000);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('nessun banner se i dati arrivano poco prima del cambio URL', () => {
    const w = make();
    w.check();
    w.notifyPayload();
    vi.advanceTimersByTime(1000);
    w.notifyPayload();
    url = 'https://www.immobiliare.it/vendita-case/milano/?pag=2';
    w.check();
    vi.advanceTimersByTime(6000);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('banner se dopo un cambio rotta non arriva nulla', () => {
    const w = make();
    w.check();
    w.notifyPayload();
    vi.advanceTimersByTime(10_000);
    url = 'https://www.immobiliare.it/vendita-case/milano/?pag=2';
    w.check();
    vi.advanceTimersByTime(5000);
    expect(onMissing).toHaveBeenCalledWith('https://www.immobiliare.it/vendita-case/milano/?pag=2');
  });

  it('ignora le pagine non gestite e le verifiche senza cambio URL', () => {
    url = 'https://www.immobiliare.it/';
    const w = make();
    w.check();
    w.check();
    vi.advanceTimersByTime(10_000);
    expect(onMissing).not.toHaveBeenCalled();
  });
});
