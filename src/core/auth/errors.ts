import { id } from '@/core/i18n/id';

const t = id.auth.errors;

// Maps Supabase Auth errors to plain Indonesian. Never shows raw server text
// (it can be English or technical) and never reveals whether an email exists.
const byCode: Record<string, string> = {
  invalid_credentials: t.invalidCredentials,
  email_not_confirmed: t.emailNotConfirmed,
  user_already_exists: t.genericSignup,
  email_exists: t.genericSignup,
  weak_password: t.weakPassword,
  same_password: t.samePassword,
  over_email_send_rate_limit: t.emailRateLimit,
  over_request_rate_limit: t.requestRateLimit,
  captcha_failed: t.captcha,
  email_address_invalid: t.emailInvalid,
  validation_failed: t.validation,
  signup_disabled: t.signupDisabled,
  otp_expired: t.linkExpired,
  flow_state_expired: t.linkExpired,
  flow_state_not_found: t.linkOtherDevice,
  bad_code_verifier: t.linkOtherDevice,
  session_not_found: t.sessionExpired,
  session_expired: t.sessionExpired,
  refresh_token_not_found: t.sessionExpired,
  reauthentication_needed: t.reauthNeeded,
  user_banned: t.accountBlocked,
};

type ErrorLike = { code?: unknown; name?: unknown; status?: unknown; message?: unknown };

export function authErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return t.unknown;
  const e = error as ErrorLike;
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return t.network;
  if (typeof e.code === 'string' && byCode[e.code]) return byCode[e.code];
  if (typeof e.message === 'string' && /network|fetch|timeout/i.test(e.message)) return t.network;
  if (e.status === 429) return t.requestRateLimit;
  return t.unknown;
}

export function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : null;
}
