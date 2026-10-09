import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { shadows } from '@/core/theme';
import { cn } from '@/lib/utils';

import { TextClassContext } from './ui/text';

export type CardTone = 'white' | 'blue' | 'sun' | 'coral' | 'lavender' | 'sky' | 'cream' | 'peach' | 'mint';

const toneClass: Record<CardTone, { bg: string; text?: string }> = {
  white: { bg: 'bg-card' },
  blue: { bg: 'bg-primary', text: 'text-primary-on' },
  sun: { bg: 'bg-sun', text: 'text-sun-on' },
  coral: { bg: 'bg-coral', text: 'text-coral-on' },
  lavender: { bg: 'bg-tint-lavender' },
  sky: { bg: 'bg-tint-sky' },
  cream: { bg: 'bg-tint-cream' },
  peach: { bg: 'bg-tint-peach' },
  mint: { bg: 'bg-tint-mint' },
};

// One object per card (a child, a streak, a result). Bold tones set the text color
// for their children; decorations go in as absolutely positioned children.
export function Card({
  children,
  tone = 'white',
  className,
  style,
  testID,
}: {
  children: ReactNode;
  tone?: CardTone;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = toneClass[tone];
  const card = (
    <View
      testID={testID}
      className={cn('gap-3 overflow-hidden rounded-card p-5', t.bg, className)}
      style={[{ borderCurve: 'continuous', boxShadow: tone === 'white' ? shadows.card : undefined }, style]}
    >
      {children}
    </View>
  );
  return t.text ? <TextClassContext.Provider value={t.text}>{card}</TextClassContext.Provider> : card;
}
