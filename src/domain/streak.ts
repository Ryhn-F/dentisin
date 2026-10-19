// Brushing streak math (pure).
//
// Two rules live here:
// 1. Display helpers (currentWeek, streakCount): local calendar, Monday-Sunday, morning and
//    evening slots. They drive the existing slot dots; they are NOT the server's streak.
// 2. computeStreak: the server rule of brushing_streak() (ACCOUNTS_AND_FLOWS.md §2.7,
//    migration 20261017000500): a calendar day counts when it has >= 1 session with
//    duration_s >= limits.streak_min_duration_s; `current` = consecutive counted days up to
//    today, or up to yesterday when today is not counted yet; `longest`; a 7-day window ending
//    today (oldest first). Used offline so local and server numbers agree; the server number
//    wins once synced.
import type { StreakDay } from '@/components/streak';
import type { BrushingRecord, BrushingSlot, BrushingStreak } from '@/domain/models';

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Slot of a session from the local clock: morning 06:00-09:00, evening 20:00-23:00, else
 * other (mirrors brushingWindows).
 */
export function slotForTime(date: Date): BrushingSlot {
  const h = date.getHours();
  if (h >= 6 && h < 9) return 'morning';
  if (h >= 20 && h < 23) return 'evening';
  return 'other';
}

export type BrushingBlock = 'outsideWindow' | 'morningDone' | 'eveningDone';

/**
 * Why a new session cannot start now, or null: brushing is only open in the two windows and
 * once per window per day. `records` must be one child's sessions.
 */
export function brushingBlock(records: readonly BrushingRecord[], now = new Date()): BrushingBlock | null {
  const slot = slotForTime(now);
  if (slot === 'other') return 'outsideWindow';
  return slotsByDay(records).get(localDateKey(now))?.[slot] ? `${slot}Done` : null;
}

function slotsByDay(records: readonly BrushingRecord[]) {
  const map = new Map<string, { morning: boolean; evening: boolean }>();
  for (const r of records) {
    const key = localDateKey(new Date(r.startedAt));
    const entry = map.get(key) ?? { morning: false, evening: false };
    if (r.slot === 'morning') entry.morning = true;
    if (r.slot === 'evening') entry.evening = true;
    map.set(key, entry);
  }
  return map;
}

/** Monday-Sunday of the current local week with morning/evening dots (display only). */
export function currentWeek(records: readonly BrushingRecord[], now = new Date()): StreakDay[] {
  const byDay = slotsByDay(records);
  const mondayOffset = (now.getDay() + 6) % 7; // JS: 0 = Sunday
  const todayKey = localDateKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - mondayOffset + i);
    const key = localDateKey(d);
    const slots = byDay.get(key) ?? { morning: false, evening: false };
    return { date: key, weekday: i, ...slots, isToday: key === todayKey, isFuture: key > todayKey };
  });
}

/** Display-only count of consecutive days with both slots (prototype rule; see computeStreak). */
export function streakCount(records: readonly BrushingRecord[], now = new Date()): number {
  const byDay = slotsByDay(records);
  const complete = (d: Date) => {
    const s = byDay.get(localDateKey(d));
    return !!s && s.morning && s.evening;
  };
  const cursor = new Date(now);
  // Today still counts as "in progress": start from yesterday if today is incomplete.
  if (!complete(cursor)) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (complete(cursor)) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Server streak rule
// ---------------------------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function deviceZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && tz) return tz;
  } catch {
    // Fall through.
  }
  return 'Asia/Jakarta';
}

/** YYYY-MM-DD of `date` in the IANA zone `tz`; the device's local date when Intl cannot. */
export function dateKeyInZone(date: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    const y = part('year');
    const m = part('month');
    const d = part('day');
    if (y && m && d && /^\d{4}$/.test(y)) return `${y}-${m}-${d}`;
  } catch {
    // Unknown zone or no Intl time zone support: local calendar.
  }
  return localDateKey(date);
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function keyOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export type StreakOptions = {
  /** limits.streakMinDurationS (useLimits()). */
  minDurationS: number;
  /** IANA zone; default the device zone (the app sends the same to brushing_streak). */
  tz?: string;
  now?: Date;
};

/**
 * Offline equivalent of the brushing_streak() RPC, same result shape (BrushingStreak). Records
 * of other children must be filtered out by the caller.
 */
export function computeStreak(records: readonly BrushingRecord[], options: StreakOptions): BrushingStreak {
  const tz = options.tz ?? deviceZone();
  const now = options.now ?? new Date();
  const min = options.minDurationS;
  const today = dayNumber(dateKeyInZone(now, tz));

  const counts = new Map<number, number>();
  for (const r of records) {
    if (!(r.durationS >= min)) continue;
    const started = new Date(r.startedAt);
    if (Number.isNaN(started.getTime())) continue;
    const day = dayNumber(dateKeyInZone(started, tz));
    if (day > today) continue; // future sessions (clock skew) never count, like the server
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const days = [...counts.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const day of days) {
    run = day === previous + 1 ? run + 1 : 1;
    previous = day;
    longest = Math.max(longest, run);
  }
  const last = days.length ? days[days.length - 1] : null;
  // `run` is now the length of the run that ends on `last`.
  const current = last !== null && (last === today || last === today - 1) ? run : 0;

  const week = Array.from({ length: 7 }, (_, i) => {
    const day = today - 6 + i;
    const brushings = counts.get(day) ?? 0;
    return { date: keyOfDay(day), done: brushings > 0, brushings };
  });

  return {
    current,
    longest,
    lastDay: last === null ? null : keyOfDay(last),
    todayDone: last === today,
    week,
    minDurationS: min,
    tz,
  };
}
