import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addDays, formatLocalDate, formatRecallDate, fromDateInput, isDue, nextRecallCheck, RECALL_SHORTCUTS, recallLabel,
  recallStatus, startOfLocalDay, toDateInput, type RecallStatus,
} from '@/core/recall';

// Il fuso dell'agente: le mezzanotti locali non coincidono con quelle UTC e c'è il cambio dell'ora legale.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Rome';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

const day = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

describe('date locali', () => {
  it('il fuso dei test è davvero Europe/Rome', () => {
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-120);
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60);
  });

  it('startOfLocalDay porta alla mezzanotte locale, non a quella UTC', () => {
    expect(startOfLocalDay(day(2026, 10, 17, 0) + 30 * 60_000)).toBe(day(2026, 10, 17));
    expect(startOfLocalDay(day(2026, 10, 17, 23))).toBe(day(2026, 10, 17));
    expect(startOfLocalDay(day(2026, 10, 17))).not.toBe(Date.UTC(2026, 9, 17));
  });

  it("addDays somma giorni di calendario anche a cavallo del cambio dell'ora legale", () => {
    expect(addDays(day(2026, 3, 28), 1)).toBe(day(2026, 3, 29)); // 23 ore
    expect(addDays(day(2026, 3, 28), 2)).toBe(day(2026, 3, 30));
    expect(addDays(day(2026, 10, 24), 2)).toBe(day(2026, 10, 26)); // 25 ore in mezzo
    expect(addDays(day(2026, 10, 15), 30)).toBe(day(2026, 11, 14));
    expect(addDays(day(2026, 10, 15), -1)).toBe(day(2026, 10, 14));
  });

  it('nextRecallCheck: mezzanotte locale successiva più un minuto', () => {
    expect(nextRecallCheck(day(2026, 10, 15, 14))).toBe(day(2026, 10, 16) + 60_000);
    expect(nextRecallCheck(day(2026, 10, 24, 23))).toBe(day(2026, 10, 25) + 60_000);
  });
});

describe('recallStatus / isDue / recallLabel', () => {
  const now = day(2026, 10, 15, 14);

  it('nessun richiamo', () => {
    expect(recallStatus(null, now)).toBeNull();
    expect(recallStatus(undefined, now)).toBeNull();
    expect(isDue(null, now)).toBe(false);
  });

  it.each<[string, number, RecallStatus, boolean, string]>([
    ['due giorni fa', day(2026, 10, 13), { kind: 'overdue', days: 2 }, true, 'scaduto da 2 giorni'],
    ['ieri', day(2026, 10, 14), { kind: 'overdue', days: 1 }, true, 'scaduto ieri'],
    ['oggi', day(2026, 10, 15), { kind: 'today', days: 0 }, true, 'oggi'],
    ['domani', day(2026, 10, 16), { kind: 'upcoming', days: 1 }, false, 'domani'],
    ['tra tre giorni', day(2026, 10, 18), { kind: 'upcoming', days: 3 }, false, 'tra 3 giorni'],
  ])('%s', (_name, recallAt, status, due, label) => {
    expect(recallStatus(recallAt, now)).toEqual(status);
    expect(isDue(recallAt, now)).toBe(due);
    expect(recallLabel(status)).toBe(label);
  });

  it("conta i giorni di calendario anche attraverso il cambio dell'ora legale", () => {
    expect(recallStatus(day(2026, 3, 30), day(2026, 3, 28, 23))).toEqual({ kind: 'upcoming', days: 2 });
    expect(recallStatus(day(2026, 10, 24), day(2026, 10, 26, 1))).toEqual({ kind: 'overdue', days: 2 });
  });
});

describe('formati e campo data', () => {
  it('formatta con i valori locali', () => {
    expect(formatRecallDate(day(2026, 10, 17))).toBe('sab 17 ott');
    expect(formatLocalDate(day(2026, 10, 17))).toBe('17/10/2026');
    expect(formatLocalDate(day(2026, 1, 5))).toBe('05/01/2026');
  });

  it('andata e ritorno con il valore di <input type="date">', () => {
    expect(toDateInput(day(2026, 3, 9))).toBe('2026-03-09');
    expect(fromDateInput('2026-03-09')).toBe(day(2026, 3, 9));
  });

  it('un campo vuoto o non valido non è una data', () => {
    expect(fromDateInput('')).toBeNull();
    expect(fromDateInput('2026-02-30')).toBeNull();
    expect(fromDateInput('17/10/2026')).toBeNull();
    // Anni intermedi mentre si scrive l'anno da tastiera.
    expect(fromDateInput('0202-10-17')).toBeNull();
    expect(fromDateInput('1999-10-17')).toBeNull();
  });

  it('scorciatoie', () => {
    expect(RECALL_SHORTCUTS).toEqual([
      { label: 'Domani', days: 1 },
      { label: 'Tra 3 giorni', days: 3 },
      { label: 'Tra 1 settimana', days: 7 },
      { label: 'Tra 1 mese', days: 30 },
    ]);
  });
});
