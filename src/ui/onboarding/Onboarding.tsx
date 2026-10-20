import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { changesSince, needsOnboarding, ONBOARDING_CHANGES } from '@/core/onboarding';
import { BADGE_COLORS, BADGE_LOOK, toReactStyle } from '@/shared/badge-style';
import { formatDate, formatPercent } from '@/shared/format';
import type { OnboardingStatus, Priority, Settings } from '@/shared/types';
import type { Api } from '@/ui/sidepanel/api';
import './onboarding.css';
import { ZoneStep } from './ZoneStep';

type OnboardingApi = Pick<Api, 'getOnboardingStatus' | 'acceptOnboarding' | 'getSettings' | 'saveSettings'>;

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
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [status, settings] = await Promise.all([api.getOnboardingStatus(), api.getSettings()]);
      setData({ status, settings });
      setCode(settings.pilotCode);
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
      // Il codice si salva prima: se non è valido, l'errore resta a video e la conferma non avviene.
      if (data && code.trim() !== data.settings.pilotCode) {
        const settings = await api.saveSettings({ ...data.settings, pilotCode: code });
        setData((d) => (d ? { ...d, settings } : d));
      }
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
          <p>
            Apri una ricerca su Immobiliare.it, Idealista.it, Subito.it o CasaDaPrivato.it, oppure scegli qui sotto la tua zona e premi «Cerca» nel
            pannello: i lead dei privati si aggiornano da soli.
          </p>
          <p>Suggerimento: fissa l'icona di HomeRadar nella barra di Chrome (icona del puzzle, poi la puntina) per aprire il pannello con un clic.</p>
        </section>
        <ZoneStep api={api} initial={data.settings} />
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
          Su Immobiliare.it, Idealista.it, Subito.it e CasaDaPrivato.it HomeRadar riconosce gli annunci pubblicati da privati e li segnala, così
          trovi prima i proprietari da contattare. Lavora sulle pagine che apri tu e, quando premi «Cerca» nel pannello, sulle
          ricerche dei comuni che hai scelto: le apre in una finestra a parte e le legge come faresti tu. Non parte mai da solo.
        </p>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Cosa salva</h2>
        <ul>
          <li>
            Gli annunci di privati che vedi nelle ricerche: titolo, indirizzo completo (via e civico, come pubblicato
            nell'annuncio), città e zona, tipologia, m², locali, prezzo, link e link della foto di copertina.
          </li>
          <li>Lo storico dei prezzi, per riconoscere i ribassi.</li>
          <li>
            La categoria dell'immobile (residenziale, commerciale, terreno, box), i comuni e le categorie della tua zona e,
            per gli annunci trovati con «Cerca», se nei giri successivi non compaiono più.
          </li>
          <li>
            Lo stato che dai a ogni lead, le date di ricontatto e le tue note. Le note le scrivi tu: non inserire dati personali
            che non ti servono.
          </li>
          <li>
            Quando lo stesso immobile compare su più portali, HomeRadar lo riconosce confrontando città, m², locali e prezzo e
            lo mostra come un solo lead. Se separi due annunci uniti per errore, la scelta viene salvata.
          </li>
          <li>
            Quando un annuncio viene tolto e ripubblicato sullo stesso portale, HomeRadar lo riconosce confrontando città, m²,
            locali, tipologia, zona, indirizzo e prezzo, e il lead tiene età, storico prezzi, stato e note dell'annuncio
            precedente. Se separi un annuncio unito per errore, la scelta viene salvata.
          </li>
        </ul>
        <h2 className="onboarding__h">Cosa non salva mai</h2>
        <ul>
          <li>Gli annunci di agenzie.</li>
          <li>Nomi e numeri di telefono dei venditori, anche quando il portale li mostra.</li>
        </ul>
        <p>
          I portali possono chiedere una verifica («non sei un robot») se vedono molte pagine aperte di fila: in quel caso
          HomeRadar si ferma su quel portale e te lo dice. Puoi sempre interrompere il giro con «Ferma» o chiudendo la sua finestra.
        </p>
      </section>
      <section className="card">
        <h2 className="onboarding__h">Dove restano i dati</h2>
        <ul>
          <li>
            Annunci, stati e note restano solo nel tuo browser, su questo computer: non vengono inviati a nessun server, nemmeno
            a chi ha creato HomeRadar.
          </li>
          <li>
            Il pannello mostra la foto di copertina dei tuoi lead caricandola dai server delle immagini del portale, come
            fa la pagina di ricerca. La foto non viene copiata sul tuo computer.
          </li>
          <li>
            Ogni giorno HomeRadar invia al gestore del pilota statistiche d'uso anonime (giorni d'uso, numero di lead, passaggi
            di stato, export) e gli errori tecnici, con il codice pilota della tua agenzia. Non invia mai annunci, indirizzi,
            prezzi, note o nomi. Puoi spegnere l'invio dalle impostazioni.
          </li>
          <li>
            {`Gli annunci rimasti in stato "Nuovo" che non rivedi da ${settings.retentionDays} giorni vengono cancellati da soli, anche se hanno note: per tenerli cambia lo stato. Puoi cambiare il periodo nelle impostazioni. L'annuncio precedente di una ripubblicazione resta finché rivedi la ripubblicazione.`}
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
            <span>età stimata: Idealista, Subito e CasaDaPrivato non pubblicano la data dell'annuncio, quindi HomeRadar la stima; su Immobiliare l'età è esatta.</span>
          </li>
          <li><Badge priority="medium">−8%</Badge><span>ribasso rispetto al prezzo più alto visto.</span></li>
          <li>
            <Badge priority="medium">· 2 portali</Badge>
            <span>lo stesso immobile è pubblicato su più portali: età, priorità e ribasso valgono per tutto il gruppo.</span>
          </li>
          <li>
            <Badge priority="medium">· ripubblicato</Badge>
            <span>l'annuncio è stato tolto e ripubblicato sullo stesso portale: età e ribassi partono dall'annuncio precedente.</span>
          </li>
          <li>
            <Badge priority="medium">+18% su Navigli</Badge>
            <span>
              nel pannello: €/m² sopra la mediana degli annunci di privati che hai visto nella stessa zona (o città, se in zona
              sono pochi). È un'indicazione, non una valutazione.
            </span>
          </li>
          <li>
            <Badge priority="high">3</Badge>
            <span>sull'icona di HomeRadar: i richiami da fare oggi o in ritardo. Li trovi nella scheda «Richiami» del pannello.</span>
          </li>
        </ul>
      </section>
      <p className="onboarding__contact">Per domande, rivolgiti a chi ti ha fornito HomeRadar.</p>
      {mode === 'confirm' && (
        <section className="card onboarding__code">
          <label className="onboarding__h" htmlFor="onboarding-code">Codice pilota (facoltativo)</label>
          <input id="onboarding-code" className="field" value={code} onChange={(e) => setCode(e.target.value)} />
          <p className="onboarding__hint">Te lo dà chi gestisce il pilota. Puoi inserirlo anche dopo, nelle impostazioni.</p>
        </section>
      )}
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
