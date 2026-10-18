import { describe, expect, it } from 'vitest';
import { categoryFromTypology } from '@/core/category';

describe('categoryFromTypology', () => {
  it.each([
    ['Appartamento', 'residential'], ['Villa', 'residential'], ['Attico - Mansarda', 'residential'], ['Rustico - Casale', 'residential'],
    ['Ville singole e a schiera', 'residential'], ['Appartamenti', 'residential'], ['Bilocale', 'residential'], ['Loft', 'residential'],
    ['Garage - Box', 'garage'], ['Posto auto', 'garage'], ['Garage e box', 'garage'], ['Box', 'garage'],
    ['Negozi - Locali commerciali', 'commercial'], ['Negozio', 'commercial'], ['Laboratorio', 'commercial'], ['Ufficio - Studio', 'commercial'],
    ['Ufficio', 'commercial'], ['Capannone', 'commercial'], ['Locale', 'commercial'], ['Locale o capannone', 'commercial'],
    ['Uffici e Locali commerciali', 'commercial'], ['Magazzini - Depositi', 'commercial'],
    ['Terreno edificabile', 'land'], ['Terreno agricolo', 'land'], ['Terreni e rustici', 'land'],
  ] as const)('%s → %s', (typology, expected) => {
    expect(categoryFromTypology(typology)).toBe(expected);
  });

  it('null se la tipologia manca o non dice la categoria', () => {
    expect(categoryFromTypology(null)).toBeNull();
    expect(categoryFromTypology(undefined)).toBeNull();
    expect(categoryFromTypology('')).toBeNull();
    expect(categoryFromTypology('Altro')).toBeNull();
  });
});
