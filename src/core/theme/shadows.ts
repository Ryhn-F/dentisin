// Soft, blue-tinted elevation (design references). boxShadow strings only — never
// legacy elevation/shadow* props. Hierarchy still comes from color and size first.
export const shadows = {
  card: '0 8px 24px rgba(61, 90, 241, 0.10)',
  raised: '0 12px 28px rgba(61, 90, 241, 0.18)',
  button: '0 8px 18px rgba(61, 90, 241, 0.28)',
  accentButton: '0 8px 18px rgba(255, 197, 46, 0.40)',
} as const;
