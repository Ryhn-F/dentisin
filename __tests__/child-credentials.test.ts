// Child username + password rules = backend/supabase/functions/_shared/validators.ts.

import {
  checkChildUsername,
  isChildUsernameShape,
  isValidChildUsername,
  normalizeChildUsername,
  RESERVED_CHILD_USERNAMES,
  type ChildUsernameIssue,
} from '@/core/account/api';
import { PASSWORD_MAX_BYTES, checkChildPassword, isChildPasswordValid, utf8ByteLength } from '@/core/auth/validation';

describe('child username (USERNAME_RE ^[a-z0-9][a-z0-9._-]{2,19}$ + reserved words)', () => {
  const cases: [string, ChildUsernameIssue | null][] = [
    ['si.budi', null],
    ['  Si.Budi  ', null], // trimmed + lowercased like the server
    ['abc', null], // 3 = minimum
    ['a'.repeat(20), null], // 20 = maximum
    ['kakak_2', null],
    ['adik-kecil', null],
    ['007', null],
    ['', 'empty'],
    ['   ', 'empty'],
    ['ab', 'too_short'],
    ['a'.repeat(21), 'too_long'],
    ['x'.repeat(65), 'too_long'],
    ['.budi', 'bad_start'],
    ['_budi', 'bad_start'],
    ['-budi', 'bad_start'],
    ['si budi', 'bad_chars'],
    ['budi!', 'bad_chars'],
    ['büdi', 'bad_chars'], // non-ASCII refused before lowercasing
    ['Koko', 'bad_chars'], // Kelvin sign would fold to "k"
    ['admin', 'reserved'],
    ['Admin', 'reserved'],
    ['service_role', 'reserved'],
    ['kader', 'reserved'],
    ['test', 'reserved'],
  ];

  it.each(cases)('%j -> %s', (raw, issue) => {
    expect(checkChildUsername(raw)).toBe(issue);
    expect(isValidChildUsername(raw)).toBe(issue === null);
  });

  it('normalises like the server', () => {
    expect(normalizeChildUsername('  Si.Budi ')).toBe('si.budi');
  });

  it('login checks only the shape (reserved words answer uniformly on the server)', () => {
    expect(isChildUsernameShape('Admin')).toBe(true);
    expect(isChildUsernameShape('a')).toBe(false);
    expect(isChildUsernameShape('si budi')).toBe(false);
  });

  it('has the same reserved list as the edge function', () => {
    expect([...RESERVED_CHILD_USERNAMES].sort()).toEqual(
      [
        'admin', 'administrator', 'root', 'system', 'sys', 'null', 'nil', 'none', 'undefined', 'support',
        'help', 'info', 'dentisai', 'dentis', 'service', 'service_role', 'anon', 'anonymous',
        'authenticated', 'guardian', 'parent', 'child', 'teen', 'kader', 'staff', 'moderator',
        'official', 'test',
      ].sort(),
    );
  });
});

describe('child password (isStrongPassword: >= 8, lower+upper+digit, <= 72 bytes, no control chars)', () => {
  const cases: [string, boolean][] = [
    ['Gigi1234', true],
    ['Gigi123', false],
    ['gigi1234', false],
    ['GIGI1234', false],
    ['GigiSehat', false],
    ['Gigi 1234 Senyum', true], // spaces are allowed
    [`Aa1${'x'.repeat(69)}`, true], // exactly 72 bytes
    [`Aa1${'x'.repeat(70)}`, false], // 73 bytes
    [`Aa1${'é'.repeat(35)}`, false], // 3 + 70 bytes = 73
    ['Gigi1234\n', false],
    ['Gigi\u00001234', false],
    ['Gigi\u007f1234', false],
  ];

  it.each(cases)('%j -> %s', (pw, ok) => {
    expect(isChildPasswordValid(pw)).toBe(ok);
  });

  it('counts UTF-8 bytes', () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength(String.fromCodePoint(0x1f600))).toBe(4);
  });

  it('reports each rule for the form', () => {
    const rules = checkChildPassword('Gigi1234');
    expect(rules.map((r) => r.key)).toEqual(['length', 'lower', 'upper', 'digit', 'maxBytes', 'noControl']);
    expect(rules.every((r) => r.met && r.label.length > 0)).toBe(true);
  });
});
