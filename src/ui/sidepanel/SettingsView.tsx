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
  if (!form) return <p>{message ?? 'Caricamento…'}</p>;

  const field = (key: keyof Settings, label: string) => (
    <label className="settings__field">
      {label}
      <input type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
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
      {field('minAgeDays', 'Soglia anzianità (giorni)')}
      {field('minDropPercent', 'Ribasso minimo (%)')}
      {field('retentionDays', 'Conservazione annunci non lavorati (giorni)')}
      <button type="button" onClick={save}>Salva</button>
      <button type="button" onClick={copyReport}>Copia report diagnostico</button>
      <div className="settings__danger">
        <span>Elimina tutti gli annunci salvati, con storico prezzi, stati e note. Le impostazioni restano.</span>
        {confirmingReset ? (
          <div className="settings__confirm">
            <button type="button" className="bulk__danger" onClick={reset}>Conferma: azzera tutto</button>
            <button type="button" onClick={() => setConfirmingReset(false)}>Annulla</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmingReset(true)}>Azzera archivio annunci</button>
        )}
      </div>
      {message && <p className="settings__message">{message}</p>}
    </section>
  );
}
