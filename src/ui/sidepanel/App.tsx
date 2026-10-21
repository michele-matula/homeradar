import { Fragment, useCallback, useEffect, useState } from 'react';
import { warnedPortals } from '@/core/diagnostics';
import { applyQuery, describeQuery, inComuni, isEmptyQuery, OTHER_COMUNI, parseThousands, type LeadQuery } from '@/core/lead-filters';
import { seenSince } from '@/core/lead-groups';
import { groupByRecall, groupByStatus, leadCategories, leadKeys, leadPortals, PRIORITY_LABELS, RECALL_GROUP_LABELS, SORT_KEYS, SORT_LABELS, sortLeadsBy, type SortKey } from '@/core/leads';
import { needsOnboarding } from '@/core/onboarding';
import { isDue } from '@/core/recall';
import { Onboarding } from '@/ui/onboarding/Onboarding';
import { joinList } from '@/shared/format';
import {
  CATEGORY_LABELS, LEAD_STATUSES, PORTAL_SITES, PORTAL_TAGS, PORTALS, PROPERTY_CATEGORIES,
  type ComuneRef, type LeadStatus, type LeadView, type Portal, type Priority, type PropertyCategory,
} from '@/shared/types';
import { defaultApi, type Api } from './api';
import { ExportBar } from './ExportBar';
import { AlertIcon, BackIcon, ChevronIcon, CloseIcon, Logo, SearchIcon, SettingsIcon } from './Icons';
import { LeadItem } from './LeadItem';
import { SettingsView } from './SettingsView';
import { SweepCard } from './SweepCard';
import { loadFiltersOpen, saveFiltersOpen } from './filtersPrefs';
import { loadSortByTab, saveSortByTab, type SortByTab } from './sortPrefs';

