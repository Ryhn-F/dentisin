// Based on React Native Reusables `Checkbox` (MIT) on @rn-primitives/checkbox,
// using our Material icon set instead of lucide (one icon family, design_principles §3.5).
import * as CheckboxPrimitive from '@rn-primitives/checkbox';

import { palette } from '@/core/theme';
import { cn } from '@/lib/utils';

import { Icon } from '../icon';

export function Checkbox({ className, ...props }: CheckboxPrimitive.RootProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'size-7 shrink-0 overflow-hidden rounded-lg border-2',
        props.checked ? 'border-primary' : 'border-outline bg-card',
        props.disabled && 'opacity-50',
        className,
      )}
      hitSlop={12}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="h-full w-full items-center justify-center bg-primary">
        <Icon name="check" size={20} color={palette.onPrimary} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
