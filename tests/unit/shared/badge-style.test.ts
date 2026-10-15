import { describe, expect, it } from 'vitest';
import { BADGE_COLORS, BADGE_LOOK, toReactStyle } from '@/shared/badge-style';

describe('badge-style', () => {
  it('converte le proprietà CSS nei nomi di React', () => {
    expect(toReactStyle({ 'border-color': '#fff', 'box-shadow': 'none', color: '#000' })).toEqual({ borderColor: '#fff', boxShadow: 'none', color: '#000' });
  });
  it("l'aspetto non contiene posizionamento, così la legenda resta in linea", () => {
    expect(BADGE_LOOK).not.toHaveProperty('position');
    expect(BADGE_COLORS.high.background).toBe('#c0262d');
  });
});
