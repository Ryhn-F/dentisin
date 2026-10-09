import { config } from '@/core/config';
import { id } from '@/core/i18n/id';

import type { AuthCallback, AuthLinkType } from './callback-url';
import { authErrorCode, authErrorMessage } from './errors';
import { clearGuestFlag, useSession } from './session-store';
import { supabase } from './supabase';
import { normalizeEmail } from './validation';

export type AuthResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; code: string | null };

function notConfigured(): AuthResult<never> {
  return { ok: false, message: id.auth.errors.notConfigured, code: 'not_configured' };
}

function failure(error: unknown): AuthResult<never> {
  return { ok: false, message: authErrorMessage(error), code: authErrorCode(error) };
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
    await clearGuestFlag();
    return { ok: true };
  } catch (e) {
    return failure(e);
  }
}

// Supabase does not reveal whether an email already exists (it returns a user with
// no identities); the UI shows the same "check your email" screen either way.
export async function signUp(email: string, password: string, captchaToken?: string): Promise<AuthResult> {
  if (!supabase) return notConfigured();
  try {
    const normalized = normalizeEmail(email);
    const { error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { emailRedirectTo: config.authRedirectUrl, captchaToken },
    });
    if (error) return failure(error);
    useSession.getState().setPendingEmail(normalized);
    return { ok: true };
  } catch (e) {
    return failure(e);
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
    return error ? failure(error) : { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function requestPasswordReset(email: string, captchaToken?: string): Promise<AuthResult> {
  if (!supabase) return notConfigured();
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
      redirectTo: config.authRedirectUrl,
      captchaToken,
    });
    return error ? failure(error) : { ok: true };
  } catch (e) {
    return failure(e);
  }
}

export async function completeAuthCallback(
  callback: AuthCallback,
): Promise<AuthResult<{ type: AuthLinkType }>> {
  if (!supabase) return notConfigured();
  try {
    if (callback.kind === 'code') {
      const { error } = await supabase.auth.exchangeCodeForSession(callback.code);
      if (error) return failure(error);
      await clearGuestFlag();
      return { ok: true, type: callback.type };
    }
    if (callback.kind === 'tokens') {
      const { error } = await supabase.auth.setSession({
        access_token: callback.accessToken,
        refresh_token: callback.refreshToken,
      });
      if (error) return failure(error);
      await clearGuestFlag();
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
