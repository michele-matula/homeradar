import { useCallback, useEffect, useState } from 'react';
import { localDay } from '@/core/usage';
import { formatDateTime } from '@/shared/format';
import { PORTAL_SITES, PORTALS, type Portal, type PortalSweepOutcome, type SweepResult, type SweepStatus } from '@/shared/types';
import type { Api } from './api';

type SweepApi = Pick<Api, 'getSettings' | 'getSweepStatus' | 'startSweep' | 'stopSweep' | 'onSweepChanged'>;

const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;
const minutes = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`;
const OUTCOME_TITLES: Record<SweepResult['outcome'], string> = {
  completed: 'Giro completato', partial: 'Giro completato in parte', stopped: 'Giro fermato', interrupted: 'Giro interrotto',
};

function portalReason(p: Portal, o: PortalSweepOutcome): string | null {
  const site = PORTAL_SITES[p];
  if (o === 'blocked') return `${site} ha chiesto una verifica: aprilo tu e riprova domani.`;
  if (o === 'capped') return `${site}: raggiunto il limite di pagine, alcune ricerche sono incomplete.`;
  if (o === 'error') return `${site} non ha risposto ad alcune pagine.`;
  return null;
}

function reasons(r: SweepResult): string[] {
  const out = PORTALS.flatMap((p) => {
    const s = r.portals[p];
    const why = s && portalReason(p, s.outcome);
    return why ? [why] : [];
  });
  if (r.notFound.length) out.push(`Non trovati: ${r.notFound.join(', ')}.`);
  return out;
}

/** Scheda "Ricerca" in cima ai lead: avvio del giro, avanzamento, riepilogo. */
export function SweepCard({ api, onShowNew, onOpenSettings }: { api: SweepApi; onShowNew(since: number): void; onOpenSettings(): void }) {
  const [status, setStatus] = useState<SweepStatus | null>(null);
  const [comuni, setComuni] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Il riepilogo si mostra per un giro finito mentre il pannello era aperto, finché l'agente non lo chiude.
  const [openedAt] = useState(Date.now);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, settings] = await Promise.all([api.getSweepStatus(), api.getSettings()]);
      setStatus(s);
      setComuni(settings.searchArea.comuni.length);
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return api.onSweepChanged(() => void refresh());
  }, [api, refresh]);

  const act = (fn: () => Promise<SweepStatus>) => {
    setError(null);
    fn().then(setStatus, (e: unknown) => setError(errorText(e)));
  };

  if (!status) return null;
  const { running, last } = status;
  const now = Date.now();

  if (running) {
    return (
      <section className="card sweep" aria-label="Ricerca">
        <h2 className="card__title">{`Ricerca in corso · ${minutes(now - running.startedAt)}`}</h2>
        <progress className="sweep__bar" max={running.total} value={running.done} aria-label="Ricerche fatte" />
        {running.current && <p className="sweep__current">{running.current}</p>}
        <ul className="sweep__portals">
          {PORTALS.filter((p) => running.portals[p]).map((p) => (
            <li key={p}>{`${PORTAL_SITES[p]}: ${running.portals[p]!.pages} pagine · ${running.portals[p]!.privates} privati`}</li>
          ))}
        </ul>
        <div className="settings__row">
          <span>{`Finora: ${running.newCount} nuovi · ${running.drops} ribassi`}</span>
          <button type="button" className="btn btn--sm" onClick={() => act(() => api.stopSweep())}>Ferma</button>
        </div>
        {error && <p className="banner banner--error"><span>{error}</span></p>}
      </section>
    );
  }

  if (last && last.finishedAt >= openedAt && dismissed !== last.finishedAt) {
    return (
      <section className="card sweep" aria-label="Ricerca">
        <h2 className="card__title">{`${OUTCOME_TITLES[last.outcome]} · ${minutes(last.finishedAt - last.startedAt)}`}</h2>
        <p>{`${last.newCount} nuovi · ${last.drops} ribassi · ${last.missing} non più visti`}</p>
        {reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
        <div className="settings__row">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => onShowNew(last.startedAt)}>Vedi i nuovi</button>
          <button type="button" className="btn btn--sm" onClick={() => setDismissed(last.finishedAt)}>Chiudi</button>
        </div>
      </section>
    );
  }

  const today = last != null && localDay(last.startedAt) === localDay(now);
  return (
    <section className="card sweep" aria-label="Ricerca">
      {comuni === 0 ? (
        <div className="settings__row">
          <span>Scegli i comuni in cui lavori per cercare i lead con un clic.</span>
          <button type="button" className="btn btn--primary btn--sm" onClick={onOpenSettings}>Imposta la tua zona</button>
        </div>
      ) : (
        <>
          <p className="sweep__last">
            {last ? `Ultimo giro: ${formatDateTime(last.startedAt)} · ${OUTCOME_TITLES[last.outcome].replace('Giro ', '')}` : 'Nessun giro fatto finora'}
          </p>
          {last && reasons(last).map((r) => <p key={r} className="sweep__reason">{r}</p>)}
          <div className="settings__row">
            <span>{today ? `${comuni} ${comuni === 1 ? 'comune' : 'comuni'}` : 'Giro di oggi da fare'}</span>
            <button type="button" className={today ? 'btn btn--sm' : 'btn btn--primary btn--sm'} onClick={() => act(() => api.startSweep())}>Cerca</button>
          </div>
        </>
      )}
      {error && <p className="banner banner--error"><span>{error}</span></p>}
    </section>
  );
}
