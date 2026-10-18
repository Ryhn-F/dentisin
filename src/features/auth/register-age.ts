import { DEFAULT_LIMITS } from '@/domain/models';

// Age gate for teen sign-up (ACCOUNTS_AND_FLOWS.md §2.1). Pure and unit-tested.
//
// It mirrors the server rule private.teen_age_ok (migration 20261018000300): the age is derived
// from birth year (+ month) and today in Asia/Jakarta, without the day. With a month the age is
// exact; without one, EVERY possible age must lie inside [min, max]. The server stays the final
// judge (age_out_of_range); this gate only saves a wasted sign-up and explains the parent route.

/** Display constants (the app does not know my_account().limits before it signs in). */
export const TEEN_MIN_AGE = DEFAULT_LIMITS.teenMinAge;
export const TEEN_MAX_AGE = DEFAULT_LIMITS.teenMaxAge;

export type AgeBounds = { min: number; max: number };
export const DEFAULT_AGE_BOUNDS: AgeBounds = { min: TEEN_MIN_AGE, max: TEEN_MAX_AGE };

/** Jakarta has no daylight saving: a fixed UTC+7 shift gives its calendar year and month. */
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

export function jakartaYearMonth(now: Date = new Date()): { year: number; month: number } {
  const shifted = new Date(now.getTime() + JAKARTA_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** Possible ages in whole years. Equal ends mean the age is exact (month known). */
export type AgeRange = { lo: number; hi: number };

/** `null` for input that cannot be a birth date: a non-integer, month outside 1..12, or the future. */
export function ageRange(year: number, month: number | null, now: Date = new Date()): AgeRange | null {
  if (!Number.isInteger(year)) return null;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
  const today = jakartaYearMonth(now);
  if (month === null) {
    if (year > today.year) return null;
    const hi = today.year - year;
    return { lo: hi - 1, hi };
  }
  const months = today.year * 12 + today.month - (year * 12 + month);
  if (months < 0) return null;
  const age = Math.floor(months / 12);
  return { lo: age, hi: age };
}

export type AgeGate =
  | { status: 'ok'; range: AgeRange }
  /** Everyone born in that year (+ month) is younger than the minimum age. */
  | { status: 'too_young'; range: AgeRange }
  /** Everyone born in that year (+ month) is older than the maximum age. */
  | { status: 'too_old'; range: AgeRange }
  /** Year alone straddles a bound (e.g. 14 or 15): the month decides. */
  | { status: 'needs_month'; range: AgeRange }
  | { status: 'invalid' };

export function evaluateTeenAge(
  year: number,
  month: number | null,
  now: Date = new Date(),
  bounds: AgeBounds = DEFAULT_AGE_BOUNDS,
): AgeGate {
  const range = ageRange(year, month, now);
  if (!range) return { status: 'invalid' };
  if (range.hi < bounds.min) return { status: 'too_young', range };
  if (range.lo > bounds.max) return { status: 'too_old', range };
  if (range.lo >= bounds.min && range.hi <= bounds.max) return { status: 'ok', range };
  // Only a year without a month can reach here (a known month gives lo === hi).
  return { status: 'needs_month', range };
}

/** Birth years offered as chips, newest first: ages `minAge..maxAge` for a year-only answer. */
export function birthYearChoices(now: Date = new Date(), minAge = 10, maxAge = 25): number[] {
  const { year } = jakartaYearMonth(now);
  const years: number[] = [];
  for (let age = minAge; age <= maxAge; age++) years.push(year - age);
  return years;
}
