// Pure helpers for the child-account and consent screens: form validation, error copy, display
// names, consent wording per giver. No React and no network here, so everything is unit-testable.

import {
  checkChildUsername,
  normalizeChildUsername,
  type ApiErrorCode,
} from '@/core/account/api';
import { checkChildPassword, isChildPasswordValid } from '@/core/auth/validation';
import { id } from '@/core/i18n/id';
import { childDisplayName } from '@/data/local-store';
import {
  consentTextVersions,
  type AccountType,
  type ChildProfile,
  type ChildSummary,
  type ConsentGiver,
  type ConsentType,
} from '@/domain/models';

import type { ConsentCopy } from '@/components/consent-card';

const t = id.childAccounts;

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

/** Message for the username field, or null when the name can be used (same rules as the server). */
export function usernameFieldError(raw: string): string | null {
  const issue = checkChildUsername(raw);
  return issue ? t.usernameErrors[issue] : null;
}

export type PasswordRuleView = { key: string; label: string; met: boolean };

/**
 * Rule chips for the password field. The four everyday rules are always listed; the rare ones
 * (72 bytes, control characters) only appear once they are broken.
 */
export function passwordRuleViews(password: string): PasswordRuleView[] {
  return checkChildPassword(password).filter(
    (rule) => !rule.met || rule.key === 'length' || rule.key === 'lower' || rule.key === 'upper' || rule.key === 'digit',
  );
}

export type PasswordPairErrors = { password: string | null; confirm: string | null };

/** Password + confirmation. The password text itself is never echoed in a message. */
export function validatePasswordPair(password: string, confirm: string): PasswordPairErrors {
  const e = t.fieldErrors;
  return {
    password: isChildPasswordValid(password) ? null : e.passwordWeak,
    confirm: confirm === '' ? e.confirmEmpty : confirm !== password ? e.confirmMismatch : null,
  };
}

export type CreateFormErrors = PasswordPairErrors & { username: string | null };

export function validateCreateForm(input: { username: string; password: string; confirm: string }): {
  ok: boolean;
  errors: CreateFormErrors;
  /** The name as it will be sent (trimmed, lower case). */
  username: string;
} {
  const pair = validatePasswordPair(input.password, input.confirm);
  const errors: CreateFormErrors = { username: usernameFieldError(input.username), ...pair };
  return { ok: !errors.username && !errors.password && !errors.confirm, errors, username: normalizeChildUsername(input.username) };
}

export function validateResetForm(input: { password: string; confirm: string }): { ok: boolean; errors: PasswordPairErrors } {
  const errors = validatePasswordPair(input.password, input.confirm);
  return { ok: !errors.password && !errors.confirm, errors };
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

/** Friendly Indonesian copy for an API error code (unknown codes get the generic line). */
export function childAccountErrorMessage(code: ApiErrorCode | string): string {
  const table: Record<string, string> = t.errors;
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : t.errors.generic;
}

/** Codes that mean "the session token is no good": refresh once, then retry. */
export function isAuthError(code: ApiErrorCode): boolean {
  return code === 'unauthorized' || code === 'not_authenticated';
}

// ---------------------------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------------------------

/** Name to show: the local nickname, else a fallback ("Anak 2", or "Profil saya" for a teen). */
export function kidLabel(kid: Pick<ChildProfile, 'nickname' | 'isSelf'>, index: number): string {
  return childDisplayName(kid) ?? (kid.isSelf ? t.list.selfName : t.list.fallbackName(index + 1));
}

export type ChildAccountStatus = 'unknown' | 'none' | 'active' | 'disabled' | 'pending';

/** Child-account status from a list_children row (unknown while the row is not loaded). */
export function childAccountStatus(row: Pick<ChildSummary, 'hasChildAccount' | 'childAccountDisabled' | 'deletionPending'> | null | undefined): ChildAccountStatus {
  if (!row) return 'unknown';
  if (row.deletionPending) return 'pending';
  if (!row.hasChildAccount) return 'none';
  return row.childAccountDisabled ? 'disabled' : 'active';
}

export function childAccountStatusLabel(status: ChildAccountStatus): string | null {
  switch (status) {
    case 'none':
      return t.list.chipNone;
    case 'active':
      return t.list.chipActive;
    case 'disabled':
      return t.list.chipDisabled;
    case 'pending':
      return t.list.chipPending;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------------------------

/** Whose wording applies: the teen's own profile uses the teen texts, everything else the guardian's. */
export function consentGiverFor(kid: Pick<ChildProfile, 'isSelf'> | null | undefined, accountType: AccountType | null | undefined): ConsentGiver {
  return kid?.isSelf || accountType === 'teen' ? 'teen' : 'guardian';
}

export function consentCopyFor(giver: ConsentGiver, type: ConsentType): ConsentCopy {
  return id.consentsV2[giver][type];
}

/** The text version recorded with a grant (CONSENT_TEXT_DRAFT.md version list). */
export function consentTextVersionFor(giver: ConsentGiver, type: ConsentType): string {
  return consentTextVersions[giver][type];
}

/** Withdrawing these needs an explicit confirmation (data flow stops / videos vanish). */
export function needsWithdrawConfirmation(type: ConsentType): type is 'b' | 'd' {
  return type === 'b' || type === 'd';
}

/**
 * Consent cards to show, in order. (c) is always listed (shown locked while dataset_contribution is
 * off); (d) only while the server flag brushing_proof_video is on.
 */
export function visibleConsentTypes(input: { proofVideo: boolean }): ConsentType[] {
  return input.proofVideo ? ['a', 'b', 'c', 'd'] : ['a', 'b', 'c'];
}
