import { describe, expect, it } from 'vitest';
import { comuneInfo, provinceSlug, searchComuni, slug, toRef } from '@/core/comuni';

describe('comuni', () => {
  it('trova un comune per codice ISTAT, con provincia e regione', () => {
    expect(comuneInfo('015059')).toEqual({ istat: '015059', name: "Cassano d'Adda", province: { sigla: 'MI', name: 'Milano', region: 'Lombardia' } });
    expect(comuneInfo('999999')).toBeNull();
  });

  it('cerca per prefisso senza accenti e apostrofi, prima i nomi che iniziano così', () => {
    expect(searchComuni('trevig')[0]).toMatchObject({ name: 'Treviglio', province: { sigla: 'BG' } });
    expect(searchComuni("cassano d'a").map((c) => c.name)).toContain("Cassano d'Adda");
    expect(searchComuni('cantu').map((c) => c.name)).toContain('Cantù');
    expect(searchComuni('')).toEqual([]);
    expect(searchComuni('a', 5)).toHaveLength(5);
  });

  it('slug come negli URL dei portali', () => {
    expect(slug("Cassano d'Adda")).toBe('cassano-d-adda');
    expect(slug('Cantù')).toBe('cantu');
    expect(slug('Bolzano/Bozen')).toBe('bolzano');
    expect(slug('Trentino-Alto Adige/Südtirol')).toBe('trentino-alto-adige');
    expect(slug("Valle d'Aosta/Vallée d'Aoste")).toBe('valle-d-aosta');
  });

  it('slug della provincia, con le eccezioni dei portali', () => {
    expect(provinceSlug(comuneInfo('015059')!.province)).toBe('milano');
    expect(provinceSlug({ sigla: 'MB', name: 'Monza e della Brianza', region: 'Lombardia' })).toBe('monza-brianza');
  });

  it('converte in riferimento salvabile', () => {
    expect(toRef(comuneInfo('015059')!)).toEqual({ istat: '015059', name: "Cassano d'Adda", province: 'MI' });
  });
});
