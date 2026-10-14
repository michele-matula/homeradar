import { describe, expect, it } from 'vitest';
import { validateSettings } from '@/core/settings';
import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';

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
    expect(() => validateSettings({ enabledPortals: { immobiliare: true, idealista: 'no' as unknown as boolean, subito: true } })).toThrow('Portali attivi non validi');
  });
  it('completa i portali attivi uno per uno e scarta chiavi sconosciute', () => {
    const s = validateSettings({ enabledPortals: { subito: false, altro: true } as unknown as Settings['enabledPortals'] });
    expect(s.enabledPortals).toEqual({ immobiliare: true, idealista: true, subito: false });
  });
});
