// Based on React Native Reusables `Switch` (MIT) on @rn-primitives/switch.
// Bigger and bolder than the default: 56×32 track, white knob, blue when on.
// The off track uses `outline` (3:1 non-text contrast on white/lavender).
import * as SwitchPrimitives from '@rn-primitives/switch';

import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: SwitchPrimitives.RootProps) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        'h-8 w-14 shrink-0 flex-row items-center rounded-full px-1',
        props.checked ? 'bg-primary' : 'bg-outline',
        props.disabled && 'opacity-50',
        className,
      )}
      hitSlop={8}
      {...props}
    >
      <SwitchPrimitives.Thumb
        className={cn('size-6 rounded-full bg-card', props.checked ? 'translate-x-6' : 'translate-x-0')}
      />
    </SwitchPrimitives.Root>
  );
}
