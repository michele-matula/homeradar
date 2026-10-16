import { BRAND_COLOR } from '@/shared/logo';

export const WARNING_COLOR = '#d97706';
export const RECALL_COLOR = '#dc2626';

export interface ActionBadge {
  text: string;
  /** null: il colore non va cambiato (testo vuoto). */
  color: string | null;
  title: string;
}

/**
 * Segnale sull'icona. Precedenza: conferma dell'informativa mancante, poi i richiami da fare
 * (l'avviso dei portali resta nel titolo), poi l'avviso.
 */
export function actionBadge({ onboarding, warning, due }: { onboarding: boolean; warning: boolean; due: number }): ActionBadge {
  if (onboarding) return { text: '●', color: BRAND_COLOR, title: "HomeRadar: conferma l'informativa per iniziare" };
  if (due > 0) {
    const recalls = `${due} ${due === 1 ? 'richiamo' : 'richiami'} da fare`;
    const tail = warning ? ' · un portale ha cambiato struttura, vedi il pannello' : '';
    return { text: due > 99 ? '99+' : String(due), color: RECALL_COLOR, title: `HomeRadar: ${recalls}${tail}` };
  }
  if (warning) return { text: '!', color: WARNING_COLOR, title: 'HomeRadar' };
  return { text: '', color: null, title: 'HomeRadar' };
}
