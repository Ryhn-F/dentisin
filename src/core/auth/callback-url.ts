// Parses the deep link Supabase sends back after email confirmation or password
// recovery: dentisai://auth/callback?code=… (PKCE) or …#access_token=…&refresh_token=…
// (implicit), or ?error=…&error_code=…&error_description=… on failure.

export type AuthLinkType = 'signup' | 'recovery' | 'email_change' | 'magiclink' | 'invite' | null;

export type AuthCallback =
  | { kind: 'code'; code: string; type: AuthLinkType }
  | { kind: 'tokens'; accessToken: string; refreshToken: string; type: AuthLinkType }
  | { kind: 'error'; code: string | null; description: string | null }
  | { kind: 'empty' };

const LINK_TYPES = new Set(['signup', 'recovery', 'email_change', 'magiclink', 'invite']);

function toParams(part: string): URLSearchParams {
  return new URLSearchParams(part.startsWith('?') || part.startsWith('#') ? part.slice(1) : part);
}

export function parseAuthCallback(url: string | null | undefined): AuthCallback {
  if (!url) return { kind: 'empty' };

  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : '';
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';

  // Fragment values win over query values (implicit flow puts everything in the hash).
  const params = toParams(query);
  toParams(hash).forEach((value, key) => params.set(key, value));

  const rawType = params.get('type');
  const type = (rawType && LINK_TYPES.has(rawType) ? rawType : null) as AuthLinkType;

  const error = params.get('error') ?? params.get('error_code');
  if (error) {
    return {
      kind: 'error',
      code: params.get('error_code') ?? params.get('error'),
      description: params.get('error_description'),
    };
  }

  const code = params.get('code');
  if (code) return { kind: 'code', code, type };

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken, type };

  return { kind: 'empty' };
}
