export const BANNER_ID = 'homeradar-banner';
export const FALLBACK_TEXT = 'HomeRadar: ricarica la pagina per analizzare questi risultati';

export function showBanner(doc: Document, text: string): void {
  if (doc.getElementById(BANNER_ID)) return;
  const el = doc.createElement('div');
  el.id = BANNER_ID;
  el.setAttribute('role', 'status');
  Object.assign(el.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: '2147483647',
    background: '#1d4ed8', color: '#fff', padding: '8px 12px', borderRadius: '8px',
    font: '500 13px/1.4 system-ui, sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,.2)',
    display: 'flex', gap: '10px', alignItems: 'center',
  } satisfies Partial<CSSStyleDeclaration>);
  const msg = doc.createElement('span');
  msg.textContent = text;
  const reload = doc.createElement('button');
  reload.textContent = 'Ricarica';
  reload.addEventListener('click', () => doc.defaultView?.location.reload());
  const close = doc.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Chiudi');
  close.addEventListener('click', () => el.remove());
  el.append(msg, reload, close);
  doc.body.append(el);
}
