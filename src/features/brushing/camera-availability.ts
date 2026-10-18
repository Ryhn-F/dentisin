// Who may record a brushing proof video, and for whom (ACCOUNTS_AND_FLOWS.md §1, §2.4, §2.8;
// SYNC_EVENTS.md §3.8). Pure: the session screen feeds it the session, my_account(), the local
// consents and the camera permission, and offers the camera switch only when it says so.
// Anything else falls back to timer mode: the camera never blocks brushing or the streak.
//
// Rules:
// - signed in (not guest), my_account() loaded for this user, not a legacy (pre-ADR 017) backend;
// - account child or teen, flag brushing_proof_video on, capabilities.registerProofs (guardians
//   never record, ADR 018);
// - child: child_account.proof_allowed (flag + parent's consents b and d + not disabled) and
//   sync allowed; the video is for the parent (owner = the parent's user id);
// - teen: its self profile, with LOCAL consents (b) and (d) granted by the teen; the video is for
//   the teen alone (owner = the teen's user id);
// - fewer than limits.proofMaxPerChildPerDay clips today (WIB) for that child on this phone (the
//   server stays the final judge: it answers limit_exceeded);
// - camera permission not permanently denied, and the camera did not fail on this phone.

import { DEFAULT_LIMITS, type ChildProfile, type MyAccount } from '@/domain/models';

export type ProofAudience = 'parent' | 'self';

/** Camera permission as the screen knows it: null = not asked / not loaded yet. */
export type CameraPermissionInfo = { granted: boolean; canAskAgain: boolean } | null;

export type CameraUnavailableReason =
  | 'unsupported_platform'
  | 'not_signed_in'
  | 'account_unknown'
  | 'legacy_backend'
  | 'guardian'
  | 'no_capability'
  | 'proof_not_allowed'
  | 'sync_off'
  | 'no_self_profile'
  | 'no_consent'
  /** The child already has the day's maximum of proof clips (limits.proofMaxPerChildPerDay). */
  | 'daily_limit'
  | 'permission_denied'
  | 'camera_error';

export type CameraAvailability =
  | {
      available: true;
      /** child_id the brushing session and its proof belong to (as stored locally). */
      childId: string;
      /** First segment of the storage path: the parent (child account) or the teen. Lower case. */
      ownerId: string;
      audience: ProofAudience;
      /** The system permission prompt is still needed before recording. */
      needsPermission: boolean;
    }
  | {
      available: false;
      reason: CameraUnavailableReason;
      /** daily_limit only: the limit that was reached (for the note). */
      limit?: number;
    };

export type CameraAvailabilityInput = {
  platform: string;
  sessionStatus: 'loading' | 'signedOut' | 'signedIn' | 'guest';
  userId: string | null;
  me: MyAccount | null;
  /** Local children (to find a teen's self profile before my_account() knows it). */
  kids: readonly Pick<ChildProfile, 'id' | 'isSelf'>[];
  /** Local consent values per child (useLocalData().consents). */
  consents: Readonly<Record<string, { b: boolean; d: boolean } | undefined>>;
  /** Children the server takes no more data for (deletion pending). */
  syncBlocked: Readonly<Record<string, string | undefined>>;
  permission: CameraPermissionInfo;
  /** Proof clips already recorded today (WIB) per child_id (proofCountsToday()). Missing = none. */
  proofsToday?: Readonly<Record<string, number | undefined>>;
  /** The camera failed to start or record earlier in this session. */
  cameraFailed: boolean;
};

const RECORDING_PLATFORMS: ReadonlySet<string> = new Set(['android', 'ios']);

function no(reason: CameraUnavailableReason): CameraAvailability {
  return { available: false, reason };
}

export function cameraAvailability(input: CameraAvailabilityInput): CameraAvailability {
  // expo-camera records only on native; the web build is a design preview.
  if (!RECORDING_PLATFORMS.has(input.platform)) return no('unsupported_platform');
  if (input.sessionStatus !== 'signedIn' || !input.userId) return no('not_signed_in');
  const me = input.me;
  if (!me || me.userId !== input.userId) return no('account_unknown');
  if (me.legacy) return no('legacy_backend');
  if (me.accountType === 'guardian') return no('guardian');
  // Feature flag off: nothing anyone can do in the app.
  if (!me.flags.brushingProofVideo) return no('no_capability');

  let target: { childId: string; ownerId: string; audience: ProofAudience };
  if (me.accountType === 'child') {
    const account = me.childAccount;
    if (!account) return no('account_unknown');
    // Flag on but not allowed: the parent has not granted consents (b) + (d) (or disabled the account).
    if (account.proofAllowed !== true || account.disabled) return no('proof_not_allowed');
    if (!me.capabilities.registerProofs) return no('no_capability');
    if (account.syncAllowed === false) return no('sync_off');
    target = { childId: account.childId, ownerId: account.guardianId, audience: 'parent' };
  } else {
    if (!me.capabilities.registerProofs) return no('no_capability');
    const selfId = me.selfChildId ?? input.kids.find((k) => k.isSelf === true)?.id ?? null;
    if (!selfId) return no('no_self_profile');
    if (input.syncBlocked[selfId]) return no('sync_off');
    const consent = input.consents[selfId];
    if (!consent?.b || !consent.d) return no('no_consent');
    target = { childId: selfId, ownerId: me.userId, audience: 'self' };
  }

  const limit = me.limits?.proofMaxPerChildPerDay ?? DEFAULT_LIMITS.proofMaxPerChildPerDay;
  if ((input.proofsToday?.[target.childId] ?? 0) >= limit) return { available: false, reason: 'daily_limit', limit };
  if (input.cameraFailed) return no('camera_error');
  const permission = input.permission;
  if (permission && !permission.granted && !permission.canAskAgain) return no('permission_denied');
  return {
    available: true,
    childId: target.childId,
    ownerId: target.ownerId.toLowerCase(),
    audience: target.audience,
    needsPermission: !permission?.granted,
  };
}
