import { useEffect, useState } from 'react';
import { leadPortals, priorityLabel, STATUS_LABELS } from '@/core/leads';
import { aboveMarketText, isAboveMarket, marketExplanation } from '@/core/market';
import { addDays, formatRecallDate, fromDateInput, RECALL_SHORTCUTS, recallLabel, recallStatus, startOfLocalDay, toDateInput } from '@/core/recall';
import { formatDate, formatDayMonth, formatEuro } from '@/shared/format';
import { LEAD_STATUSES, PORTAL_TAGS, type LeadStatus, type LeadView } from '@/shared/types';
import { Cover } from './Cover';
import { ExternalIcon, TrashIcon } from './Icons';
import { InfoTip } from './InfoTip';
import { Sparkline } from './Sparkline';

interface Props {
  lead: LeadView;
  now: number;
  onChange(patch: { status?: LeadStatus; notes?: string; recallAt?: number | null }): void;
  onDelete(): void;
  /** Stacca una fonte dal lead unito: non è lo stesso immobile. */
  onSplit?(key: string): void;
}

export function LeadItem({ lead, now, onChange, onDelete, onSplit }: Props) {
  const { listing, evaluation, state, prices, market, others } = lead;
  const portals = leadPortals(lead);
  const [notes, setNotes] = useState(state.notes);
  const [confirming, setConfirming] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [picking, setPicking] = useState(false);
  const recall = recallStatus(state.recallAt, now);
  const pick = (recallAt: number) => {
    setPicking(false);
    onChange({ recallAt });
  };
  const commitDate = (value: string) => {
    const day = fromDateInput(value);
    if (day != null) pick(day);
  };
  useEffect(() => setNotes(state.notes), [state.notes]);

  const price = listing.currentPrice != null ? `€ ${formatEuro(listing.currentPrice)}` : 'Prezzo n.d.';
  const visits = `Visto ${listing.seenCount} ${listing.seenCount === 1 ? 'volta' : 'volte'}`;

  return (
    <li className={`lead lead--${evaluation.priority}${recall?.kind === 'overdue' ? ' lead--overdue' : ''}`}>
      <div className="lead__top">
        <div className="lead__tags">
          {evaluation.priority !== 'none' && (
            <span className={`pill pill--${evaluation.priority}`}>{priorityLabel(evaluation.priority, listing.portal)}</span>
          )}
          {portals.map((p) => (
            <span key={p} className="portal-tag">{PORTAL_TAGS[p]}</span>
          ))}
          {portals.length > 1 && <span className="pill pill--multi">{`Su ${portals.length} portali`}</span>}
          {lead.reposted && <span className="pill pill--multi">Ripubblicato</span>}
          {lead.missing != null && <span className="pill pill--missing">{`Non più visto dal ${formatDate(lead.missing)}`}</span>}
          {lead.missingPortals.map((p) => (
            <span key={`gone-${p}`} className="pill pill--missing">{`Non più su ${PORTAL_TAGS[p]}`}</span>
          ))}
        </div>
        <Sparkline prices={prices.map((p) => p.price)} />
      </div>
      <div className="lead__body">
        <Cover key={lead.covers.join(' ')} covers={lead.covers} href={listing.url} />
        <div className="lead__main">
          <div className="lead__head">
            <div className="lead__title">{listing.title}</div>
            <div className="lead__price">{price}</div>
          </div>
          <div className="lead__meta">{[...evaluation.reasons, visits].join(' · ')}</div>
        </div>
      </div>
      {isAboveMarket(market) && (
        <div className="lead__market">
          <span className="market-tag">{aboveMarketText(market)}</span>
          <InfoTip label="Sopra mercato">{marketExplanation(market)}</InfoTip>
        </div>
      )}
      {others.length > 0 && (
        <div className="sources">
          <button type="button" className="btn btn--sm" aria-expanded={showSources} onClick={() => setShowSources((s) => !s)}>
            {`Fonti (${others.length + 1})`}
          </button>
          {showSources && (
            <ul className="sources__list">
              {[{ listing, evaluation, previous: false }, ...others].map((s) => (
                <li key={s.listing.key} className="sources__item">
                  <span className="portal-tag">{PORTAL_TAGS[s.listing.portal]}</span>
                  {s.previous && (
                    <span className="sources__previous">{`Annuncio precedente · visto fino al ${formatDayMonth(s.listing.lastSeenAt)}`}</span>
                  )}
                  <span className="sources__facts">
                    {[
                      s.listing.currentPrice != null ? `€ ${formatEuro(s.listing.currentPrice)}` : 'Prezzo n.d.',
                      s.listing.surfaceM2 != null ? `${s.listing.surfaceM2} m²` : null,
                      s.evaluation.ageDays != null ? `${s.evaluation.ageEstimated ? '~' : ''}${s.evaluation.ageDays} gg` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  <a className="btn btn--sm" href={s.listing.url} target="_blank" rel="noreferrer">
                    Apri <ExternalIcon />
                  </a>
                  {onSplit && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      aria-label={s.previous ? `Separa annuncio precedente ${PORTAL_TAGS[s.listing.portal]}` : `Separa ${PORTAL_TAGS[s.listing.portal]}`}
                      title="Non è lo stesso immobile: mostralo come lead a sé"
                      onClick={() => onSplit(s.listing.key)}
                    >
                      Separa
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="lead__actions">
        <select className="field field--select" aria-label="Stato" value={state.status} onChange={(e) => onChange({ status: e.target.value as LeadStatus })}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <a className="btn btn--sm" href={listing.url} target="_blank" rel="noreferrer">
          Apri <ExternalIcon />
        </a>
        {confirming ? (
          <>
            <button type="button" className="btn btn--danger btn--sm" onClick={onDelete}>
              {others.length ? `Conferma: elimina ${others.length + 1} annunci` : 'Conferma eliminazione'}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => setConfirming(false)}>Annulla</button>
          </>
        ) : (
          <button type="button" className="icon-btn icon-btn--danger" aria-label="Elimina" title="Elimina" onClick={() => setConfirming(true)}>
            <TrashIcon />
          </button>
        )}
      </div>
      {state.status !== 'discarded' && (
        <div className="recall">
          {state.recallAt != null && recall ? (
            <>
              <span className={`recall__tag recall__tag--${recall.kind}`}>
                {`Richiamo ${formatRecallDate(state.recallAt)} · ${recallLabel(recall)}`}
              </span>
              <button type="button" className="btn btn--sm" onClick={() => onChange({ recallAt: null })}>Fatto</button>
              <button type="button" className="btn btn--sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Sposta…</button>
            </>
          ) : (
            <button type="button" className="btn btn--sm" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>Richiama…</button>
          )}
          {picking && (
            <div className="recall__picker">
              <input
                type="date"
                className="field recall__date"
                aria-label="Data del richiamo"
                defaultValue={state.recallAt != null ? toDateInput(state.recallAt) : ''}
                // Si salva uscendo dal campo o con Invio: scrivendo da tastiera ogni cifra produce una data intermedia.
                onBlur={(e) => commitDate(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitDate(e.currentTarget.value);
                }}
              />
              {RECALL_SHORTCUTS.map((s) => (
                // Date.now() e non `now`: il pannello può essere aperto da prima di mezzanotte.
                <button key={s.days} type="button" className="chip" onClick={() => pick(addDays(startOfLocalDay(Date.now()), s.days))}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <input
        className="field lead__notes"
        aria-label="Note"
        placeholder="Aggiungi una nota…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes !== state.notes) onChange({ notes });
        }}
      />
    </li>
  );
}
