import type { Config } from 'tailwindcss';

// Tokens come from the TS theme (single source); Tailwind only exposes them as classes.
import { palette, levelColors } from './src/core/theme/colors';
import { radius } from './src/core/theme/radius';
import { childTypeScale, fontFamilies, typeScale } from './src/core/theme/typography';

const fontSize = Object.fromEntries([
  ...Object.entries(typeScale).map(([name, r]) => [kebab(name), [`${r.size}px`, { lineHeight: `${r.lineHeight}px` }]]),
  ...Object.entries(childTypeScale).map(([name, r]) => [`${kebab(name)}-child`, [`${r!.size}px`, { lineHeight: `${r!.lineHeight}px` }]]),
]);

function kebab(s: string) {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- the preset ships as CommonJS without types
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: palette.bg,
        surface: palette.surface,
        card: palette.card,
        ink: palette.text,
        'ink-soft': palette.textSecondary,
        primary: { DEFAULT: palette.primary, deep: palette.primaryDeep, on: palette.onPrimary },
        sun: { DEFAULT: palette.accent, on: palette.onAccent },
        coral: { DEFAULT: palette.coral, on: palette.onCoral },
        success: palette.success,
        danger: palette.danger,
        outline: palette.outline,
        separator: palette.separator,
        tint: palette.tints,
        level: Object.fromEntries(Object.entries(levelColors).map(([k, v]) => [k, v.bg])),
      },
      fontFamily: {
        sans: [fontFamilies.regular],
        'sans-medium': [fontFamilies.medium],
        'sans-semibold': [fontFamilies.semibold],
        'sans-bold': [fontFamilies.bold],
        'sans-extrabold': [fontFamilies.extrabold],
      },
      fontSize,
      borderRadius: {
        field: `${radius.field}px`,
        card: `${radius.card}px`,
        tile: `${radius.lg}px`,
        sheet: `${radius.sheet}px`,
      },
    },
  },
  plugins: [],
} satisfies Config;
