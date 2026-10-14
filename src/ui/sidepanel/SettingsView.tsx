import { useEffect, useState } from 'react';
import { formatDiagnostics } from '@/core/diagnostics';
import { PORTAL_SITES, PORTALS, type Portal, type Settings } from '@/shared/types';
import type { Api } from './api';

export function SettingsView({ api, onSaved }: { api: Api; onSaved(): void }) {
  const [form, setForm] = useState<Settings | null>(null);
  /** Ultime impostazioni salvate: gli interruttori salvano subito, senza le modifiche ancora in sospeso nei campi. */
  const [saved, setSaved] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  useEffect(() => {
    api.getSettings().then((s) => {
      setSaved(s);
      setForm(s);
    }, (e: unknown) => setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`));
  }, [api]);
  if (!form) return <p className="settings__loading">{message ?? 'Caricamento…'}</p>;

  const field = (key: 'minAgeDays' | 'minDropPercent' | 'retentionDays', label: string) => (
    <label className="settings__field">
      <span>{label}</span>
      <input className="field" type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
    </label>
  );

  async function save() {
    try {
      setSaved(await api.saveSettings(form!));
      setMessage('Impostazioni salvate');
      onSaved();
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function togglePortal(portal: Portal) {
    const on = !form!.enabledPortals[portal];
    try {
      const result = await api.saveSettings({ ...saved!, enabledPortals: { ...saved!.enabledPortals, [portal]: on } });
      setSaved(result);
      setForm((f) => f && { ...f, enabledPortals: result.enabledPortals });
      setMessage(`${PORTAL_SITES[portal]} ${on ? 'attivato' : 'disattivato'}`);
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
        <h2 className="card__title">Portali attivi</h2>
        <p className="card__text">Su un portale spento HomeRadar non legge né salva alcun dato. Gli annunci già salvati restano.</p>
        {PORTALS.map((p) => (
          <label key={p} className="switch">
            <span className="switch__label">{PORTAL_SITES[p]}</span>
            <input
              type="checkbox"
              role="switch"
              className="switch__input"
              checked={form.enabledPortals[p]}
              onChange={() => void togglePortal(p)}
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        ))}
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
