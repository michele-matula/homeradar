// Logo HomeRadar (radar stilizzato). Unica sorgente per side panel, banner sul portale
// e icone dell'estensione (vedi scripts/generate-icons.mjs).
export const BRAND_COLOR = '#0f4c5c';

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" aria-hidden="true">
<rect width="128" height="128" rx="28" fill="${BRAND_COLOR}"/>
<circle cx="64" cy="64" r="42" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="7"/>
<circle cx="64" cy="64" r="22" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="7"/>
<path d="M64 64 L64 22 A42 42 0 0 1 100.4 43 Z" fill="#fff" fill-opacity=".22"/>
<line x1="64" y1="64" x2="100.4" y2="43" stroke="#fff" stroke-width="7" stroke-linecap="round"/>
<circle cx="64" cy="64" r="8" fill="#fff"/>
<circle cx="84" cy="38" r="9" fill="#fbbf24"/>
</svg>`;
