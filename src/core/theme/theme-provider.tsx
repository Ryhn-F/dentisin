import { createContext, use, useMemo, useState, type ReactNode } from 'react';
import type { TextStyle } from 'react-native';

import { levelColors, palette } from './colors';
import { childTypeScale, fontFamilies, touchTarget, typeScale, type TypeVariant, type UiMode } from './typography';

type ModeState = { mode: UiMode; setMode: (mode: UiMode) => void };

const ModeContext = createContext<ModeState | null>(null);

export function ThemeProvider({
  initialMode = 'adult',
  children,
}: {
  initialMode?: UiMode;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<UiMode>(initialMode);
  const value = useMemo(() => ({ mode, setMode }), [mode]);
  return <ModeContext value={value}>{children}</ModeContext>;
}

export function useUiMode(): ModeState {
  const ctx = use(ModeContext);
  if (!ctx) {
    throw new Error('useUiMode must be used inside <ThemeProvider>');
  }
  return ctx;
}

/** RN text style for a ramp step — for places that cannot take `className` (TextInput, navigation). */
export function textStyle(variant: TypeVariant, mode: UiMode = 'adult'): TextStyle {
  const r = (mode === 'child' ? childTypeScale[variant] : undefined) ?? typeScale[variant];
  return { fontFamily: fontFamilies[r.family], fontSize: r.size, lineHeight: r.lineHeight };
}

// Runtime tokens for values `className` cannot express: mode-dependent touch sizes,
// icon/SVG colors, navigation options. Outside a provider the theme is adult mode.
export function useTheme() {
  const mode = use(ModeContext)?.mode ?? 'adult';
  return useMemo(
    () => ({
      mode,
      colors: palette,
      levels: levelColors,
      touch: touchTarget[mode],
    }),
    [mode],
  );
}

export type Theme = ReturnType<typeof useTheme>;
