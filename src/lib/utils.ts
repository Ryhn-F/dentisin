import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

import { childTypeScale, typeScale } from '@/core/theme/typography';

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Custom font sizes (`text-title`, `text-body-child`, …) must be registered, otherwise
// tailwind-merge treats them as colors and drops `text-ink` & co. (React Native
// Reusables' `cn`, extended for our tokens.)
const fontSizes = [
  ...Object.keys(typeScale).map(kebab),
  ...Object.keys(childTypeScale).map((k) => `${kebab(k)}-child`),
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: fontSizes }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
