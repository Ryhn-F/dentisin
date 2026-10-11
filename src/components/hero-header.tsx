import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette, useLightStatusBar } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Blob, Ring } from './decor';
import { TextClassContext } from './ui/text';

const HEADER_BAR = 56;

// Full-bleed blue block with organic coral/yellow blobs (design reference 2), drawn
// under a transparent native header — the navigator still owns title and back.
// Rounded bottom corners lead into the lavender page.
export function HeroHeader({
  children,
  className,
  withNavHeader = true,
  ring = true,
}: {
  children?: ReactNode;
  className?: string;
  /** Leave room for the transparent navigation header above the content. */
  withNavHeader?: boolean;
  /** The yellow ring sits in the bottom-right corner; turn it off when a CTA ends there. */
  ring?: boolean;
}) {
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  return (
    <TextClassContext.Provider value="text-primary-on">
      <View
        className={cn('overflow-hidden rounded-b-sheet bg-primary px-5 pb-8', className)}
        style={{ paddingTop: insets.top + (withNavHeader ? HEADER_BAR : 16), borderCurve: 'continuous' }}
      >
        {/* Decor placement rule: coral/yellow never sit behind text or the back arrow
            (white on coral is 2.8:1, on yellow 1.6:1); deep blue may (7.4:1). */}
        <Blob color={palette.primaryDeep} size={240} variant={2} opacity={0.6} style={{ left: -110, top: -90 }} />
        {/* Below the status bar: system icons are white and must not sit on coral. */}
        <Blob color={palette.coral} size={110} variant={0} style={{ right: -58, top: insets.top + 6 }} />
        {ring ? <Ring color={palette.accent} size={72} thickness={12} style={{ right: -22, bottom: -26 }} /> : null}
        <View className="gap-4">{children}</View>
      </View>
    </TextClassContext.Provider>
  );
}
