import type { Portal } from '@/shared/types';

/**
 * Server delle immagini da cui il pannello può caricare la copertina (verificati il 2026-10-20): risposta senza cookie
 * né DataDome, anche senza referer. Un URL di un altro server non arriva mai a un <img>.
 */
const COVER_HOSTS: Record<Portal, (host: string) => boolean> = {
  immobiliare: (h) => h === 'pwm.im-cdn.it',
  idealista: (h) => /^img\d*\.idealista\.it$/.test(h),
  subito: (h) => h === 'images.sbito.it',
};

/** Regola di Subito per la miniatura (~10 KB): senza `rule` il server risponde 400. */
export const SUBITO_COVER_RULE = 'vertical-mini-card-1x-auto';

export function isCoverUrl(portal: Portal, url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && COVER_HOSTS[portal](u.hostname);
  } catch {
    return false;
  }
}

export function coverOrNull(portal: Portal, url: unknown): string | null {
  return typeof url === 'string' && isCoverUrl(portal, url) ? url : null;
}

/** URL della miniatura di Subito dalla base dell'immagine (`cdnBaseUrl` / `cdn_base_url`). */
export function subitoCover(base: string): string | null {
  try {
    const u = new URL(base);
    u.searchParams.set('rule', SUBITO_COVER_RULE);
    return u.toString();
  } catch {
    return null;
  }
}
