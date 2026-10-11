import { DEFAULT_SETTINGS, type Settings } from '@/shared/types';

export function validateSettings(input: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  if (!Number.isInteger(s.minAgeDays) || s.minAgeDays < 1 || s.minAgeDays > 3650) throw new Error('Soglia giorni non valida');
  if (!Number.isFinite(s.minDropPercent) || s.minDropPercent < 0 || s.minDropPercent > 100) throw new Error('Ribasso minimo non valido');
  if (!Number.isInteger(s.retentionDays) || s.retentionDays < 7 || s.retentionDays > 3650) throw new Error('Conservazione non valida');
  return s;
}
