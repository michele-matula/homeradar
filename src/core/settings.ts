import { PILOT_CODE_RE } from '@/shared/report-schema';
import { DEFAULT_SETTINGS, PORTALS, PROPERTY_CATEGORIES, type ComuneRef, type SearchArea, type Settings } from '@/shared/types';

export const INVALID_PILOT_CODE = 'Codice pilota non valido: usa da 4 a 32 tra lettere, cifre e trattini';
export const MAX_COMUNI = 30;
const INVALID_AREA = 'Zona di lavoro non valida';

function validateArea(input: Partial<SearchArea> | undefined): SearchArea {
  const area = { ...DEFAULT_SETTINGS.searchArea, ...input };
  if (!Array.isArray(area.comuni) || !Array.isArray(area.categories)) throw new Error(INVALID_AREA);
  const comuni: ComuneRef[] = [];
  for (const c of area.comuni as Partial<ComuneRef>[]) {
    if (!c || typeof c.istat !== 'string' || !/^\d{6}$/.test(c.istat) || typeof c.name !== 'string' || !c.name.trim()
      || typeof c.province !== 'string' || !/^[A-Z]{2}$/.test(c.province)) throw new Error(INVALID_AREA);
    if (!comuni.some((x) => x.istat === c.istat)) comuni.push({ istat: c.istat, name: c.name, province: c.province });
  }
  if (comuni.length > MAX_COMUNI) throw new Error(`Al massimo ${MAX_COMUNI} comuni`);
  const categories = PROPERTY_CATEGORIES.filter((k) => (area.categories as string[]).includes(k));
  if (!categories.length) throw new Error('Scegli almeno una categoria');
  return { comuni, categories };
}

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
  s.searchArea = validateArea(input.searchArea);
  return s;
}
