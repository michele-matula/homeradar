import { DEFAULT_SETTINGS, PORTALS, type Settings } from '@/shared/types';

export function validateSettings(input: Partial<Settings>): Settings {
  // enabledPortals si completa portale per portale: un portale nuovo nasce acceso.
  const s = { ...DEFAULT_SETTINGS, ...input, enabledPortals: { ...DEFAULT_SETTINGS.enabledPortals, ...input.enabledPortals } };
  if (!Number.isInteger(s.minAgeDays) || s.minAgeDays < 1 || s.minAgeDays > 3650) throw new Error('Soglia giorni non valida');
  if (!Number.isFinite(s.minDropPercent) || s.minDropPercent < 0 || s.minDropPercent > 100) throw new Error('Ribasso minimo non valido');
  if (!Number.isInteger(s.retentionDays) || s.retentionDays < 7 || s.retentionDays > 3650) throw new Error('Conservazione non valida');
  if (PORTALS.some((p) => typeof s.enabledPortals[p] !== 'boolean')) throw new Error('Portali attivi non validi');
  s.enabledPortals = Object.fromEntries(PORTALS.map((p) => [p, s.enabledPortals[p]])) as Settings['enabledPortals'];
  return s;
}
