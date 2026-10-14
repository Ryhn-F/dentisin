import { create } from 'zustand';

import { appStorage } from './auth/secure-storage';
import type { UiMode } from './theme/typography';

// Device-level display preferences (not personal data). Restored behind the splash
// screen together with the session, so child mode never flashes in adult size first.
const MODE_KEY = 'dentisai.uiMode';

type PrefsState = {
  mode: UiMode;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (mode: UiMode) => void;
};

export const usePrefs = create<PrefsState>((set) => ({
  mode: 'adult',
  hydrated: false,
  hydrate: async () => {
    try {
      const stored = await appStorage.getItem(MODE_KEY);
      set({ mode: stored === 'child' ? 'child' : 'adult', hydrated: true });
    } catch {
      // Unreadable storage must not block the app: fall back to adult mode.
      set({ hydrated: true });
    }
  },
  setMode: (mode) => {
    set({ mode });
    appStorage.setItem(MODE_KEY, mode).catch(() => {});
  },
}));
