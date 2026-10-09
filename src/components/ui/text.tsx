// Based on React Native Reusables `Text` (MIT): cva variants + TextClassContext so a
// parent (e.g. Button) can set the text color. Restyled to the DentisAI type ramp.
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Text as RNText } from 'react-native';

import { useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

export const textVariants = cva('font-sans text-body text-ink', {
  variants: {
    variant: {
      hero: 'font-sans-extrabold text-hero',
      display: 'font-sans-extrabold text-display',
      title: 'font-sans-extrabold text-title',
      headline: 'font-sans-bold text-headline',
      label: 'font-sans-semibold text-label',
      body: 'font-sans text-body',
      bodyStrong: 'font-sans-semibold text-body-strong',
      caption: 'font-sans-medium text-caption',
    },
    tone: {
      default: '',
      secondary: 'text-ink-soft',
      primary: 'text-primary',
      success: 'text-success',
      danger: 'text-danger',
      onPrimary: 'text-primary-on',
      onAccent: 'text-sun-on',
    },
  },
  defaultVariants: { variant: 'body', tone: 'default' },
});

// Child mode: larger reading sizes (design_principles.md §2).
const childSize: Partial<Record<NonNullable<TextVariantProps['variant']>, string>> = {
  headline: 'text-headline-child',
  body: 'text-body-child',
  bodyStrong: 'text-body-strong-child',
  caption: 'text-caption-child',
};

type TextVariantProps = VariantProps<typeof textVariants>;

export const TextClassContext = React.createContext<string | undefined>(undefined);

export type TextProps = React.ComponentProps<typeof RNText> & TextVariantProps & { className?: string };

export function Text({ className, variant = 'body', tone, ...props }: TextProps) {
  const contextClass = React.useContext(TextClassContext);
  const { mode } = useTheme();
  return (
    <RNText
      className={cn(
        textVariants({ variant, tone }),
        mode === 'child' && variant ? childSize[variant] : undefined,
        // A parent's text color applies unless this Text sets its own tone.
        tone ? undefined : contextClass,
        className,
      )}
      {...props}
    />
  );
}
