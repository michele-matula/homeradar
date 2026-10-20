import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildBackup } from '@/core/backup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/ui/sidepanel/App';
import type { Api } from '@/ui/sidepanel/api';
import { LeadItem } from '@/ui/sidepanel/LeadItem';
import { Sparkline } from '@/ui/sidepanel/Sparkline';
import { DEFAULT_SETTINGS, type Diagnostics, type LeadStatus, type LeadView, type Portal, type Priority } from '@/shared/types';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function lead(id: number, priority: Priority, status: LeadStatus = 'new'): LeadView {
  const key = `immobiliare:${id}`;
  return {
    listing: {
      key, portal: 'immobiliare', portalId: id, url: `https://www.immobiliare.it/annunci/${id}/`, title: `Bilocale ${id}`,
      address: null, city: 'Milano', zone: null, typology: null, surfaceM2: null, rooms: null, currentPrice: 235000,
      portalCreatedAt: null, estimatedCreatedAt: null, lastDrop: null, firstSeenAt: 0, lastSeenAt: 0, seenCount: 3, category: 'residential', sweepScope: null, missedSweeps: 0, missingSince: null,
    },
    evaluation: {
      listingKey: key, portalId: id, priority, ageDays: 173, ageEstimated: false, ageUncertain: false, dropPercent: 5.6,
      dropCount: 1, maxKnownPrice: 249000, reasons: ['Online da 173 gg', 'Ribassato del 5,6%'], badgeText: '',
    },
    state: { listingKey: key, status, notes: '', statusChangedAt: 0, updatedAt: 0, recallAt: null },
    prices: [
      { listingKey: key, price: 249000, at: 1, source: 'declared' },
      { listingKey: key, price: 235000, at: 2, source: 'declared' },
    ],
    market: null,
    others: [],
    covers: [],
    reposted: false, missing: null, missingPortals: [],
  };
}

const today = () => new Date(new Date().setHours(0, 0, 0, 0)).getTime();
const dayOffset = (n: number) => {
  const d = new Date(today());
  d.setDate(d.getDate() + n);
  return d.getTime();
};
const withRecall = (l: LeadView, recallAt: number | null, status: LeadStatus = 'contacted'): LeadView => ({ ...l, state: { ...l.state, status, recallAt } });

function from(portal: Portal, l: LeadView): LeadView {
  const key = `${portal}:${l.listing.portalId}`;
  return { ...l, listing: { ...l.listing, key, portal }, evaluation: { ...l.evaluation, listingKey: key }, state: { ...l.state, listingKey: key } };
}

