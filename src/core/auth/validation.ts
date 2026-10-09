import { id } from '@/core/i18n/id';

// Mirrors backend/supabase/config.toml:
//   minimum_password_length = 10, password_requirements = "lower_upper_letters_digits".
export const PASSWORD_MIN_LENGTH = 10;

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

// Deliberately simple: the server is the authority; this only catches typos early.
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
