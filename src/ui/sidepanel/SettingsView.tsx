import { useEffect, useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { backupFileName, importSummaryText, NOT_A_BACKUP } from '@/core/backup';
import { formatDiagnostics } from '@/core/diagnostics';
import { UNCERTAINTY_DAYS } from '@/core/rules';
import { formatDateTime } from '@/shared/format';
import { PORTAL_SITES, PORTALS, type BackupStatus, type Portal, type ReportingInfo, type Settings } from '@/shared/types';
import type { Api } from './api';
import { downloadBlob } from './download';
import { FeedbackCard } from './FeedbackCard';
import { InfoTip } from './InfoTip';
import { PilotCard } from './PilotCard';

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

/** `File.text()` manca in alcuni ambienti (jsdom): in quel caso si passa da FileReader. */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function SettingsView({ api, onSaved, download = downloadBlob, onOpenGuide }: {
  api: Api;
  onSaved(): void;
  download?: (b: Blob, name: string) => void;
  /** Apre l'informativa in sola lettura. */
  onOpenGuide?: () => void;
}) {
  const [form, setForm] = useState<Settings | null>(null);
  /** Ultime impostazioni salvate: gli interruttori salvano subito, senza le modifiche ancora in sospeso nei campi. */
  const [saved, setSaved] = useState<Settings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  /** Lo stato del backup non si è potuto leggere: non si sa se ce n'è uno. */
  const [backupUnknown, setBackupUnknown] = useState(false);
  const [info, setInfo] = useState<ReportingInfo | null>(null);
  const ids = useId();
  useEffect(() => {
    api.getBackupStatus().then(setBackup, () => setBackupUnknown(true));
  }, [api]);
  useEffect(() => {
    api.getReportingInfo().then(setInfo, () => {});
  }, [api]);
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

  /** Impostazioni salvate subito (interruttori, codice pilota): aggiornano anche i campi, senza toccare quelli in sospeso. */
  function applySaved(result: Settings) {
    setSaved(result);
    setForm((f) => f && {
      ...f,
      enabledPortals: result.enabledPortals,
      autoBackup: result.autoBackup,
      pilotCode: result.pilotCode,
      reportingEnabled: result.reportingEnabled,
    });
  }

  /** Gli interruttori salvano subito, partendo dalle impostazioni salvate e non dai campi in sospeso. */
  async function saveNow(patch: Partial<Settings>, ok: string) {
    try {
      const result = await api.saveSettings({ ...saved!, ...patch });
      applySaved(result);
      setMessage(ok);
      onSaved();
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function togglePortal(portal: Portal) {
    const on = !form!.enabledPortals[portal];
    return saveNow({ enabledPortals: { ...saved!.enabledPortals, [portal]: on } }, `${PORTAL_SITES[portal]} ${on ? 'attivato' : 'disattivato'}`);
  }

  function toggleAutoBackup() {
    const on = !form!.autoBackup;
    return saveNow({ autoBackup: on }, `Backup automatico ${on ? 'attivato' : 'disattivato'}`);
  }

  async function exportBackup() {
    try {
      const file = await api.exportBackup();
      download(new Blob([JSON.stringify(file)], { type: 'application/json' }), backupFileName(Date.now()));
      // Il file è già stato scaricato: se l'aggiornamento della data fallisce l'esportazione resta riuscita.
      try {
        setBackup(await api.getBackupStatus());
        setBackupUnknown(false);
      } catch {
        /* ignorato */
      }
      setMessage('Backup esportato');
    } catch (e) {
      setMessage(`Errore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function importBackup(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Azzerato subito: riscegliere lo stesso file deve riattivare l'importazione.
    input.value = '';
    if (!file) return;
    let json: unknown;
    try {
      json = JSON.parse(await readText(file));
    } catch {
      setMessage(`Errore: ${NOT_A_BACKUP}`);
      return;
    }
    try {
      const summary = await api.importBackup(json);
      const s = await api.getSettings();
      setSaved(s);
      setForm(s);
      setMessage(importSummaryText(summary));
      onSaved();
    } catch (err) {
      setMessage(`Errore: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const backupFailed = backup?.lastAutoFailedAt != null && (backup.lastAt === null || backup.lastAutoFailedAt > backup.lastAt);

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
        <h2 className="card__title">Backup</h2>
        {(backup || backupUnknown) && (
          <p className="card__text">
            {backup ? (backup.lastAt ? `Ultimo backup: ${formatDateTime(backup.lastAt)}` : 'Ultimo backup: mai') : 'Ultimo backup: non disponibile'}
          </p>
        )}
        {backupFailed && <p className="card__text backup__warn">Ultimo backup automatico non riuscito</p>}
        {backup?.pending && <p className="card__text">Backup automatico in corso: se Chrome chiede dove salvare il file, conferma</p>}
        <div className="settings__row switch">
          <label id={`${ids}-autoBackup-label`} htmlFor={`${ids}-autoBackup`} className="switch__label">Backup automatico settimanale</label>
          <InfoTip label="Backup automatico settimanale">
            Una volta a settimana salva una copia di annunci, stati, note e storico prezzi nella cartella
            Download/HomeRadar, a rotazione su 4 file (circa un mese di storia). Il file resta sul tuo computer e
            contiene gli indirizzi degli annunci e le tue note.
          </InfoTip>
          <label className="switch__control">
            <input
              id={`${ids}-autoBackup`}
              type="checkbox"
              role="switch"
              className="switch__input"
              aria-labelledby={`${ids}-autoBackup-label`}
              checked={form.autoBackup}
              onChange={() => void toggleAutoBackup()}
            />
            <span className="switch__track" aria-hidden="true" />
          </label>
        </div>
        <div className="settings__row">
          <button type="button" className="btn" onClick={exportBackup}>Esporta backup ora</button>
          <InfoTip label="Esporta backup ora">
            Scarica subito un file di backup, per esempio prima di cambiare computer. Su un altro browser lo riapri con
            «Importa backup».
          </InfoTip>
        </div>
        <div className="settings__row">
          <label className="btn">
            Importa backup
            <input type="file" accept=".json,application/json" className="visually-hidden" onChange={(e) => void importBackup(e)} />
          </label>
          <InfoTip label="Importa backup">
            Unisce un backup ai dati di questo browser senza cancellare nulla: aggiunge gli annunci mancanti e, per
            lo stesso annuncio, tiene lo stato e le note modificati più di recente. Le impostazioni del backup si
            usano solo se qui non le hai mai cambiate.
          </InfoTip>
        </div>
      </div>
      <div className="card">
        <h2 className="card__title">Informativa e guida</h2>
        <p className="card__text">Cosa fa HomeRadar, cosa salva e come leggere i badge.</p>
        <div className="settings__row">
          <button type="button" className="btn" onClick={onOpenGuide}>Rivedi informativa</button>
        </div>
      </div>
      <PilotCard
        api={api}
        settings={saved!}
        info={info}
        onSettings={(s) => {
          applySaved(s);
          onSaved();
        }}
        onInfo={setInfo}
        onMessage={setMessage}
      />
      <FeedbackCard api={api} settings={saved!} info={info} onInfo={setInfo} />
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
