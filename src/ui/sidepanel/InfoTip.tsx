import { useId, useState, type ReactNode } from 'react';

/**
 * Icona "i" con spiegazione: compare al passaggio del mouse o al focus (anche col clic), Esc la chiude.
 * Il fumetto è posizionato rispetto al contenitore `position: relative` più vicino (la riga dell'impostazione),
 * così resta largo quanto la card e non esce dal pannello.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  return (
    <span className="info" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        type="button"
        className="info__btn"
        aria-label={`Informazioni: ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={(e) => e.currentTarget.focus()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setFocused(false);
            setHovered(false);
          }
        }}
      >
        i
      </button>
      <span role="tooltip" id={id} className="info__tip" hidden={!open}>
        {children}
      </span>
    </span>
  );
}
