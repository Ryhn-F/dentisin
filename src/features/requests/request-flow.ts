// Screening requests: pure helpers shared by the child flow and the guardian list.
// No UI here, so every rule (red flags, outcome mapping, expiry text) is unit-testable.

import type { ApiErrorCode } from '@/core/account/api';
import { useAccount } from '@/core/account/account-store';
import { recordScreeningRequest } from '@/core/sync/bridge';
import { outbox, type WaitResult } from '@/core/sync/outbox';
import type { IconName } from '@/components/icon';
import type { IconTileTone } from '@/components/icon-tile';
import type { RequestReason, RequestStatus } from '@/domain/models';
import { triageParams } from '@/domain/triage';

// ---------------------------------------------------------------------------------------------
// Reasons and red flags
// ---------------------------------------------------------------------------------------------

/** Picture for each reason code (child buttons and guardian cards). */
export const reasonLook: Record<RequestReason, { icon: IconName; tone: IconTileTone }> = {
  toothache: { icon: 'sentiment-very-dissatisfied', tone: 'coral' },
  sensitive_teeth: { icon: 'ac-unit', tone: 'blue' },
  bleeding_gums: { icon: 'water-drop', tone: 'danger' },
  swelling: { icon: 'warning-amber', tone: 'sun' },
  other: { icon: 'help-outline', tone: 'lavender' },
};

/** Red-flag questions of step 3, in the order they are asked. */
export const redFlagIds = ['swelling', 'fever', 'pus', 'trauma'] as const;
export type RedFlagId = (typeof redFlagIds)[number];

/** Picture for each red-flag question. */
export const redFlagIcons: Record<RedFlagId, IconName> = {
  swelling: 'face',
  fever: 'thermostat',
  pus: 'opacity',
  trauma: 'sports-handball',
};

export type RedFlagAnswers = Partial<Record<RedFlagId, boolean>>;

/** A swelling reason already is the "bengkak" red flag, whatever step 3 says. */
export function isRedFlagReason(reason: RequestReason | null): boolean {
  return reason === 'swelling';
}

/**
 * Red flags always win (CLAUDE.md §2.4): any "yes" answer, or the swelling reason itself,
 * means the child sees the local "tell your parents now" advice before anything else.
 * The answers never leave the phone: the server only receives reason_code + pain_level
 * (SYNC_EVENTS.md §3.7), and it judges nothing from them.
 */
export function hasRedFlag(reason: RequestReason | null, answers: RedFlagAnswers): boolean {
  return isRedFlagReason(reason) || redFlagIds.some((flag) => answers[flag] === true);
}

/**
 * Pain score (0-10) from which the pain counts as "nyeri hebat": the bundled triage rules'
 * pain_urgent_min_score (rule PAIN_HIGH -> level urgent), never a number of our own. While the
 * dentist has not set it, the rules give its cautious `if_unset` value.
 */
export const PAIN_URGENT_MIN_SCORE: number = Number(triageParams.pain_urgent_min_score);

/** "Tidak tahu" (null / 'unknown') is never severe; a score at or above the rules' threshold is. */
export function isSeverePain(pain: number | 'unknown' | null | undefined, minScore: number = PAIN_URGENT_MIN_SCORE): boolean {
  return typeof pain === 'number' && pain >= minScore;
}

/**
 * Whether the child sees the local "Beri tahu orang tua sekarang" advice at once, before the
 * server answers (ACCOUNTS_AND_FLOWS.md §10 'Anak': nyeri hebat / bengkak; CLAUDE.md §2.4):
 * any red flag, or severe pain.
 */
export function needsLocalAdvice(reason: RequestReason | null, answers: RedFlagAnswers, pain: number | 'unknown' | null): boolean {
  return hasRedFlag(reason, answers) || isSeverePain(pain);
}

/** Guardian card: why a request is marked "Segera" (swelling first), or null. */
export function requestUrgency(reason: RequestReason, painLevel: number | null): 'swelling' | 'pain' | null {
  if (isRedFlagReason(reason)) return 'swelling';
  return isSeverePain(painLevel) ? 'pain' : null;
}

/** Step 3 asks every question but "bengkak" when the child already picked the swelling reason. */
export function visibleRedFlags(reason: RequestReason | null): readonly RedFlagId[] {
  return isRedFlagReason(reason) ? redFlagIds.filter((flag) => flag !== 'swelling') : redFlagIds;
}

/** PainScale value ('unknown' | 0..10) to the server value: "tidak tahu" is null, never 0. */
export function painToLevel(pain: number | 'unknown' | null): number | null {
  return typeof pain === 'number' ? pain : null;
}

// ---------------------------------------------------------------------------------------------
// Sending and tracking
// ---------------------------------------------------------------------------------------------

/** What the child is told about the request. */
export type RequestOutcome =
  | 'sending'
  | 'sent'
  | 'queued'
  | 'limit'
  | 'consent'
  | 'syncOff'
  | 'failed';

