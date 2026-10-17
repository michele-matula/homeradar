import { PILOT_CODE_RE } from '@/shared/report-schema';
import { DEFAULT_SETTINGS, PORTALS, type Settings } from '@/shared/types';

export const INVALID_PILOT_CODE = 'Codice pilota non valido: usa da 4 a 32 tra lettere, cifre e trattini';

export function validateSettings(input: Partial<Settings>): Settings {
  // enabledPortals si completa portale per portale: un portale nuovo nasce acceso.
  const s = { ...DEFAULT_SETTINGS, ...input, enabledPortals: { ...DEFAULT_SETTINGS.enabledPortals, ...input.enabledPortals } };
  if (!Number.isInteger(s.minAgeDays) || s.minAgeDays < 1 || s.minAgeDays > 3650) throw new Error('Soglia giorni non valida');
  if (!Number.isFinite(s.minDropPercent) || s.minDropPercent < 0 || s.minDropPercent > 100) throw new Error('Ribasso minimo non valido');
  if (!Number.isInteger(s.retentionDays) || s.retentionDays < 7 || s.retentionDays > 3650) throw new Error('Conservazione non valida');
  if (typeof s.autoBackup !== 'boolean') throw new Error('Backup automatico non valido');
  if (PORTALS.some((p) => typeof s.enabledPortals[p] !== 'boolean')) throw new Error('Portali attivi non validi');
  if (typeof s.reportingEnabled !== 'boolean') throw new Error('Invio statistiche non valido');
  s.pilotCode = String(s.pilotCode ?? '').toUpperCase().replace(/\s+/g, '');
  if (s.pilotCode !== '' && !PILOT_CODE_RE.test(s.pilotCode)) throw new Error(INVALID_PILOT_CODE);
  s.enabledPortals = Object.fromEntries(PORTALS.map((p) => [p, s.enabledPortals[p]])) as Settings['enabledPortals'];
  return s;
}
