import type { BrushingRecord } from '@/domain/models';
import { currentWeek, localDateKey, streakCount } from '@/mock/streak';

// Prototype streak math used by phase 2 screens (replaced by the checkin.py port in phase 5).
function rec(date: Date, slot: BrushingRecord['slot']): BrushingRecord {
  return { id: `${date.toISOString()}-${slot}`, childId: 'c', startedAt: date.toISOString(), durationS: 120, spiritScore: null, slot, cameraMode: false, synced: false };
}

function at(base: Date, daysBack: number, hour: number) {
  const d = new Date(base);
  d.setDate(d.getDate() - daysBack);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('prototype streak', () => {
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
});
