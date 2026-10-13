import { useCallback, useEffect, useState } from 'react';
import { groupByStatus } from '@/core/leads';
import { LEAD_STATUSES, type LeadStatus, type LeadView } from '@/shared/types';
import { defaultApi, type Api } from './api';
import { ExportBar } from './ExportBar';
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
        <b>HomeRadar</b>
        <button type="button" onClick={() => setView(view === 'leads' ? 'settings' : 'leads')}>
          {view === 'leads' ? '⚙ Impostazioni' : '← Lead'}
        </button>
      </header>
      {warning && <p className="banner banner--warning">Immobiliare.it potrebbe essere cambiato: alcuni dati non sono stati letti.</p>}
      {error && <p className="banner banner--error">{error}</p>}
      {view === 'settings' ? (
        <SettingsView api={api} onSaved={() => void refresh()} />
      ) : (
        <>
          <nav className="tabs">
            {LEAD_STATUSES.map((s) => (
              <button key={s} type="button" className={s === tab ? 'tab tab--on' : 'tab'} onClick={() => setTab(s)}>
                {`${TAB_LABELS[s]} (${groups[s].length})`}
              </button>
            ))}
          </nav>
          {visible.length > 0 && (
            <div className="bulk">
              {confirmingAll ? (
                <>
                  <button
                    type="button"
                    className="bulk__danger"
                    onClick={() => run(() => api.deleteListings(visible.map((l) => l.listing.key)))}
                  >
                    {`Conferma: elimina ${visible.length} ${visible.length === 1 ? 'annuncio' : 'annunci'}`}
                  </button>
                  <button type="button" onClick={() => setConfirmingAll(false)}>Annulla</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmingAll(true)}>{`Elimina tutti (${visible.length})`}</button>
              )}
            </div>
          )}
          {visible.length === 0 ? (
            <p className="empty">Nessun lead in questa scheda. Naviga su Immobiliare.it per raccoglierne.</p>
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
