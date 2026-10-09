// Single theme entry point: import { palette, useTheme } from '@/core/theme'.
// Hex colors are allowed only inside this folder (enforced by __tests__/design-lint.test.ts);
// components use Tailwind classes generated from these same tokens (tailwind.config.ts).
export * from './colors';
export * from './contrast';
export * from './motion';
export * from './navigation';
export * from './radius';
export * from './shadows';
export * from './spacing';
export * from './theme-provider';
export * from './typography';
