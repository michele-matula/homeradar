import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type SweepStatus } from '@/shared/types';
import { SweepCard } from '@/ui/sidepanel/SweepCard';

function api(status: SweepStatus, comuni = 1) {
  return {
    getSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, searchArea: { ...DEFAULT_SETTINGS.searchArea, comuni: Array.from({ length: comuni }, (_, i) => ({ istat: `01600${i}`, name: `C${i}`, province: 'BG' })) } })),
    getSweepStatus: vi.fn(async () => status),
    startSweep: vi.fn(async () => status),
    stopSweep: vi.fn(async () => status),
    onSweepChanged: () => () => {},
  };
}

afterEach(cleanup);

describe('SweepCard', () => {
  it('senza comuni manda alle impostazioni', async () => {
    const onOpenSettings = vi.fn();
    render(<SweepCard api={api({ running: null, last: null }, 0)} onShowNew={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Imposta la tua zona' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('a riposo avvia il giro', async () => {
    const a = api({ running: null, last: null });
    render(<SweepCard api={a} onShowNew={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('Giro di oggi da fare')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cerca' }));
    expect(a.startSweep).toHaveBeenCalled();
  });

  it('in corso mostra avanzamento e Ferma', async () => {
    const a = api({ running: { startedAt: Date.now(), total: 10, done: 4, current: 'Treviglio · Case', portals: { immobiliare: { pages: 5, privates: 30 } }, newCount: 2, drops: 1 }, last: null });
    render(<SweepCard api={a} onShowNew={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('Treviglio · Case')).toBeTruthy();
    expect(screen.getByText(/5 pagine · 30 privati/)).toBeTruthy();
    expect(screen.getByText('Finora: 2 nuovi · 1 ribassi')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ferma' }));
    expect(a.stopSweep).toHaveBeenCalled();
  });

  it('a fine giro (in questa sessione) mostra il riepilogo e i motivi', async () => {
    const now = Date.now();
    const a = api({ running: null, last: {
      startedAt: now - 600_000, finishedAt: now + 1000, outcome: 'partial', newCount: 18, drops: 4, missing: 2, notFound: [],
      portals: { idealista: { pages: 3, privates: 9, outcome: 'blocked' } },
    } });
    const onShowNew = vi.fn();
    render(<SweepCard api={a} onShowNew={onShowNew} onOpenSettings={vi.fn()} />);
    expect(await screen.findByText('18 nuovi · 4 ribassi · 2 non più visti')).toBeTruthy();
    expect(screen.getByText('Idealista.it ha chiesto una verifica: aprilo tu e riprova domani.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vedi i nuovi' }));
    expect(onShowNew).toHaveBeenCalledWith(now - 600_000);
  });
});
