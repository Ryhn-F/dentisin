// Public runtime configuration. EXPO_PUBLIC_* values are inlined into the JS bundle,
// so only public values belong here (the Supabase anon/publishable key is public by
// design; RLS protects the data). Never put the service-role key or CAPTCHA secret here.
// Set them in app/.env.local (git-ignored); see app/.env.example.

function read(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const config = {
  supabaseUrl: read(process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: read(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  turnstileSiteKey: read(process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY),
  // Turnstile validates the page hostname; the WebView pretends to be this origin.
  turnstileBaseUrl: read(process.env.EXPO_PUBLIC_TURNSTILE_BASE_URL) ?? 'https://app.ryhnfir.dev',
  // Must be listed in Supabase Auth "Redirect URLs" (backend/supabase/config.toml).
  authRedirectUrl: read(process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL) ?? 'dentisai://auth/callback',
} as const;

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
