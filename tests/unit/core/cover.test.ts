import { describe, expect, it } from 'vitest';
import { coverOrNull, isCoverUrl, subitoCover, SUBITO_COVER_RULE } from '@/core/cover';

const IMMO = 'https://pwm.im-cdn.it/image/2030080280/xxs-c.jpg';
const IDEA = 'https://img4.idealista.it/blur/480_360_mq/0/id.pro.it.image.master/4b/6d/bf/780558105.jpg';
const SUB = 'https://images.sbito.it/api/v1/sbt-ads-images-pro/images/3f/3f48389a-ec1a-4435-b055-4b21a05401a8';

describe('isCoverUrl', () => {
  it('accetta i server immagini di ogni portale', () => {
    expect(isCoverUrl('immobiliare', IMMO)).toBe(true);
    expect(isCoverUrl('idealista', IDEA)).toBe(true);
    expect(isCoverUrl('idealista', 'https://img.idealista.it/x.jpg')).toBe(true);
    expect(isCoverUrl('subito', `${SUB}?rule=${SUBITO_COVER_RULE}`)).toBe(true);
  });

  it('rifiuta server di un altro portale, altri host, http e URL non validi', () => {
    expect(isCoverUrl('idealista', IMMO)).toBe(false);
    expect(isCoverUrl('immobiliare', 'https://pwm.im-cdn.it.evil.example/x.jpg')).toBe(false);
    expect(isCoverUrl('idealista', 'https://www.idealista.it/x.jpg')).toBe(false);
    expect(isCoverUrl('immobiliare', IMMO.replace('https:', 'http:'))).toBe(false);
    expect(isCoverUrl('subito', 'x.jpg')).toBe(false);
    expect(isCoverUrl('subito', '')).toBe(false);
  });
});

describe('coverOrNull', () => {
  it("restituisce l'URL ammesso, altrimenti null", () => {
    expect(coverOrNull('immobiliare', IMMO)).toBe(IMMO);
    expect(coverOrNull('immobiliare', 'https://example.com/x.jpg')).toBeNull();
    expect(coverOrNull('immobiliare', 42)).toBeNull();
    expect(coverOrNull('immobiliare', undefined)).toBeNull();
    expect(coverOrNull('immobiliare', null)).toBeNull();
  });
});

describe('subitoCover', () => {
  it('aggiunge la regola della miniatura', () => {
    expect(subitoCover(SUB)).toBe(`${SUB}?rule=vertical-mini-card-1x-auto`);
  });
  it('sostituisce una regola già presente', () => {
    expect(subitoCover(`${SUB}?rule=large-fixed-card-1x-auto`)).toBe(`${SUB}?rule=vertical-mini-card-1x-auto`);
  });
  it('base non valida: null', () => {
    expect(subitoCover('non un url')).toBeNull();
  });
});
