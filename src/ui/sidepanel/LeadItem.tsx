import { useEffect, useState } from 'react';
import { PRIORITY_LABELS, STATUS_LABELS } from '@/core/leads';
import { formatEuro } from '@/shared/format';
import { LEAD_STATUSES, type LeadStatus, type LeadView } from '@/shared/types';
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
      {evaluation.priority !== 'none' && (
        <span className={`pill pill--${evaluation.priority}`}>{PRIORITY_LABELS[evaluation.priority]}</span>
      )}
      <div className="lead__title">{`${listing.title} — ${price}`}</div>
      <div className="lead__meta">{[...evaluation.reasons, visits].join(' · ')}</div>
      <Sparkline prices={prices.map((p) => p.price)} />
      <div className="lead__actions">
        <select aria-label="Stato" value={state.status} onChange={(e) => onChange({ status: e.target.value as LeadStatus })}>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <input
          aria-label="Note"
          placeholder="Note…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== state.notes) onChange({ notes });
          }}
        />
        <a href={listing.url} target="_blank" rel="noreferrer">↗ Apri</a>
        {confirming ? (
          <button type="button" onClick={onDelete}>Conferma eliminazione</button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)}>Elimina</button>
        )}
      </div>
    </li>
  );
}
