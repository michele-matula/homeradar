import { BRAND_COLOR } from '@/shared/logo';

export const WARNING_COLOR = '#d97706';

export interface ActionBadge {
  text: string;
  /** null: il colore non va cambiato (testo vuoto). */
  color: string | null;
  title: string;
}

/** Segnale sull'icona: la conferma dell'informativa mancante ha la precedenza sull'avviso dei portali. */
export function actionBadge({ onboarding, warning }: { onboarding: boolean; warning: boolean }): ActionBadge {
  if (onboarding) return { text: '●', color: BRAND_COLOR, title: "HomeRadar: conferma l'informativa per iniziare" };
  if (warning) return { text: '!', color: WARNING_COLOR, title: 'HomeRadar' };
  return { text: '', color: null, title: 'HomeRadar' };
}
