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
  // Origin of the backend's static pages (backend/web, Cloudflare Pages): the Turnstile
  // host page lives at <origin>/captcha/ and the email-link page at <origin>/auth/callback.
  turnstileBaseUrl: (read(process.env.EXPO_PUBLIC_TURNSTILE_BASE_URL) ?? 'https://app.ryhnfir.dev').replace(/\/+$/, ''),
  // Where Supabase sends people after they tap an email link. Backend contract: the https
  // page (it forwards ?code / #… to dentisai://auth/callback and has a tap-to-open fallback).
  // It is in Supabase "Redirect URLs" AND in the mailer's ALLOWED_REDIRECT_PREFIXES; a
  // redirect the mailer does not allow is dropped and the user lands on the bare Site URL.
  authRedirectUrl: read(process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL) ?? 'https://app.ryhnfir.dev/auth/callback',
  // DentisAI ML/AI API (backend/api, FastAPI; ADR 019). Optional: without it every screening is
  // evaluated on the device only. No trailing slash.
  apiBaseUrl: read(process.env.EXPO_PUBLIC_API_BASE_URL)?.replace(/\/+$/, '') ?? null,
} as const;

export const isApiConfigured = Boolean(config.apiBaseUrl);

export const isSupabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

/** Turnstile host page (backend/web/captcha/index.html): ?sitekey=<public key>&action=<name>. */
export function captchaPageUrl(siteKey: string, action: string): string {
  const params = new URLSearchParams({ sitekey: siteKey, action });
  return `${config.turnstileBaseUrl}/captcha/?${params.toString()}`;
}

// CAPTCHA tokens are sent only from the Android app (the widget needs a WebView);
// the web build is a design preview.
export const captchaEnabled = Boolean(config.turnstileSiteKey) && process.env.EXPO_OS !== 'web';
