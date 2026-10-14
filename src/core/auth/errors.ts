import { id } from '@/core/i18n/id';

const t = id.auth.errors;

// Maps Supabase Auth errors (GoTrue `error_code`) to plain Indonesian. Never shows raw
// server text (it can be English or technical) and never reveals whether an email exists.
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
  // Built-in Supabase mailer only sends to team addresses (custom mailer not active yet).
  email_address_not_authorized: t.emailNotAuthorized,
  validation_failed: t.validation,
  signup_disabled: t.signupDisabled,
  email_provider_disabled: t.signupDisabled,
  otp_expired: t.linkExpired,
  flow_state_expired: t.linkExpired,
  flow_state_not_found: t.linkOtherDevice,
  bad_code_verifier: t.linkOtherDevice,
  session_not_found: t.sessionExpired,
  session_expired: t.sessionExpired,
  refresh_token_not_found: t.sessionExpired,
  refresh_token_already_used: t.sessionExpired,
  user_not_found: t.sessionExpired,
  bad_jwt: t.sessionExpired,
  no_authorization: t.sessionExpired,
  reauthentication_needed: t.reauthNeeded,
  reauthentication_not_valid: t.reauthNeeded,
  user_banned: t.accountBlocked,
  request_timeout: t.network,
  // Send Email hook (mailer.ryhnfir.dev) did not answer or refused: the mail was not sent.
  hook_timeout: t.emailSendFailed,
  hook_timeout_after_retry: t.emailSendFailed,
  hook_payload_over_size_limit: t.emailSendFailed,
  hook_payload_invalid_content_type: t.emailSendFailed,
};

type ErrorLike = { code?: unknown; name?: unknown; status?: unknown; message?: unknown };

export type AuthErrorContext = {
  /** The request makes Supabase send an email (sign-up, resend, password reset). */
  sendsEmail?: boolean;
};

export function authErrorMessage(error: unknown, context: AuthErrorContext = {}): string {
  if (!error || typeof error !== 'object') return t.unknown;
  const e = error as ErrorLike;
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return t.network;
  if (e.code === 'over_email_send_rate_limit' && typeof e.message === 'string') {
    // Per-address limit (auth.email.max_frequency = 60s): "…only request this after 47 seconds."
    const seconds = /(\d{1,4})\s*seconds?/i.exec(e.message);
    if (seconds) return t.emailWait(Number(seconds[1]));
  }
  if (typeof e.code === 'string' && byCode[e.code]) return byCode[e.code];
  if (typeof e.message === 'string' && /network|fetch|timeout/i.test(e.message)) return t.network;
  if (e.status === 429) return t.requestRateLimit;
  // A server error while sending mail ("Error sending confirmation email").
  if (context.sendsEmail && typeof e.status === 'number' && e.status >= 500) return t.emailSendFailed;
  return t.unknown;
}

export function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as ErrorLike).code;
  return typeof code === 'string' ? code : null;
}
