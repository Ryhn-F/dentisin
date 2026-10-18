// Backend auth contract (backend/supabase/config.toml [auth], backend/web/captcha,
// backend/web/auth/callback, smtp-handler) as seen from the app.

import { useAccount } from '@/core/account/account-store';
import { completeAuthCallback, requestPasswordReset, resendConfirmation, signIn, signUp } from '@/core/auth/auth-service';
import { isAllowedCaptchaNavigation, parseCaptchaMessage, tokenFromCaptchaUrl } from '@/core/auth/captcha';
import { authErrorMessage } from '@/core/auth/errors';
import { setStorageBackendForTests, type KeyValueBackend } from '@/core/auth/secure-storage';
import { useSession } from '@/core/auth/session-store';
import { PASSWORD_MIN_LENGTH, isPasswordValid } from '@/core/auth/validation';
import { captchaPageUrl, config } from '@/core/config';
import { id } from '@/core/i18n/id';

// A fake Supabase client: only what the auth service and session store call. Built inside
// the factory because jest.mock is hoisted above every import and const in this file.
jest.mock('@/core/auth/supabase', () => {
  const auth = {
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    exchangeCodeForSession: jest.fn(),
    resend: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    setSession: jest.fn(),
    updateUser: jest.fn(),
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    signOut: jest.fn(),
  };
  return { supabase: { auth, rpc: jest.fn() } };
});

const mocked = jest.requireMock('@/core/auth/supabase') as {
  supabase: { auth: Record<string, jest.Mock>; rpc: jest.Mock };
};
const mockAuth = mocked.supabase.auth;
const mockRpc = mocked.supabase.rpc;

const UID = '11111111-1111-4111-8111-111111111111';

function myAccountJson(roles: string[]) {
  return {
    user_id: UID,
    account_type: 'guardian',
    roles,
    self_child_id: null,
    child_accounts: 0,
    child_account: null,
    flags: { brushing_proof_video: false },
    capabilities: { create_child_accounts: true, register_proofs: false },
    limits: {
      teen_min_age: 15,
      teen_max_age: 19,
      max_child_accounts_per_guardian: 6,
      streak_min_duration_s: 60,
      request_max_per_child_per_day: 5,
      request_expiry_days: 14,
      proof_max_bytes: 10485760,
      proof_max_duration_s: 180,
      proof_max_per_child_per_day: 3,
      proof_retention_days: 7,
    },
  };
}

function memoryBackend(): KeyValueBackend {
  const data = new Map<string, string>();
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setStorageBackendForTests(memoryBackend());
  useSession.setState({ status: 'signedOut', email: null, userId: null, pendingEmail: null, recovering: false });
  useAccount.setState({ userId: null, me: null, status: 'idle', lastError: null, lastFetchedAt: null });
});

afterAll(() => setStorageBackendForTests(null));

describe('password policy = config.toml (minimum_password_length 8, lower_upper_letters_digits)', () => {
  it.each([
    ['Gigi1234', true], // exactly 8
    ['Gigi123', false], // 7
    ['gigi1234', false], // no upper
    ['GIGI1234', false], // no lower
    ['GigiSehat', false], // no digit
  ])('%s -> %s', (pw, ok) => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(isPasswordValid(pw)).toBe(ok);
  });
});

describe('Turnstile host page (backend/web/captcha)', () => {
  it('builds <origin>/captcha/?sitekey=…&action=…', () => {
    expect(captchaPageUrl('0x4AAAAAAAtestkey', 'signup')).toBe(
      `${config.turnstileBaseUrl}/captcha/?sitekey=0x4AAAAAAAtestkey&action=signup`,
    );
    expect(config.turnstileBaseUrl.endsWith('/')).toBe(false);
  });

  it('reads the token message', () => {
    expect(parseCaptchaMessage(JSON.stringify({ type: 'turnstile', token: '0.abcDEF_123-xyz' }))).toEqual({
      kind: 'token',
      token: '0.abcDEF_123-xyz',
    });
  });

  it('reads error messages, including expiry', () => {
    expect(parseCaptchaMessage('{"type":"turnstile_error","code":"expired"}')).toEqual({ kind: 'error', code: 'expired' });
    expect(parseCaptchaMessage('{"type":"turnstile_error","code":"110200"}')).toEqual({ kind: 'error', code: '110200' });
  });

  it('rejects malformed tokens and ignores anything else', () => {
    expect(parseCaptchaMessage('{"type":"turnstile","token":"<script>"}')).toEqual({ kind: 'error', code: 'bad_token' });
    expect(parseCaptchaMessage('{"type":"token","value":"0.abcdefghijk"}')).toEqual({ kind: 'ignore' });
    expect(parseCaptchaMessage('not json')).toEqual({ kind: 'ignore' });
    expect(parseCaptchaMessage('null')).toEqual({ kind: 'ignore' });
  });

  it('accepts the page fallback deep link dentisai://captcha?token=…', () => {
    expect(tokenFromCaptchaUrl('dentisai://captcha?token=0.abcdefghijk')).toBe('0.abcdefghijk');
    expect(tokenFromCaptchaUrl('dentisai://auth/callback?code=1')).toBeNull();
  });

  it('lets the WebView load only the host page and Cloudflare challenges', () => {
    const origin = 'https://app.ryhnfir.dev';
    expect(isAllowedCaptchaNavigation(`${origin}/captcha/?sitekey=x&action=login`, origin)).toBe(true);
    expect(isAllowedCaptchaNavigation('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/x', origin)).toBe(true);
    expect(isAllowedCaptchaNavigation('https://app.ryhnfir.dev.evil.example/captcha/', origin)).toBe(false);
    expect(isAllowedCaptchaNavigation(`${origin}/captchaX`, origin)).toBe(false);
    expect(isAllowedCaptchaNavigation(`${origin}/auth/callback`, origin)).toBe(false);
    expect(isAllowedCaptchaNavigation('https://example.com/', origin)).toBe(false);
  });
});

