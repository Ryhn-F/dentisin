// Child-account helpers (src/features/child-accounts/logic.ts): username and password form
// validation, error copy for every code in ACCOUNTS_AND_FLOWS 2.2, status labels, consent wording.
import { id } from '@/core/i18n/id';
import {
  childAccountErrorMessage,
  childAccountStatus,
  childAccountStatusLabel,
  consentCopyFor,
  consentGiverFor,
  consentTextVersionFor,
  isAuthError,
  kidLabel,
  needsWithdrawConfirmation,
  passwordRuleViews,
  usernameFieldError,
  validateCreateForm,
  validatePasswordPair,
  validateResetForm,
  visibleConsentTypes,
} from '@/features/child-accounts/logic';
import { derivePrerequisite } from '@/features/child-accounts/use-prerequisite';
import { consentTextVersions } from '@/domain/models';

const t = id.childAccounts;

describe('username field', () => {
  it('accepts the server shape and rejects the rest with a message', () => {
    expect(usernameFieldError('si.budi')).toBeNull();
    expect(usernameFieldError('  Budi_01 ')).toBeNull();
    expect(usernameFieldError('')).toBe(t.usernameErrors.empty);
    expect(usernameFieldError('ab')).toBe(t.usernameErrors.too_short);
    expect(usernameFieldError('a'.repeat(21))).toBe(t.usernameErrors.too_long);
    expect(usernameFieldError('budi kecil')).toBe(t.usernameErrors.bad_chars);
    expect(usernameFieldError('.budi')).toBe(t.usernameErrors.bad_start);
    expect(usernameFieldError('admin')).toBe(t.usernameErrors.reserved);
  });
});

describe('password rules', () => {
  it('lists the four everyday rules and only shows the rare ones once broken', () => {
    const fine = passwordRuleViews('Abcdefg1').map((r) => r.key);
    expect(fine).toEqual(['length', 'lower', 'upper', 'digit']);
    const tooLong = passwordRuleViews(`Aa1${'x'.repeat(80)}`).map((r) => r.key);
    expect(tooLong).toContain('maxBytes');
    const control = passwordRuleViews('Abcdefg1\u0007').map((r) => r.key);
    expect(control).toContain('noControl');
  });

  it('checks the pair without echoing the password', () => {
    const weak = validatePasswordPair('abc', 'abc');
    expect(weak.password).toBe(t.fieldErrors.passwordWeak);
    expect(weak.password).not.toContain('abc');
    expect(validatePasswordPair('Abcdefg1', '').confirm).toBe(t.fieldErrors.confirmEmpty);
    expect(validatePasswordPair('Abcdefg1', 'Abcdefg2').confirm).toBe(t.fieldErrors.confirmMismatch);
    expect(validatePasswordPair('Abcdefg1', 'Abcdefg1')).toEqual({ password: null, confirm: null });
  });
});

describe('create / reset forms', () => {
  it('normalizes the username and passes a valid form', () => {
    const r = validateCreateForm({ username: '  Si.Budi ', password: 'Abcdefg1', confirm: 'Abcdefg1' });
    expect(r.ok).toBe(true);
    expect(r.username).toBe('si.budi');
  });

  it('reports every problem at once', () => {
    const r = validateCreateForm({ username: 'x', password: 'abc', confirm: 'abd' });
    expect(r.ok).toBe(false);
    expect(r.errors.username).toBe(t.usernameErrors.too_short);
    expect(r.errors.password).toBe(t.fieldErrors.passwordWeak);
    expect(r.errors.confirm).toBe(t.fieldErrors.confirmMismatch);
  });

  it('validates the reset form', () => {
    expect(validateResetForm({ password: 'Abcdefg1', confirm: 'Abcdefg1' }).ok).toBe(true);
    expect(validateResetForm({ password: 'abcdefgh', confirm: 'abcdefgh' }).ok).toBe(false);
  });
});

describe('error mapping', () => {
  it('has friendly copy for every code of the 2.2 table', () => {
    const codes = [
      'child_not_found',
      'child_already_has_account',
      'child_account_limit',
      'username_taken',
      'invalid_username',
      'weak_password',
      'unauthorized',
      'forbidden',
      'not_deployed',
      'network',
    ] as const;
    for (const code of codes) {
      const message = childAccountErrorMessage(code);
      expect(message).toBe(t.errors[code]);
      expect(message).not.toBe(t.errors.generic);
    }
    expect(childAccountErrorMessage('child_not_found')).toMatch(/belum tersinkron/);
    expect(childAccountErrorMessage('not_deployed')).toMatch(/belum tersedia/);
  });

  it('falls back to the generic line for unknown codes (including prototype keys)', () => {
    expect(childAccountErrorMessage('something_new')).toBe(t.errors.generic);
    expect(childAccountErrorMessage('toString')).toBe(t.errors.generic);
  });

  it('knows which codes mean "refresh the session"', () => {
    expect(isAuthError('unauthorized')).toBe(true);
    expect(isAuthError('not_authenticated')).toBe(true);
    expect(isAuthError('forbidden')).toBe(false);
  });
});

