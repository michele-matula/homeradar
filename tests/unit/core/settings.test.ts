import { describe, expect, it } from 'vitest';
import { validateSettings } from '@/core/settings';
import { DEFAULT_SETTINGS } from '@/shared/types';

describe('validateSettings', () => {
  it('completa con i valori predefiniti', () => {
    expect(validateSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ minAgeDays: 180 })).toEqual({ ...DEFAULT_SETTINGS, minAgeDays: 180 });
  });
  it('rifiuta valori non validi', () => {
    expect(() => validateSettings({ minAgeDays: 0 })).toThrow('Soglia giorni non valida');
    expect(() => validateSettings({ minAgeDays: 12.5 })).toThrow('Soglia giorni non valida');
    expect(() => validateSettings({ minDropPercent: -1 })).toThrow('Ribasso minimo non valido');
    expect(() => validateSettings({ minDropPercent: 101 })).toThrow('Ribasso minimo non valido');
    expect(() => validateSettings({ retentionDays: 3 })).toThrow('Conservazione non valida');
  });
});
