import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotCard, reportingLine } from '@/ui/sidepanel/PilotCard';
import { SettingsView } from '@/ui/sidepanel/SettingsView';
import type { Api } from '@/ui/sidepanel/api';
import { DEFAULT_SETTINGS, type ReportingInfo, type Settings } from '@/shared/types';

afterEach(cleanup);

const status = { lastSentAt: null, lastAttemptAt: null, lastError: null, codeRejected: false };
const info = (p: Partial<ReportingInfo> = {}, s: Partial<ReportingInfo['status']> = {}): ReportingInfo => ({ configured: true, queued: 0, ...p, status: { ...status, ...s } });

/** Il campo si attiva quando arrivano le informazioni sull'invio: modificarlo prima è una corsa. */
async function enabledCodeField(): Promise<HTMLInputElement> {
  const field = (await screen.findByLabelText('Codice pilota')) as HTMLInputElement;
  await waitFor(() => expect(field.disabled).toBe(false));
  return field;
}

function api(settings: Partial<Settings> = {}, ri: ReportingInfo = info()): Api {
  let saved = { ...DEFAULT_SETTINGS, ...settings };
  return {
    getSettings: vi.fn(async () => saved),
    saveSettings: vi.fn(async (s: Settings) => {
      saved = { ...s, pilotCode: s.pilotCode.toUpperCase() };
      return saved;
    }),
    getBackupStatus: vi.fn(async () => ({ lastAt: null, lastAutoFailedAt: null, nextSlot: 1, pending: null })),
    getReportingInfo: vi.fn(async () => ri),
    sendReportNow: vi.fn(async () => info({}, { lastSentAt: Date.now(), lastAttemptAt: Date.now() })),
    previewReport: vi.fn(async () => ({ formatVersion: 1, pilotCode: 'ROSSI-7K2P' })),
    sendFeedback: vi.fn(async () => 'sent' as const),
    getDiagnostics: vi.fn(),
  } as unknown as Api;
}

describe('reportingLine', () => {
  const now = new Date(2026, 9, 17, 15).getTime();
  const s = { ...DEFAULT_SETTINGS, pilotCode: 'ROSSI-7K2P' };
  it.each<[ReportingInfo, Settings, string]>([
    [info({ configured: false }), s, 'Invio non configurato in questa versione'],
    [info(), { ...s, pilotCode: '' }, "Inserisci il codice pilota per attivare l'invio"],
    [info(), { ...s, reportingEnabled: false }, 'Invio spento'],
    [info({}, { codeRejected: true, lastError: 'rejected' }), s, 'Codice non riconosciuto: controlla il codice che hai ricevuto'],
    [info({}, { lastAttemptAt: now, lastError: 'network' }), s, 'Ultimo tentativo non riuscito (nessuna connessione): si riprova da solo'],
    [info({}, { lastAttemptAt: now, lastError: 'server' }), s, 'Ultimo tentativo non riuscito (server non raggiungibile): si riprova da solo'],
    [info({}, { lastSentAt: new Date(2026, 9, 17, 10, 32).getTime() }), s, 'Ultimo invio: oggi alle 10:32'],
    [info({}, { lastSentAt: new Date(2026, 9, 3, 9, 5).getTime() }), s, 'Ultimo invio: il 03/10 alle 09:05'],
    [info(), s, 'Nessun invio ancora'],
  ])('%#', (i, settings, text) => {
    expect(reportingLine(i, settings, now)).toBe(text);
  });
});

describe('impostazioni: pilota e feedback', () => {
  it("salva il codice, invia ora e mostra l'anteprima", async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    fireEvent.change(await enabledCodeField(), { target: { value: 'rossi-7k2p' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva codice' }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ pilotCode: 'rossi-7k2p' })));
    expect(await screen.findByDisplayValue('ROSSI-7K2P')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia ora' }));
    expect(await screen.findByText(/Ultimo invio: oggi alle/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mostra cosa viene inviato' }));
    expect(await screen.findByText(/"pilotCode": "ROSSI-7K2P"/)).toBeTruthy();
  });

  it('l\'interruttore spegne l\'invio salvando subito e disattiva "Invia ora"', async () => {
    const a = api({ pilotCode: 'ROSSI-7K2P' });
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    fireEvent.click(await screen.findByRole('switch', { name: "Invia statistiche d'uso anonime" }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ reportingEnabled: false })));
    expect(await screen.findByText('Invio spento')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Invia ora' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('il salvataggio generale non sovrascrive il codice salvato dalla scheda Pilota', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    fireEvent.change(await enabledCodeField(), { target: { value: 'ROSSI-7K2P' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva codice' }));
    await screen.findByText('Codice pilota salvato');
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(a.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ pilotCode: 'ROSSI-7K2P' })));
  });

  it('feedback: invio, conteggio e messaggio in coda', async () => {
    const a = api({ pilotCode: 'ROSSI-7K2P' });
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    const box = await screen.findByLabelText('Il tuo messaggio');
    await waitFor(() => expect((box as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.change(box, { target: { value: 'Mi piace' } });
    expect(screen.getByText('8/2000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invia feedback' }));
    expect(await screen.findByText('Inviato, grazie')).toBeTruthy();
    expect(a.sendFeedback).toHaveBeenCalledWith('Mi piace');
    expect((box as HTMLTextAreaElement).value).toBe('');
    (a.sendFeedback as ReturnType<typeof vi.fn>).mockResolvedValueOnce('queued');
    fireEvent.change(box, { target: { value: 'Secondo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invia feedback' }));
    expect(await screen.findByText('Salvato: verrà inviato appena possibile')).toBeTruthy();
  });

  it('feedback disattivato senza codice o senza configurazione', async () => {
    render(<SettingsView api={api()} onSaved={vi.fn()} />);
    expect(await screen.findByText('Inserisci il codice pilota per inviare un feedback')).toBeTruthy();
    expect((screen.getByLabelText('Il tuo messaggio') as HTMLTextAreaElement).disabled).toBe(true);
    cleanup();
    render(<SettingsView api={api({ pilotCode: 'ROSSI-7K2P' }, info({ configured: false }))} onSaved={vi.fn()} />);
    expect(await screen.findByText('Invio non configurato in questa versione', { selector: '.feedback__hint' })).toBeTruthy();
    expect((screen.getByLabelText('Il tuo messaggio') as HTMLTextAreaElement).disabled).toBe(true);
  });
});
describe('PilotCard', () => {
  it('il campo segue il codice salvato quando cambia altrove (es. importazione di un backup)', async () => {
    const props = { api: api(), info: info(), onSettings: vi.fn(), onInfo: vi.fn(), onMessage: vi.fn() };
    const { rerender } = render(<PilotCard {...props} settings={DEFAULT_SETTINGS} />);
    expect((screen.getByLabelText('Codice pilota') as HTMLInputElement).value).toBe('');
    rerender(<PilotCard {...props} settings={{ ...DEFAULT_SETTINGS, pilotCode: 'ROSSI-7K2P' }} />);
    expect((screen.getByLabelText('Codice pilota') as HTMLInputElement).value).toBe('ROSSI-7K2P');
  });
});
