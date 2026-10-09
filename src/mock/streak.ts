// PHASE 2 PROTOTYPE streak math (local calendar, both slots required).
// Phase 5 replaces this with a TS port of backend/ml/brushing/checkin.py
// (windows, IANA time zone, streak_requires) verified against its cases.json.
import type { StreakDay } from '@/components/streak';
import type { BrushingRecord } from '@/domain/models';

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
