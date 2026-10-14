import { describe, expect, it } from 'vitest';
import { formatDate, formatDayMonth, formatEuro, formatPercent, joinList } from '@/shared/format';

describe('format', () => {
  it('formatta gli euro con il punto delle migliaia', () => {
    expect(formatEuro(235000)).toBe('235.000');
    expect(formatEuro(2500)).toBe('2.500');
    expect(formatEuro(1250000)).toBe('1.250.000');
    expect(formatEuro(950)).toBe('950');
  });
  it('formatta le percentuali con la virgola e al massimo un decimale', () => {
    expect(formatPercent(5.6224)).toBe('5,6');
    expect(formatPercent(10)).toBe('10');
    expect(formatPercent(9.96)).toBe('10');
  });
  it('formatta le date in UTC', () => {
    expect(formatDate(Date.UTC(2026, 8, 21))).toBe('21/09/2026');
    expect(formatDayMonth(Date.UTC(2026, 8, 1))).toBe('01/09');
  });
});

describe('joinList', () => {
  it('unisce gli elementi con virgole e la congiunzione finale', () => {
    expect(joinList(['A'], 'e')).toBe('A');
    expect(joinList(['A', 'B'], 'e')).toBe('A e B');
    expect(joinList(['A', 'B', 'C'], 'o')).toBe('A, B o C');
  });
});
