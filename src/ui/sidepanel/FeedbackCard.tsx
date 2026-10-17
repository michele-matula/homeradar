import { useId, useState } from 'react';
import { FEEDBACK_MAX } from '@/shared/report-schema';
import type { ReportingInfo, Settings } from '@/shared/types';
import type { Api } from './api';

export function FeedbackCard({ api, settings, info, onInfo }: {
  api: Api;
  settings: Settings;
  info: ReportingInfo | null;
  onInfo(i: ReportingInfo): void;
}) {
  const ids = useId();
  const [text, setText] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = !info?.configured
    ? 'Invio non configurato in questa versione'
    : !settings.pilotCode
      ? 'Inserisci il codice pilota per inviare un feedback'
      : null;

  async function send() {
    setBusy(true);
    try {
      const r = await api.sendFeedback(text);
      setText('');
      setResult(r === 'sent' ? 'Inviato, grazie' : 'Salvato: verrà inviato appena possibile');
      onInfo(await api.getReportingInfo());
    } catch (e) {
      setResult(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card__title">Feedback</h2>
      <p className="card__text">
        Cosa funziona, cosa manca, cosa non torna: arriva a chi gestisce il pilota. Non scrivere nomi o telefoni dei privati.
      </p>
      {hint && <p className="card__text feedback__hint">{hint}</p>}
      <label htmlFor={`${ids}-fb`} className="visually-hidden">Il tuo messaggio</label>
      <textarea
        id={`${ids}-fb`}
        className="field feedback__text"
        rows={4}
        maxLength={FEEDBACK_MAX}
        value={text}
        disabled={hint !== null}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="settings__row">
        <span className="feedback__count">{`${text.length}/${FEEDBACK_MAX}`}</span>
        <button type="button" className="btn btn--primary" disabled={hint !== null || busy || !text.trim()} onClick={() => void send()}>
          Invia feedback
        </button>
      </div>
      {result && <p className="card__text">{result}</p>}
      {info && info.queued > 0 && <p className="card__text">{`${info.queued} ${info.queued === 1 ? 'messaggio' : 'messaggi'} in attesa di invio`}</p>}
    </div>
  );
}
