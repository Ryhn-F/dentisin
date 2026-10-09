import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { config, isSupabaseConfigured } from '@/core/config';

import { appStorage } from './secure-storage';

// The app talks to Supabase directly (Auth + RPC `sync_events`, RLS-protected).
// FastAPI is admin-only and never called from the app (app_plan.md §1).
// When not configured (local dev without keys) the client is null and the app
// still works fully offline in no-account mode.
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(config.supabaseUrl!, config.supabaseAnonKey!, {
      auth: {
        storage: appStorage,
        storageKey: 'dentisai.auth',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground (Supabase RN guidance).
if (supabase && process.env.EXPO_OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
