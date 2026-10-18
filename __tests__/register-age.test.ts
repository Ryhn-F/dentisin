// Age gate for teen sign-up and setup (src/features/auth/register-age.ts): boundaries 15..19,
// unknown month, the Asia/Jakarta calendar and the year chips.
import {
  DEFAULT_AGE_BOUNDS,
  TEEN_MAX_AGE,
  TEEN_MIN_AGE,
  ageRange,
  birthYearChoices,
  evaluateTeenAge,
  jakartaYearMonth,
} from '@/features/auth/register-age';
import { DEFAULT_LIMITS } from '@/domain/models';

const NOW = new Date('2026-10-18T05:00:00Z'); // October 2026 in Jakarta

describe('register-age', () => {
  it('uses the default limits as display constants', () => {
    expect(TEEN_MIN_AGE).toBe(DEFAULT_LIMITS.teenMinAge);
    expect(TEEN_MAX_AGE).toBe(DEFAULT_LIMITS.teenMaxAge);
    expect(DEFAULT_AGE_BOUNDS).toEqual({ min: 15, max: 19 });
  });

  it('takes the calendar month from Jakarta time, not UTC', () => {
    expect(jakartaYearMonth(new Date('2026-09-30T16:59:00Z'))).toEqual({ year: 2026, month: 9 });
    expect(jakartaYearMonth(new Date('2026-09-30T17:00:00Z'))).toEqual({ year: 2026, month: 10 });
    expect(jakartaYearMonth(new Date('2026-12-31T20:00:00Z'))).toEqual({ year: 2027, month: 1 });
  });

  describe('with a month (exact age)', () => {
    const table: [number, number, 'ok' | 'too_young' | 'too_old', number][] = [
      [2011, 10, 'ok', 15], // turns 15 this month
      [2011, 11, 'too_young', 14], // turns 15 next month
      [2007, 10, 'ok', 19],
      [2006, 11, 'ok', 19], // 19 until next month
      [2006, 10, 'too_old', 20], // turns 20 this month
      [2010, 1, 'ok', 16],
      [2015, 6, 'too_young', 11],
      [1990, 1, 'too_old', 36],
    ];
    it.each(table)('%i-%i -> %s (age %i)', (year, month, status, age) => {
      const gate = evaluateTeenAge(year, month, NOW);
      expect(gate.status).toBe(status);
      expect(gate).toMatchObject({ range: { lo: age, hi: age } });
    });
  });

  describe('without a month (every possible age must fit)', () => {
    const table: [number, string, number, number][] = [
      [2012, 'too_young', 13, 14],
      [2011, 'needs_month', 14, 15],
      [2010, 'ok', 15, 16],
      [2008, 'ok', 17, 18],
      [2007, 'ok', 18, 19],
      [2006, 'needs_month', 19, 20],
      [2005, 'too_old', 20, 21],
    ];
    it.each(table)('%i -> %s (ages %i..%i)', (year, status, lo, hi) => {
      expect(evaluateTeenAge(year, null, NOW)).toMatchObject({ status, range: { lo, hi } });
    });
  });

  it('rejects input that cannot be a birth date', () => {
    expect(evaluateTeenAge(2027, null, NOW).status).toBe('invalid'); // future year
    expect(evaluateTeenAge(2026, 11, NOW).status).toBe('invalid'); // future month
    expect(evaluateTeenAge(2010, 0, NOW).status).toBe('invalid');
    expect(evaluateTeenAge(2010, 13, NOW).status).toBe('invalid');
    expect(evaluateTeenAge(2010.5, null, NOW).status).toBe('invalid');
    expect(evaluateTeenAge(Number.NaN, 3, NOW).status).toBe('invalid');
    expect(ageRange(2010, 1.5, NOW)).toBeNull();
  });

  it('follows custom bounds from my_account().limits', () => {
    expect(evaluateTeenAge(2010, 5, NOW, { min: 16, max: 19 }).status).toBe('ok'); // 16
    expect(evaluateTeenAge(2011, 1, NOW, { min: 16, max: 19 }).status).toBe('too_young'); // 15
  });

  it('offers newest-first year chips from age 10 to 25', () => {
    const years = birthYearChoices(NOW);
    expect(years[0]).toBe(2016);
    expect(years[years.length - 1]).toBe(2001);
    expect(years).toHaveLength(16);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });
});
