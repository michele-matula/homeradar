import { useEffect, useId, useState, type ReactNode } from 'react';
import { formatDiagnostics } from '@/core/diagnostics';
import { UNCERTAINTY_DAYS } from '@/core/rules';
import { PORTAL_SITES, PORTALS, type Portal, type Settings } from '@/shared/types';
import type { Api } from './api';
import { InfoTip } from './InfoTip';

type NumberKey = 'minAgeDays' | 'minDropPercent' | 'retentionDays';

/** Spiegazioni accanto a ogni impostazione, per chi usa l'estensione senza che gliel'abbiano spiegata. */
const FIELD_HELP: Record<NumberKey, ReactNode> = {
  minAgeDays: (
    <>
      Un annuncio di privato diventa lead quando è online da almeno questi giorni: chi vende da tempo è più disposto a
      valutare un'agenzia. Se l'età è stimata ed è a meno di {UNCERTAINTY_DAYS} giorni dalla soglia, l'annuncio è
      segnato «Da verificare». Alzala per avere meno lead ma più maturi, abbassala per averne di più.
    </>
  ),
  minDropPercent: (
    <>
      Un annuncio diventa lead anche quando il prezzo è sceso almeno di questa percentuale rispetto al prezzo più alto
      visto. Con 0 conta qualsiasi ribasso. I ribassi emergono confrontando i prezzi delle tue ricerche nel tempo (su
      Immobiliare e Idealista anche dal ribasso indicato dal portale): più spesso navighi, più ne trovi.
    </>
  ),
  retentionDays: (
    <>
      Gli annunci che non ricompaiono nelle tue ricerche da più di questi giorni vengono eliminati in automatico, con
      il loro storico prezzi. Riguarda solo gli annunci ancora «Nuovi»: quelli che hai già lavorato (per esempio
      contattati) non vengono mai eliminati.
    </>
  ),
};

const PORTAL_HELP: Record<Portal, string> = {
  immobiliare:
    "Legge i risultati delle ricerche che apri su Immobiliare.it, anche le pagine successive. L'età dell'annuncio è quella indicata dal portale.",
  idealista:
    "Legge gli annunci delle ricerche che apri su Idealista.it. Il portale non mostra la data di pubblicazione: l'età è stimata (indicata con «~»). Ordinare ogni tanto per «più recenti» rende la stima più precisa.",
  subito:
    "Legge i risultati delle ricerche nella categoria Immobili di Subito.it. La data mostrata da Subito è quella dell'ultimo rinnovo, non della pubblicazione: l'età è stimata (indicata con «~»).",
};

export function SettingsView({ api, onSaved }: { api: Api; onSaved(): void }) {
  const [form, setForm] = useState<Settings | null>(null);
  /** Ultime impostazioni salvate: gli interruttori salvano subito, senza le modifiche ancora in sospeso nei campi. */
  const [saved, setSaved] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const ids = useId();
  useEffect(() => {
    api.getSettings().then((s) => {
      setSaved(s);
      setForm(s);
    }, (e: unknown) => setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`));
  }, [api]);
  if (!form) return <p className="settings__loading">{message ?? 'Caricamento…'}</p>;

  const field = (key: NumberKey, label: string) => (
    <div className="settings__field">
      <div className="settings__row">
        <label htmlFor={`${ids}-${key}`}>{label}</label>
        <InfoTip label={label}>{FIELD_HELP[key]}</InfoTip>
      </div>
      <input
        id={`${ids}-${key}`}
        className="field"
        type="number"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
      />
    </div>
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
        <div className="settings__row">
          <h2 className="card__title">Regole dei lead</h2>
          <InfoTip label="Regole dei lead">
            Decidono quali annunci di privati diventano lead: anzianità e ribasso insieme danno priorità Alta, uno solo
            dei due Media. Le modifiche valgono anche per gli annunci già salvati, dopo aver premuto «Salva».
          </InfoTip>
        </div>
        {field('minAgeDays', 'Soglia anzianità (giorni)')}
        {field('minDropPercent', 'Ribasso minimo (%)')}
        {field('retentionDays', 'Conservazione annunci non lavorati (giorni)')}
        <button type="button" className="btn btn--primary" onClick={save}>Salva</button>
      </div>
      <div className="card">
        <h2 className="card__title">Portali attivi</h2>
        <p className="card__text">Su un portale spento HomeRadar non legge né salva alcun dato. Gli annunci già salvati restano.</p>
        {PORTALS.map((p) => (
          <div key={p} className="settings__row switch">
            <label id={`${ids}-${p}-label`} htmlFor={`${ids}-${p}`} className="switch__label">{PORTAL_SITES[p]}</label>
            <InfoTip label={PORTAL_SITES[p]}>
              {PORTAL_HELP[p]} L'interruttore ha effetto subito, senza premere «Salva».
            </InfoTip>
            <label className="switch__control">
              <input
                id={`${ids}-${p}`}
                type="checkbox"
                role="switch"
                className="switch__input"
                aria-labelledby={`${ids}-${p}-label`}
                checked={form.enabledPortals[p]}
                onChange={() => void togglePortal(p)}
              />
              <span className="switch__track" aria-hidden="true" />
            </label>
          </div>
        ))}
      </div>
      <div className="card">
        <h2 className="card__title">Assistenza</h2>
        <p className="card__text">Se qualcosa non funziona, copia il report e invialo a chi ti supporta.</p>
        <div className="settings__row">
          <button type="button" className="btn" onClick={copyReport}>Copia report diagnostico</button>
          <InfoTip label="Copia report diagnostico">
            Copia negli appunti un breve testo tecnico (versione, contatori di lettura, ultimi errori) da incollare in
            un'email o in chat. Non contiene l'elenco dei tuoi annunci, gli stati né le note.
          </InfoTip>
        </div>
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
          <div className="settings__row">
            <button type="button" className="btn btn--ghost-danger" onClick={() => setConfirmingReset(true)}>Azzera archivio annunci</button>
            <InfoTip label="Azzera archivio annunci">
              Cancella da questo browser tutti gli annunci salvati, con stati e note, e non si può annullare: se ti
              servono, esporta prima i lead. Lo storico prezzi ripartirà da zero e si ricostruirà solo navigando.
            </InfoTip>
          </div>
        )}
      </div>
    </section>
  );
}
