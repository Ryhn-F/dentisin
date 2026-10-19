// Pure helpers of the guardian / teen home (ACCOUNTS_AND_FLOWS.md §4): display names with a
// fallback for children that have no local nickname, and the banners derived from
// list_children() rows. No React, no I/O: unit-tested in __tests__/homes-banners.test.ts.
import { id } from '@/core/i18n/id';
import { childDisplayName } from '@/data/local-store';
import type { AccountType, ChildProfile, ChildSummary } from '@/domain/models';

const t = id.homeV2;

/** A child as the home shows it: the local nickname, or "Anak N" when there is none. */
export type HomeChild = { id: string; label: string; named: boolean };

/**
 * Display labels for the local children, in their order. Children without a nickname (added
 * on another device, or merged from list_children) are numbered among themselves: "Anak 1",
 * "Anak 2" ... so the labels stay stable while named children are added.
 */
export function homeChildren(kids: readonly Pick<ChildProfile, 'id' | 'nickname'>[]): HomeChild[] {
  let unnamed = 0;
  return kids.map((kid) => {
    const name = childDisplayName(kid);
    if (name) return { id: kid.id, label: name, named: true };
    unnamed += 1;
    return { id: kid.id, label: t.fallbackName(unnamed), named: false };
  });
}

/** Label of one child id; "Anak" when the child is not known locally (yet). */
export function labelOf(children: readonly HomeChild[], childId: string): string {
  return children.find((c) => c.id === childId)?.label ?? t.fallbackNameUnknown;
}

/** "Budi", "Budi dan Sari", "Budi, Sari dan Ani". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${t.and} ${names[names.length - 1]}`;
}

export type HomeBanner =
  | { kind: 'requests'; childIds: string[]; names: string }
  | { kind: 'proofs'; childId: string; count: number; name: string }
  | { kind: 'deletion'; childIds: string[]; names: string; self: boolean }
  | { kind: 'unnamed'; count: number };

/** Stable React key of a banner. */
export function bannerKey(b: HomeBanner): string {
  return b.kind === 'proofs' ? `proofs:${b.childId}` : b.kind;
}

/**
 * Banners for the home, most important first:
 * 1. requests: children with unseen screening requests (guardian only; teens never receive
 *    requests) -> /requests;
 * 2. proofs: one per child with unviewed proof videos (guardian only; the teen home has its
 *    own "Video sikat gigiku" row) -> /proofs?child=<id>;
 * 3. deletion: children whose deletion is pending (info, nothing is sent any more);
 * 4. unnamed: local children without a nickname (guardian only) -> Profil.
 * Rows of children that are not on this device are still named ("Anak") so a badge is never
 * hidden; the merge adds them locally on the same poll.
 */
export function deriveHomeBanners(input: {
  accountType: AccountType | null;
  rows: readonly ChildSummary[];
  children: readonly HomeChild[];
}): HomeBanner[] {
  const { accountType, rows, children } = input;
  if (accountType === 'child') return [];
  const guardian = accountType !== 'teen';
  const out: HomeBanner[] = [];

  if (guardian) {
    const requesting = rows.filter((r) => r.unseenRequests > 0).map((r) => r.childId);
    if (requesting.length) {
      out.push({ kind: 'requests', childIds: requesting, names: joinNames(requesting.map((c) => labelOf(children, c))) });
    }
    for (const row of rows) {
      if (row.unviewedProofs > 0) {
        out.push({ kind: 'proofs', childId: row.childId, count: row.unviewedProofs, name: labelOf(children, row.childId) });
      }
    }
  }

  const deleting = rows.filter((r) => r.deletionPending).map((r) => r.childId);
  if (deleting.length) {
    out.push({
      kind: 'deletion',
      childIds: deleting,
      names: joinNames(deleting.map((c) => labelOf(children, c))),
      self: !guardian,
    });
  }

  if (guardian) {
    const unnamed = children.filter((c) => !c.named).length;
    if (unnamed > 0) out.push({ kind: 'unnamed', count: unnamed });
  }
  return out;
}

/** Unviewed proof videos of one child (the teen's "Video sikat gigiku" badge). */
export function unviewedProofsOf(rows: readonly ChildSummary[], childId: string | null | undefined): number {
  if (!childId) return 0;
  return rows.find((r) => r.childId === childId)?.unviewedProofs ?? 0;
}
