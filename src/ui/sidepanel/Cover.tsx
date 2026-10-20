import { useState } from 'react';
import { HouseIcon } from './Icons';

interface Props {
  /** Copertine in ordine di preferenza (`LeadView.covers`). */
  covers: string[];
  /** Annuncio principale, aperto al clic come «Apri». */
  href: string;
}

/**
 * Miniatura del lead: prova le copertine in ordine e, se nessuna si carica, mostra un riquadro neutro della stessa
 * misura. La foto arriva dal server immagini del portale solo quando il lead è visibile, senza referrer.
 * Chi la usa la monta con `key` sulle copertine, così un elenco nuovo riparte dalla prima.
 */
export function Cover({ covers, href }: Props) {
  const [index, setIndex] = useState(0);
  const src = covers[index];
  return (
    <a className={`cover${src ? '' : ' cover--empty'}`} href={href} target="_blank" rel="noreferrer" aria-label="Apri l'annuncio">
      {src ? (
        <img
          key={src}
          className="cover__img"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
        />
      ) : (
        <HouseIcon />
      )}
    </a>
  );
}
