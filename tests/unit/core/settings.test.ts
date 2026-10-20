import { describe, expect, it } from 'vitest';
import { INVALID_PILOT_CODE, validateSettings } from '@/core/settings';
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
  it('attiva il backup automatico di default, anche per impostazioni salvate prima', () => {
    expect(DEFAULT_SETTINGS.autoBackup).toBe(true);
    expect(validateSettings({ minAgeDays: 90 }).autoBackup).toBe(true);
    expect(validateSettings({ autoBackup: false }).autoBackup).toBe(false);
  });
  it('rifiuta un valore non booleano', () => {
    expect(() => validateSettings({ autoBackup: 'sì' as unknown as boolean })).toThrow('Backup automatico non valido');
  });
  it('completa i portali attivi uno per uno e scarta chiavi sconosciute', () => {
    const s = validateSettings({ enabledPortals: { subito: false, altro: true } as unknown as Settings['enabledPortals'] });
    expect(s.enabledPortals).toEqual({ immobiliare: true, idealista: true, subito: false });
  });
  it('normalizza il codice pilota e rifiuta quelli non validi', () => {
    expect(validateSettings({ pilotCode: ' rossi-7k2p ' }).pilotCode).toBe('ROSSI-7K2P');
    expect(validateSettings({ pilotCode: 'ro ssi 7k' }).pilotCode).toBe('ROSSI7K');
    expect(validateSettings({}).pilotCode).toBe('');
    expect(validateSettings({}).reportingEnabled).toBe(true);
    expect(() => validateSettings({ pilotCode: 'ab' })).toThrow(INVALID_PILOT_CODE);
    expect(() => validateSettings({ pilotCode: 'ROSSI_7K' })).toThrow(INVALID_PILOT_CODE);
    expect(() => validateSettings({ reportingEnabled: 'sì' as unknown as boolean })).toThrow('Invio statistiche non valido');
  });
});

describe('validateSettings: zona di lavoro', () => {
  const tre = { istat: '016219', name: 'Treviglio', province: 'BG' };
  it('predefinita: nessun comune, solo le case', () => {
    expect(validateSettings({}).searchArea).toEqual({ comuni: [], categories: ['residential'] });
  });
  it('toglie i doppioni e ordina le categorie', () => {
    const s = validateSettings({ searchArea: { comuni: [tre, tre], categories: ['garage', 'residential', 'garage'] } });
    expect(s.searchArea).toEqual({ comuni: [tre], categories: ['residential', 'garage'] });
  });
  it('rifiuta comuni malformati, troppi comuni e nessuna categoria', () => {
    expect(() => validateSettings({ searchArea: { comuni: [{ ...tre, istat: '16219' }], categories: ['residential'] } })).toThrow('Zona di lavoro non valida');
    const many = Array.from({ length: 31 }, (_, i) => ({ istat: String(100000 + i), name: `C${i}`, province: 'BG' }));
    expect(() => validateSettings({ searchArea: { comuni: many, categories: ['residential'] } })).toThrow('Al massimo 30 comuni');
    expect(() => validateSettings({ searchArea: { comuni: [tre], categories: [] } })).toThrow('Scegli almeno una categoria');
  });
});
