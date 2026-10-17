import { useEffect, useId, useState } from 'react';
import type { UsageReport } from '@/shared/report-schema';
import type { ReportingInfo, Settings } from '@/shared/types';
import type { Api } from './api';
import { InfoTip } from './InfoTip';

const pad = (n: number) => String(n).padStart(2, '0');

function when(ms: number, now: number): string {
  const d = new Date(ms);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? `oggi alle ${time}` : `il ${pad(d.getDate())}/${pad(d.getMonth() + 1)} alle ${time}`;
}

const FAILURE: Record<'network' | 'server' | 'invalid', string> = {
  network: 'nessuna connessione',
  server: 'server non raggiungibile',
  invalid: 'dati rifiutati',
};

/** Stato dell'invio dei report, in una riga per l'agente. */
export function reportingLine(info: ReportingInfo, settings: Settings, now: number): string {
  const s = info.status;
  if (!info.configured) return 'Invio non configurato in questa versione';
  if (!settings.pilotCode) return "Inserisci il codice pilota per attivare l'invio";
  if (!settings.reportingEnabled) return 'Invio spento';
  if (s.codeRejected) return 'Codice non riconosciuto: controlla il codice che hai ricevuto';
  if (s.lastError && s.lastError !== 'rejected' && s.lastAttemptAt != null && (s.lastSentAt == null || s.lastAttemptAt > s.lastSentAt)) {
    return `Ultimo tentativo non riuscito (${FAILURE[s.lastError]}): si riprova da solo`;
  }
  return s.lastSentAt != null ? `Ultimo invio: ${when(s.lastSentAt, now)}` : 'Nessun invio ancora';
}

export function PilotCard({ api, settings, info, onSettings, onInfo, onMessage }: {
  api: Api;
  settings: Settings;
  info: ReportingInfo | null;
  onSettings(s: Settings): void;
  onInfo(i: ReportingInfo): void;
  onMessage(m: string): void;
}) {
  const ids = useId();
  const [code, setCode] = useState(settings.pilotCode);
  // Il codice salvato può cambiare altrove (importazione di un backup): il campo lo segue.
  useEffect(() => setCode(settings.pilotCode), [settings.pilotCode]);
  const [preview, setPreview] = useState<UsageReport | null>(null);
  const err = (e: unknown) => onMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
  const configured = info?.configured ?? false;

  async function save(patch: Partial<Settings>, ok: string) {
    try {
      const s = await api.saveSettings({ ...settings, ...patch });
      onSettings(s);
      setCode(s.pilotCode);
      onInfo(await api.getReportingInfo());
      onMessage(ok);
    } catch (e) {
      err(e);
    }
  }

  async function sendNow() {
    try {
      onInfo(await api.sendReportNow());
    } catch (e) {
      err(e);
    }
  }

  async function togglePreview() {
    if (preview) {
      setPreview(null);
      return;
    }
    try {
      setPreview(await api.previewReport());
    } catch (e) {
      err(e);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">Pilota</h2>
      {info && <p className="card__text">{reportingLine(info, settings, Date.now())}</p>}
      <div className="settings__field">
        <div className="settings__row">
          <label htmlFor={`${ids}-code`}>Codice pilota</label>
          <InfoTip label="Codice pilota">Il codice che ti ha dato chi gestisce il pilota. Identifica la tua agenzia nei report.</InfoTip>
        </div>
        <div className="settings__row">
          <input id={`${ids}-code`} className="field" value={code} disabled={!configured} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="btn" disabled={!configured} onClick={() => void save({ pilotCode: code }, 'Codice pilota salvato')}>
            Salva codice
          </button>
        </div>
      </div>
      <div className="settings__row switch">
        <label id={`${ids}-rep-label`} htmlFor={`${ids}-rep`} className="switch__label">Invia statistiche d'uso anonime</label>
        <InfoTip label="Invia statistiche d'uso anonime">
          Una volta al giorno invia al gestore del pilota: giorni d'uso, numero di lead per portale e priorità, passaggi di
          stato, richiami e note (solo quanti), export ed errori tecnici. Non invia mai annunci, indirizzi, prezzi, note o
          nomi. L'interruttore ha effetto subito.
        </InfoTip>
        <label className="switch__control">
          <input
            id={`${ids}-rep`}
            type="checkbox"
            role="switch"
            className="switch__input"
            aria-labelledby={`${ids}-rep-label`}
            checked={settings.reportingEnabled}
            disabled={!configured}
            onChange={() =>
              void save({ reportingEnabled: !settings.reportingEnabled }, settings.reportingEnabled ? 'Invio statistiche disattivato' : 'Invio statistiche attivato')}
          />
          <span className="switch__track" aria-hidden="true" />
        </label>
      </div>
      <div className="settings__row">
        <button type="button" className="btn" disabled={!configured || !settings.reportingEnabled || !settings.pilotCode} onClick={() => void sendNow()}>
          Invia ora
        </button>
        <button type="button" className="btn" onClick={() => void togglePreview()}>{preview ? 'Nascondi' : 'Mostra cosa viene inviato'}</button>
      </div>
      {preview && <pre className="pilot__preview">{JSON.stringify(preview, null, 2)}</pre>}
    </div>
  );
}
