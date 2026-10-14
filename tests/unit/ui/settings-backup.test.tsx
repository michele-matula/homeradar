import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBackup } from '@/core/backup';
import type { Api } from '@/ui/sidepanel/api';
import { SettingsView } from '@/ui/sidepanel/SettingsView';
import { DEFAULT_SETTINGS, type BackupStatus } from '@/shared/types';

afterEach(cleanup);

function api(status: BackupStatus = { lastAt: null, lastAutoFailedAt: null, nextSlot: 1 }): Api {
  return {
    listLeads: vi.fn(async () => []),
    setLeadState: vi.fn(),
    deleteListing: vi.fn(),
    deleteListings: vi.fn(),
    deleteAllListings: vi.fn(async () => 0),
    getSettings: vi.fn(async () => DEFAULT_SETTINGS),
    saveSettings: vi.fn(async (s) => s),
    getDiagnostics: vi.fn(),
    onLeadsChanged: vi.fn(() => () => {}),
    exportBackup: vi.fn(async () => buildBackup({ listings: [], priceSnapshots: [], leadStates: [], calibration: [] }, 0, '0.1.0')),
    importBackup: vi.fn(async () => ({ added: 2, updated: 1, unchanged: 0 })),
    getBackupStatus: vi.fn(async () => status),
  } as unknown as Api;
}

const fileInput = () => screen.getByLabelText('Importa backup', { selector: 'input' }) as HTMLInputElement;

describe('impostazioni: backup', () => {
  it('mostra "mai" e spegne il backup automatico salvando subito', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    expect(await screen.findByText('Ultimo backup: mai')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Backup automatico settimanale' }));
    expect(await screen.findByText('Backup automatico disattivato')).toBeTruthy();
    expect(a.saveSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, autoBackup: false });
  });

  it("segnala l'ultimo backup automatico fallito", async () => {
    render(<SettingsView api={api({ lastAt: 1000, lastAutoFailedAt: 2000, nextSlot: 2 })} onSaved={vi.fn()} />);
    expect(await screen.findByText('Ultimo backup automatico non riuscito')).toBeTruthy();
  });

  it('esporta il backup come file JSON e aggiorna la data', async () => {
    const a = api();
    const download = vi.fn();
    render(<SettingsView api={a} onSaved={vi.fn()} download={download} />);
    vi.mocked(a.getBackupStatus).mockResolvedValue({ lastAt: new Date(2026, 9, 12, 9, 30).getTime(), lastAutoFailedAt: null, nextSlot: 1 });
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta backup ora' }));
    await waitFor(() => expect(download).toHaveBeenCalled());
    const [blob, name] = download.mock.calls[0]!;
    expect(name).toMatch(/^homeradar-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(await (blob as Blob).text()).format).toBe('homeradar-backup');
    expect(await screen.findByText('Ultimo backup: 12/10 alle 09:30')).toBeTruthy();
  });

  it('importa un file, mostra il riepilogo e ricarica i lead; lo stesso file si può riscegliere', async () => {
    const a = api();
    const onSaved = vi.fn();
    render(<SettingsView api={a} onSaved={onSaved} />);
    await screen.findByText('Ultimo backup: mai');
    const file = new File(['{"format":"homeradar-backup"}'], 'b.json', { type: 'application/json' });
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByText('Backup importato: 2 annunci nuovi, 1 aggiornato, 0 già presenti')).toBeTruthy();
    expect(a.importBackup).toHaveBeenCalledWith({ format: 'homeradar-backup' });
    expect(onSaved).toHaveBeenCalled();
    expect(fileInput().value).toBe('');
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await waitFor(() => expect(a.importBackup).toHaveBeenCalledTimes(2));
  });

  it('un file non JSON dà errore senza chiamare il background', async () => {
    const a = api();
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    await screen.findByText('Ultimo backup: mai');
    fireEvent.change(fileInput(), { target: { files: [new File(['ciao'], 'x.json')] } });
    expect(await screen.findByText('Errore: Il file non è un backup di HomeRadar')).toBeTruthy();
    expect(a.importBackup).not.toHaveBeenCalled();
  });

  it("mostra l'errore del background", async () => {
    const a = api();
    vi.mocked(a.importBackup).mockRejectedValue(new Error('Backup non valido (annunci)'));
    render(<SettingsView api={a} onSaved={vi.fn()} />);
    await screen.findByText('Ultimo backup: mai');
    fireEvent.change(fileInput(), { target: { files: [new File(['{}'], 'x.json')] } });
    expect(await screen.findByText('Errore: Backup non valido (annunci)')).toBeTruthy();
  });

  it('ogni voce del backup ha il suo tooltip', async () => {
    render(<SettingsView api={api()} onSaved={vi.fn()} />);
    for (const name of ['Backup automatico settimanale', 'Esporta backup ora', 'Importa backup']) {
      expect(await screen.findByRole('button', { name: `Informazioni: ${name}` })).toBeTruthy();
    }
  });
});
