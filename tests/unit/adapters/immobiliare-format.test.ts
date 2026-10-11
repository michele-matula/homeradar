import { describe, expect, it } from 'vitest';
import {
  parseEuro, parseItalianDate, parseItalianDecimal, parseRooms, parseSurface,
} from '@/adapters/immobiliare/format';

describe('immobiliare format', () => {
  it('legge importi in euro', () => {
    expect(parseEuro('€ 249.000')).toBe(249000);
    expect(parseEuro('€ 1.250.000')).toBe(1250000);
    expect(parseEuro('Prezzo su richiesta')).toBeNull();
  });
  it('legge decimali italiani', () => {
    expect(parseItalianDecimal('5,6')).toBe(5.6);
    expect(parseItalianDecimal('12')).toBe(12);
    expect(parseItalianDecimal('')).toBeNull();
    expect(parseItalianDecimal('n.d.')).toBeNull();
  });
  it('legge date gg/mm/aaaa come mezzanotte UTC', () => {
    expect(parseItalianDate('21/09/2026')).toBe(Date.UTC(2026, 8, 21));
    expect(parseItalianDate('2026-09-21')).toBeNull();
  });
  it('legge superficie e locali', () => {
    expect(parseSurface('65 m²')).toBe(65);
    expect(parseSurface('1.200 m²')).toBe(1200);
    expect(parseSurface('')).toBeNull();
    expect(parseRooms('2')).toBe(2);
    expect(parseRooms('5+')).toBe(5);
    expect(parseRooms('')).toBeNull();
  });
});
