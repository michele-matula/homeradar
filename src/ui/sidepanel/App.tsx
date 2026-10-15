import { useCallback, useEffect, useState } from 'react';
import { warnedPortals } from '@/core/diagnostics';
import { groupByStatus, PRIORITY_LABELS, SORT_KEYS, SORT_LABELS, sortLeadsBy, type SortKey } from '@/core/leads';
import { needsOnboarding } from '@/core/onboarding';
import { Onboarding } from '@/ui/onboarding/Onboarding';
import { joinList } from '@/shared/format';
import { LEAD_STATUSES, PORTAL_SITES, PORTAL_TAGS, PORTALS, type LeadStatus, type LeadView, type Portal, type Priority } from '@/shared/types';
import { defaultApi, type Api } from './api';
import { ExportBar } from './ExportBar';
import { AlertIcon, BackIcon, Logo, SearchIcon, SettingsIcon } from './Icons';
import { LeadItem } from './LeadItem';
import { SettingsView } from './SettingsView';
import { loadSortByTab, saveSortByTab, type SortByTab } from './sortPrefs';

const TAB_LABELS: Record<LeadStatus, string> = { new: 'Nuovi', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };
type PriorityFilter = 'all' | Exclude<Priority, 'none'>;
const PRIORITY_FILTERS: PriorityFilter[] = ['all', 'high', 'medium', 'verify'];
const FILTER_LABELS: Record<PriorityFilter, string> = { all: 'Tutti', high: PRIORITY_LABELS.high, medium: PRIORITY_LABELS.medium, verify: PRIORITY_LABELS.verify };
const byFilter = (leads: LeadView[], f: PriorityFilter) => (f === 'all' ? leads : leads.filter((l) => l.evaluation.priority === f));
/** Filtro per sito: lista vuota = tutti i siti. */
const byPortals = (leads: LeadView[], ps: Portal[]) => (ps.length ? leads.filter((l) => ps.includes(l.listing.portal)) : leads);
const nAnnunci = (n: number) => `${n} ${n === 1 ? 'annuncio' : 'annunci'}`;
const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

function warningText(portals: Portal[]): string {
  const sites = joinList(portals.map((p) => PORTAL_SITES[p]), 'e');
  return portals.length === 1
    ? `${sites} potrebbe essere cambiato: alcuni dati non sono stati letti.`
    : `${sites} potrebbero essere cambiati: alcuni dati non sono stati letti.`;
}

