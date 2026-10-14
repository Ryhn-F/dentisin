import { config } from '@/core/config';
import { id } from '@/core/i18n/id';

import type { AuthCallback, AuthLinkType } from './callback-url';
import { authErrorCode, authErrorMessage, type AuthErrorContext } from './errors';
import { clearGuestFlag, useSession } from './session-store';
import { supabase } from './supabase';
import { normalizeEmail } from './validation';

// Backend contract (backend/supabase/config.toml [auth], docs/runbooks/auth-setup.md):
// - Supabase Auth only (FastAPI has no auth endpoints); email + password, email
//   confirmation required, PKCE (the code verifier stays on this device).
// - Email links go through the mailer hook to <SUPABASE_URL>/auth/v1/verify, which
//   redirects to `config.authRedirectUrl` (https page → dentisai://auth/callback?code=…).
// - `captchaToken` on sign-up, sign-in, resend and password reset (Turnstile).
// - The signup trigger creates the `guardian` row and role; the app sends no profile data.

export type AuthResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; code: string | null };

function notConfigured(): AuthResult<never> {
  return { ok: false, message: id.auth.errors.notConfigured, code: 'not_configured' };
}

function failure(error: unknown, context?: AuthErrorContext): AuthResult<never> {
  return { ok: false, message: authErrorMessage(error, context), code: authErrorCode(error) };
}

const sendsEmail: AuthErrorContext = { sendsEmail: true };

/** After any successful sign-in: the device leaves no-account mode and learns its roles. */
async function onSignedIn() {
  await clearGuestFlag();
  void useSession.getState().refreshRoles();
}

export async function signIn(email: string, password: string, captchaToken?: string): Promise<AuthResult> {
  if (!supabase) return notConfigured();
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizeEmail(email),
      password,
      options: { captchaToken },
    });
    if (error) return failure(error);
    await onSignedIn();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

// Supabase does not reveal whether an email already exists (it returns a user with
// no identities and sends nothing); the UI shows the same "check your email" screen.
// `needsConfirmation` is false only if the project auto-confirms (then a session exists).
export async function signUp(
  email: string,
  password: string,
  captchaToken?: string,
): Promise<AuthResult<{ needsConfirmation: boolean }>> {
  if (!supabase) return notConfigured();
  try {
    const normalized = normalizeEmail(email);
    const { data, error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { emailRedirectTo: config.authRedirectUrl, captchaToken },
    });
    if (error) return failure(error, sendsEmail);
    if (data.session) {
      await onSignedIn();
      return { ok: true, needsConfirmation: false };
    }
    useSession.getState().setPendingEmail(normalized);
    return { ok: true, needsConfirmation: true };
  } catch (e) {
    return failure(e, sendsEmail);
  }
}

export async function resendConfirmation(email: string, captchaToken?: string): Promise<AuthResult> {
  if (!supabase) return notConfigured();
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalizeEmail(email),
      options: { emailRedirectTo: config.authRedirectUrl, captchaToken },
    });
    return error ? failure(error, sendsEmail) : { ok: true };
  } catch (e) {
    return failure(e, sendsEmail);
  }
}

export async function requestPasswordReset(email: string, captchaToken?: string): Promise<AuthResult> {
  if (!supabase) return notConfigured();
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: config.authRedirectUrl,
      captchaToken,
    });
    return error ? failure(error, sendsEmail) : { ok: true };
  } catch (e) {
    return failure(e, sendsEmail);
  }
}

export async function completeAuthCallback(
  callback: AuthCallback,
): Promise<AuthResult<{ type: AuthLinkType }>> {
  if (!supabase) return notConfigured();
  try {
    if (callback.kind === 'code') {
      // PKCE: the link carries no `type`; supabase-js remembers whether this device asked
      // for a password reset and returns `redirectType: "recovery"` (present at runtime in
      // auth-js 2.117, missing from its types). The PASSWORD_RECOVERY event is the backup.
      const { data, error } = await supabase.auth.exchangeCodeForSession(callback.code);
      if (error) return failure(error);
      await onSignedIn();
      const redirectType = (data as { redirectType?: string | null }).redirectType;
      return { ok: true, type: redirectType === 'recovery' ? 'recovery' : callback.type };
    }
    if (callback.kind === 'tokens') {
      const { error } = await supabase.auth.setSession({
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken,
      });
      if (error) return failure(error);
      await onSignedIn();
      return { ok: true, type: callback.type };
    }
    if (callback.kind === 'error') {
      return failure({ code: callback.code ?? 'otp_expired' });
    }
    return { ok: false, message: id.auth.errors.linkInvalid, code: 'empty' };
  } catch (e) {
    return failure(e);
  }
}

export async function updatePassword(password: string): Promise<AuthResult> {
  if (!supabase) return notConfigured();
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return failure(error);
    useSession.getState().setRecovering(false);
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}
