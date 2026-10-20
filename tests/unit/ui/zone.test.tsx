import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type SearchArea } from '@/shared/types';
import { ZoneEditor } from '@/ui/sidepanel/ZoneEditor';

afterEach(cleanup);

describe('ZoneEditor', () => {
  it('aggiunge un comune dai suggerimenti e lo toglie', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ZoneEditor value={DEFAULT_SETTINGS.searchArea} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Comuni'), { target: { value: 'trevig' } });
    fireEvent.click(screen.getByRole('button', { name: 'Treviglio (BG)' }));
    const next = onChange.mock.calls[0]![0] as SearchArea;
    expect(next.comuni.map((c) => c.name)).toEqual(['Treviglio']);
    rerender(<ZoneEditor value={next} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Togli Treviglio' }));
    expect((onChange.mock.calls[1]![0] as SearchArea).comuni).toEqual([]);
  });

  it("l'ultima categoria non si può togliere", () => {
    const onChange = vi.fn();
    render(<ZoneEditor value={{ comuni: [], categories: ['garage'] }} onChange={onChange} />);
    expect((screen.getByRole('checkbox', { name: 'Box' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terreni' }));
    expect(onChange).toHaveBeenCalledWith({ comuni: [], categories: ['land', 'garage'] });
  });

  it('mostra la durata stimata del giro', () => {
    const cassano = { istat: '015059', name: "Cassano d'Adda", province: 'MI' };
    const { rerender } = render(<ZoneEditor value={{ comuni: [cassano], categories: ['residential'] }} onChange={vi.fn()} />);
    expect(screen.getByText('Circa 4 ricerche: il giro dura circa 1 minuto.')).toBeTruthy();
    rerender(<ZoneEditor value={{ comuni: [cassano], categories: ['residential', 'commercial', 'land', 'garage'] }} onChange={vi.fn()} />);
    expect(screen.getByText('Circa 13 ricerche: il giro dura circa 3 minuti.')).toBeTruthy();
  });
});
