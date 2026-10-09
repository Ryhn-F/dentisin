// Design theme v3 ("playful & bold", references: app/docs/design_principles.md §3).
// SINGLE SOURCE for colors: tailwind.config.ts imports this file, so `className`
// utilities and runtime values (icons, SVG, navigation) can never drift apart.
// No imports here — this file is also evaluated by Node when Tailwind loads.
// Every text pair must be listed in `contrastPairs` (WCAG AA 4.5:1) and every
// non-text boundary in `nonTextPairs` (3:1) — enforced by __tests__/contrast.test.ts.
// Light mode only (decision 2026-10-09).

export type TintName = 'lavender' | 'sky' | 'cream' | 'peach' | 'mint';

export const palette = {
  bg: '#F3F5FF',
  surface: '#E7EBFD',
  card: '#FFFFFF',
  text: '#1C1E4F',
  textSecondary: '#5A5F86',
  primary: '#3D5AF1',
  primaryDeep: '#2C44CF',
  onPrimary: '#FFFFFF',
  // "Sun" yellow: CTAs and rewards. Navy text only — white on yellow fails contrast.
  accent: '#FFC52E',
  onAccent: '#1C1E4F',
  // Coral: decoration and bold cards with navy text. Never white text on coral.
  coral: '#FF6B5B',
  onCoral: '#1C1E4F',
  success: '#16784A',
  danger: '#C62F24',
  outline: '#7D84AE',
  separator: '#DCE1F7',
  ripple: 'rgba(28, 30, 79, 0.10)',
  // Translucent white for decorations on blue (never for text that must pass AA).
  onPrimarySoft: 'rgba(255, 255, 255, 0.82)',
  tints: {
    lavender: '#E3E8FF',
    sky: '#DCEAFF',
    cream: '#FFF2CC',
    peach: '#FFE2DC',
    mint: '#D9F3EA',
  } satisfies Record<TintName, string>,
} as const;

export type Palette = typeof palette;

export const tintNames: readonly TintName[] = ['lavender', 'sky', 'cream', 'peach', 'mint'];

export type TriageLevel = 'emergency' | 'urgent' | 'scheduled' | 'routine';

export const triageLevels: readonly TriageLevel[] = ['emergency', 'urgent', 'scheduled', 'routine'];

// Clinical meaning: unchanged by the visual redesign.
export const levelColors: Record<TriageLevel, { bg: string; on: string }> = {
  emergency: { bg: '#B3261E', on: '#FFFFFF' },
  urgent: { bg: '#A04A00', on: '#FFFFFF' },
  scheduled: { bg: '#F2C230', on: '#2B2100' },
  routine: { bg: '#1E7A46', on: '#FFFFFF' },
};

export type ContrastPair = { name: string; fg: string; bg: string };

const p = palette;
const neutralSurfaces: [string, string][] = [
  ['bg', p.bg],
  ['surface', p.surface],
  ['card', p.card],
];

export const contrastPairs: readonly ContrastPair[] = [
  // Body text on every neutral surface and every tint.
  ...[...neutralSurfaces, ...tintNames.map((t): [string, string] => [`tint.${t}`, p.tints[t]])].flatMap(
    ([bgName, bg]) => [
      { name: `text on ${bgName}`, fg: p.text, bg },
      { name: `textSecondary on ${bgName}`, fg: p.textSecondary, bg },
    ],
  ),
  // Links / ghost buttons, inline errors and "done" text on neutral surfaces.
  ...neutralSurfaces.flatMap(([bgName, bg]) => [
    { name: `primary on ${bgName}`, fg: p.primary, bg },
    { name: `danger on ${bgName}`, fg: p.danger, bg },
    { name: `success on ${bgName}`, fg: p.success, bg },
  ]),
  // Bold cards and buttons.
  { name: 'onPrimary on primary', fg: p.onPrimary, bg: p.primary },
  { name: 'onPrimary on primaryDeep', fg: p.onPrimary, bg: p.primaryDeep },
  { name: 'onAccent on accent', fg: p.onAccent, bg: p.accent },
  { name: 'onCoral on coral', fg: p.onCoral, bg: p.coral },
  ...triageLevels.map((level) => ({
    name: `level ${level}`,
    fg: levelColors[level].on,
    bg: levelColors[level].bg,
  })),
];

// Input borders, switch tracks, unfilled streak dots, rings: WCAG 1.4.11 non-text 3:1.
export const nonTextPairs: readonly ContrastPair[] = [
  { name: 'outline on bg', fg: p.outline, bg: p.bg },
  { name: 'outline on card', fg: p.outline, bg: p.card },
  { name: 'outline on surface', fg: p.outline, bg: p.surface },
  { name: 'accent ring on primary', fg: p.accent, bg: p.primary },
  { name: 'primary on card', fg: p.primary, bg: p.card },
];
