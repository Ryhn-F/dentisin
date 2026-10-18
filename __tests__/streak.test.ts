// Streak math (src/domain/streak.ts): the display helpers (local week, both slots) and the server
// rule of brushing_streak() used offline (ACCOUNTS_AND_FLOWS.md §2.7).
import type { BrushingRecord } from '@/domain/models';
import { computeStreak, currentWeek, dateKeyInZone, localDateKey, slotForTime, streakCount } from '@/domain/streak';

function rec(date: Date, slot: BrushingRecord['slot'], durationS = 120): BrushingRecord {
  return {
    id: `${date.toISOString()}-${slot}`,
    childId: 'c',
    startedAt: date.toISOString(),
    durationS,
    spiritScore: null,
    slot,
    cameraMode: false,
    synced: false,
    proofId: null,
  };
}

function at(base: Date, daysBack: number, hour: number) {
  const d = new Date(base);
  d.setDate(d.getDate() - daysBack);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('display streak (local week, both slots)', () => {
  const now = new Date(2026, 9, 9, 12, 0); // Friday 9 Oct 2026, noon (local)

  it('counts consecutive complete days, today still in progress', () => {
    const records = [
      rec(at(now, 0, 7), 'morning'), // today: morning only
      rec(at(now, 1, 7), 'morning'),
      rec(at(now, 1, 20), 'evening'),
      rec(at(now, 2, 7), 'morning'),
      rec(at(now, 2, 20), 'evening'),
      rec(at(now, 3, 7), 'morning'), // break: no evening
    ];
    expect(streakCount(records, now)).toBe(2);
  });

  it('a day needs both morning and evening', () => {
    expect(streakCount([rec(at(now, 1, 7), 'morning')], now)).toBe(0);
  });

  it('builds Monday–Sunday with today and future flags', () => {
    const week = currentWeek([rec(at(now, 0, 7), 'morning')], now);
    expect(week).toHaveLength(7);
    expect(week[0].weekday).toBe(0);
    expect(week[0].date).toBe('2026-10-05');
    const today = week.find((d) => d.isToday)!;
    expect(today.date).toBe(localDateKey(now));
    expect(today.morning).toBe(true);
    expect(week.filter((d) => d.isFuture).map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11']);
  });

  it('derives the slot from the local clock', () => {
    expect(slotForTime(new Date(2026, 9, 9, 6, 0))).toBe('morning');
    expect(slotForTime(new Date(2026, 9, 9, 9, 59))).toBe('morning');
    expect(slotForTime(new Date(2026, 9, 9, 10, 0))).toBe('other');
    expect(slotForTime(new Date(2026, 9, 9, 19, 30))).toBe('evening');
    expect(slotForTime(new Date(2026, 9, 9, 23, 0))).toBe('other');
  });
});

describe('server streak rule (computeStreak)', () => {
  const tz = 'Asia/Jakarta'; // UTC+7, no DST
  const now = new Date('2026-10-18T05:00:00Z'); // 12:00 WIB, Sunday 18 Oct
  const wib = (day: number, hour: number, durationS = 120) =>
    rec(new Date(Date.UTC(2026, 9, day, hour - 7, 0)), 'other', durationS);

  it('counts a day with one session >= the minimum, in the given time zone', () => {
    // 23:30 UTC on the 17th is 06:30 WIB on the 18th: it counts for today.
    const s = computeStreak([rec(new Date('2026-10-17T23:30:00Z'), 'morning')], { minDurationS: 60, tz, now });
    expect(s).toMatchObject({ current: 1, longest: 1, lastDay: '2026-10-18', todayDone: true, minDurationS: 60, tz });
  });

  it('ignores sessions shorter than streak_min_duration_s', () => {
    const s = computeStreak([wib(18, 7, 59), wib(17, 7, 59)], { minDurationS: 60, tz, now });
    expect(s).toMatchObject({ current: 0, longest: 0, lastDay: null, todayDone: false });
    expect(s.week.every((d) => !d.done && d.brushings === 0)).toBe(true);
  });

  it('current runs up to yesterday while today is not done yet', () => {
    const s = computeStreak([wib(17, 20), wib(16, 7), wib(15, 7)], { minDurationS: 60, tz, now });
    expect(s).toMatchObject({ current: 3, longest: 3, lastDay: '2026-10-17', todayDone: false });
  });

  it('a gap of a full day breaks the current streak but keeps the longest', () => {
    const records = [wib(16, 7), wib(12, 7), wib(11, 7), wib(10, 7), wib(9, 7)];
    const s = computeStreak(records, { minDurationS: 60, tz, now });
    expect(s).toMatchObject({ current: 0, longest: 4, lastDay: '2026-10-16' });
  });

  it('counts several sessions on one day once for the streak and all for the week', () => {
    const s = computeStreak([wib(18, 7), wib(18, 20), wib(17, 7)], { minDurationS: 60, tz, now });
    expect(s.current).toBe(2);
    expect(s.week).toHaveLength(7);
    expect(s.week[0].date).toBe('2026-10-12');
    expect(s.week[6]).toEqual({ date: '2026-10-18', done: true, brushings: 2 });
    expect(s.week[5]).toEqual({ date: '2026-10-17', done: true, brushings: 1 });
  });

  it('never counts sessions in the future (clock skew), like the server', () => {
    const s = computeStreak([wib(19, 7)], { minDurationS: 60, tz, now });
    expect(s).toMatchObject({ current: 0, longest: 0, lastDay: null });
  });

  it('uses the server minimum from my_account().limits', () => {
    const records = [wib(18, 7, 90)];
    expect(computeStreak(records, { minDurationS: 60, tz, now }).current).toBe(1);
    expect(computeStreak(records, { minDurationS: 120, tz, now }).current).toBe(0);
  });

  it('formats calendar dates in a zone and falls back to the local date for an unknown zone', () => {
    const d = new Date('2026-10-17T18:00:00Z');
    expect(dateKeyInZone(d, 'Asia/Jakarta')).toBe('2026-10-18');
    expect(dateKeyInZone(d, 'UTC')).toBe('2026-10-17');
    expect(dateKeyInZone(d, 'Not/AZone')).toBe(localDateKey(d));
  });
});
