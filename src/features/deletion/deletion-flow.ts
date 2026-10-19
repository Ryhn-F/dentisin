// Guardian / teen data deletion (SUPABASE_API.md §3.2, ACCOUNTS_AND_FLOWS.md §1, §9).
//
// requestChildDeletion: request_deletion('child') for one own child (guardian) or the teen's
//   self profile; then this phone's copy goes: the child's proof uploads and clips, its queued
//   sync events, and its local records (forgetChild leaves a deletion_pending marker, so the
//   bridge never syncs it and list_children never merges it back while the server works). A
//   child the server does not know (never synced: the RPC answers forbidden and list_children
//   does not list it) is deleted on this phone only.
// requestAccountDeletion: request_deletion('account'); then every store of the user on this
//   phone (local data, outbox, proof uploads, history cache, a guardian's remembered parent
//   email for the child login screen), then sign-out with a notice for the welcome screen.
// Local data goes only after the server accepted the request: a failed request changes
// nothing. Child accounts never delete (the RPC answers forbidden; the screens refuse first).
// Privacy: never logs.

import { useAccount } from '@/core/account/account-store';
import { listChildren, requestDeletion, type ApiErrorCode, type ApiFailure, type ApiResult } from '@/core/account/api';
import { forgetParentEmail, getRememberedParentEmail } from '@/core/auth/auth-service';
import { useSession } from '@/core/auth/session-store';
import { normalizeEmail } from '@/core/auth/validation';
import { id } from '@/core/i18n/id';
import { outbox } from '@/core/sync/outbox';
import { useLocalData } from '@/data/local-store';
import type { ChildProfile, ChildSummary, MyAccount } from '@/domain/models';
import { proofUploads } from '@/features/brushing/proof-uploads';
import { withSessionRetry } from '@/features/child-accounts/session-retry';
import { clearHistoryCache } from '@/features/history/history-model';

import { useDeletionNotice } from './notice';

const t = id.deletion;

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** child = a guardian's child, self = the teen's own profile, account = the whole account. */
export type DeletionKind = 'child' | 'self' | 'account';

/** Who may delete: guardian and teen accounts (ACCOUNTS_AND_FLOWS.md §1); never child accounts. */
export function canRequestDeletion(me: Pick<MyAccount, 'accountType'> | null | undefined): boolean {
  return me?.accountType === 'guardian' || me?.accountType === 'teen';
}

/** The teen's self profile id: from my_account(), else the local self profile. */
export function selfProfileId(
  me: Pick<MyAccount, 'accountType' | 'selfChildId'> | null | undefined,
  kids: readonly Pick<ChildProfile, 'id' | 'isSelf'>[],
): string | null {
  if (me?.accountType !== 'teen') return null;
  return me.selfChildId ?? kids.find((k) => k.isSelf === true)?.id ?? null;
}

/** The server (list_children) or this phone (a rejected event) says the deletion is pending. */
export function isDeletionPending(
  childId: string,
  row: Pick<ChildSummary, 'deletionPending'> | null | undefined,
  syncBlocked: Readonly<Record<string, string | undefined>>,
): boolean {
  return row?.deletionPending === true || syncBlocked[childId] === 'deletion_pending';
}

/** Server rows of children with a pending deletion that are not on this phone (any more). */
export function pendingElsewhere(rows: readonly Pick<ChildSummary, 'childId' | 'deletionPending'>[], localIds: readonly string[]): number {
  const known = new Set(localIds);
  return rows.filter((r) => r.deletionPending && !known.has(r.childId)).length;
}

/** Friendly copy for a request_deletion failure. */
export function deletionErrorMessage(code: ApiErrorCode | string): string {
  const table: Record<string, string> = t.errors;
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : t.errors.generic;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const forbidden: ApiFailure = { ok: false, code: 'forbidden' };

export type ChildDeletionResult =
  | {
      ok: true;
      /** deletion_request id; null when the child was never on the server (phone only). */
      requestId: string | null;
    }
  | ApiFailure;

/** True only when list_children answers and does not contain the child. */
async function unknownToServer(childId: string): Promise<boolean> {
  const rows = await withSessionRetry(listChildren);
  return rows.ok && !rows.data.some((r) => r.childId.toLowerCase() === childId.toLowerCase());
}

async function quietly(run: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await run();
  } catch {
    // One store failing must not keep the others (or the sign-out) from running.
  }
}

/** Removes one child from this phone after its deletion was requested (or it was phone-only). */
export function forgetChildOnDevice(childId: string, me: MyAccount): void {
  proofUploads.deleteChildData(childId);
  outbox.purgeChild(childId);
  useLocalData.getState().forgetChild(childId);
  // A teen keeps an empty self profile while my_account() still names it (the home expects one);
  // the deletion_pending marker keeps it out of sync, and it goes when the server is done.
  if (me.accountType === 'teen') useLocalData.getState().applyAccount(me);
  clearHistoryCache();
}

/**
 * request_deletion('child') for a guardian's child or the teen's self profile, then removes it
 * from this phone. Failures leave everything as it was.
 */
export async function requestChildDeletion(childId: string): Promise<ChildDeletionResult> {
  const me = useAccount.getState().me;
  if (!me || !canRequestDeletion(me)) return forbidden;
  if (me.accountType === 'teen' && childId !== selfProfileId(me, useLocalData.getState().kids)) return forbidden;
  const res = await withSessionRetry(() => requestDeletion({ scope: 'child', childId }));
  let requestId: string | null;
  if (res.ok) requestId = res.data;
  else if (res.code === 'forbidden' && (await unknownToServer(childId))) requestId = null;
  else return res;
  forgetChildOnDevice(childId, me);
  return { ok: true, requestId };
}

/** Removes every store of `userId` from this phone (account deletion). */
export async function clearAccountOnDevice(userId: string, me: MyAccount, email: string | null): Promise<void> {
  await quietly(() => useLocalData.getState().deleteScopeData(userId));
  await quietly(() => outbox.deleteScopeData(userId));
  await quietly(() => proofUploads.deleteScopeData(userId));
  clearHistoryCache();
  if (me.accountType === 'guardian' && email) {
    // The child login screen remembers the parent email; this account no longer exists.
    await quietly(async () => {
      if ((await getRememberedParentEmail()) === normalizeEmail(email)) await forgetParentEmail();
    });
  }
}

/**
 * request_deletion('account'), then this phone's data of the account, then sign-out (the
 * welcome screen shows the notice). Failures leave everything as it was.
 */
export async function requestAccountDeletion(): Promise<ApiResult<string>> {
  const { userId, email } = useSession.getState();
  const me = useAccount.getState().me;
  if (!userId || !me || me.userId !== userId || !canRequestDeletion(me)) return forbidden;
  const res = await withSessionRetry(() => requestDeletion({ scope: 'account' }));
  if (!res.ok) return res;
  await clearAccountOnDevice(userId, me, email);
  useDeletionNotice.getState().show();
  await useSession.getState().signOut();
  return res;
}
