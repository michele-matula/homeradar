import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { changesSince, needsOnboarding, ONBOARDING_CHANGES } from '@/core/onboarding';
import { BADGE_COLORS, BADGE_LOOK, toReactStyle } from '@/shared/badge-style';
import { formatDate, formatPercent } from '@/shared/format';
import type { OnboardingStatus, Priority, Settings } from '@/shared/types';
import type { Api } from '@/ui/sidepanel/api';
import './onboarding.css';

type OnboardingApi = Pick<Api, 'getOnboardingStatus' | 'acceptOnboarding' | 'getSettings'>;

const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

function Badge({ priority, children }: { priority: Priority; children: string }) {
  return <span className="legend__badge" style={toReactStyle({ ...BADGE_LOOK, ...BADGE_COLORS[priority] }) as CSSProperties}>{children}</span>;
}

/**
 * Benvenuto e informativa. `confirm`: con il pulsante di conferma (scheda all'installazione e pannello
 * finché manca la conferma); `review`: in sola lettura dalle impostazioni.
 */
export function Onboarding({ api, mode, onDone, changes = ONBOARDING_CHANGES }: {
  api: OnboardingApi;
  mode: 'confirm' | 'review';
  /** Pannello: torna alla lista o alle impostazioni. Senza, la scheda mostra "HomeRadar è attivo". */
  onDone?: () => void;
  changes?: Record<number, string[]>;
}) {
  const [data, setData] = useState<{ status: OnboardingStatus; settings: Settings } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [status, settings] = await Promise.all([api.getOnboardingStatus(), api.getSettings()]);
      setData({ status, settings });
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const status = await api.acceptOnboarding();
      setData((d) => (d ? { ...d, status } : d));
      if (onDone) onDone();
      else setDone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="onboarding">
        {error ? (
          <>
            <p className="banner banner--error"><span>{error}</span></p>
            <button type="button" className="btn" onClick={() => void load()}>Riprova</button>
          </>
        ) : (
          <p className="settings__loading">Caricamento…</p>
        )}
      </div>
    );
  }

  const { status, settings } = data;
  if (mode === 'confirm' && (done || !needsOnboarding(status.acceptedVersion, status.current))) {
    return (
      <div className="onboarding">
        <section className="card">
          <h2 className="onboarding__title">HomeRadar è attivo</h2>
          <p>Apri una ricerca su Immobiliare.it, Idealista.it o Subito.it: i badge compaiono sugli annunci dei privati.</p>
          <p>Suggerimento: fissa l'icona di HomeRadar nella barra di Chrome (icona del puzzle, poi la puntina) per aprire il pannello con un clic.</p>
        </section>
      </div>
    );
  }

  const news = changesSince(status.acceptedVersion, changes, status.current);
  const dropped = settings.minDropPercent > 0 ? `ribassato di almeno ${formatPercent(settings.minDropPercent)}%` : 'ribassato';

  return (
    <div className="onboarding">
      {news.length > 0 && (
        <section className="card onboarding__changes">
          <h2 className="onboarding__h">Cosa è cambiato</h2>
          <ul>{news.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}
      <section className="card">
        <h2 className="onboarding__title">Benvenuto in HomeRadar</h2>
        <p>
          Su Immobiliare.it, Idealista.it e Subito.it HomeRadar riconosce gli annunci pubblicati da privati e li segnala, così
          trovi prima i proprietari da contattare. Lavora solo sulle pagine che apri tu: non visita i portali da solo e non fa
          ricerche al posto tuo.
        </p>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Cosa salva</h2>
        <ul>
          <li>
            Gli annunci di privati che vedi nelle ricerche: titolo, indirizzo completo (via e civico, come pubblicato
            nell'annuncio), città e zona, tipologia, m², locali, prezzo e link.
          </li>
          <li>Lo storico dei prezzi, per riconoscere i ribassi.</li>
          <li>
            Lo stato che dai a ogni lead, le date di ricontatto e le tue note. Le note le scrivi tu: non inserire dati personali
            che non ti servono.
          </li>
        </ul>
        <h2 className="onboarding__h">Cosa non salva mai</h2>
        <ul>
          <li>Gli annunci di agenzie.</li>
          <li>Nomi e numeri di telefono dei venditori, anche quando il portale li mostra.</li>
        </ul>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Dove restano i dati</h2>
        <ul>
          <li>Solo nel tuo browser, su questo computer. Non vengono inviati a nessun server, nemmeno a chi ha creato HomeRadar.</li>
          <li>
            {`Gli annunci rimasti in stato "Nuovo" che non rivedi da ${settings.retentionDays} giorni vengono cancellati da soli, anche se hanno note: per tenerli cambia lo stato. Puoi cambiare il periodo nelle impostazioni.`}
          </li>
          <li>
            Una volta a settimana HomeRadar salva un backup nella cartella Download/HomeRadar. Se Chrome è impostato per chiedere
            dove salvare i file, in quel momento vedrai la finestra di salvataggio: confermala. Il backup si può spegnere nelle
            impostazioni.
          </li>
          <li>Puoi cancellare tutto in qualsiasi momento: Impostazioni → Azzera archivio annunci.</li>
        </ul>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Come leggere i badge</h2>
        <ul className="legend">
          <li><Badge priority="high">● Alta</Badge><span>{`online da almeno ${settings.minAgeDays} giorni e ${dropped}.`}</span></li>
          <li><Badge priority="medium">● Media</Badge><span>solo una delle due condizioni.</span></li>
          <li>
            <Badge priority="verify">◐ Da verificare</Badge>
            <Badge priority="verify">◐ Età incerta</Badge>
            <span>l'età è vicina alla soglia e non è certa.</span>
          </li>
          <li><Badge priority="none">Privato</Badge><span>annuncio di un privato senza segnali particolari.</span></li>
          <li>
            <Badge priority="none">~120 gg</Badge>
            <span>età stimata: Idealista e Subito non pubblicano la data dell'annuncio, quindi HomeRadar la stima; su Immobiliare l'età è esatta.</span>
          </li>
          <li><Badge priority="medium">−8%</Badge><span>ribasso rispetto al prezzo più alto visto.</span></li>
          <li>
            <Badge priority="high">3</Badge>
            <span>sull'icona di HomeRadar: i richiami da fare oggi o in ritardo. Li trovi nella scheda «Richiami» del pannello.</span>
          </li>
        </ul>
      </section>
      <p className="onboarding__contact">Per domande, rivolgiti a chi ti ha fornito HomeRadar.</p>
      {error && <p className="banner banner--error"><span>{error}</span></p>}
      {mode === 'confirm' ? (
        <button type="button" className="btn btn--primary onboarding__cta" disabled={busy} onClick={() => void accept()}>
          Ho capito, inizia
        </button>
      ) : (
        <div className="onboarding__review">
          {status.acceptedAt != null && <span>{`Confermata il ${formatDate(status.acceptedAt)}`}</span>}
          <button type="button" className="btn" onClick={onDone}>Chiudi</button>
        </div>
      )}
    </div>
  );
}
