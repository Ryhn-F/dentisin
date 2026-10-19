// Who is screened: a teen screens only its self profile; a guardian picks one of the local
// children (children known only from the server have no nickname and get a fallback label).
// Also reads the screening-request route params (requests list -> /screening?child&request).
import { isUuid } from '@/core/util/uuid';
import { childDisplayName } from '@/data/local-store';
import type { ChildProfile, MyAccount, ScreeningRecord } from '@/domain/models';

type Fallback = (n: number) => string;

/** The teen's own profile: the server's self_child_id first, then the local is_self flag. */
export function teenSelfProfile(kids: readonly ChildProfile[], me: Pick<MyAccount, 'selfChildId'> | null): ChildProfile | null {
  const byServer = me?.selfChildId ? kids.find((k) => k.id === me.selfChildId) : undefined;
  return byServer ?? kids.find((k) => k.isSelf === true) ?? null;
}

/** Name to show for each child, with "Anak", "Anak 2" ... for children without a nickname. */
export function childLabels(kids: readonly ChildProfile[], fallback: Fallback): Map<string, string> {
  const labels = new Map<string, string>();
  let unnamed = 0;
  for (const kid of kids) {
    const name = childDisplayName(kid);
    if (name) labels.set(kid.id, name);
    else {
      unnamed += 1;
      labels.set(kid.id, fallback(unnamed));
    }
  }
  return labels;
}

export type RouteParam = string | string[] | undefined;

export type RequestTarget =
  | { kind: 'none' }
  /** The request's child is not on this phone (yet): screen without answering it. */
  | { kind: 'missing_child' }
  /** A screening on this phone already answers this request. */
  | { kind: 'answered' }
  | { kind: 'ok'; requestId: string; childId: string };

const single = (v: RouteParam): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Screening-request params from the requests screen (`{ child, request }`). Both must be uuids;
 * the request is only carried for that child, so a wrong pairing never reaches the server
 * (request_id of another child -> forbidden, which would reject the whole screening).
 */
export function resolveRequestTarget(
  params: { child?: RouteParam; request?: RouteParam },
  kids: readonly Pick<ChildProfile, 'id'>[],
  screenings: readonly Pick<ScreeningRecord, 'requestId'>[],
): RequestTarget {
  const child = single(params.child);
  const request = single(params.request);
  if (!isUuid(child) || !isUuid(request)) return { kind: 'none' };
  const childId = child.toLowerCase();
  const requestId = request.toLowerCase();
  if (screenings.some((r) => r.requestId?.toLowerCase() === requestId)) return { kind: 'answered' };
  const kid = kids.find((k) => k.id.toLowerCase() === childId);
  if (!kid) return { kind: 'missing_child' };
  return { kind: 'ok', requestId, childId: kid.id };
}
