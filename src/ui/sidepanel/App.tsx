import { useCallback, useEffect, useState } from 'react';
import { groupByStatus } from '@/core/leads';
import { LEAD_STATUSES, type LeadStatus, type LeadView } from '@/shared/types';
import { defaultApi, type Api } from './api';
import { ExportBar } from './ExportBar';
import { AlertIcon, BackIcon, Logo, SearchIcon, SettingsIcon } from './Icons';
import { LeadItem } from './LeadItem';
import { SettingsView } from './SettingsView';

const TAB_LABELS: Record<LeadStatus, string> = { new: 'Nuovi', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };
const errorText = (e: unknown) => `Errore: ${e instanceof Error ? e.message : String(e)}`;

export function App({ api = defaultApi }: { api?: Api }) {
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [tab, setTab] = useState<LeadStatus>('new');
  const [view, setView] = useState<'leads' | 'settings'>('leads');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, diag] = await Promise.all([api.listLeads(), api.getDiagnostics()]);
      setLeads(list);
      setWarning(diag.adapterWarning);
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
  const visible = groups[tab];

  useEffect(() => setConfirmingAll(false), [tab, visible.length]);

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
      {warning && (
        <p className="banner banner--warning">
          <AlertIcon />
          <span>Immobiliare.it potrebbe essere cambiato: alcuni dati non sono stati letti.</span>
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
          {visible.length > 0 && (
            <div className="bulk">
              <span className="bulk__count">{`${visible.length} ${visible.length === 1 ? 'annuncio' : 'annunci'}`}</span>
              <div className="bulk__actions">
                {confirmingAll ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => run(() => api.deleteListings(visible.map((l) => l.listing.key)))}
                    >
                      {`Conferma: elimina ${visible.length} ${visible.length === 1 ? 'annuncio' : 'annunci'}`}
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => setConfirmingAll(false)}>Annulla</button>
                  </>
                ) : (
                  <button type="button" className="btn btn--ghost-danger btn--sm" onClick={() => setConfirmingAll(true)}>
                    {`Elimina tutti (${visible.length})`}
                  </button>
                )}
              </div>
            </div>
          )}
          {visible.length === 0 ? (
            <div className="empty">
              <SearchIcon />
              <p>Nessun lead in questa scheda. Naviga su Immobiliare.it per raccoglierne.</p>
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
