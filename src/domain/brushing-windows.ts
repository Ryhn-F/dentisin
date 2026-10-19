// Product decision 2026-10-19: morning 06:00–09:00, evening 20:00–23:00 (local clock, end
// exclusive); one session per window per day; either window lights the day's streak.
// backend/ml/brushing/brushing_rules.yaml still has the older PLACEHOLDER windows.
export const brushingWindows = {
  morning: { start: '06.00', end: '09.00' },
  evening: { start: '20.00', end: '23.00' },
} as const;

export const TARGET_DURATION_S = 120;