type Tab = 'recall' | LeadStatus;
const TABS: Tab[] = ['recall', ...LEAD_STATUSES];
const TAB_LABELS: Record<Tab, string> = { recall: 'Richiami', new: 'Nuovi', to_contact: 'Da contattare', contacted: 'Contattati', discarded: 'Scartati' };
type PriorityFilter = 'all' | Exclude<Priority, 'none'>;
const PRIORITY_FILTERS: PriorityFilter[] = ['all', 'high', 'medium', 'verify'];
const FILTER_LABELS: Record<PriorityFilter, string> = { all: 'Tutti', high: PRIORITY_LABELS.high, medium: PRIORITY_LABELS.medium, verify: PRIORITY_LABELS.verify };
const byFilter = (leads: LeadView[], f: PriorityFilter) => (f === 'all' ? leads : leads.filter((l) => l.evaluation.priority === f));
/** Filtro per sito: lista vuota = tutti i siti. Un lead unito passa se ha una fonte su uno dei siti scelti. */
const byPortals = (leads: LeadView[], ps: Portal[]) => (ps.length ? leads.filter((l) => leadPortals(l).some((p) => ps.includes(p))) : leads);
const byMulti = (leads: LeadView[], on: boolean) => (on ? leads.filter((l) => leadPortals(l).length > 1) : leads);
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
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const tab: Tab = chosenTab ?? 'new';
  const [filter, setFilter] = useState<PriorityFilter>('all');
  const [portals, setPortals] = useState<Portal[]>([]);
  /** Solo lead pubblicati su più portali. */
  const [multi, setMulti] = useState(false);
  /** Filtri che agiscono prima delle schede, come ricerca e prezzo. */
  const [categories, setCategories] = useState<PropertyCategory[]>([]);
  const [missingOnly, setMissingOnly] = useState(false);
  /** Comuni della zona di «Cerca», dalle impostazioni: sono i bottoni del filtro per comune. */
  const [zone, setZone] = useState<ComuneRef[]>([]);
  /** Codici ISTAT scelti e/o `OTHER_COMUNI`; vuoto = tutti i comuni. */
  const [chosenComuni, setChosenComuni] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(loadFiltersOpen);
  /** "Vedi i nuovi" del giro: lead con una fonte vista per la prima volta da questa data. */
  const [since, setSince] = useState<number | null>(null);
  const [view, setView] = useState<'leads' | 'settings' | 'guide'>('leads');
  /** Conferma dell'informativa: finché non è 'ok' la lista non si mostra. */
  const [gate, setGate] = useState<'loading' | 'needed' | 'ok' | { error: string }>('loading');
  const [error, setError] = useState<string | null>(null);
  const [warned, setWarned] = useState<Portal[]>([]);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [sortByTab, setSortByTab] = useState<SortByTab>(loadSortByTab);
  // Ricerca e prezzo valgono per tutte le schede e si azzerano alla chiusura del pannello, come badge e sito.
  const [text, setText] = useState('');
  const [minInput, setMinInput] = useState('');
  const [maxInput, setMaxInput] = useState('');
  const [reservedOnly, setReservedOnly] = useState(false);

  const refresh = useCallback(async () => {
    // La zona serve solo al filtro per comune: se non si legge, la lista si mostra comunque.
    api.getSettings().then((s) => setZone(s.searchArea.comuni), () => {});
    try {
      const [list, diag] = await Promise.all([api.listLeads(), api.getDiagnostics()]);
      setLeads(list);
      // Si apre su "Richiami" solo se c'è qualcosa da fare oggi; poi decide l'agente.
      setTab((t) => t ?? (list.some((l) => isDue(l.state.recallAt, Date.now())) ? 'recall' : 'new'));
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

  useEffect(() => {
    // Giorno con il pannello aperto, per la misura del pilota. Un errore non deve disturbare l'agente.
    api.trackUsage({ kind: 'panel' }).catch(() => {});
  }, [api]);

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

  const minPrice = parseThousands(minInput);
  const maxPrice = parseThousands(maxInput);
  // Un prezzo non valido non filtra: il campo è segnato in rosso.
  const query: LeadQuery = { text, minPrice: minPrice === 'invalid' ? null : minPrice, maxPrice: maxPrice === 'invalid' ? null : maxPrice, reservedOnly };
  // Ricerca e prezzo agiscono prima delle schede, così anche i loro conteggi li seguono.
  const now = Date.now();
  const base = applyQuery(leads, query).filter((l) =>
    (!missingOnly || l.missing != null || l.missingPortals.length > 0)
    && (since == null || seenSince(l, since)));
  // Un comune tolto dalla zona esce dal filtro; senza zona il filtro per comune non c'è.
  const comuni = zone.length ? chosenComuni.filter((c) => c === OTHER_COMUNI || zone.some((z) => z.istat === c)) : [];
  const byCategories = (list: LeadView[]) => (categories.length ? list.filter((l) => leadCategories(l).some((c) => categories.includes(c))) : list);
  const byComuni = (list: LeadView[]) => (comuni.length ? list.filter((l) => inComuni(l, zone, comuni)) : list);
  // Categorie e comuni si contano prima del proprio filtro: così se ne può scegliere più di uno.
  const beforeCategories = byComuni(base);
  const beforeComuni = byCategories(base);
  const applied = byCategories(beforeCategories);
  const inTab = (list: LeadView[], t: Tab) => (t === 'recall' ? list.filter((l) => l.state.recallAt != null) : groupByStatus(list)[t]);
  const groups = groupByStatus(applied);
  const recalls = applied.filter((l) => l.state.recallAt != null);
  const dueCount = recalls.filter((l) => isDue(l.state.recallAt, now)).length;
  const tabLeads = (t: Tab) => (t === 'recall' ? recalls : groups[t]);
  const inPortals = byMulti(byPortals(tabLeads(tab), portals), multi);
  const filtered = byFilter(inPortals, filter);
  const recallGroups = tab === 'recall' ? groupByRecall(filtered, now) : [];
  // Nella scheda "Richiami" l'ordine è quello dei gruppi; altrove il criterio scelto.
  const visible = tab === 'recall' ? recallGroups.flatMap((g) => g.leads) : sortLeadsBy(filtered, sortByTab[tab]);
  const comuneName = (c: string) => (c === OTHER_COMUNI ? 'altri comuni' : zone.find((z) => z.istat === c)?.name ?? c);
  const comuniTag = comuni.length ? joinList(comuni.map(comuneName), 'e') : null;
  const tagParts = [
    ...(filter === 'all' ? [] : [FILTER_LABELS[filter]]),
    ...(comuniTag ? [comuniTag] : []),
    ...(portals.length ? [joinList(portals.map((p) => PORTAL_TAGS[p]), 'e')] : []),
    ...(multi ? ['su più portali'] : []),
    ...(categories.length ? [joinList(categories.map((c) => CATEGORY_LABELS[c]), 'e')] : []),
    ...(missingOnly ? ['non più visti'] : []),
    ...(since != null ? ['da questo giro'] : []),
    ...describeQuery(query),
  ];
  const filterTag = tagParts.length ? ` «${tagParts.join(', ')}»` : '';
  const clearPrice = () => {
    setMinInput('');
    setMaxInput('');
    setReservedOnly(false);
  };
  // Filtri del riquadro «Filtri»: a riquadro chiuso restano visibili come etichette che si tolgono con un clic.
  const priceTag = describeQuery({ ...query, text: '' }).join(', ') || (minPrice === 'invalid' || maxPrice === 'invalid' ? 'prezzo non valido' : '');
  const drawerTags: { label: string; clear: () => void }[] = [
    ...(comuniTag ? [{ label: comuniTag, clear: () => setChosenComuni([]) }] : []),
    ...(portals.length ? [{ label: joinList(portals.map((p) => PORTAL_TAGS[p]), 'e'), clear: () => setPortals([]) }] : []),
    ...(multi ? [{ label: 'Su più portali', clear: () => setMulti(false) }] : []),
    ...(categories.length ? [{ label: joinList(categories.map((c) => CATEGORY_LABELS[c]), 'e'), clear: () => setCategories([]) }] : []),
    ...(priceTag ? [{ label: priceTag, clear: clearPrice }] : []),
    ...(missingOnly ? [{ label: 'Non più visti', clear: () => setMissingOnly(false) }] : []),
    ...(since != null ? [{ label: 'Da questo giro', clear: () => setSince(null) }] : []),
  ];
  const anyFilter = filter !== 'all' || !isEmptyQuery(query) || drawerTags.length > 0;
  const toggleFilters = () => {
    saveFiltersOpen(!filtersOpen);
    setFiltersOpen(!filtersOpen);
  };
  const resetFilters = () => {
    setText('');
    setMinInput('');
    setMaxInput('');
    setReservedOnly(false);
    setFilter('all');
    setPortals([]);
    setMulti(false);
    setCategories([]);
    setChosenComuni([]);
    setMissingOnly(false);
    setSince(null);
  };

  // Come per siti e categorie, sceglierli tutti equivale a nessun filtro.
  const toggleComune = (c: string) =>
    setChosenComuni(() => {
      const options = [...zone.map((z) => z.istat), OTHER_COMUNI];
      const next = options.filter((x) => (x === c ? !comuni.includes(x) : comuni.includes(x)));
      return next.length === options.length ? [] : next;
    });

  const toggleCategory = (c: PropertyCategory) =>
    setCategories((cs) => {
      const next = PROPERTY_CATEGORIES.filter((x) => (x === c ? !cs.includes(x) : cs.includes(x)));
      return next.length === PROPERTY_CATEGORIES.length ? [] : next;
    });

  // Selezionare tutti i siti equivale a nessun filtro: si torna a "Tutti i siti".
  const togglePortal = (p: Portal) =>
    setPortals((ps) => {
      const next = PORTALS.filter((x) => (x === p ? !ps.includes(x) : ps.includes(x)));
      return next.length === PORTALS.length ? [] : next;
    });

  // L'ordinamento è ricordato per scheda: "Contattati" può seguire un criterio diverso da "Nuovi".
  const setSort = (key: SortKey) => {
    if (tab === 'recall') return;
    setSortByTab((prev) => {
      const next = { ...prev, [tab]: key };
      saveSortByTab(next);
      return next;
    });
  };

  useEffect(() => setConfirmingAll(false), [tab, filter, portals, multi, categories, chosenComuni, missingOnly, since, visible.length, text, query.minPrice, query.maxPrice, reservedOnly]);

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
              <SweepCard
                api={api}
                onShowNew={(at) => {
                  setSince(at);
                  setTab('new');
                }}
                onOpenSettings={() => setView('settings')}
              />
              <nav className="tabs" role="tablist">
                {TABS.map((t) => {
                  const due = t === 'recall' && dueCount > 0;
                  const count = t === 'recall' ? (due ? dueCount : recalls.length) : groups[t].length;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={t === tab}
                      aria-label={`${TAB_LABELS[t]} (${due ? `${count} da fare` : count})`}
                      className={t === tab ? 'tab tab--on' : 'tab'}
                      onClick={() => setTab(t)}
                    >
                      <span className={due ? 'tab__count tab__count--due' : 'tab__count'}>{count}</span>
                      <span className="tab__label">{TAB_LABELS[t]}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="search">
                <SearchIcon size={16} />
                <input
                  type="search"
                  className="field search__input"
                  aria-label="Cerca nei lead"
                  placeholder="Cerca titolo, indirizzo, zona…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                {text && (
                  <button type="button" className="icon-btn search__clear" aria-label="Svuota ricerca" title="Svuota ricerca" onClick={() => setText('')}>
                    <CloseIcon />
                  </button>
                )}
              </div>
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
              <div className="filterbar">
                <button
                  type="button"
                  className={`btn btn--sm filterbar__toggle${drawerTags.length ? ' filterbar__toggle--on' : ''}`}
                  aria-expanded={filtersOpen}
                  aria-controls="filters-drawer"
                  onClick={toggleFilters}
                >
                  {drawerTags.length ? `Filtri (${drawerTags.length})` : 'Filtri'}
                  <ChevronIcon open={filtersOpen} />
                </button>
                {!filtersOpen && drawerTags.map((t) => (
                  <button key={t.label} type="button" className="filter-tag" aria-label={`Togli il filtro ${t.label}`} title="Togli il filtro" onClick={t.clear}>
                    {t.label}
                    <CloseIcon />
                  </button>
                ))}
                {anyFilter && (
                  <button type="button" className="btn btn--sm filterbar__reset" onClick={resetFilters}>Azzera filtri</button>
                )}
              </div>
              {filtersOpen && (
                <div className="drawer" id="filters-drawer">
                  {zone.length > 0 && (
                    <section className="drawer__section">
                      <h4 className="drawer__title">Comune</h4>
                      <div className="filters" role="group" aria-label="Filtra per comune">
                        <button
                          type="button"
                          aria-pressed={comuni.length === 0}
                          className={`chip${comuni.length === 0 ? ' chip--on' : ''}`}
                          onClick={() => setChosenComuni([])}
                        >
                          Tutti i comuni
                        </button>
                        {[...zone.map((z) => z.istat), OTHER_COMUNI].map((c) => {
                          const count = byFilter(byMulti(byPortals(inTab(beforeComuni, tab), portals), multi), filter)
                            .filter((l) => inComuni(l, zone, [c])).length;
                          const on = comuni.includes(c);
                          const label = c === OTHER_COMUNI ? 'Altri comuni' : comuneName(c);
                          return (
                            <button
                              key={c}
                              type="button"
                              aria-pressed={on}
                              aria-label={`${label} (${count})`}
                              className={`chip${on ? ' chip--on' : ''}`}
                              disabled={count === 0 && !on}
                              onClick={() => toggleComune(c)}
                            >
                              {label} <span className="chip__count">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                  <section className="drawer__section">
                    <h4 className="drawer__title">Sito</h4>
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
                        const count = byFilter(byMulti(tabLeads(tab), multi), filter).filter((l) => leadPortals(l).includes(p)).length;
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
                      {(() => {
                        const count = byFilter(byPortals(tabLeads(tab), portals), filter).filter((l) => leadPortals(l).length > 1).length;
                        return (
                          <button
                            type="button"
                            aria-pressed={multi}
                            aria-label={`Su più portali (${count})`}
                            className={`chip${multi ? ' chip--on' : ''}`}
                            disabled={count === 0 && !multi}
                            onClick={() => setMulti((m) => !m)}
                          >
                            Su più portali <span className="chip__count">{count}</span>
                          </button>
                        );
                      })()}
                    </div>
                  </section>
                  <section className="drawer__section">
                    <h4 className="drawer__title">Categoria</h4>
                    <div className="filters" role="group" aria-label="Filtra per categoria">
                      {PROPERTY_CATEGORIES.map((c) => {
                        const count = inTab(beforeCategories, tab).filter((l) => leadCategories(l).includes(c)).length;
                        const on = categories.includes(c);
                        return (
                          <button
                            key={c}
                            type="button"
                            aria-pressed={on}
                            aria-label={`${CATEGORY_LABELS[c]} (${count})`}
                            className={`chip${on ? ' chip--on' : ''}`}
                            disabled={count === 0 && !on}
                            onClick={() => toggleCategory(c)}
                          >
                            {CATEGORY_LABELS[c]} <span className="chip__count">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <section className="drawer__section">
                    <h4 className="drawer__title">Prezzo</h4>
                    <div className="price">
                      <span className="price__label">da</span>
                      <input
                        className="field price__input"
                        inputMode="decimal"
                        aria-label="Prezzo minimo in migliaia di euro"
                        aria-invalid={minPrice === 'invalid'}
                        value={minInput}
                        onChange={(e) => { setMinInput(e.target.value); setReservedOnly(false); }}
                      />
                      <span className="price__label">a</span>
                      <input
                        className="field price__input"
                        inputMode="decimal"
                        aria-label="Prezzo massimo in migliaia di euro"
                        aria-invalid={maxPrice === 'invalid'}
                        value={maxInput}
                        onChange={(e) => { setMaxInput(e.target.value); setReservedOnly(false); }}
                      />
                      <span className="price__label">k€</span>
                      <button
                        type="button"
                        className="btn btn--sm"
                        aria-pressed={reservedOnly}
                        onClick={() => {
                          if (!reservedOnly) {
                            setMinInput('');
                            setMaxInput('');
                          }
                          setReservedOnly(!reservedOnly);
                        }}
                      >
                        Solo trattativa riservata
                      </button>
                    </div>
                  </section>
                  <section className="drawer__section">
                    <h4 className="drawer__title">Altro</h4>
                    <div className="filters" role="group" aria-label="Altri filtri">
                      {(() => {
                        const count = tabLeads(tab).filter((l) => l.missing != null || l.missingPortals.length > 0).length;
                        return (
                          <button
                            type="button"
                            aria-pressed={missingOnly}
                            aria-label={`Non più visti (${count})`}
                            className={`chip${missingOnly ? ' chip--on' : ''}`}
                            disabled={count === 0 && !missingOnly}
                            onClick={() => setMissingOnly((m) => !m)}
                          >
                            Non più visti <span className="chip__count">{count}</span>
                          </button>
                        );
                      })()}
                      {since != null && (
                        <button type="button" aria-pressed className="chip chip--on" onClick={() => setSince(null)}>Da questo giro ✕</button>
                      )}
                    </div>
                  </section>
                </div>
              )}
              {tab !== 'recall' && (
                <label className="sort">
                  <span className="sort__label">Ordina per</span>
                  <select className="field field--select" value={sortByTab[tab]} onChange={(e) => setSort(e.target.value as SortKey)}>
                    {SORT_KEYS.map((k) => (
                      <option key={k} value={k}>{SORT_LABELS[k]}</option>
                    ))}
                  </select>
                </label>
              )}
              {tab !== 'recall' && visible.length > 0 && (
                <div className="bulk">
                  <span className="bulk__count">{nAnnunci(visible.length)}</span>
                  <div className="bulk__actions">
                    {confirmingAll ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => run(() => api.deleteListings(visible.flatMap(leadKeys)))}
                        >
                          {/* Un lead unito elimina tutte le sue fonti: si contano gli annunci, non i lead. */}
                          {`Conferma: elimina ${nAnnunci(visible.flatMap(leadKeys).length)}${filterTag}`}
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
                  <p>
                    {filterTag
                      ? `Nessun lead${filterTag} in questa scheda.`
                      : tab === 'recall'
                        ? 'Nessun richiamo. Imposta una data di ricontatto su un lead con «Richiama…».'
                        : `Nessun lead in questa scheda. Premi «Cerca» o naviga su ${joinList(PORTALS.map((p) => PORTAL_SITES[p]), 'o')} per raccoglierne.`}
                  </p>
                </div>
              ) : (
                <ul className="leads">
                  {(tab === 'recall' ? recallGroups : [{ kind: null, leads: visible }]).map((g) => (
                    <Fragment key={g.kind ?? 'all'}>
                      {g.kind && <li className="leads__group"><h3>{RECALL_GROUP_LABELS[g.kind]}</h3></li>}
                      {g.leads.map((l) => (
                        <LeadItem
                          key={l.listing.key}
                          lead={l}
                          now={now}
                          onChange={(patch) => run(() => api.setLeadState(leadKeys(l), patch))}
                          onDelete={() => run(() => api.deleteListings(leadKeys(l)))}
                          onSplit={(key) => run(() => api.splitListing(key, leadKeys(l).filter((k) => k !== key)))}
                        />
                      ))}
                    </Fragment>
                  ))}
                </ul>
              )}
              <ExportBar leads={visible} onExported={(format) => void api.trackUsage({ kind: 'export', format }).catch(() => {})} />
            </>
          )}
        </>
      )}
    </main>
  );
}