/** First wait before the status turns into "akan terkirim saat ada internet". */
export const FIRST_WAIT_MS = 6000;
/** Later waits while the event stays queued and the screen is open. */
export const LATER_WAIT_MS = 120_000;

/** Outbox result to the child-facing outcome. `timeout` means: still queued (offline or slow). */
export function outcomeFromWait(result: WaitResult): RequestOutcome {
  switch (result.state) {
    case 'applied':
      return 'sent';
    case 'timeout':
      return 'queued';
    case 'rejected':
      if (result.code === 'limit_exceeded') return 'limit';
      if (result.code === 'consent_required') return 'consent';
      return 'failed';
    case 'held':
    case 'unknown':
      return 'failed';
  }
}

/**
 * Why the bridge refused to queue anything: the parent has not allowed the account to send
 * (sync_allowed = false), or the account is not loaded / not a child account.
 */
export function outcomeWhenNotQueued(): RequestOutcome {
  const child = useAccount.getState().me?.childAccount;
  return child && child.syncAllowed === false ? 'syncOff' : 'failed';
}

export type SendInput = { childId: string; reason: RequestReason; painLevel: number | null };

/**
 * Queues the request through the bridge and reports progress to `onOutcome` until it is applied,
 * rejected or the caller cancels. Returns the cancel function. Offline requests stay queued in
 * the outbox, so they still go out when the child leaves the screen.
 * Never logs: no reason, pain level, child id or event id is written anywhere.
 */
export function sendRequest(input: SendInput, onOutcome: (outcome: RequestOutcome) => void): () => void {
  let cancelled = false;
  const eventId = recordScreeningRequest({
    childId: input.childId,
    reasonCode: input.reason,
    painLevel: input.painLevel,
  });
  if (!eventId) {
    onOutcome(outcomeWhenNotQueued());
    return () => {};
  }
  onOutcome('sending');
  // Nudge the outbox now instead of waiting for its debounce; failures fall back to its backoff.
  void outbox.flush().catch(() => undefined);

  void (async () => {
    let wait = FIRST_WAIT_MS;
    while (!cancelled) {
      const result = await outbox.waitForEvent(eventId, wait);
      if (cancelled) return;
      const outcome = outcomeFromWait(result);
      onOutcome(outcome);
      if (outcome !== 'queued') {
        // A refused request is final (a retry needs a new event id): do not leave it in the
        // outbox's "needs attention" list, the child was told and can ask again.
        if (result.state === 'rejected' || result.state === 'held') outbox.dismiss(eventId);
        return;
      }
      wait = LATER_WAIT_MS;
    }
  })().catch(() => {
    if (!cancelled) onOutcome('queued');
  });

  return () => {
    cancelled = true;
  };
}

// ---------------------------------------------------------------------------------------------
// Guardian list helpers
// ---------------------------------------------------------------------------------------------

export const openStatuses: readonly RequestStatus[] = ['pending', 'seen'];
export const closedStatuses: readonly RequestStatus[] = ['done', 'cancelled', 'expired'];

export function isOpenStatus(status: RequestStatus): boolean {
  return status === 'pending' || status === 'seen';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left until `expiresAt` (rounded up); 0 when it ends today or is already past. */
export function daysUntilExpiry(expiresAt: string, now: number = Date.now()): number {
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end) || end <= now) return 0;
  return Math.ceil((end - now) / DAY_MS);
}

/** Groups items by child id, keeping the order of first appearance. */
export function groupByChild<T extends { childId: string }>(items: readonly T[]): { childId: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(item.childId);
    if (list) list.push(item);
    else groups.set(item.childId, [item]);
  }
  return [...groups.entries()].map(([childId, list]) => ({ childId, items: list }));
}

/** Which friendly state a failed list call gets (see id.requests.list.errors). */
export type ListErrorKind = 'notDeployed' | 'forbidden' | 'network' | 'notAuthenticated' | 'other';

export function listErrorKind(code: ApiErrorCode): ListErrorKind {
  switch (code) {
    case 'not_deployed':
      return 'notDeployed';
    case 'forbidden':
      return 'forbidden';
    case 'network':
      return 'network';
    case 'not_authenticated':
      return 'notAuthenticated';
    default:
      return 'other';
  }
}

/**
 * Labels for children the local store has no nickname for (the server never stores names):
 * unnamed children are numbered in order of appearance, so two siblings stay distinguishable.
 */
export function childLabeler(
  kids: readonly { id: string; nickname: string }[],
  childIds: readonly string[],
  fallback: (n: number) => string,
): (childId: string) => string {
  const unnamed: string[] = [];
  for (const childId of childIds) {
    const nick = kids.find((k) => k.id === childId)?.nickname?.trim();
    if (!nick && !unnamed.includes(childId)) unnamed.push(childId);
  }
  const single = unnamed.length <= 1;
  return (childId) => {
    const nick = kids.find((k) => k.id === childId)?.nickname?.trim();
    if (nick) return nick;
    return fallback(single ? 1 : unnamed.indexOf(childId) + 1);
  };
}
