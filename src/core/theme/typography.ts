// Plus Jakarta Sans everywhere (OFL-1.1, bundled — see fonts.ts): bold geometric
// headings like the design references, regular/medium for readable body text.
// SINGLE SOURCE for the type ramp: tailwind.config.ts builds `text-*` sizes and
// `font-*` families from this file. No imports here (evaluated by Node too).

export type UiMode = 'child' | 'adult';

export const fontFamilies = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export type TypeVariant =
  | 'hero'
  | 'display'
  | 'title'
  | 'headline'
  | 'label'
  | 'body'
  | 'bodyStrong'
  | 'caption';

type Ramp = { size: number; lineHeight: number; family: keyof typeof fontFamilies };

export const typeScale: Record<TypeVariant, Ramp> = {
  hero: { size: 52, lineHeight: 60, family: 'extrabold' },
  display: { size: 32, lineHeight: 40, family: 'extrabold' },
  title: { size: 22, lineHeight: 30, family: 'extrabold' },
  headline: { size: 17, lineHeight: 24, family: 'bold' },
  label: { size: 14, lineHeight: 20, family: 'semibold' },
  body: { size: 16, lineHeight: 24, family: 'regular' },
  bodyStrong: { size: 16, lineHeight: 24, family: 'semibold' },
  caption: { size: 14, lineHeight: 20, family: 'medium' },
};

// Child mode reads at ~grade 4: larger body text (>= 18sp).
export const childTypeScale: Partial<Record<TypeVariant, Ramp>> = {
  headline: { size: 19, lineHeight: 26, family: 'bold' },
  body: { size: 18, lineHeight: 26, family: 'regular' },
  bodyStrong: { size: 18, lineHeight: 26, family: 'semibold' },
  caption: { size: 16, lineHeight: 22, family: 'medium' },
};

// Minimum touch target heights in dp (design_principles.md §2).
export const touchTarget: Record<UiMode, { regular: number; large: number }> = {
  adult: { regular: 48, large: 56 },
  child: { regular: 56, large: 64 },
};

export const minTargetGap = 8;
