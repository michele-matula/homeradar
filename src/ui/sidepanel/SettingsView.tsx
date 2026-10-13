import { useEffect, useState } from 'react';
import { formatDiagnostics } from '@/core/diagnostics';
import type { Settings } from '@/shared/types';
import type { Api } from './api';

export function SettingsView({ api, onSaved }: { api: Api; onSaved(): void }) {
  const [form, setForm] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  useEffect(() => {
    api.getSettings().then(setForm, (e: unknown) => setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`));
  }, [api]);
  if (!form) return <p className="settings__loading">{message ?? 'Caricamento…'}</p>;

  const field = (key: keyof Settings, label: string) => (
    <label className="settings__field">
      <span>{label}</span>
      <input className="field" type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
    </label>
  );

  async function save() {
    try {
      await api.saveSettings(form!);
      setMessage('Impostazioni salvate');
      onSaved();
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(formatDiagnostics(await api.getDiagnostics(), Date.now()));
      setMessage('Report copiato negli appunti');
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function reset() {
    setConfirmingReset(false);
    try {
      const removed = await api.deleteAllListings();
      setMessage(`Archivio azzerato: ${removed} ${removed === 1 ? 'annuncio eliminato' : 'annunci eliminati'}`);
      onSaved();
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="settings">
      {message && <p className={message.startsWith('Errore') ? 'banner banner--error' : 'banner banner--ok'}>{message}</p>}
      <div className="card">
        <h2 className="card__title">Regole dei lead</h2>
        {field('minAgeDays', 'Soglia anzianità (giorni)')}
        {field('minDropPercent', 'Ribasso minimo (%)')}
        {field('retentionDays', 'Conservazione annunci non lavorati (giorni)')}
        <button type="button" className="btn btn--primary" onClick={save}>Salva</button>
      </div>
      <div className="card">
        <h2 className="card__title">Assistenza</h2>
        <p className="card__text">Se qualcosa non funziona, copia il report e invialo a chi ti supporta.</p>
        <button type="button" className="btn" onClick={copyReport}>Copia report diagnostico</button>
      </div>
      <div className="card card--danger">
        <h2 className="card__title">Zona pericolosa</h2>
        <p className="card__text">Elimina tutti gli annunci salvati, con storico prezzi, stati e note. Le impostazioni restano.</p>
        {confirmingReset ? (
          <div className="settings__confirm">
            <button type="button" className="btn btn--danger" onClick={reset}>Conferma: azzera tutto</button>
            <button type="button" className="btn" onClick={() => setConfirmingReset(false)}>Annulla</button>
          </div>
        ) : (
          <button type="button" className="btn btn--ghost-danger" onClick={() => setConfirmingReset(true)}>Azzera archivio annunci</button>
        )}
      </div>
    </section>
  );
}
