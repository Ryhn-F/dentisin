import type { ExpoConfig } from 'expo/config';

// Android-first (ADR 004). iOS is not configured for the MVP.
// Brand colors here must match src/core/theme/colors.ts (palette.light.primary / bg).
const config: ExpoConfig = {
  name: 'DentisAI',
  slug: 'dentisai',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  // Deep link for Supabase auth callback (app/CLAUDE.md §6.8).
  scheme: 'dentisai',
  // Light mode only for now; system UI (status bar, dialogs) follows.
  userInterfaceStyle: 'light',
  android: {
    // PROPOSAL — confirm before the first store/EAS build; cannot change after publishing.
    package: 'dev.ryhnfir.dentisai',
    adaptiveIcon: {
      backgroundColor: '#FFFDF8',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    // Web is used only for quick visual previews during development.
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    // Supabase session + no-account flag in the Android Keystore.
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFDF8',
        image: './assets/images/splash-icon.png',
        imageWidth: 76,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
