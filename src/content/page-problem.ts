/** Pagine che il giro deve riconoscere: verifica di DataDome o pagina inesistente. */
export type PageProblem = 'blocked' | 'notFound';

export function pageProblem(doc: Document): PageProblem | null {
  if (doc.querySelector('iframe[src*="captcha-delivery.com"]')) return 'blocked';
  const text = visibleText(doc);
  if (/Al momento non siamo disponibili/i.test(text)) return 'blocked';
  if (/La pagina che stai cercando non è presente/i.test(text)) return 'notFound';
  return null;
}

/** Testo della pagina senza script e stili: __NEXT_DATA__ di Immobiliare contiene anche i testi delle pagine di errore. */
function visibleText(doc: Document): string {
  if (!doc.body) return '';
  const body = doc.body.cloneNode(true) as HTMLElement;
  for (const el of body.querySelectorAll('script, style, noscript, template')) el.remove();
  return body.textContent ?? '';
}
