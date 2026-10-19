// Child-account usernames: a nickname handle, unique per guardian (ADR 017 §2.2).
// Mirrors backend/supabase/functions/_shared/validators.ts (USERNAME_RE, RESERVED_USERNAMES,
// normalizeUsername, isAllowedNewUsername). The server stays the authority; this check only
// saves a round trip and lets the form explain the rule.

/** After trim + lowercase: starts with a letter/digit, then 2–19 of a-z 0-9 . _ - (3–20 total). */
export const CHILD_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,19}$/;
export const CHILD_USERNAME_MIN = 3;
export const CHILD_USERNAME_MAX = 20;

/** Handles that could be mistaken for staff/system accounts (refused on create). */
export const RESERVED_CHILD_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'sys',
  'null',
  'nil',
  'none',
  'undefined',
  'support',
  'help',
  'info',
  'dentisai',
  'dentis',
  'service',
  'service_role',
  'anon',
  'anonymous',
  'authenticated',
  'guardian',
  'parent',
  'child',
  'teen',
  'kader',
  'staff',
  'moderator',
  'official',
  'test',
]);

/** Trim + lowercase, as the server does before checking (use for display and for requests). */
export function normalizeChildUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export type ChildUsernameIssue = 'empty' | 'too_short' | 'too_long' | 'bad_chars' | 'bad_start' | 'reserved';

/**
 * Why `raw` cannot be used for a NEW child account, or null when it can. Non-ASCII input is
 * refused before lowercasing (same as the server: e.g. the Kelvin sign would fold to "k").
 */
export function checkChildUsername(raw: string): ChildUsernameIssue | null {
  if (raw.length > 64) return 'too_long';
  const trimmed = raw.trim();
  if (trimmed === '') return 'empty';
  if (!/^[\x21-\x7e]+$/.test(trimmed)) return 'bad_chars';
  const u = trimmed.toLowerCase();
  if (u.length < CHILD_USERNAME_MIN) return 'too_short';
  if (u.length > CHILD_USERNAME_MAX) return 'too_long';
  if (!/^[a-z0-9._-]+$/.test(u)) return 'bad_chars';
  if (!/^[a-z0-9]/.test(u)) return 'bad_start';
  if (!CHILD_USERNAME_RE.test(u)) return 'bad_chars';
  if (RESERVED_CHILD_USERNAMES.has(u)) return 'reserved';
  return null;
}

/** Shape AND not reserved: what a guardian may create (server isAllowedNewUsername). */
export function isValidChildUsername(raw: string): boolean {
  return checkChildUsername(raw) === null;
}

/** Shape only (login: reserved words are not re-checked, the server answers uniformly). */
export function isChildUsernameShape(raw: string): boolean {
  if (raw.length > 64) return false;
  const trimmed = raw.trim();
  return /^[\x21-\x7e]+$/.test(trimmed) && CHILD_USERNAME_RE.test(trimmed.toLowerCase());
}
