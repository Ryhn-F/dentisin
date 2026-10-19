import { id } from '@/core/i18n/id';

// Mirrors backend/supabase/config.toml [auth]:
//   minimum_password_length = 8 (owner decision 2026-10-10),
//   password_requirements = "lower_upper_letters_digits".
export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt (GoTrue) only uses 72 bytes; the child-accounts function refuses longer passwords. */
export const PASSWORD_MAX_BYTES = 72;

const t = id.auth.passwordRules;

const rules = [
  { key: 'length', label: t.length, test: (pw: string) => pw.length >= PASSWORD_MIN_LENGTH },
  { key: 'lower', label: t.lower, test: (pw: string) => /[a-z]/.test(pw) },
  { key: 'upper', label: t.upper, test: (pw: string) => /[A-Z]/.test(pw) },
  { key: 'digit', label: t.digit, test: (pw: string) => /[0-9]/.test(pw) },
] as const;

export type PasswordRuleKey = (typeof rules)[number]['key'];

export function checkPassword(password: string) {
  return rules.map((rule) => ({ key: rule.key, label: rule.label, met: rule.test(password) }));
}

export function isPasswordValid(password: string): boolean {
  return rules.every((rule) => rule.test(password));
}

/** UTF-8 byte length (no TextEncoder dependency). Lone surrogates count as 3 bytes (U+FFFD). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// Child passwords (set by the guardian through the child-accounts Edge Function) follow
// supabase/functions/_shared/validators.ts isStrongPassword: the same policy plus <= 72 UTF-8
// bytes and no control characters; length counts code points, not UTF-16 units.
const childRules = [
  { key: 'length', label: t.length, test: (pw: string) => [...pw].length >= PASSWORD_MIN_LENGTH },
  { key: 'lower', label: t.lower, test: (pw: string) => /[a-z]/.test(pw) },
  { key: 'upper', label: t.upper, test: (pw: string) => /[A-Z]/.test(pw) },
  { key: 'digit', label: t.digit, test: (pw: string) => /[0-9]/.test(pw) },
  { key: 'maxBytes', label: t.maxBytes, test: (pw: string) => utf8ByteLength(pw) <= PASSWORD_MAX_BYTES },
  { key: 'noControl', label: t.noControl, test: (pw: string) => !CONTROL_RE.test(pw) },
] as const;

export type ChildPasswordRuleKey = (typeof childRules)[number]['key'];

/** Rule-by-rule check for the child password form (same shape as checkPassword). */
export function checkChildPassword(password: string) {
  return childRules.map((rule) => ({ key: rule.key, label: rule.label, met: rule.test(password) }));
}

export function isChildPasswordValid(password: string): boolean {
  return childRules.every((rule) => rule.test(password));
}

// Deliberately simple: the server is the authority; this only catches typos early.
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
