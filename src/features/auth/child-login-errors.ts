import { id } from '@/core/i18n/id';

const t = id.childLogin.errors;

/** Retry-After fallback (seconds) when the server gives none. */
export const DEFAULT_LOCKOUT_S = 60;
/** Upper bound so a bad header cannot lock the screen for hours. */
export const MAX_LOCKOUT_S = 15 * 60;

/** Message for a failed child sign-in. Every credential-related cause shows the same text. */
export function childLoginMessage(code: string): string {
  switch (code) {
    case 'invalid_credentials':
    case 'not_child':
    case 'invalid_body':
    case 'unauthorized':
    case 'forbidden':
      return t.invalidCredentials;
    case 'too_many_attempts':
      return t.tooManyAttempts;
    case 'upstream_unavailable':
    case 'network':
    case 'internal':
      return t.busy;
    case 'not_deployed':
      return t.notDeployed;
    default:
      return t.generic;
  }
}

export function lockoutSeconds(retryAfterS: number | undefined): number {
  if (retryAfterS === undefined || !Number.isFinite(retryAfterS) || retryAfterS <= 0) return DEFAULT_LOCKOUT_S;
  return Math.min(Math.ceil(retryAfterS), MAX_LOCKOUT_S);
}
