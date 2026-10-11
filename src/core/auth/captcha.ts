// Contract with the backend's Turnstile host page (backend/web/captcha/index.html):
//   URL      <origin>/captcha/?sitekey=<public site key>&action=<name>
//   success  window.ReactNativeWebView.postMessage('{"type":"turnstile","token":"…"}')
//            (fallback outside a WebView: navigate to dentisai://captcha?token=…)
//   failure  '{"type":"turnstile_error","code":"…"}' (code "expired" = token timed out)
// The app passes the token as `captchaToken` to signUp / signInWithPassword / resend /
// resetPasswordForEmail; Supabase verifies it with the Turnstile secret (never in the app).

export type CaptchaAction = 'login' | 'signup' | 'reset' | 'resend';

export type CaptchaMessage = { kind: 'token'; token: string } | { kind: 'error'; code: string } | { kind: 'ignore' };

// Turnstile tokens are opaque URL-safe strings (a few hundred to ~2k characters).
const TOKEN_PATTERN = /^[A-Za-z0-9._\-:]{10,4096}$/;

function asToken(value: unknown): string | null {
  return typeof value === 'string' && TOKEN_PATTERN.test(value) ? value : null;
}

/** Parses a WebView message from the host page. Anything unexpected is ignored. */
export function parseCaptchaMessage(data: string): CaptchaMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { kind: 'ignore' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'ignore' };
  const msg = parsed as { type?: unknown; token?: unknown; code?: unknown };
  if (msg.type === 'turnstile') {
    const token = asToken(msg.token);
    return token ? { kind: 'token', token } : { kind: 'error', code: 'bad_token' };
  }
  if (msg.type === 'turnstile_error') {
    const code = typeof msg.code === 'string' ? msg.code.slice(0, 32) : '';
    return { kind: 'error', code };
  }
  return { kind: 'ignore' };
}

/** Token from the page's fallback navigation (dentisai://captcha?token=…), else null. */
export function tokenFromCaptchaUrl(url: string): string | null {
  const match = /^dentisai:\/\/captcha\/?\?(.*)$/i.exec(url);
  if (!match) return null;
  return asToken(new URLSearchParams(match[1]).get('token'));
}

/**
 * Navigations the CAPTCHA WebView may perform: the host page itself and Cloudflare's
 * challenge frames. Everything else (links, redirects elsewhere) is blocked.
 */
export function isAllowedCaptchaNavigation(url: string, origin: string): boolean {
  if (url === 'about:blank' || url.startsWith('about:srcdoc')) return true;
  if (url.startsWith('https://challenges.cloudflare.com/')) return true;
  const page = `${origin}/captcha`;
  return url === page || url.startsWith(`${page}/`) || url.startsWith(`${page}?`);
}
