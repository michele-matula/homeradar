import { describe, expect, it } from 'vitest';
import { pageProblem } from '@/content/page-problem';

const doc = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('pageProblem', () => {
  it('riconosce la verifica di DataDome', () => {
    expect(pageProblem(doc('<body><iframe src="https://geo.captcha-delivery.com/captcha/?x=1"></iframe></body>'))).toBe('blocked');
    expect(pageProblem(doc('<body><h1>Ops! Al momento non siamo disponibili</h1></body>'))).toBe('blocked');
  });
  it('riconosce la pagina inesistente di Immobiliare', () => {
    expect(pageProblem(doc('<body><p>La pagina che stai cercando non è presente sul nostro sito o non è più disponibile.</p></body>'))).toBe('notFound');
  });
  it('null su una pagina normale', () => {
    expect(pageProblem(doc('<body><ul><li>annuncio</li></ul></body>'))).toBeNull();
  });
});
