// Durations in ms. Animate transform/opacity only; respect OS reduce-motion;
// the emergency screen never animates (design_principles.md §7).
export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
  /** Press feedback: quick, slightly bouncy, interruptible. */
  pressSpring: { damping: 15, stiffness: 320, mass: 0.6 },
  /** Mascot idle float (only on rare/celebration moments). */
  floatDistance: 6,
  floatDuration: 1400,
} as const;
