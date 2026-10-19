import { useAccount } from '@/core/account/account-store';
import { childLogin, type ApiErrorCode } from '@/core/account/api';
import { config } from '@/core/config';
import { id } from '@/core/i18n/id';
import type { MyAccount } from '@/domain/models';

import type { AuthCallback, AuthLinkType } from './callback-url';
import { authErrorCode, authErrorMessage, type AuthErrorContext } from './errors';
import { appStorage } from './secure-storage';
import { clearGuestFlag, useSession } from './session-store';
import { supabase } from './supabase';
import { normalizeEmail } from './validation';

// Backend contract (backend/supabase/config.toml [auth], docs/runbooks/auth-setup.md):
// - Supabase Auth only (FastAPI has no auth endpoints); email + password, email
//   confirmation required, PKCE (the code verifier stays on this device).
// - Email links go through the mailer hook to <SUPABASE_URL>/auth/v1/verify, which
//   redirects to `config.authRedirectUrl` (https page → dentisai://auth/callback?code=…).
// - `captchaToken` on sign-up, sign-in, resend and password reset (Turnstile).
// - The signup trigger creates the `guardian` row and role. The only metadata the app sends is
//   `account_type` ('guardian' | 'teen', ADR 017); the server ignores any other value.
// - Child accounts never use signUp/signIn: they log in through the child-login Edge Function
//   (signInChild) and then use an ordinary Supabase session restricted by RLS.

export type AuthResult<T = object> = ({ ok: true } & T) | { ok: false; message: string; code: string | null };

function notConfigured(): AuthResult<never> {
  return { ok: false, message: id.auth.errors.notConfigured, code: 'not_configured' };
}

function failure(error: unknown, context?: AuthErrorContext): AuthResult<never> {
  return { ok: false, message: authErrorMessage(error, context), code: authErrorCode(error) };
}

const sendsEmail: AuthErrorContext = { sendsEmail: true };

/** Account types a person can choose at sign-up (child accounts are made by a guardian). */
export type SignUpAccountType = 'guardian' | 'teen';

/**
 * After any successful sign-in: the device leaves no-account mode and the account store
 * switches to this user and reads my_account() (routing waits for it, see resolveHome).
 * Returns the account, or null when it could not be read (offline blip).
 */
async function onSignedIn(): Promise<MyAccount | null> {
  await clearGuestFlag();
  let userId = useSession.getState().userId;
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      userId = data.session?.user.id ?? userId;
    } catch {
      // Keep the id the auth listener stored.
    }
  }
  if (!userId) return null;
  await useAccount.getState().setUser(userId);
  await useAccount.getState().refresh();
  return useAccount.getState().me;
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
  accountType: SignUpAccountType,
  captchaToken?: string,
): Promise<AuthResult<{ needsConfirmation: boolean }>> {
  if (!supabase) return notConfigured();
  try {
    const normalized = normalizeEmail(email);
    const { data, error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: {
        data: { account_type: accountType },
        emailRedirectTo: config.authRedirectUrl,
        captchaToken,
      },
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

// ---------------------------------------------------------------------------------------------
// Child accounts (ADR 017 §2.3): parent email + username + password through child-login.
// ---------------------------------------------------------------------------------------------

/** signInChild codes: the child-login / API codes plus 'not_child' and 'session_failed'. */
export type ChildSignInCode = ApiErrorCode | 'not_child' | 'session_failed';

export type ChildSignInResult =
  | { ok: true; account: MyAccount | null }
  | { ok: false; code: ChildSignInCode; retryAfterS?: number };

/**
 * Child login: child-login Edge Function -> supabase.auth.setSession -> my_account().
 * The account must be a child account; anything else is signed out again ('not_child').
 * When my_account() cannot be read right after login (offline blip) the child stays signed in
 * with `account: null`; routing then shows the account gate, which retries.
 * UI: every 'invalid_credentials' cause must show the same message (never tell them apart).
 */
export async function signInChild(input: {
  parentEmail: string;
  username: string;
  password: string;
  captchaToken?: string | null;
}): Promise<ChildSignInResult> {
  if (!supabase) return { ok: false, code: 'not_configured' };
  const res = await childLogin(input);
  if (!res.ok) {
    return res.retryAfterS !== undefined
      ? { ok: false, code: res.code, retryAfterS: res.retryAfterS }
      : { ok: false, code: res.code };
  }
  try {
    const { error } = await supabase.auth.setSession({
      access_token: res.data.accessToken,
      refresh_token: res.data.refreshToken,
    });
    if (error) return { ok: false, code: 'session_failed' };
  } catch {
    return { ok: false, code: 'session_failed' };
  }
  const account = await onSignedIn();
  if (account && account.accountType !== 'child') {
    await useSession.getState().signOut();
    return { ok: false, code: 'not_child' };
  }
  await rememberParentEmail(input.parentEmail);
  return { ok: true, account };
}

const PARENT_EMAIL_KEY = 'dentisai.childLogin.parentEmail';

/** Parent email last used on the child login screen (the password is never stored). */
export async function getRememberedParentEmail(): Promise<string | null> {
  try {
    const value = await appStorage.getItem(PARENT_EMAIL_KEY);
    return value && value.length <= 254 ? value : null;
  } catch {
    return null;
  }
}

export async function rememberParentEmail(email: string): Promise<void> {
  try {
    await appStorage.setItem(PARENT_EMAIL_KEY, normalizeEmail(email));
  } catch {
    // Convenience only.
  }
}

export async function forgetParentEmail(): Promise<void> {
  try {
    await appStorage.removeItem(PARENT_EMAIL_KEY);
  } catch {
    // Convenience only.
  }
}

// ---------------------------------------------------------------------------------------------
// Teen sign-up: the birth year-month asked BEFORE signUp (age gate) stays on this device until
// the teen-setup screen calls ensure_self_profile after the first sign-in.
// ---------------------------------------------------------------------------------------------

export type PendingTeenBirth = { year: number; month: number | null };

const TEEN_BIRTH_KEY = 'dentisai.pendingTeenBirth';

export async function setPendingTeenBirth(birth: PendingTeenBirth): Promise<void> {
  try {
    await appStorage.setItem(TEEN_BIRTH_KEY, JSON.stringify({ year: birth.year, month: birth.month }));
  } catch {
    // The setup screen asks again when nothing is stored.
  }
}

export async function getPendingTeenBirth(): Promise<PendingTeenBirth | null> {
  try {
    const raw = await appStorage.getItem(TEEN_BIRTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { year?: unknown; month?: unknown };
    const { year, month } = parsed;
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > 2100) return null;
    if (month === null || month === undefined) return { year, month: null };
    if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return { year, month };
  } catch {
    return null;
  }
}

export async function clearPendingTeenBirth(): Promise<void> {
  try {
    await appStorage.removeItem(TEEN_BIRTH_KEY);
  } catch {
    // Nothing else to do.
  }
}
