import { parseAuthCallback } from '@/core/auth/callback-url';
import { authErrorCode, authErrorMessage } from '@/core/auth/errors';
import { createChunkedStorage, safeKey, type KeyValueBackend } from '@/core/auth/secure-storage';
import { checkPassword, isEmail, isPasswordValid, normalizeEmail } from '@/core/auth/validation';
import { id } from '@/core/i18n/id';

describe('password rules (mirror backend config.toml)', () => {
  it.each([
    ['Gigisehat2026', true],
    ['gigisehat2026', false], // no upper
    ['GIGISEHAT2026', false], // no lower
    ['GigiSehatAnak', false], // no digit
    ['Gigi123', false], // 7 chars
    ['Gigi1234', true], // exactly 8 (backend minimum_password_length = 8)
  ])('%s -> %s', (pw, ok) => {
    expect(isPasswordValid(pw)).toBe(ok);
  });

  it('reports each rule separately for the live checklist', () => {
    expect(checkPassword('abc').map((r) => [r.key, r.met])).toEqual([
      ['length', false],
      ['lower', true],
      ['upper', false],
      ['digit', false],
    ]);
  });
});

describe('email helpers', () => {
  it.each([
    ['orang.tua@contoh.co.id', true],
    [' nama@contoh.com ', true],
    ['nama@contoh', false],
    ['nama contoh@x.com', false],
    ['', false],
  ])('isEmail(%j) -> %s', (value, ok) => {
    expect(isEmail(value)).toBe(ok);
  });

  it('normalizes case and whitespace', () => {
    expect(normalizeEmail('  Nama@Contoh.COM ')).toBe('nama@contoh.com');
  });
});

describe('parseAuthCallback', () => {
  it('reads a PKCE code from the query', () => {
    expect(parseAuthCallback('dentisai://auth/callback?code=abc-123')).toEqual({ kind: 'code', code: 'abc-123', type: null });
  });

  it('reads implicit-flow tokens and type from the fragment', () => {
    expect(
      parseAuthCallback('dentisai://auth/callback#access_token=AT&refresh_token=RT&type=recovery&expires_in=3600'),
    ).toEqual({ kind: 'tokens', accessToken: 'AT', refreshToken: 'RT', type: 'recovery' });
  });

  it('reports server errors without exposing tokens', () => {
    expect(
      parseAuthCallback('dentisai://auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid'),
    ).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid' });
  });

  it('ignores unknown link types', () => {
    expect(parseAuthCallback('x?code=c&type=evil')).toEqual({ kind: 'code', code: 'c', type: null });
  });

  it.each([null, undefined, '', 'dentisai://auth/callback', 'dentisai://auth/callback?access_token=only'])(
    'empty for %j',
    (url) => {
      expect(parseAuthCallback(url)).toEqual({ kind: 'empty' });
    },
  );
});

describe('authErrorMessage', () => {
  it('maps known Supabase codes to Indonesian text', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', status: 400 })).toBe(id.auth.errors.invalidCredentials);
    expect(authErrorMessage({ code: 'captcha_failed' })).toBe(id.auth.errors.captcha);
    expect(authErrorMessage({ code: 'over_email_send_rate_limit' })).toBe(id.auth.errors.emailRateLimit);
  });

  it('does not reveal whether an email is registered', () => {
    expect(authErrorMessage({ code: 'user_already_exists' })).toBe(id.auth.errors.genericSignup);
    expect(authErrorMessage({ code: 'email_exists' })).toBe(id.auth.errors.genericSignup);
  });

  it('treats fetch failures as offline', () => {
    expect(authErrorMessage({ name: 'AuthRetryableFetchError', status: 0 })).toBe(id.auth.errors.network);
    expect(authErrorMessage(new TypeError('Network request failed'))).toBe(id.auth.errors.network);
  });

  it('never echoes raw server text', () => {
    expect(authErrorMessage({ code: 'some_new_code', message: 'Database error saving new user' })).toBe(
      id.auth.errors.unknown,
    );
    expect(authErrorMessage(null)).toBe(id.auth.errors.unknown);
  });

  it('extracts the code when present', () => {
    expect(authErrorCode({ code: 'email_not_confirmed' })).toBe('email_not_confirmed');
    expect(authErrorCode('oops')).toBeNull();
  });
});

describe('chunked secure storage', () => {
  function memory(): KeyValueBackend & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: async (k) => map.get(k) ?? null,
      setItem: async (k, v) => void map.set(k, v),
      removeItem: async (k) => void map.delete(k),
    };
  }

  it('round-trips values larger than one SecureStore entry', async () => {
    const backend = memory();
    const storage = createChunkedStorage(backend);
    const big = 'x'.repeat(5000);
    await storage.setItem('dentisai.auth', big);
    expect(await storage.getItem('dentisai.auth')).toBe(big);
    expect([...backend.map.keys()].every((k) => /^[A-Za-z0-9._-]+$/.test(k))).toBe(true);
  });

  it('removes all chunks and shrinks cleanly', async () => {
    const backend = memory();
    const storage = createChunkedStorage(backend);
    await storage.setItem('k', 'y'.repeat(4000));
    await storage.setItem('k', 'short');
    expect(await storage.getItem('k')).toBe('short');
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
    expect(backend.map.size).toBe(0);
  });

  it('treats a partially written value as missing', async () => {
    const backend = memory();
    const storage = createChunkedStorage(backend);
    await storage.setItem('k', 'z'.repeat(4000));
    await backend.removeItem('k.1');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('sanitizes keys for SecureStore', () => {
    expect(safeKey('sb-abc:auth token')).toBe('sb-abc_auth_token');
  });
});
