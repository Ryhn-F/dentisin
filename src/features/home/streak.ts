// Streak shown on the homes (ACCOUNTS_AND_FLOWS.md §2.7). The server's brushing_streak() is
// the reference once synced; offline (guest, legacy backend, no signal) the app computes the
// same rule locally (computeStreak). Between the two there is a lag: a session brushed on this
// phone counts locally at once but reaches the server only after the outbox flushed. The merge
// below covers that gap so the counter never drops right after brushing. Pure functions.
import type { BrushingStreak } from '@/domain/models';

/**
 * Server streak, corrected with today's local sessions. Only "today" can lag (older local
 * sessions were synced long ago or are of another device's history), so:
 * - no server value -> local;
 * - the server already counts today, or nothing local today -> server;
 * - otherwise today is counted on top of the server run that ends yesterday.
 * Both must be computed in the same time zone (the app sends deviceTimeZone() to the RPC).
 */
export function mergeStreaks(server: BrushingStreak | null, local: BrushingStreak): BrushingStreak {
  if (!server) return local;
  if (server.todayDone || !local.todayDone) return server;
  // todayDone=false: server.current is the run ending yesterday (or 0).
  const current = server.current + 1;
  const localByDate = new Map(local.week.map((d) => [d.date, d]));
  const week = server.week.map((d) => {
    const mine = localByDate.get(d.date);
    if (!mine?.done) return d;
    return { date: d.date, done: true, brushings: Math.max(d.brushings, mine.brushings) };
  });
  return {
    ...server,
    current,
    longest: Math.max(server.longest, current),
    lastDay: local.lastDay,
    todayDone: true,
    week,
  };
}

export type WeekDot = {
  date: string;
  /** 0 = Monday ... 6 = Sunday (index into id.components.streak.weekdays*). */
  weekday: number;
  done: boolean;
  isToday: boolean;
};

/** The streak's 7-day window (oldest first, ending today) as display dots. */
export function weekDots(streak: Pick<BrushingStreak, 'week'>): WeekDot[] {
  const last = streak.week.length - 1;
  return streak.week.map((d, i) => {
    const [y, m, day] = d.date.split('-').map(Number);
    const js = new Date(Date.UTC(y, (m || 1) - 1, day || 1)).getUTCDay(); // 0 = Sunday
    return { date: d.date, weekday: (js + 6) % 7, done: d.done, isToday: i === last };
  });
}
