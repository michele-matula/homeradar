import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '@/ui/onboarding/Onboarding';
import { DEFAULT_SETTINGS, type OnboardingStatus, type Settings } from '@/shared/types';

afterEach(cleanup);

const never: OnboardingStatus = { acceptedVersion: null, acceptedAt: null, current: 1 };
const accepted: OnboardingStatus = { acceptedVersion: 1, acceptedAt: Date.UTC(2026, 9, 15, 10), current: 1 };

function api(status: OnboardingStatus = never, settings = DEFAULT_SETTINGS) {
  return {
    getOnboardingStatus: vi.fn(async () => status),
    acceptOnboarding: vi.fn(async () => accepted),
    getSettings: vi.fn(async () => settings),
    saveSettings: vi.fn(async (s: Settings) => ({ ...s, pilotCode: s.pilotCode.trim().toUpperCase() })),
  };
}

describe('Onboarding', () => {
  it('mostra informativa e legenda con le soglie attuali delle impostazioni', async () => {
    render(<Onboarding api={api(never, { ...DEFAULT_SETTINGS, minAgeDays: 90, minDropPercent: 5, retentionDays: 60 })} mode="confirm" />);
    expect(await screen.findByRole('heading', { name: 'Benvenuto in HomeRadar' })).toBeTruthy();
    expect(screen.getByText(/indirizzo completo \(via e civico/)).toBeTruthy();
    expect(screen.getByText(/Nomi e numeri di telefono dei venditori/)).toBeTruthy();
    expect(screen.getByText(/non rivedi da 60 giorni/)).toBeTruthy();
    expect(screen.getByText(/finestra di salvataggio/)).toBeTruthy();
    expect(screen.getByText('online da almeno 90 giorni e ribassato di almeno 5%.')).toBeTruthy();
    expect(screen.getByText('● Alta')).toBeTruthy();
    expect(screen.getByText(/le date di ricontatto/)).toBeTruthy();
    expect(screen.getByText(/richiami da fare oggi o in ritardo/)).toBeTruthy();
    expect(screen.getByText('+18% su Navigli')).toBeTruthy();
    expect(screen.getByText(/sopra la mediana degli annunci di privati che hai visto nella stessa zona/)).toBeTruthy();
    expect(screen.getByText('Per domande, rivolgiti a chi ti ha fornito HomeRadar.')).toBeTruthy();
    expect(screen.queryByText('Cosa è cambiato')).toBeNull();
  });

  it('la conservazione avverte che anche le note dei lead rimasti "Nuovo" vengono cancellate', async () => {
    render(<Onboarding api={api(never, { ...DEFAULT_SETTINGS, retentionDays: 60 })} mode="confirm" />);
    expect(
      await screen.findByText(
        'Gli annunci rimasti in stato "Nuovo" che non rivedi da 60 giorni vengono cancellati da soli, anche se hanno note: per tenerli cambia lo stato. Puoi cambiare il periodo nelle impostazioni. L\'annuncio precedente di una ripubblicazione resta finché rivedi la ripubblicazione.',
      ),
    ).toBeTruthy();
  });

  it('senza soglia di ribasso dice solo "ribassato"', async () => {
    render(<Onboarding api={api()} mode="confirm" />);
    expect(await screen.findByText('online da almeno 120 giorni e ribassato.')).toBeTruthy();
  });

  it('nella scheda, dopo la conferma, dice che HomeRadar è attivo', async () => {
    const a = api();
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText('HomeRadar è attivo')).toBeTruthy();
    expect(a.acceptOnboarding).toHaveBeenCalledTimes(1);
  });

  it('nel pannello, dopo la conferma, chiama onDone', async () => {
    const onDone = vi.fn();
    render(<Onboarding api={api()} mode="confirm" onDone={onDone} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("se la conferma fallisce mostra l'errore e lascia il pulsante", async () => {
    const a = api();
    a.acceptOnboarding.mockRejectedValueOnce(new Error('boom'));
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText('Errore: boom')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ho capito, inizia' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('riconferma dopo un aggiornamento: riquadro "Cosa è cambiato" con le novità', async () => {
    render(<Onboarding api={api({ acceptedVersion: 1, acceptedAt: 1, current: 2 })} mode="confirm" changes={{ 2: ['Date di ricontatto sui lead'] }} />);
    expect(await screen.findByText('Cosa è cambiato')).toBeTruthy();
    expect(screen.getByText('Date di ricontatto sui lead')).toBeTruthy();
  });

  it('in sola lettura: data di conferma e "Chiudi", nessun pulsante di conferma', async () => {
    const onDone = vi.fn();
    render(<Onboarding api={api(accepted)} mode="review" onDone={onDone} />);
    expect(await screen.findByText('Confermata il 15/10/2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ho capito, inizia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('se lo stato non si legge mostra l\'errore e "Riprova"', async () => {
    const a = api();
    a.getOnboardingStatus.mockRejectedValueOnce(new Error('Nessuna risposta dal background'));
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('heading', { name: 'Benvenuto in HomeRadar' })).toBeTruthy();
  });
});
describe('Onboarding: codice pilota e invio dei report', () => {
  it('salva il codice pilota prima di confermare', async () => {
    const a = api();
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.change(await screen.findByLabelText('Codice pilota (facoltativo)'), { target: { value: ' rossi-7k2p ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ho capito, inizia' }));
    await waitFor(() => expect(a.acceptOnboarding).toHaveBeenCalled());
    expect(a.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ pilotCode: ' rossi-7k2p ' }));
  });

  it("con un codice non valido mostra l'errore e non conferma", async () => {
    const a = api();
    a.saveSettings.mockRejectedValueOnce(new Error('Codice pilota non valido: usa da 4 a 32 tra lettere, cifre e trattini'));
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.change(await screen.findByLabelText('Codice pilota (facoltativo)'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ho capito, inizia' }));
    expect(await screen.findByText(/Codice pilota non valido/)).toBeTruthy();
    expect(a.acceptOnboarding).not.toHaveBeenCalled();
  });

  it('senza codice conferma senza salvare le impostazioni', async () => {
    const a = api();
    render(<Onboarding api={a} mode="confirm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ho capito, inizia' }));
    await waitFor(() => expect(a.acceptOnboarding).toHaveBeenCalled());
    expect(a.saveSettings).not.toHaveBeenCalled();
  });

  it("dichiara l'invio giornaliero e non mostra il campo in sola lettura", async () => {
    render(<Onboarding api={api(accepted)} mode="review" onDone={() => {}} />);
    expect(await screen.findByText(/Ogni giorno HomeRadar invia al gestore del pilota/)).toBeTruthy();
    expect(screen.getByText(/Annunci, stati e note restano solo nel tuo browser/)).toBeTruthy();
    expect(screen.queryByLabelText('Codice pilota (facoltativo)')).toBeNull();
  });
});