function fakeApi(leads: LeadView[], adapterWarning: Diagnostics['adapterWarning'] = {}): Api {
  return {
    listLeads: vi.fn(async () => leads),
    splitListing: vi.fn(async () => {}),
    setLeadState: vi.fn(async (k, p) => ({ listingKey: k, status: p.status ?? 'new', notes: p.notes ?? '', statusChangedAt: 0, updatedAt: 0, recallAt: null })),
    deleteListing: vi.fn(async () => {}),
    deleteListings: vi.fn(async () => {}),
    deleteAllListings: vi.fn(async () => leads.length),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (s) => s),
    getDiagnostics: vi.fn(async () => ({ version: '0.1.0', counters: {}, errors: [], adapterWarning })),
    onLeadsChanged: vi.fn(() => () => {}),
    exportBackup: vi.fn(async () => buildBackup({ listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, 0, '0.1.0')),
    importBackup: vi.fn(async () => ({ added: 0, updated: 0, unchanged: 0 })),
    getBackupStatus: vi.fn(async () => ({ lastAt: null, lastAutoFailedAt: null, nextSlot: 1, pending: null })),
    getOnboardingStatus: vi.fn(async () => ({ acceptedVersion: 1, acceptedAt: 0, current: 1 })),
    acceptOnboarding: vi.fn(async () => ({ acceptedVersion: 1, acceptedAt: 0, current: 1 })),
    onOnboardingChanged: vi.fn(() => () => {}),
    startSweep: vi.fn(async () => ({ running: null, last: null })),
    stopSweep: vi.fn(async () => ({ running: null, last: null })),
    getSweepStatus: vi.fn(async () => ({ running: null, last: null })),
    onSweepChanged: vi.fn(() => () => {}),
    getReportingInfo: vi.fn(async () => ({ configured: true, queued: 0, status: { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false } })),
    sendReportNow: vi.fn(),
    previewReport: vi.fn(),
    sendFeedback: vi.fn(async () => 'sent' as const),
    trackUsage: vi.fn(async () => {}),
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
  it('per Idealista chiama "Età incerta" la priorità da verificare', () => {
    const l = lead(1, 'verify');
    const fromIdealista = { ...l, listing: { ...l.listing, key: 'idealista:1', portal: 'idealista' as const } };
    render(<ul><LeadItem lead={fromIdealista} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Età incerta')).toBeTruthy();
    expect(screen.queryByText('Da verificare')).toBeNull();
  });

  it('mostra il portale di provenienza', () => {
    const l = lead(1, 'high');
    const fromIdealista = { ...l, listing: { ...l.listing, key: 'idealista:1', portal: 'idealista' as const } };
    render(<ul><LeadItem lead={fromIdealista} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Idealista').className).toBe('portal-tag');
  });

  it('mostra "non più visto" e i portali da cui è sparito', () => {
    const l = { ...lead(1, 'high'), missing: Date.UTC(2026, 9, 15, 12) };
    const { unmount } = render(<ul><LeadItem lead={l} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Non più visto dal 15/10/2026')).toBeTruthy();
    unmount();
    render(<ul><LeadItem lead={{ ...lead(2, 'high'), missingPortals: ['idealista'] }} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Non più su Idealista')).toBeTruthy();
  });

  it('mostra "sopra mercato" con la spiegazione solo da +10%', () => {
    const market = { scope: 'zone' as const, label: 'Navigli', city: 'Milano', medianPerM2: 4200, sampleSize: 7, deltaPercent: 18.4 };
    render(<ul><LeadItem lead={{ ...lead(1, 'high'), market }} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('+18% su Navigli')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Informazioni: Sopra mercato' })).toBeTruthy();
    expect(screen.getByText(/Mediana dei privati visti in zona Navigli \(Milano\): 4\.200 €\/m² su 7 annunci/)).toBeTruthy();
    cleanup();
    render(<ul><LeadItem lead={{ ...lead(1, 'high'), market: { ...market, deltaPercent: 9.96 } }} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByText(/su Navigli/)).toBeNull();
    cleanup();
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByRole('button', { name: 'Informazioni: Sopra mercato' })).toBeNull();
  });

  it('mostra priorità, titolo, motivi e visite', () => {
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.getByText('Alta')).toBeTruthy();
    expect(screen.getByText('Bilocale 1')).toBeTruthy();
    expect(screen.getByText('€ 235.000')).toBeTruthy();
    expect(screen.getByText('Online da 173 gg · Ribassato del 5,6% · Visto 3 volte')).toBeTruthy();
  });

  it('cambia stato, salva le note all\'uscita e chiede conferma prima di eliminare', () => {
    const onChange = vi.fn();
    const onDelete = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={onChange} onDelete={onDelete} /></ul>);
    fireEvent.change(screen.getByLabelText('Stato'), { target: { value: 'to_contact' } });
    expect(onChange).toHaveBeenCalledWith({ status: 'to_contact' });
    const notes = screen.getByLabelText('Note');
    fireEvent.change(notes, { target: { value: 'chiamare' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.blur(notes);
    expect(onChange).toHaveBeenLastCalledWith({ notes: 'chiamare' });
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Conferma eliminazione'));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('senza richiamo: "Richiama…" apre data e scorciatoie; una scorciatoia salva il giorno', () => {
    const onChange = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={onChange} onDelete={() => {}} /></ul>);
    expect(screen.queryByLabelText('Data del richiamo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Richiama…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tra 3 giorni' }));
    expect(onChange).toHaveBeenCalledWith({ recallAt: dayOffset(3) });
    expect(screen.queryByLabelText('Data del richiamo')).toBeNull();
  });

  it('il campo data salva solo uscendo dal campo o con Invio, non a ogni cifra; un campo svuotato non salva nulla', () => {
    const onChange = vi.fn();
    render(<ul><LeadItem lead={withRecall(lead(1, 'high'), dayOffset(4))} now={Date.now()} onChange={onChange} onDelete={() => {}} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Sposta…' }));
    const field = () => screen.getByLabelText('Data del richiamo');
    // Scrivendo l'anno da tastiera Chrome passa da date intermedie valide (0202-03-09).
    fireEvent.change(field(), { target: { value: '0202-03-09' } });
    fireEvent.change(field(), { target: { value: '2031-03-09' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ recallAt: new Date(2031, 2, 9).getTime() });

    onChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Sposta…' }));
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: '2031-04-01' } });
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith({ recallAt: new Date(2031, 3, 1).getTime() });
  });

  it('le scorciatoie contano dal giorno in cui si clicca, anche se il pannello è aperto da ieri', () => {
    const onChange = vi.fn();
    render(<ul><LeadItem lead={lead(1, 'high')} now={dayOffset(-1) + 12 * 3600_000} onChange={onChange} onDelete={() => {}} /></ul>);
    fireEvent.click(screen.getByRole('button', { name: 'Richiama…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(onChange).toHaveBeenCalledWith({ recallAt: dayOffset(1) });
  });

  it('con un richiamo scaduto: etichetta rossa, "Fatto" lo toglie, "Sposta…" riapre le scorciatoie', () => {
    const onChange = vi.fn();
    const { container } = render(<ul><LeadItem lead={withRecall(lead(1, 'high'), dayOffset(-2))} now={Date.now()} onChange={onChange} onDelete={() => {}} /></ul>);
    expect(screen.getByText(/scaduto da 2 giorni/)).toBeTruthy();
    expect(container.querySelector('.lead--overdue')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fatto' }));
    expect(onChange).toHaveBeenCalledWith({ recallAt: null });
    fireEvent.click(screen.getByRole('button', { name: 'Sposta…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(onChange).toHaveBeenLastCalledWith({ recallAt: dayOffset(1) });
  });

  it("su un lead scartato non c'è la riga del richiamo", () => {
    render(<ul><LeadItem lead={lead(1, 'high', 'discarded')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByRole('button', { name: 'Richiama…' })).toBeNull();
  });
});

describe('App', () => {
  it("segna l'apertura del pannello e gli export", async () => {
    const api = fakeApi([lead(1, 'high')]);
    // jsdom non crea URL blob: il download vero non interessa qui.
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App api={api} />);
    await screen.findByRole('button', { name: /CSV/ });
    expect(api.trackUsage).toHaveBeenCalledWith({ kind: 'panel' });
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(api.trackUsage).toHaveBeenCalledWith({ kind: 'export', format: 'csv' });
  });
  const titles = () => screen.getAllByText(/^Bilocale \d+$/).map((e) => e.textContent);
  const withPrice = (l: LeadView, currentPrice: number): LeadView => ({ ...l, listing: { ...l.listing, currentPrice } });
  const at = (l: LeadView, listing: Partial<LeadView['listing']>): LeadView => ({ ...l, listing: { ...l.listing, ...listing } });

  it('scheda "Richiami": tutti gli stati, gruppi Scaduti/Oggi/Prossimi, senza ordinamento né "Elimina tutti"', async () => {
    const leads = [
      withRecall(lead(1, 'high'), dayOffset(3), 'to_contact'),
      withRecall(lead(2, 'medium'), dayOffset(-1), 'contacted'),
      withRecall(lead(3, 'medium'), today(), 'contacted'),
      lead(4, 'high'),
    ];
    render(<App api={fakeApi(leads)} />);
    // Ci sono richiami da fare: il pannello parte dalla scheda "Richiami".
    const tab = await screen.findByRole('tab', { name: 'Richiami (2 da fare)' });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Scaduti', 'Oggi', 'Prossimi']);
    expect(titles()).toEqual(['Bilocale 2', 'Bilocale 3', 'Bilocale 1']);
    expect(screen.queryByText('Ordina per')).toBeNull();
    expect(screen.queryByText(/^Elimina tutti/)).toBeNull();
  });

  it('senza richiami da fare parte da "Nuovi" e la scheda mostra il totale', async () => {
    render(<App api={fakeApi([withRecall(lead(1, 'high'), dayOffset(5)), lead(2, 'high')])} />);
    expect((await screen.findByRole('tab', { name: 'Nuovi (1)' })).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Richiami (1)' }));
    expect(titles()).toEqual(['Bilocale 1']);
  });

  it('scheda "Richiami" vuota: spiega come impostarne uno', async () => {
    render(<App api={fakeApi([lead(1, 'high')])} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Richiami (0)' }));
    expect(screen.getByText('Nessun richiamo. Imposta una data di ricontatto su un lead con «Richiama…».')).toBeTruthy();
  });

  it('un richiamo impostato dal pannello passa al servizio', async () => {
    const api = fakeApi([lead(1, 'high')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Richiama…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Domani' }));
    expect(api.setLeadState).toHaveBeenCalledWith(['immobiliare:1'], { recallAt: dayOffset(1) });
  });

  it('ordina la lista col criterio scelto, ricordandolo per scheda anche alla riapertura', async () => {
    const leads = [withPrice(lead(1, 'high'), 300000), withPrice(lead(2, 'medium'), 100000), withPrice(lead(3, 'high', 'contacted'), 50000), withPrice(lead(4, 'high', 'contacted'), 90000)];
    const { unmount } = render(<App api={fakeApi(leads)} />);
    const sort = (await screen.findByLabelText('Ordina per')) as HTMLSelectElement;
    expect(sort.value).toBe('priority');
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2']);
    fireEvent.change(sort, { target: { value: 'price_asc' } });
    expect(titles()).toEqual(['Bilocale 2', 'Bilocale 1']);
    // L'altra scheda mantiene il proprio ordinamento.
    fireEvent.click(screen.getByRole('tab', { name: 'Contattati (2)' }));
    expect((screen.getByLabelText('Ordina per') as HTMLSelectElement).value).toBe('priority');
    fireEvent.change(screen.getByLabelText('Ordina per'), { target: { value: 'price_desc' } });
    expect(titles()).toEqual(['Bilocale 4', 'Bilocale 3']);
    unmount();

    render(<App api={fakeApi(leads)} />);
    await screen.findByText('Bilocale 1');
    expect((screen.getByLabelText('Ordina per') as HTMLSelectElement).value).toBe('price_asc');
    expect(titles()).toEqual(['Bilocale 2', 'Bilocale 1']);
    fireEvent.click(screen.getByRole('tab', { name: 'Contattati (2)' }));
    expect((screen.getByLabelText('Ordina per') as HTMLSelectElement).value).toBe('price_desc');
  });

  it('con un ordinamento salvato illeggibile torna alla priorità', async () => {
    localStorage.setItem('homeradar.sortByTab', '{"new":"boh"');
    render(<App api={fakeApi([lead(1, 'high')])} />);
    expect(((await screen.findByLabelText('Ordina per')) as HTMLSelectElement).value).toBe('priority');
    localStorage.setItem('homeradar.sortByTab', '{"new":"boh","contacted":"drop"}');
    cleanup();
    render(<App api={fakeApi([lead(1, 'high')])} />);
    expect(((await screen.findByLabelText('Ordina per')) as HTMLSelectElement).value).toBe('priority');
  });

  it('filtra per sito, anche più siti insieme, combinandosi con il filtro per badge', async () => {
    const api = fakeApi([lead(1, 'high'), from('subito', lead(2, 'high')), from('idealista', lead(3, 'medium')), from('subito', lead(4, 'medium'))]);
    render(<App api={api} />);
    const site = (name: string) => screen.getByRole('button', { name });
    expect((await screen.findByRole('button', { name: 'Tutti i siti' })).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(site('Subito (2)'));
    expect(screen.getByText('Bilocale 2')).toBeTruthy();
    expect(screen.getByText('Bilocale 4')).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Alta (1)' })).toBeTruthy();
    fireEvent.click(site('Idealista (1)'));
    expect(screen.getByText('Bilocale 3')).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Media (2)' }));
    expect(site('Immobiliare (0)').hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByText('Elimina tutti «Media, Idealista e Subito» (2)'));
    fireEvent.click(screen.getByText('Conferma: elimina 2 annunci «Media, Idealista e Subito»'));
    expect(api.deleteListings).toHaveBeenCalledWith(['idealista:3', 'subito:4']);
    // Togliere un sito lo esclude; "Tutti i siti" azzera il filtro.
    fireEvent.click(site('Subito (1)'));
    expect(screen.queryByText('Bilocale 4')).toBeNull();
    fireEvent.click(site('Tutti i siti'));
    expect(screen.getByText('Bilocale 4')).toBeTruthy();
  });

  it('selezionare tutti i siti equivale a "Tutti i siti"', async () => {
    render(<App api={fakeApi([lead(1, 'high'), from('subito', lead(2, 'high')), from('idealista', lead(3, 'high'))])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Immobiliare (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Idealista (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Subito (1)' }));
    expect(screen.getByRole('button', { name: 'Tutti i siti' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Subito (1)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('spegne un portale dalle impostazioni salvando subito', async () => {
    const api = fakeApi([]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Impostazioni' }));
    const subito = await screen.findByRole('switch', { name: 'Subito.it' });
    expect((subito as HTMLInputElement).checked).toBe(true);
    fireEvent.click(subito);
    expect(await screen.findByText('Subito.it disattivato')).toBeTruthy();
    expect(api.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, enabledPortals: { immobiliare: true, idealista: true, subito: false } });
    expect((screen.getByRole('switch', { name: 'Subito.it' }) as HTMLInputElement).checked).toBe(false);
  });

  it('spiega ogni impostazione con un tooltip che compare al focus e si chiude con Esc', async () => {
    render(<App api={fakeApi([])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Impostazioni' }));
    const names = [
      'Regole dei lead', 'Soglia anzianità (giorni)', 'Ribasso minimo (%)', 'Conservazione annunci non lavorati (giorni)',
      'Immobiliare.it', 'Idealista.it', 'Subito.it', 'Copia report diagnostico', 'Azzera archivio annunci',
    ];
    for (const name of names) expect(await screen.findByRole('button', { name: `Informazioni: ${name}` })).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    const info = screen.getByRole('button', { name: 'Informazioni: Conservazione annunci non lavorati (giorni)' });
    fireEvent.focus(info);
    expect(screen.getByRole('tooltip').textContent).toContain('non vengono mai eliminati');
    fireEvent.keyDown(info, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Il campo resta etichettato dal suo testo, non dal tooltip.
    expect(screen.getByLabelText('Soglia anzianità (giorni)')).toBeTruthy();
  });

  it("nel banner nomina il portale con l'avviso", async () => {
    render(<App api={fakeApi([], { immobiliare: false, idealista: true })} />);
    expect(await screen.findByText('Idealista.it potrebbe essere cambiato: alcuni dati non sono stati letti.')).toBeTruthy();
  });

  it('con più portali li elenca tutti', async () => {
    render(<App api={fakeApi([], { immobiliare: true, idealista: true, subito: true })} />);
    expect(await screen.findByText('Immobiliare.it, Idealista.it e Subito.it potrebbero essere cambiati: alcuni dati non sono stati letti.')).toBeTruthy();
  });

  it('mostra le schede con i conteggi e filtra per stato', async () => {
    render(<App api={fakeApi([lead(1, 'high'), lead(2, 'medium'), lead(3, 'medium', 'contacted')])} />);
    expect(await screen.findByRole('tab', { name: 'Nuovi (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contattati (1)' })).toBeTruthy();
    expect(screen.getByText('Bilocale 1')).toBeTruthy();
    expect(screen.queryByText('Bilocale 3')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Contattati (1)' }));
    expect(screen.getByText('Bilocale 3')).toBeTruthy();
  });

  it('elimina tutti gli annunci della scheda corrente dopo conferma', async () => {
    const api = fakeApi([lead(1, 'high'), lead(2, 'medium'), lead(3, 'medium', 'contacted')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByText('Elimina tutti (2)'));
    expect(api.deleteListings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Annulla'));
    fireEvent.click(screen.getByRole('tab', { name: 'Contattati (1)' }));
    fireEvent.click(screen.getByText('Elimina tutti (1)'));
    fireEvent.click(screen.getByText('Conferma: elimina 1 annuncio'));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:3']);
  });

  it('filtra per badge con i conteggi della scheda e mantiene il filtro cambiando scheda', async () => {
    render(<App api={fakeApi([lead(1, 'high'), lead(2, 'medium'), lead(3, 'verify'), lead(4, 'verify'), lead(5, 'high', 'contacted')])} />);
    expect(await screen.findByRole('radio', { name: 'Tutti (4)' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Tutti (4)' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Da verificare (2)' }));
    expect(screen.getByText('Bilocale 3')).toBeTruthy();
    expect(screen.getByText('Bilocale 4')).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    expect(screen.queryByText('Bilocale 2')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Contattati (1)' }));
    expect(screen.getByRole('radio', { name: 'Da verificare (0)' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Media (0)' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Nessun lead «Da verificare» in questa scheda.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Alta (1)' }));
    expect(screen.getByText('Bilocale 5')).toBeTruthy();
  });

  it('con un filtro attivo "Elimina tutti" agisce solo sugli annunci filtrati', async () => {
    const api = fakeApi([lead(1, 'high'), lead(2, 'verify'), lead(3, 'verify')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Da verificare (2)' }));
    fireEvent.click(screen.getByText('Elimina tutti «Da verificare» (2)'));
    fireEvent.click(screen.getByText('Conferma: elimina 2 annunci «Da verificare»'));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:2', 'immobiliare:3']);
  });

  it('azzera l\'archivio dalle impostazioni dopo conferma', async () => {
    const api = fakeApi([lead(1, 'high'), lead(2, 'medium')]);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Impostazioni' }));
    fireEvent.click(await screen.findByText('Azzera archivio annunci'));
    fireEvent.click(screen.getByText('Annulla'));
    expect(api.deleteAllListings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Azzera archivio annunci'));
    fireEvent.click(screen.getByText('Conferma: azzera tutto'));
    expect(await screen.findByText('Archivio azzerato: 2 annunci eliminati')).toBeTruthy();
    expect(api.deleteAllListings).toHaveBeenCalledTimes(1);
  });

  it('mostra il banner quando l\'adattatore segnala un problema', async () => {
    render(<App api={fakeApi([], { immobiliare: true })} />);
    expect(await screen.findByText('Immobiliare.it potrebbe essere cambiato: alcuni dati non sono stati letti.')).toBeTruthy();
    expect(screen.getByText('Nessun lead in questa scheda. Premi «Cerca» o naviga su Immobiliare.it, Idealista.it o Subito.it per raccoglierne.')).toBeTruthy();
    expect(screen.queryByText(/Elimina tutti/)).toBeNull();
  });

  it('mostra un errore se il database non risponde, lasciando l\'export disponibile', async () => {
    const api = fakeApi([]);
    api.listLeads = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    render(<App api={api} />);
    expect(await screen.findByText('Errore: QuotaExceededError')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Esporta XLSX' })).toBeTruthy();
  });

  it('la ricerca filtra lista e conteggi delle schede, su più campi e senza accenti', async () => {
    const leads = [
      at(lead(1, 'high'), { zone: 'Navile' }),
      at(lead(2, 'high'), { city: 'Bologna', zone: 'Navile', typology: 'Trilocale' }),
      lead(3, 'high'),
      at(lead(4, 'high', 'contacted'), { address: 'Via Città di Castello 3' }),
    ];
    render(<App api={fakeApi(leads)} />);
    const search = await screen.findByLabelText('Cerca nei lead');
    fireEvent.change(search, { target: { value: 'navile' } });
    expect(screen.getByRole('tab', { name: 'Nuovi (2)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contattati (0)' })).toBeTruthy();
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2']);
    fireEvent.change(search, { target: { value: 'Bologna  NAVILE' } });
    expect(titles()).toEqual(['Bilocale 2']);
    fireEvent.change(search, { target: { value: 'trilocale' } });
    expect(titles()).toEqual(['Bilocale 2']);
    fireEvent.change(search, { target: { value: 'citta' } });
    expect(screen.getByRole('tab', { name: 'Nuovi (0)' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Contattati (1)' })).toBeTruthy();
    expect(screen.getByText('Nessun lead «"citta"» in questa scheda.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Svuota ricerca' }));
    expect(screen.getByRole('tab', { name: 'Nuovi (3)' })).toBeTruthy();
    expect((screen.getByLabelText('Cerca nei lead') as HTMLInputElement).value).toBe('');
  });

  it('la fascia di prezzo in k€ esclude i lead fuori fascia e senza prezzo; un valore non valido non filtra', async () => {
    const leads = [withPrice(lead(1, 'high'), 150000), withPrice(lead(2, 'high'), 250000), withPrice(lead(3, 'high'), 300000), at(lead(4, 'high'), { currentPrice: null })];
    render(<App api={fakeApi(leads)} />);
    const min = await screen.findByLabelText('Prezzo minimo in migliaia di euro');
    const max = screen.getByLabelText('Prezzo massimo in migliaia di euro');
    expect(titles()).toHaveLength(4);
    fireEvent.change(min, { target: { value: '0' } });
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2', 'Bilocale 3']);
    fireEvent.change(min, { target: { value: '150' } });
    fireEvent.change(max, { target: { value: '250' } });
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2']);
    expect(screen.getByText('Elimina tutti «150–250 k€» (2)')).toBeTruthy();
    fireEvent.change(max, { target: { value: 'abc' } });
    expect(max.getAttribute('aria-invalid')).toBe('true');
    expect(min.getAttribute('aria-invalid')).toBe('false');
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 2', 'Bilocale 3']);
  });

  it('"Elimina tutti" riporta ricerca e prezzo, elimina solo i visibili e la conferma si annulla se cambia la ricerca', async () => {
    const api = fakeApi([
      at(withPrice(lead(1, 'high'), 200000), { zone: 'Navile' }),
      at(withPrice(lead(2, 'high'), 400000), { zone: 'Navile' }),
      withPrice(lead(3, 'high'), 200000),
    ]);
    render(<App api={api} />);
    fireEvent.change(await screen.findByLabelText('Cerca nei lead'), { target: { value: 'navile' } });
    fireEvent.change(screen.getByLabelText('Prezzo massimo in migliaia di euro'), { target: { value: '250' } });
    fireEvent.click(screen.getByText('Elimina tutti «"navile", fino a 250 k€» (1)'));
    expect(screen.getByText(/^Conferma: elimina/)).toBeTruthy();
    // Stesso numero di visibili, ricerca diversa: la conferma non deve sopravvivere.
    fireEvent.change(screen.getByLabelText('Cerca nei lead'), { target: { value: 'navil' } });
    expect(screen.queryByText(/^Conferma: elimina/)).toBeNull();
    fireEvent.click(screen.getByText('Elimina tutti «"navil", fino a 250 k€» (1)'));
    fireEvent.click(screen.getByText('Conferma: elimina 1 annuncio «"navil", fino a 250 k€»'));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:1']);
  });

  it('"Azzera filtri" compare solo con un filtro attivo e riporta tutto allo stato iniziale', async () => {
    render(<App api={fakeApi([lead(1, 'high'), lead(2, 'medium')])} />);
    const search = await screen.findByLabelText('Cerca nei lead');
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
    fireEvent.change(search, { target: { value: '   ' } });
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
    expect(screen.getByText('Elimina tutti (2)')).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Prezzo minimo in migliaia di euro'), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Azzera filtri' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'bilocale' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Alta (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Immobiliare (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Azzera filtri' }));
    expect((screen.getByLabelText('Cerca nei lead') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Prezzo minimo in migliaia di euro') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('radio', { name: 'Tutti (2)' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Tutti i siti' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Azzera filtri' })).toBeNull();
  });

  it('i filtri restano attivi e si applicano ai lead nuovi quando la lista si aggiorna; l\'export indica la vista filtrata', async () => {
    let notify = () => {};
    const api = fakeApi([at(lead(1, 'high'), { zone: 'Navile' }), lead(2, 'high')]);
    api.onLeadsChanged = vi.fn((cb: () => void) => {
      notify = cb;
      return () => {};
    });
    render(<App api={api} />);
    fireEvent.change(await screen.findByLabelText('Cerca nei lead'), { target: { value: 'navile' } });
    expect(screen.getByText('Esporta la vista corrente (1)')).toBeTruthy();
    // Dal portale arrivano un lead della zona cercata e uno di un'altra zona.
    api.listLeads = vi.fn(async () => [at(lead(1, 'high'), { zone: 'Navile' }), lead(2, 'high'), at(lead(5, 'high'), { zone: 'Navile' }), lead(6, 'high')]);
    await act(async () => notify());
    expect(titles()).toEqual(['Bilocale 1', 'Bilocale 5']);
    expect(screen.getByRole('tab', { name: 'Nuovi (2)' })).toBeTruthy();
    expect((screen.getByLabelText('Cerca nei lead') as HTMLInputElement).value).toBe('navile');
    expect(screen.getByText('Esporta la vista corrente (2)')).toBeTruthy();
  });
});

describe('App: informativa', () => {
  const never = { acceptedVersion: null, acceptedAt: null, current: 1 };

  it("senza conferma mostra l'informativa al posto della lista e nasconde le impostazioni", async () => {
    const api = fakeApi([lead(1, 'high')]);
    vi.mocked(api.getOnboardingStatus).mockResolvedValue(never);
    render(<App api={api} />);
    expect(await screen.findByRole('button', { name: 'Ho capito, inizia' })).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Impostazioni' })).toBeNull();
  });

  it('confermando nel pannello passa alla lista', async () => {
    const api = fakeApi([lead(1, 'high')]);
    // Due letture "mai confermata": quella del pannello e quella della schermata; poi confermata.
    vi.mocked(api.getOnboardingStatus).mockResolvedValueOnce(never).mockResolvedValueOnce(never);
    render(<App api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText('Bilocale 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Impostazioni' })).toBeTruthy();
  });

  it('passa alla lista quando la conferma arriva dalla scheda di benvenuto', async () => {
    const api = fakeApi([lead(1, 'high')]);
    let notify = () => {};
    vi.mocked(api.onOnboardingChanged).mockImplementation((cb) => {
      notify = cb;
      return () => {};
    });
    vi.mocked(api.getOnboardingStatus).mockResolvedValueOnce(never).mockResolvedValueOnce(never);
    render(<App api={api} />);
    await screen.findByRole('button', { name: 'Ho capito, inizia' });
    notify();
    expect(await screen.findByText('Bilocale 1')).toBeTruthy();
  });

  it('se lo stato non si legge mostra l\'errore e "Riprova", mai la lista', async () => {
    const api = fakeApi([lead(1, 'high')]);
    vi.mocked(api.getOnboardingStatus).mockRejectedValueOnce(new Error('Nessuna risposta dal background'));
    render(<App api={api} />);
    expect(await screen.findByText('Errore: Nessuna risposta dal background')).toBeTruthy();
    expect(screen.queryByText('Bilocale 1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Bilocale 1')).toBeTruthy();
  });

  it("dalle impostazioni si rivede l'informativa in sola lettura e si torna indietro", async () => {
    const api = fakeApi([lead(1, 'high')]);
    vi.mocked(api.getOnboardingStatus).mockResolvedValue({ acceptedVersion: 1, acceptedAt: Date.UTC(2026, 9, 15), current: 1 });
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    fireEvent.click(screen.getByRole('button', { name: 'Impostazioni' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rivedi informativa' }));
    expect(await screen.findByText('Confermata il 15/10/2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ho capito, inizia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(await screen.findByRole('button', { name: 'Rivedi informativa' })).toBeTruthy();
  });
});

/** Lead unito: il principale di Immobiliare e la stessa casa su Idealista. */
function merged(id: number, priority: Priority = 'high'): LeadView {
  const main = lead(id, priority);
  const twin = from('idealista', lead(id + 1000, priority));
  return { ...main, others: [{ listing: { ...twin.listing, currentPrice: 239000, surfaceM2: 62 }, evaluation: twin.evaluation, prices: [], previous: false }] };
}

/** Lead ripubblicato: la ripubblicazione su Immobiliare e l'annuncio precedente, tolto a settembre. */
function republished(id: number): LeadView {
  const main = lead(id, 'high');
  const before = lead(id - 500, 'medium');
  const previous = { listing: { ...before.listing, currentPrice: 260000, lastSeenAt: Date.UTC(2026, 8, 12, 10) }, evaluation: before.evaluation, prices: [], previous: true };
  return { ...main, reposted: true, others: [previous] };
}

describe('lead ripubblicato', () => {
  it('pillola "Ripubblicato", un solo portale, riga "Annuncio precedente" con "Separa"', () => {
    const onSplit = vi.fn();
    render(<ul><LeadItem lead={republished(1000)} now={Date.now()} onChange={() => {}} onDelete={() => {}} onSplit={onSplit} /></ul>);
    expect(screen.getByText('Ripubblicato')).toBeTruthy();
    expect(screen.queryByText(/Su \d portali/)).toBeNull();
    expect(screen.getAllByText('Immobiliare')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fonti (2)' }));
    expect(screen.getByText('Annuncio precedente · visto fino al 12/09')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Separa annuncio precedente Immobiliare' }));
    expect(onSplit).toHaveBeenCalledWith('immobiliare:500');
  });

  it('"Su più portali" non conta una catena sullo stesso portale', async () => {
    render(<App api={fakeApi([republished(1000), merged(1)])} />);
    await screen.findByText('Bilocale 1');
    expect(screen.getByRole('button', { name: 'Su più portali (1)' })).toBeTruthy();
  });
});

describe('lead su più portali', () => {
  it('mostra i portali, "Su 2 portali" e le fonti; "Separa" stacca la fonte', () => {
    const onSplit = vi.fn();
    render(<ul><LeadItem lead={merged(1)} now={Date.now()} onChange={() => {}} onDelete={() => {}} onSplit={onSplit} /></ul>);
    expect(screen.getByText('Immobiliare')).toBeTruthy();
    expect(screen.getByText('Idealista')).toBeTruthy();
    expect(screen.getByText('Su 2 portali')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Separa Idealista' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fonti (2)' }));
    expect(screen.getByText('€ 239.000 · 62 m²', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Separa Idealista' }));
    expect(onSplit).toHaveBeenCalledWith('idealista:1001');
  });

  it('un lead da solo non ha fonti né pillola', () => {
    render(<ul><LeadItem lead={lead(1, 'high')} now={Date.now()} onChange={() => {}} onDelete={() => {}} /></ul>);
    expect(screen.queryByText(/Su \d portali/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Fonti/ })).toBeNull();
  });

  it('elimina il gruppo intero, lo stato vale per tutte le fonti, separa con le altre chiavi', async () => {
    const api = fakeApi([merged(1)]);
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    fireEvent.change(screen.getByLabelText('Stato'), { target: { value: 'contacted' } });
    expect(api.setLeadState).toHaveBeenCalledWith(['immobiliare:1', 'idealista:1001'], { status: 'contacted' });
    fireEvent.click(screen.getByRole('button', { name: 'Fonti (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Separa Idealista' }));
    expect(api.splitListing).toHaveBeenCalledWith('idealista:1001', ['immobiliare:1']);
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma: elimina 2 annunci' }));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:1', 'idealista:1001']);
  });

  it('filtro per sito e "Su più portali"', async () => {
    const api = fakeApi([merged(1), lead(2, 'high')]);
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    // Il lead unito ha una fonte su Idealista: il filtro Idealista lo trova.
    fireEvent.click(screen.getByRole('button', { name: 'Idealista (1)' }));
    expect(screen.queryByText('Bilocale 2')).toBeNull();
    expect(screen.getByText('Bilocale 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Idealista (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Su più portali (1)' }));
    expect(screen.queryByText('Bilocale 2')).toBeNull();
    expect(screen.getByText(/Elimina tutti «su più portali» \(1\)/)).toBeTruthy();
  });
});

describe('eliminazione di massa con lead uniti', () => {
  it('la conferma conta gli annunci che verranno eliminati, non i lead', async () => {
    const api = fakeApi([merged(1), lead(2, 'high')]);
    render(<App api={api} />);
    await screen.findByText('Bilocale 1');
    fireEvent.click(screen.getByRole('button', { name: 'Elimina tutti (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conferma: elimina 3 annunci' }));
    expect(api.deleteListings).toHaveBeenCalledWith(['immobiliare:1', 'idealista:1001', 'immobiliare:2']);
  });
});

describe('filtri del giro', () => {
  const box = (id: number): LeadView => { const l = lead(id, 'high'); return { ...l, listing: { ...l.listing, category: 'garage' } }; };
  const visibleLeads = () => document.querySelectorAll('li.lead').length;

  it('filtra per categoria', async () => {
    render(<App api={fakeApi([lead(1, 'high'), box(2)])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Box (1)' }));
    expect(visibleLeads()).toBe(1);
    expect(screen.getByText('Bilocale 2')).toBeTruthy();
  });

  it('filtra i non più visti', async () => {
    render(<App api={fakeApi([lead(1, 'high'), { ...lead(2, 'high'), missing: 5 }])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Non più visti (1)' }));
    expect(visibleLeads()).toBe(1);
  });
});

describe('revisione: filtri per categoria multipli', () => {
  it('con una categoria scelta si può aggiungerne un\'altra', async () => {
    const box = (id: number): LeadView => { const l = lead(id, 'high'); return { ...l, listing: { ...l.listing, category: 'garage' } }; };
    render(<App api={fakeApi([lead(1, 'high'), box(2)])} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Residenziale (1)' }));
    const boxChip = screen.getByRole('button', { name: 'Box (1)' }) as HTMLButtonElement;
    expect(boxChip.disabled).toBe(false);
    fireEvent.click(boxChip);
    expect(document.querySelectorAll('li.lead').length).toBe(2);
  });
});

describe('LeadItem: copertina', () => {
  it("ogni lead ha la miniatura: foto se c'è, altrimenti riquadro neutro", () => {
    const cover = 'https://pwm.im-cdn.it/image/1/xxs-c.jpg';
    const { container, rerender } = render(<LeadItem lead={{ ...lead(1, 'high'), covers: [cover] }} now={0} onChange={() => {}} onDelete={() => {}} />);
    expect(container.querySelector('.lead__body .cover img')!.getAttribute('src')).toBe(cover);
    rerender(<LeadItem lead={lead(2, 'high')} now={0} onChange={() => {}} onDelete={() => {}} />);
    expect(container.querySelector('.lead__body .cover--empty')).not.toBeNull();
  });
});
