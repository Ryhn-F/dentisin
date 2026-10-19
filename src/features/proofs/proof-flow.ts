// Brushing proof videos: pure helpers shared by the list and the player.
// No UI here, so every rule (paging, retention text, URL freshness) is unit-testable.

import type { ApiErrorCode } from '@/core/account/api';
import type { BrushingProof } from '@/domain/models';

/** Page size of the list and of the player's lookup. */
export const PAGE_SIZE = 20;
/** The player looks for its proof in at most this many pages before it gives up. */
export const MAX_LOOKUP_PAGES = 5;

/**
 * A signed URL lives 300 s (PROOF_SIGNED_URL_TTL_S). Playback that starts or resumes later than
 * this after the URL was made gets a new one first, so a paused clip never stalls on an expired URL.
 */
export const URL_MAX_AGE_MS = 280_000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True while a signed URL made at `issuedAt` is still safe to use. */
export function isUrlFresh(issuedAt: number | null, now: number = Date.now()): boolean {
  return issuedAt !== null && now - issuedAt < URL_MAX_AGE_MS;
}

/** Whole days left until `expiresAt` (rounded up); 0 when it ends today or is already past. */
export function daysUntilExpiry(expiresAt: string, now: number = Date.now()): number {
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(end) || end <= now) return 0;
  return Math.ceil((end - now) / DAY_MS);
}

/** "2,4" (Indonesian decimal comma), at least 0,1 so a small clip never reads as 0 MB. */
export function formatMegabytes(bytes: number): string {
  const mb = Math.max(0.1, bytes / (1024 * 1024));
  return mb.toFixed(1).replace('.', ',');
}

/** Appends `page` to `current`, skipping rows that are already there (ties at the page edge). */
export function appendPage(current: readonly BrushingProof[], page: readonly BrushingProof[]): BrushingProof[] {
  const seen = new Set(current.map((p) => p.id));
  return [...current, ...page.filter((p) => !seen.has(p.id))];
}

/** Keyset cursor for the next page: `uploaded_at` of the last row (p_before is exclusive). */
export function nextCursor(items: readonly BrushingProof[]): string | undefined {
  return items.length > 0 ? items[items.length - 1].uploadedAt : undefined;
}

/** A full page means there may be more; a short page is the end of the list. */
export function mayHaveMore(page: readonly BrushingProof[], limit: number = PAGE_SIZE): boolean {
  return page.length >= limit;
}

/** Which friendly state a failed list call gets (see id.proofs.list.errors). */
export type ProofErrorKind = 'notDeployed' | 'forbidden' | 'network' | 'notAuthenticated' | 'other';

export function proofErrorKind(code: ApiErrorCode): ProofErrorKind {
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

/** Which friendly state a failed playback call gets (see id.proofs.player.errors). */
export type PlayErrorKind = 'gone' | 'forbidden' | 'network' | 'other';

export function playErrorKind(code: ApiErrorCode): PlayErrorKind {
  switch (code) {
    case 'not_found':
    case 'not_deployed':
      return 'gone';
    case 'forbidden':
    case 'not_authenticated':
      return 'forbidden';
    case 'network':
      return 'network';
    default:
      return 'other';
  }
}

/**
 * Labels for children the local store has no nickname for (the server never stores names):
 * unnamed children are numbered in order of appearance, so two siblings stay distinguishable.
 */
export function childLabeler(
  kids: readonly { id: string; nickname: string; isSelf?: boolean }[],
  fallback: (n: number) => string,
  selfLabel: string,
): (childId: string) => string {
  const unnamed = kids.filter((k) => !k.nickname.trim() && !k.isSelf).map((k) => k.id);
  return (childId) => {
    const kid = kids.find((k) => k.id === childId);
    const nick = kid?.nickname.trim();
    if (nick) return nick;
    if (kid?.isSelf) return selfLabel;
    const at = unnamed.indexOf(childId);
    return fallback(unnamed.length <= 1 || at < 0 ? 1 : at + 1);
  };
}