describe('child status', () => {
  it('derives the status and chip label from a list_children row', () => {
    expect(childAccountStatus(undefined)).toBe('unknown');
    expect(childAccountStatus({ hasChildAccount: false, childAccountDisabled: null, deletionPending: false })).toBe('none');
    expect(childAccountStatus({ hasChildAccount: true, childAccountDisabled: false, deletionPending: false })).toBe('active');
    expect(childAccountStatus({ hasChildAccount: true, childAccountDisabled: true, deletionPending: false })).toBe('disabled');
    expect(childAccountStatus({ hasChildAccount: true, childAccountDisabled: false, deletionPending: true })).toBe('pending');
    expect(childAccountStatusLabel('unknown')).toBeNull();
    expect(childAccountStatusLabel('active')).toBe(t.list.chipActive);
  });

  it('gives server-only children a fallback name', () => {
    expect(kidLabel({ nickname: 'Budi' }, 0)).toBe('Budi');
    expect(kidLabel({ nickname: '  ' }, 1)).toBe(t.list.fallbackName(2));
    expect(kidLabel({ nickname: '', isSelf: true }, 0)).toBe(t.list.selfName);
  });
});

describe('prerequisite (child on the server)', () => {
  const base = { row: null, bValue: false, bSynced: false, eventState: null } as const;
  it('walks consent -> waiting -> ready', () => {
    expect(derivePrerequisite(base)).toBe('needs_consent');
    expect(derivePrerequisite({ ...base, bValue: true, eventState: 'pending' })).toBe('waiting');
    expect(derivePrerequisite({ ...base, bValue: true, eventState: 'inflight' })).toBe('waiting');
    expect(derivePrerequisite({ ...base, bValue: true, bSynced: true })).toBe('ready');
  });

  it('is ready when list_children already has the child, and rejected on a refused event', () => {
    expect(derivePrerequisite({ ...base, row: { deletionPending: false } })).toBe('ready');
    expect(derivePrerequisite({ ...base, bValue: true, eventState: 'rejected' })).toBe('rejected');
    expect(derivePrerequisite({ ...base, bValue: true, eventState: 'held' })).toBe('rejected');
  });
});

describe('consent wording', () => {
  it('uses the teen texts for the own profile and the guardian texts otherwise', () => {
    expect(consentGiverFor({ isSelf: true }, 'guardian')).toBe('teen');
    expect(consentGiverFor({ isSelf: false }, 'teen')).toBe('teen');
    expect(consentGiverFor({ isSelf: false }, 'guardian')).toBe('guardian');
    expect(consentGiverFor(undefined, null)).toBe('guardian');
  });

  it('returns the recorded text version of the draft for each giver and type', () => {
    expect(consentTextVersionFor('guardian', 'd')).toBe(consentTextVersions.guardian.d);
    expect(consentTextVersionFor('teen', 'd')).toBe(consentTextVersions.teen.d);
    expect(consentTextVersionFor('guardian', 'b')).not.toBe(consentTextVersionFor('teen', 'b'));
  });

  it('has a full text set for every type and giver', () => {
    for (const giver of ['guardian', 'teen'] as const) {
      for (const type of ['a', 'b', 'c', 'd'] as const) {
        const copy = consentCopyFor(giver, type);
        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.what.length).toBeGreaterThan(0);
        expect(copy.ifDeclined.length).toBeGreaterThan(0);
      }
    }
    // (d) must say who sees it and when it is deleted.
    expect(consentCopyFor('guardian', 'd').who).toBeTruthy();
    expect(consentCopyFor('guardian', 'd').howLong).toMatch(/7 hari/);
  });

  it('asks for confirmation when withdrawing (b) or (d) only, and hides (d) without the flag', () => {
    expect(needsWithdrawConfirmation('b')).toBe(true);
    expect(needsWithdrawConfirmation('d')).toBe(true);
    expect(needsWithdrawConfirmation('a')).toBe(false);
    expect(needsWithdrawConfirmation('c')).toBe(false);
    expect(visibleConsentTypes({ proofVideo: false })).toEqual(['a', 'b', 'c']);
    expect(visibleConsentTypes({ proofVideo: true })).toEqual(['a', 'b', 'c', 'd']);
  });
});