export function App({ api = defaultApi }: { api?: Api }) {
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [tab, setTab] = useState<LeadStatus>('new');
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [portals, setPortals] = useState<Portal[]>([]);
  const [view, setView] = useState<'leads' | 'settings' | 'guide'>('leads');
  /** Conferma dell'informativa: finché non è 'ok' la lista non si mostra. */
  const [gate, setGate] = useState<'loading' | 'needed' | 'ok' | { error: string }>('loading');
  const [error, setError] = useState<string | null>(null);
  const [warned, setWarned] = useState<Portal[]>([]);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [sortByTab, setSortByTab] = useState<SortByTab>(loadSortByTab);

  const refresh = useCallback(async () => {
    try {
      const [list, diag] = await Promise.all([api.listLeads(), api.getDiagnostics()]);
      setLeads(list);
      setWarned(warnedPortals(diag.adapterWarning));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    return api.onLeadsChanged(() => void refresh());
  }, [api, refresh]);

  const checkGate = useCallback(async () => {
    try {
      const s = await api.getOnboardingStatus();
      setGate(needsOnboarding(s.acceptedVersion, s.current) ? 'needed' : 'ok');
    } catch (e) {
      setGate({ error: errorText(e) });
    }
  }, [api]);

  useEffect(() => {
    void checkGate();
    // La conferma può arrivare dalla scheda di benvenuto mentre il pannello è aperto.
    return api.onOnboardingChanged(() => void checkGate());
  }, [api, checkGate]);

  const run = (action: () => Promise<unknown>) => {
    action().then(refresh, (e: unknown) => setError(errorText(e)));
  };

  const groups = groupByStatus(leads);
  const inPortals = byPortals(groups[tab], portals);
  const visible = sortLeadsBy(byFilter(inPortals, filter), sortByTab[tab]);
  const tagParts = [
    ...(filter === 'all' ? [] : [FILTER_LABELS[filter]]),
    ...(portals.length ? [joinList(portals.map((p) => PORTAL_TAGS[p]), 'e')] : []),
  ];
  const filterTag = tagParts.length ? ` «${tagParts.join(', ')}»` : '';

  // Selezionare tutti i siti equivale a nessun filtro: si torna a "Tutti i siti".
  const togglePortal = (p: Portal) =>
    setPortals((ps) => {
      const next = PORTALS.filter((x) => (x === p ? !ps.includes(x) : ps.includes(x)));
      return next.length === PORTALS.length ? [] : next;
    });

  // L'ordinamento è ricordato per scheda: "Contattati" può seguire un criterio diverso da "Nuovi".
  const setSort = (key: SortKey) =>
    setSortByTab((prev) => {
      const next = { ...prev, [tab]: key };
      saveSortByTab(next);
      return next;
    });

  useEffect(() => setConfirmingAll(false), [tab, filter, portals, visible.length]);

  return (
    <main className="panel">
      <header className="panel__header">
        <div className="brand">
          <Logo size={28} />
          <div>
            <div className="brand__name">HomeRadar</div>
            <div className="brand__sub">
              {gate !== 'ok' ? 'Benvenuto' : { leads: 'Lead da privati', settings: 'Impostazioni', guide: 'Informativa' }[view]}
            </div>
          </div>
        </div>
        {gate === 'ok' && (view === 'leads' ? (
          <button type="button" className="icon-btn icon-btn--on-brand" aria-label="Impostazioni" title="Impostazioni" onClick={() => setView('settings')}>
            <SettingsIcon />
          </button>
        ) : (
          <button type="button" className="icon-btn icon-btn--on-brand" aria-label="Torna ai lead" title="Torna ai lead" onClick={() => setView('leads')}>
            <BackIcon />
          </button>
        ))}
      </header>
      {gate !== 'ok' ? (
        gate === 'loading' ? (
          <p className="settings__loading">Caricamento…</p>
        ) : gate === 'needed' ? (
          <Onboarding api={api} mode="confirm" onDone={() => void checkGate()} />
        ) : (
          <div className="onboarding">
            <p className="banner banner--error">
              <AlertIcon />
              <span>{gate.error}</span>
            </p>
            <button type="button" className="btn" onClick={() => void checkGate()}>Riprova</button>
          </div>
        )
      ) : (
        <>
          {warned.length > 0 && (
            <p className="banner banner--warning">
              <AlertIcon />
              <span>{warningText(warned)}</span>
            </p>
          )}
          {error && (
            <p className="banner banner--error">
              <AlertIcon />
              <span>{error}</span>
            </p>
          )}
          {view === 'settings' ? (
            <SettingsView api={api} onSaved={() => void refresh()} onOpenGuide={() => setView('guide')} />
          ) : view === 'guide' ? (
            <Onboarding api={api} mode="review" onDone={() => setView('settings')} />
          ) : (
            <>
              <nav className="tabs" role="tablist">
                {LEAD_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={s === tab}
                    aria-label={`${TAB_LABELS[s]} (${groups[s].length})`}
                    className={s === tab ? 'tab tab--on' : 'tab'}
                    onClick={() => setTab(s)}
                  >
                    <span className="tab__count">{groups[s].length}</span>
                    <span className="tab__label">{TAB_LABELS[s]}</span>
                  </button>
                ))}
              </nav>
              <div className="filters" role="radiogroup" aria-label="Filtra per badge">
                {PRIORITY_FILTERS.map((f) => {
                  const count = byFilter(inPortals, f).length;
                  const on = f === filter;
                  return (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`${FILTER_LABELS[f]} (${count})`}
                      className={`chip chip--${f}${on ? ' chip--on' : ''}`}
                      disabled={count === 0 && !on}
                      onClick={() => setFilter(f)}
                    >
                      {FILTER_LABELS[f]} <span className="chip__count">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="filters" role="group" aria-label="Filtra per sito">
                <button
                  type="button"
                  aria-pressed={portals.length === 0}
                  className={`chip${portals.length === 0 ? ' chip--on' : ''}`}
                  onClick={() => setPortals([])}
                >
                  Tutti i siti
                </button>
                {PORTALS.map((p) => {
                  const count = byFilter(groups[tab], filter).filter((l) => l.listing.portal === p).length;
                  const on = portals.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${PORTAL_TAGS[p]} (${count})`}
                      className={`chip${on ? ' chip--on' : ''}`}
                      disabled={count === 0 && !on}
                      onClick={() => togglePortal(p)}
                    >
                      {PORTAL_TAGS[p]} <span className="chip__count">{count}</span>
                    </button>
                  );
                })}
              </div>
              <label className="sort">
                <span className="sort__label">Ordina per</span>
                <select className="field field--select" value={sortByTab[tab]} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORT_KEYS.map((k) => (
                    <option key={k} value={k}>{SORT_LABELS[k]}</option>
                  ))}
                </select>
              </label>
              {visible.length > 0 && (
                <div className="bulk">
                  <span className="bulk__count">{nAnnunci(visible.length)}</span>
                  <div className="bulk__actions">
                    {confirmingAll ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => run(() => api.deleteListings(visible.map((l) => l.listing.key)))}
                        >
                          {`Conferma: elimina ${nAnnunci(visible.length)}${filterTag}`}
                        </button>
                        <button type="button" className="btn btn--sm" onClick={() => setConfirmingAll(false)}>Annulla</button>
                      </>
                    ) : (
                      <button type="button" className="btn btn--ghost-danger btn--sm" onClick={() => setConfirmingAll(true)}>
                        {`Elimina tutti${filterTag} (${visible.length})`}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {visible.length === 0 ? (
                <div className="empty">
                  <SearchIcon />
                  <p>{!filterTag ? `Nessun lead in questa scheda. Naviga su ${joinList(PORTALS.map((p) => PORTAL_SITES[p]), 'o')} per raccoglierne.` : `Nessun lead${filterTag} in questa scheda.`}</p>
                </div>
              ) : (
                <ul className="leads">
                  {visible.map((l) => (
                    <LeadItem
                      key={l.listing.key}
                      lead={l}
                      onChange={(patch) => run(() => api.setLeadState(l.listing.key, patch))}
                      onDelete={() => run(() => api.deleteListing(l.listing.key))}
                    />
                  ))}
                </ul>
              )}
              <ExportBar leads={visible} />
            </>
          )}
        </>
      )}
    </main>
  );
}
