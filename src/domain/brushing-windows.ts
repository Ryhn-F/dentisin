// Mirrors backend/ml/brushing/brushing_rules.yaml (status PLACEHOLDER):
// windows morning 06:00–10:00, evening 19:00–23:00, Asia/Jakarta, streak_requires both.
// Phase 5 loads these from the bundled rules file instead of constants.
export const brushingWindows = {
  morning: { start: '06.00', end: '10.00' },
  evening: { start: '19.00', end: '23.00' },
} as const;

export const TARGET_DURATION_S = 120;
