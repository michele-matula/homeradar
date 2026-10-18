/** Pagine che il giro deve riconoscere: verifica di DataDome o pagina inesistente. */
export type PageProblem = 'blocked' | 'notFound';

export function pageProblem(doc: Document): PageProblem | null {
  if (doc.querySelector('iframe[src*="captcha-delivery.com"]')) return 'blocked';
  const text = doc.body?.textContent ?? '';
  if (/Al momento non siamo disponibili/i.test(text)) return 'blocked';
  if (/La pagina che stai cercando non è presente/i.test(text)) return 'notFound';
  return null;
}
