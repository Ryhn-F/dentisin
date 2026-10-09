import { id } from '@/core/i18n/id';

const pad = (n: number) => String(n).padStart(2, '0');

/** "Sen, 9 Okt · 06.45" — local time, Indonesian short names, no Intl dependency. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const weekday = id.components.streak.weekdaysShort[(d.getDay() + 6) % 7];
  return `${weekday}, ${d.getDate()} ${id.months[d.getMonth()]} · ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

/** "9 Oktober 2026" */
export function formatDateLong(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${id.monthsLong[d.getMonth()]} ${d.getFullYear()}`;
}

/** "06.45" */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

/** "Oktober 2026" */
export function formatMonthYear(iso: string): string {
  const d = new Date(iso);
  return `${id.monthsLong[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2:05" */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** Whole years from birth year/month to now; null when unknown. */
export function ageInYears(birthYear: number | null, birthMonth: number | null, now = new Date()): number | null {
  if (!birthYear) return null;
  let age = now.getFullYear() - birthYear;
  if (birthMonth && now.getMonth() + 1 < birthMonth) age -= 1;
  return Math.max(0, age);
}
