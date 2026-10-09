// Based on React Native Reusables `Input` (MIT). The bordered field chrome lives in
// TextField; this is the bare, themed TextInput.
import { TextInput } from 'react-native';

import { palette, textStyle, useTheme } from '@/core/theme';
import { cn } from '@/lib/utils';

export function Input({ className, style, ...props }: React.ComponentProps<typeof TextInput>) {
  const { mode } = useTheme();
  return (
    <TextInput
      className={cn('min-w-0 flex-1 py-3 text-ink', props.editable === false && 'opacity-60', className)}
      placeholderTextColor={palette.textSecondary}
      selectionColor={palette.primary}
      // Font metrics from the ramp (TextInput ignores TextClassContext).
      style={[textStyle('body', mode), style]}
      {...props}
    />
  );
}
