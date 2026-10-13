import { useCallback, useEffect, useState } from 'react';
import { warnedPortals } from '@/core/diagnostics';
import { groupByStatus, PRIORITY_LABELS } from '@/core/leads';
import { LEAD_STATUSES, PORTAL_SITES, type LeadStatus, type LeadView, type Portal, type Priority } from '@/shared/types';
import { defaultApi, type Api } from './api';
import { ExportBar } from './ExportBar';
import { AlertIcon, BackIcon, Logo, SearchIcon, SettingsIcon } from './Icons';
import { LeadItem } from './LeadItem';
import { SettingsView } from './SettingsView';

const TAB_LABELS: Record<LeadStatus, string> = { new: 'Nuovi', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };
type PriorityFilter = 'all' | Exclude<Priority, 'none'>;
const PRIORITY_FILTERS: PriorityFilter[] = ['all', 'high', 'medium', 'verify'];
const FILTER_LABELS: Record<PriorityFilter, string> = { all: 'Tutti', high: PRIORITY_LABELS.high, medium: PRIORITY_LABELS.medium, verify: PRIORITY_LABELS.verify };
const byFilter = (leads: LeadView[], f: PriorityFilter) => (f === 'all' ? leads : leads.filter((l) => l.evaluation.priority === f));
const nAnnunci = (n: number) => `${n} ${n === 1 ? 'annuncio' : 'annunci'}`;
const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

function warningText(portals: Portal[]): string {
  const sites = portals.map((p) => PORTAL_SITES[p]);
  return sites.length === 1
    ? `${sites[0]} potrebbe essere cambiato: alcuni dati non sono stati letti.`
    : `${sites.join(' e ')} potrebbero essere cambiati: alcuni dati non sono stati letti.`;
}

export function App({ api = defaultApi }: { api?: Api }) {
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [tab, setTab] = useState<LeadStatus>('new');
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [view, setView] = useState<'leads' | 'settings'>('leads');
  const [error, setError] = useState<string | null>(null);
  const [warned, setWarned] = useState<Portal[]>([]);
  const [confirmingAll, setConfirmingAll] = useState(false);

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

  const run = (action: () => Promise<unknown>) => {
    action().then(refresh, (e: unknown) => setError(errorText(e)));
  };

  const groups = groupByStatus(leads);
  const visible = byFilter(groups[tab], filter);
  const filterTag = filter === 'all' ? '' : ` «${FILTER_LABELS[filter]}»`;

  useEffect(() => setConfirmingAll(false), [tab, filter, visible.length]);

  return (
    <main className="panel">
      <header className="panel__header">
        <div className="brand">
          <Logo size={28} />
          <div>
            <div className="brand__name">HomeRadar</div>
            <div className="brand__sub">{view === 'leads' ? 'Lead da privati' : 'Impostazioni'}</div>
          </div>
        </div>
        {view === 'leads' ? (
          <button type="button" className="icon-btn icon-btn--on-brand" aria-label="Impostazioni" title="Impostazioni" onClick={() => setView('settings')}>
            <SettingsIcon />
          </button>
        ) : (
          <button type="button" className="icon-btn icon-btn--on-brand" aria-label="Torna ai lead" title="Torna ai lead" onClick={() => setView('leads')}>
            <BackIcon />
          </button>
        )}
      </header>
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
        <SettingsView api={api} onSaved={() => void refresh()} />
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
              const count = byFilter(groups[tab], f).length;
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
              <p>{filter === 'all' ? 'Nessun lead in questa scheda. Naviga su Immobiliare.it o Idealista.it per raccoglierne.' : `Nessun lead${filterTag} in questa scheda.`}</p>
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
    </main>
  );
}
