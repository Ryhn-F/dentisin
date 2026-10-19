// Pure helpers of the child-account home (ADR 017, ACCOUNTS_AND_FLOWS.md §2.4-2.5, §10).
// The child sees only its own requests and their status: never a result, level or referral.
import type { IconName } from '@/components/icon';
import { id } from '@/core/i18n/id';
import type { MyAccount, RequestStatus, ScreeningRequest } from '@/domain/models';
import { formatDateTime } from '@/ui/format';

const t = id.kid.requests;

/** What the kid home needs from my_account(); null when this is not a child account. */
export type KidAccountView = {
  childId: string;
  username: string;
  /** Proof video allowed (flag + consents b and d + not disabled). */
  proofAllowed: boolean;
  /** false: the guardian must (re)enable the account or consent (b); nothing is sent. */
  syncAllowed: boolean;
};

export function kidAccountView(me: MyAccount | null): KidAccountView | null {
  const acc = me?.accountType === 'child' ? me.childAccount : null;
  if (!acc) return null;
  return {
    childId: acc.childId,
    username: acc.username,
    proofAllowed: acc.proofAllowed === true,
    syncAllowed: acc.syncAllowed !== false,
  };
}

/** Pending or seen: the guardian has not answered yet. */
export function isOpenRequest(r: Pick<ScreeningRequest, 'status'>): boolean {
  return r.status === 'pending' || r.status === 'seen';
}

/**
 * Red flag (ACCOUNTS_AND_FLOWS.md §2.5): an open "swelling" request keeps the local
 * "tell your parent now / go to the puskesmas" advice on the kid home.
 */
export function hasOpenSwelling(items: readonly ScreeningRequest[]): boolean {
  return items.some((r) => r.reasonCode === 'swelling' && isOpenRequest(r));
}

export const requestStatusIcon: Record<RequestStatus, IconName> = {
  pending: 'schedule',
  seen: 'visibility',
  done: 'check-circle',
  cancelled: 'do-not-disturb-on',
  expired: 'history',
};

/** One "Permintaanmu" row: reason + status (+ when it was sent). Status only, no result. */
export function kidRequestRow(r: ScreeningRequest): { title: string; subtitle: string; label: string; icon: IconName } {
  const title = t.reasons[r.reasonCode];
  const status = t.statuses[r.status];
  const date = formatDateTime(r.createdAt);
  return { title, subtitle: `${status} ${date}`, label: t.rowLabel(title, status, date), icon: requestStatusIcon[r.status] };
}