describe('error mapping for the current backend setup', () => {
  const e = id.auth.errors;

  it('tells how long to wait on the 60 s per-address email limit', () => {
    expect(
      authErrorMessage({ code: 'over_email_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 47 seconds.' }),
    ).toBe(e.emailWait(47));
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', status: 429, message: 'email rate limit exceeded' })).toBe(
      e.emailRateLimit,
    );
  });

  it('maps mailer hook failures and the built-in mailer restriction', () => {
    expect(authErrorMessage({ code: 'hook_timeout', status: 500 })).toBe(e.emailSendFailed);
    expect(authErrorMessage({ code: 'hook_timeout_after_retry', status: 500 })).toBe(e.emailSendFailed);
    expect(authErrorMessage({ code: 'email_address_not_authorized', status: 400 })).toBe(e.emailNotAuthorized);
  });

  it('reads a 5xx as "email not sent" only for requests that send email', () => {
    const serverError = { code: 'unexpected_failure', status: 500, message: 'Error sending confirmation email' };
    expect(authErrorMessage(serverError, { sendsEmail: true })).toBe(e.emailSendFailed);
    expect(authErrorMessage(serverError)).toBe(e.unknown);
  });
});

describe('auth service ↔ Supabase Auth', () => {
  it('signs up with the account type, the https callback page and the CAPTCHA token, then waits for the email', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    const result = await signUp(' Orang.Tua@Contoh.com ', 'Gigi1234', 'teen', 'captcha-token');
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'orang.tua@contoh.com',
      password: 'Gigi1234',
      options: {
        data: { account_type: 'teen' },
        emailRedirectTo: config.authRedirectUrl,
        captchaToken: 'captcha-token',
      },
    });
    expect(result).toEqual({ ok: true, needsConfirmation: true });
    expect(useSession.getState().pendingEmail).toBe('orang.tua@contoh.com');
  });

  it('sends email links to the https page by default (dentisai:// is not in the mailer allow-list)', () => {
    if (!process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL) {
      expect(config.authRedirectUrl).toBe('https://app.ryhnfir.dev/auth/callback');
    }
    expect(config.authRedirectUrl.startsWith('https://')).toBe(true);
  });

  it('does not ask for confirmation when the project auto-confirms', async () => {
    mockAuth.signUp.mockResolvedValue({ data: { user: { id: 'u1' }, session: { access_token: 'a' } }, error: null });
    await expect(signUp('a@contoh.com', 'Gigi1234', 'guardian')).resolves.toEqual({ ok: true, needsConfirmation: false });
  });

  it('reports a failed confirmation email in plain words', async () => {
    mockAuth.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'unexpected_failure', status: 500, message: 'Error sending confirmation email' },
    });
    await expect(signUp('a@contoh.com', 'Gigi1234', 'guardian')).resolves.toMatchObject({
      ok: false,
      message: id.auth.errors.emailSendFailed,
    });
  });

  it('passes the CAPTCHA token and redirect to resend and password reset', async () => {
    mockAuth.resend.mockResolvedValue({ error: null });
    mockAuth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await resendConfirmation('a@contoh.com', 't1');
    await requestPasswordReset('a@contoh.com', 't2');
    expect(mockAuth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@contoh.com',
      options: { emailRedirectTo: config.authRedirectUrl, captchaToken: 't1' },
    });
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('a@contoh.com', {
      redirectTo: config.authRedirectUrl,
      captchaToken: 't2',
    });
  });

  it('recognises a password-reset link under PKCE (no type in the URL)', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {}, redirectType: 'recovery' }, error: null });
    await expect(completeAuthCallback({ kind: 'code', code: 'c1', type: null })).resolves.toEqual({ ok: true, type: 'recovery' });
    mockAuth.exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {}, redirectType: null }, error: null });
    await expect(completeAuthCallback({ kind: 'code', code: 'c2', type: null })).resolves.toEqual({ ok: true, type: null });
  });

  it('reads my_account() after signing in; roles come from it and unknown roles are dropped', async () => {
    mockAuth.signInWithPassword.mockImplementation(async () => {
      // supabase-js fires SIGNED_IN before resolving; the store listener sets this.
      useSession.setState({ status: 'signedIn', userId: UID, email: 'a@contoh.com' });
      return { data: {}, error: null };
    });
    mockAuth.getSession.mockResolvedValue({ data: { session: { user: { id: UID } } } });
    mockRpc.mockResolvedValue({ data: myAccountJson(['guardian', 'kader', 'superuser']), error: null, status: 200 });
    await expect(signIn('a@contoh.com', 'Gigi1234', 'tok')).resolves.toEqual({ ok: true });
    expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@contoh.com',
      password: 'Gigi1234',
      options: { captchaToken: 'tok' },
    });
    expect(mockRpc).toHaveBeenCalledWith('my_account', undefined);
    // ADR 018: kader is no longer a role the app knows; only public roles survive.
    expect(useAccount.getState().me?.roles).toEqual(['guardian']);
    expect(useAccount.getState().status).toBe('ready');
  });

  it('keeps the last known account when my_account() fails (offline)', async () => {
    mockRpc.mockResolvedValueOnce({ data: myAccountJson(['guardian']), error: null, status: 200 });
    await useAccount.getState().setUser(UID);
    await useAccount.getState().refresh();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 });
    await useAccount.getState().refresh();
    expect(useAccount.getState().me?.accountType).toBe('guardian');
    expect(useAccount.getState()).toMatchObject({ status: 'ready', lastError: 'network' });
  });
});
