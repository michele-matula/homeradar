import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/ui/sidepanel/App';
import type { Api } from '@/ui/sidepanel/api';
import { LeadItem } from '@/ui/sidepanel/LeadItem';
import { Sparkline } from '@/ui/sidepanel/Sparkline';
import { DEFAULT_SETTINGS, type LeadStatus, type LeadView, type Priority } from '@/shared/types';

afterEach(cleanup);

function lead(id: number, priority: Priority, status: LeadStatus = 'new'): LeadView {
  const key = `immobiliare:${id}`;
  return {
    listing: {
      key, portal: 'immobiliare', portalId: id, url: `https://www.immobiliare.it/annunci/${id}/`, title: `Bilocale ${id}`,
      address: null, city: 'Milano', zone: null, typology: null, surfaceM2: null, rooms: null, currentPrice: 235000,
      portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 3,
    },
    evaluation: {
      listingKey: key, portalId: id, priority, ageDays: 173, ageEstimated: false, ageUncertain: false, dropPercent: 5.6,
      dropCount: 1, maxKnownPrice: 249000, reasons: ['Online da 173 gg', 'Ribassato del 5,6%'], badgeText: '',
    },
    state: { listingKey: key, status, notes: '', statusChangedAt: 0 },
    prices: [
      { listingKey: key, price: 249000, at: 1, source: 'declared' },
      { listingKey: key, price: 235000, at: 2, source: 'declared' },
    ],
  };
}

function fakeApi(leads: LeadView[], adapterWarning = false): Api {
  return {
    listLeads: vi.fn(async () => leads),
    setLeadState: vi.fn(async (k, p) => ({ listingKey: k, status: p.status ?? 'new', notes: p.notes ?? '', statusChangedAt: 0 })),
    deleteListing: vi.fn(async () => {}),
    deleteListings: vi.fn(async () => {}),
    deleteAllListings: vi.fn(async () => leads.length),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (s) => s),
    getDiagnostics: vi.fn(async () => ({ version: '0.1.0', counters: {}, errors: [], adapterWarning })),
    onLeadsChanged: vi.fn(() => () => {}),
  };
}

describe('Sparkline', () => {
  it('non disegna nulla con meno di due prezzi', () => {
    const { container } = render(<Sparkline prices={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
  it('disegna una linea con un punto per prezzo', () => {
    const { container } = render(<Sparkline prices={[249000, 235000, 230000]} />);
    expect(container.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(3);
  });
});

describe('LeadItem', () => {
  it('mostra priorità, titolo, motivi e visite', () => {
    render(<ul><LeadItem lead={lead(1, 'high')} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText('Bilocale 1 — € 235.000')).toBeTruthy();
    expect(screen.getByText('Online da 173 gg · Ribassato del 5,6% · Visto 3 volte')).toBeTruthy();
  });

  it('cambia stato, salva le note all\'uscita e chiede conferma prima di eliminare', () => {
    const onChange = vi.fn();
    const onDelete = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} onChange={onChange} onDelete={onDelete} /></ul>);
    fireEvent.change(screen.getByLabelText('Stato'), { target: { value: 'to_contact' } });
    expect(onChange).toHaveBeenCalledWith({ status: 'to_contact' });
    const notes = screen.getByLabelText('Note');
    fireEvent.change(notes, { target: { value: 'chiamare' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.blur(notes);
    expect(onChange).toHaveBeenLastCalledWith({ notes: 'chiamare' });
    fireEvent.click(screen.getByText('Elimina'));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Conferma eliminazione'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('App', () => {
  it('mostra le schede con i conteggi e filtra per stato', async () => {
    render(<App api={fakeApi([lead(1, 'high'), lead(2, 'medium'), lead(3, 'medium', 'contacted')])} />);
    expect(await screen.findByText('Nuovi (2)')).toBeTruthy();
    expect(screen.getByText('Contattati (1)')).toBeTruthy();
    expect(screen.getByText('Bilocale 1 — € 235.000')).toBeTruthy();
    expect(screen.queryByText('Bilocale 3 — € 235.000')).toBeNull();
    fireEvent.click(screen.getByText('Contattati (1)'));
    expect(screen.getByText('Bilocale 3 — € 235.000')).toBeTruthy();
  });

  it('elimina tutti gli annunci della scheda corrente dopo conferma', async () => {
    const api = fakeApi([lead(1, 'high'), lead(2, 'medium'), lead(3, 'medium', 'contacted')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByText('Elimina tutti (2)'));
    expect(api.deleteListings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Annulla'));
    fireEvent.click(screen.getByText('Contattati (1)'));
    fireEvent.click(screen.getByText('Elimina tutti (1)'));
    fireEvent.click(screen.getByText('Conferma: elimina 1 annuncio'));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:3']);
  });

  it('azzera l\'archivio dalle impostazioni dopo conferma', async () => {
    const api = fakeApi([lead(1, 'high'), lead(2, 'medium')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByText('⚙ Impostazioni'));
    fireEvent.click(await screen.findByText('Azzera archivio annunci'));
    fireEvent.click(screen.getByText('Annulla'));
    expect(api.deleteAllListings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Azzera archivio annunci'));
    fireEvent.click(screen.getByText('Conferma: azzera tutto'));
    expect(await screen.findByText('Archivio azzerato: 2 annunci eliminati')).toBeTruthy();
    expect(api.deleteAllListings).toHaveBeenCalledTimes(1);
  });

  it('mostra il banner quando l\'adattatore segnala un problema', async () => {
    render(<App api={fakeApi([], true)} />);
    expect(await screen.findByText('Immobiliare.it potrebbe essere cambiato: alcuni dati non sono stati letti.')).toBeTruthy();
    expect(screen.getByText('Nessun lead in questa scheda. Naviga su Immobiliare.it per raccoglierne.')).toBeTruthy();
    expect(screen.queryByText(/Elimina tutti/)).toBeNull();
  });

  it('mostra un errore se il database non risponde, lasciando l\'export disponibile', async () => {
    const api = fakeApi([]);
    api.listLeads = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    render(<App api={api} />);
    expect(await screen.findByText('Errore: QuotaExceededError')).toBeTruthy();
    expect(screen.getByText('⬇ Esporta XLSX')).toBeTruthy();
  });
});
