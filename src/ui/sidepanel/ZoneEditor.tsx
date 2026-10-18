import { useId, useState } from 'react';
import { searchComuni, toRef, type ComuneInfo } from '@/core/comuni';
import { MAX_COMUNI } from '@/core/settings';
import { CATEGORY_LABELS, PROPERTY_CATEGORIES, type PropertyCategory, type SearchArea } from '@/shared/types';
import { CloseIcon } from './Icons';

/** Comuni e categorie del giro delle ricerche. Controllato: chi lo usa decide quando salvare. */
export function ZoneEditor({ value, onChange }: { value: SearchArea; onChange(next: SearchArea): void }) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const chosen = new Set(value.comuni.map((c) => c.istat));
  const full = value.comuni.length >= MAX_COMUNI;
  const suggestions = full ? [] : searchComuni(query).filter((c) => !chosen.has(c.istat));

  const add = (c: ComuneInfo) => {
    onChange({ ...value, comuni: [...value.comuni, toRef(c)] });
    setQuery('');
  };
  const remove = (istat: string) => onChange({ ...value, comuni: value.comuni.filter((c) => c.istat !== istat) });
  const toggle = (k: PropertyCategory) => {
    const next = value.categories.includes(k) ? value.categories.filter((x) => x !== k) : [...value.categories, k];
    if (next.length) onChange({ ...value, categories: PROPERTY_CATEGORIES.filter((x) => next.includes(x)) });
  };

  return (
    <div className="zone">
      <label htmlFor={`${ids}-q`} className="zone__label">Comuni</label>
      <input
        id={`${ids}-q`}
        className="field"
        type="search"
        placeholder={full ? `Al massimo ${MAX_COMUNI} comuni` : 'Scrivi un comune…'}
        disabled={full}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {suggestions.length > 0 && (
        <ul className="zone__suggestions" aria-label="Comuni suggeriti">
          {suggestions.map((c) => (
            <li key={c.istat}>
              <button type="button" className="zone__suggestion" onClick={() => add(c)}>{`${c.name} (${c.province.sigla})`}</button>
            </li>
          ))}
        </ul>
      )}
      {value.comuni.length > 0 ? (
        <ul className="zone__chips" aria-label="Comuni scelti">
          {value.comuni.map((c) => (
            <li key={c.istat} className="chip chip--on zone__chip">
              {`${c.name} (${c.province})`}
              <button type="button" className="icon-btn" aria-label={`Togli ${c.name}`} title={`Togli ${c.name}`} onClick={() => remove(c.istat)}>
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card__text">Nessun comune scelto: il pulsante «Cerca» resta spento.</p>
      )}
      <fieldset className="zone__categories">
        <legend className="zone__label">Categorie</legend>
        {PROPERTY_CATEGORIES.map((k) => {
          const on = value.categories.includes(k);
          return (
            <label key={k} className="zone__category">
              <input type="checkbox" checked={on} disabled={on && value.categories.length === 1} onChange={() => toggle(k)} />
              {CATEGORY_LABELS[k]}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
