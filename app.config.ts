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
      backgroundImage: './assets/images/android-icon-background.png',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Photos and proof clips stay in app-private storage (never the gallery); nothing records
    // audio (proof videos are recorded muted, ADR 017 consent d).
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.RECORD_AUDIO',
    ],
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
    // Still photos for screening and muted brushing proof videos (ADR 017/018, consent d): no
    // microphone permission, no barcode scanner (smaller APK).
    [
      'expo-camera',
      {
        cameraPermission:
          'DentisAI memakai kamera untuk memotret gigi dan, bila diizinkan, merekam video sikat gigi tanpa suara. Foto diperiksa di HP ini saja.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFDF8',
        image: './assets/images/splash-icon.png',
        imageWidth: 200,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
