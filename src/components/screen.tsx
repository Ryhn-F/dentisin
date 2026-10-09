import type { ReactNode } from 'react';
import { ScrollView } from 'react-native';

import { cn } from '@/lib/utils';

// Standard scrolling screen body: lavender page, safe-area aware, keyboard friendly,
// 20dp edge padding and generous section gaps. `flush` removes top padding for
// screens that start with a full-bleed hero block.
export function Screen({
  children,
  className,
  flush = false,
  testID,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  testID?: string;
}) {
  return (
    <ScrollView
      testID={testID}
      contentInsetAdjustmentBehavior={flush ? 'never' : 'automatic'}
      keyboardShouldPersistTaps="handled"
      className="flex-1 bg-bg"
      contentContainerClassName={cn('gap-7 pb-12', flush ? 'pt-0' : 'px-5 pt-4', className)}
    >
      {children}
    </ScrollView>
  );
}
