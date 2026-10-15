import { BRAND_COLOR, LOGO_SVG } from '@/shared/logo';

export const BANNER_ID = 'homeradar-banner';
export const FALLBACK_TEXT = 'HomeRadar: ricarica la pagina per analizzare questi risultati';
export const ONBOARDING_TEXT = "HomeRadar non è ancora attivo: leggi e conferma l'informativa per iniziare";
export const RELOAD_AFTER_ONBOARDING_TEXT = 'HomeRadar: dopo aver confermato, ricarica la pagina';

export interface BannerAction {
  label: string;
  onClick(): void;
}

const FONT = "500 13px/1.4 Inter, 'Segoe UI', system-ui, sans-serif";

function button(doc: Document, text: string, style: Partial<CSSStyleDeclaration>): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.textContent = text;
  Object.assign(b.style, {
    font: FONT, cursor: 'pointer', borderRadius: '7px', border: '0', margin: '0', ...style,
  } satisfies Partial<CSSStyleDeclaration>);
  return b;
}

export function showBanner(doc: Document, text: string, action?: BannerAction): void {
  if (doc.getElementById(BANNER_ID)) return;
  const el = doc.createElement('div');
  el.id = BANNER_ID;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
    background: BRAND_COLOR, color: '#fff', padding: '8px 8px 8px 10px', borderRadius: '12px',
    font: FONT, boxShadow: '0 8px 24px rgba(10,58,71,.35), 0 0 0 1px rgba(255,255,255,.08) inset',
    display: 'flex', gap: '10px', alignItems: 'center', maxWidth: 'calc(100vw - 32px)',
  } satisfies Partial<CSSStyleDeclaration>);
  const logo = doc.createElement('span');
  logo.innerHTML = LOGO_SVG; // costante interna, nessun dato esterno
  Object.assign(logo.style, { display: 'block', width: '24px', height: '24px', flex: 'none' } satisfies Partial<CSSStyleDeclaration>);
  const svg = logo.querySelector('svg');
  if (svg) Object.assign(svg.style, { display: 'block', width: '100%', height: '100%' });
  const msg = doc.createElement('span');
  msg.textContent = text;
  const act = button(doc, action?.label ?? 'Ricarica', { background: '#fff', color: BRAND_COLOR, fontWeight: '600', padding: '5px 12px' });
  act.addEventListener('click', () => (action ? action.onClick() : doc.defaultView?.location.reload()));
  const close = button(doc, '✕', { background: 'transparent', color: 'rgba(255,255,255,.8)', padding: '5px 8px' });
  close.setAttribute('aria-label', 'Chiudi');
  close.addEventListener('click', () => el.remove());
  el.append(logo, msg, act, close);
  doc.body.append(el);
}

export function removeBanner(doc: Document): void {
  doc.getElementById(BANNER_ID)?.remove();
}

/**
 * Avviso finché l'informativa non è confermata. "Apri" chiede al background la scheda di benvenuto:
 * i dati della pagina già caricata non tornano, quindi dopo la conferma serve ricaricare.
 */
export function showOnboardingBanner(doc: Document, open: () => Promise<unknown>): void {
  showBanner(doc, ONBOARDING_TEXT, {
    label: 'Apri',
    onClick() {
      open().catch(() => {});
      removeBanner(doc);
      showBanner(doc, RELOAD_AFTER_ONBOARDING_TEXT);
    },
  });
}
