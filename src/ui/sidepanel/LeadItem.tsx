import { useEffect, useState } from 'react';
import { priorityLabel, STATUS_LABELS } from '@/core/leads';
import { formatEuro } from '@/shared/format';
import { LEAD_STATUSES, PORTAL_TAGS, type LeadStatus, type LeadView } from '@/shared/types';
import { ExternalIcon, TrashIcon } from './Icons';
import { Sparkline } from './Sparkline';

interface Props {
  lead: LeadView;
  onChange(patch: { status?: LeadStatus; notes?: string }): void;
  onDelete(): void;
}

export function LeadItem({ lead, onChange, onDelete }: Props) {
  const { listing, evaluation, state, prices } = lead;
  const [notes, setNotes] = useState(state.notes);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setNotes(state.notes), [state.notes]);

  const price = listing.currentPrice != null ? `€ ${formatEuro(listing.currentPrice)}` : 'Prezzo n.d.';
  const visits = `Visto ${listing.seenCount} ${listing.seenCount === 1 ? 'volta' : 'volte'}`;

  return (
    <li className={`lead lead--${evaluation.priority}`}>
      <div className="lead__top">
        <div className="lead__tags">
          {evaluation.priority !== 'none' && (
            <span className={`pill pill--${evaluation.priority}`}>{priorityLabel(evaluation.priority, listing.portal)}</span>
          )}
          <span className="portal-tag">{PORTAL_TAGS[listing.portal]}</span>
        </div>
        <Sparkline prices={prices.map((p) => p.price)} />
      </div>
      <div className="lead__head">
        <div className="lead__title">{listing.title}</div>
        <div className="lead__price">{price}</div>
      </div>
      <div className="lead__meta">{[...evaluation.reasons, visits].join(' · ')}</div>
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
            <button type="button" className="btn btn--danger btn--sm" onClick={onDelete}>Conferma eliminazione</button>
            <button type="button" className="btn btn--sm" onClick={() => setConfirming(false)}>Annulla</button>
          </>
        ) : (
          <button type="button" className="icon-btn icon-btn--danger" aria-label="Elimina" title="Elimina" onClick={() => setConfirming(true)}>
            <TrashIcon />
          </button>
        )}
      </div>
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
