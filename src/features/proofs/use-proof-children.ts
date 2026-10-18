import { useMemo } from 'react';

import { useAccountType, useMe } from '@/core/account/account-store';
import { id } from '@/core/i18n/id';
import { useLocalData } from '@/data/local-store';
import type { ChildProfile } from '@/domain/models';

import { childLabeler } from './proof-flow';

export type ProofChildren = {
  /** Children whose videos this account may open: all local children (guardian) or the self profile (teen). */
  children: ChildProfile[];
  labelFor: (childId: string) => string;
  isTeen: boolean;
};

// Who the signed-in adult can watch. The server stays the judge (list_brushing_proofs answers
// `forbidden` for any other child); this only decides what the screens offer.
export function useProofChildren(): ProofChildren {
  const kids = useLocalData((s) => s.kids);
  const me = useMe();
  const accountType = useAccountType();
  const isTeen = accountType === 'teen';
  const selfChildId = me?.selfChildId ?? null;

  return useMemo(() => {
    const children = isTeen
      ? kids.filter((k) => k.id === selfChildId || (selfChildId === null && k.isSelf === true))
      : kids;
    const labelFor = childLabeler(kids, id.proofs.list.childFallback, id.proofs.list.selfFallback);
    return { children, labelFor, isTeen };
  }, [kids, isTeen, selfChildId]);
}
