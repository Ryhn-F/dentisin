// Typed client for the account model v2 backend (ADR 017/018):
// - RPCs: backend/docs/api/ACCOUNTS_AND_FLOWS.md §2–4, §7, §9 and SUPABASE_API.md §3.2, §3.7
// - Storage bucket brushing_proofs: SUPABASE_API.md §4
// - Edge Functions child-accounts / child-login: EDGE_FUNCTIONS_AND_HOOKS.md §1.5–1.7
//
// Every function resolves to an ApiResult (it never throws). Responses are validated field by
// field (./parse.ts) and converted from snake_case JSON to the camelCase domain types in
// src/domain/models.ts. A backend without the v2 migrations/functions answers PGRST202 or 404:
// that becomes code 'not_deployed' so screens can show a friendly "not available yet" state.
// Privacy: nothing here logs. Never log arguments or results (ids, usernames, tokens, URLs).

import { config } from '@/core/config';
import { supabase } from '@/core/auth/supabase';
import { isChildPasswordValid, normalizeEmail } from '@/core/auth/validation';
import { isUuid } from '@/core/util/uuid';
import {
  accountTypes,
  appRoles,
  consentTypes,
  historyKinds,
  proofMimes,
  proofStatuses,
  requestReasons,
  requestStatuses,
  serverLevels,
  type AccountLimits,
  type BrushingProof,
  type BrushingSlot,
  type BrushingStreak,
  type ChildAccountInfo,
  type ChildSummary,
  type HistoryItem,
  type HistoryKind,
  type HistoryPage,
  type MyAccount,
  type ProofDeletedResult,
  type ProofViewedResult,
  type RequestStatus,
  type ScreeningRequest,
  type ScreeningRequestAck,
} from '@/domain/models';

import {
  BadResponse,
  arr,
  bool,
  boolOrNull,
  filterStrings,
  int,
  intOrNull,
  obj,
  oneOf,
  oneOfOrNull,
  str,
  strOrNull,
  strings,
  time,
  timeOrNull,
  uuid,
  uuidOrNull,
  type Json,
} from './parse';
import { checkChildUsername, isChildUsernameShape, normalizeChildUsername } from './username';

export {
  CHILD_USERNAME_MAX,
  CHILD_USERNAME_MIN,
  CHILD_USERNAME_RE,
  RESERVED_CHILD_USERNAMES,
  checkChildUsername,
  isChildUsernameShape,
  isValidChildUsername,
  normalizeChildUsername,
  type ChildUsernameIssue,
} from './username';

// ---------------------------------------------------------------------------------------------
// Result type and error codes
// ---------------------------------------------------------------------------------------------

/** Fixed RPC error messages (ACCOUNTS_AND_FLOWS.md §7). */
export const rpcErrorCodes = [
  'not_authenticated',
  'forbidden',
  'invalid_argument',
  'age_out_of_range',
  'deletion_pending',
  'invalid_kind',
  'invalid_action',
  'invalid_timezone',
] as const;

/** `{"error": "<code>"}` bodies of child-accounts / child-login (EDGE_FUNCTIONS_AND_HOOKS.md §1.5–1.6). */
export const functionErrorCodes = [
  'invalid_body',
  'unauthorized',
  'forbidden',
  'child_not_found',
  'child_already_has_account',
  'child_account_limit',
  'username_taken',
  'invalid_username',
  'weak_password',
  'method_not_allowed',
  'internal',
  'invalid_credentials',
  'too_many_attempts',
  'upstream_unavailable',
] as const;

export type ApiErrorCode =
  | (typeof rpcErrorCodes)[number]
  | (typeof functionErrorCodes)[number]
  /** Storage object missing or not readable (RLS hides both the same way). */
  | 'not_found'
  /** RPC/function/bucket does not exist on this backend yet (PGRST202 / HTTP 404). */
  | 'not_deployed'
  /** No connection, DNS failure or timeout. */
  | 'network'
  /** This build has no Supabase URL/key. */
  | 'not_configured'
  /** The server answered with a shape this app version does not understand. */
  | 'bad_response'
  /** Any other server error. */
  | 'unknown';

export type ApiFailure = {
  ok: false;
  code: ApiErrorCode;
  /** HTTP status when known. */
  status?: number;
  /** Seconds from a Retry-After header (429). */
  retryAfterS?: number;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

function fail(code: ApiErrorCode, extra: { status?: number; retryAfterS?: number } = {}): ApiFailure {
  const out: ApiFailure = { ok: false, code };
  if (extra.status !== undefined) out.status = extra.status;
  if (extra.retryAfterS !== undefined) out.retryAfterS = extra.retryAfterS;
  return out;
}

const REQUEST_TIMEOUT_MS = 15_000;

class Timeout extends Error {}

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout('timeout')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function looksLikeNetworkError(message: unknown): boolean {
  return typeof message === 'string' && /network|fetch|timeout|abort|connection/i.test(message);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** IANA time zone of the device (for brushing_streak), falling back to 'Asia/Jakarta'. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === 'string' && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return tz;
  } catch {
    // Old Intl implementations: fall through.
  }
  return 'Asia/Jakarta';
}

// ---------------------------------------------------------------------------------------------
// RPC plumbing
// ---------------------------------------------------------------------------------------------

const rpcCodeSet: ReadonlySet<string> = new Set(rpcErrorCodes);

/** PostgREST error -> ApiFailure (exported for tests and the sync layer). */
export function mapRpcError(error: unknown, status?: number): ApiFailure {
  const e = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const message = e.message;
  const withStatus = typeof status === 'number' && status > 0 ? { status } : {};
  // PGRST202: function (or this signature) not in the schema cache. 42883: undefined function.
  if (code === 'PGRST202' || code === '42883' || status === 404) return fail('not_deployed', withStatus);
  if (typeof message === 'string' && rpcCodeSet.has(message)) {
    return fail(message as (typeof rpcErrorCodes)[number], withStatus);
  }
  if (code === '28000' || code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303' || status === 401) {
    return fail('not_authenticated', withStatus);
  }
  if (code === '42501' || status === 403) return fail('forbidden', withStatus);
  if (code === '22023') return fail('invalid_argument', withStatus);
  if (status === 0 || (code === '' && looksLikeNetworkError(message))) return fail('network');
  return fail('unknown', withStatus);
}

type RpcResponse = { data: unknown; error: unknown; status?: number };

async function callRpc<T>(
  fn: string,
  args: Record<string, unknown> | undefined,
  parse: (data: unknown) => T,
): Promise<ApiResult<T>> {
  const client = supabase;
  if (!client) return fail('not_configured');
  let res: RpcResponse;
  try {
    res = await withTimeout<RpcResponse>(client.rpc(fn, args), REQUEST_TIMEOUT_MS);
  } catch {
    return fail('network');
  }
  if (res.error) return mapRpcError(res.error, res.status);
  try {
    return { ok: true, data: parse(res.data) };
  } catch {
    return fail('bad_response');
  }
}

// ---------------------------------------------------------------------------------------------
// Parsers (snake_case JSON -> domain types)
// ---------------------------------------------------------------------------------------------

function parseLimits(value: unknown): AccountLimits {
  const l = obj(value, 'limits');
  return {
    teenMinAge: int(l, 'teen_min_age'),
    teenMaxAge: int(l, 'teen_max_age'),
    maxChildAccountsPerGuardian: int(l, 'max_child_accounts_per_guardian'),
    streakMinDurationS: int(l, 'streak_min_duration_s'),
    requestMaxPerChildPerDay: int(l, 'request_max_per_child_per_day'),
    requestExpiryDays: int(l, 'request_expiry_days'),
    proofMaxBytes: int(l, 'proof_max_bytes'),
    proofMaxDurationS: int(l, 'proof_max_duration_s'),
    proofMaxPerChildPerDay: int(l, 'proof_max_per_child_per_day'),
    proofRetentionDays: int(l, 'proof_retention_days'),
  };
}

function parseChildAccount(value: unknown): ChildAccountInfo | null {
  if (value === null || value === undefined) return null;
  const c = obj(value, 'child_account');
  return {
    childId: uuid(c, 'child_id'),
    guardianId: uuid(c, 'guardian_id'),
    username: str(c, 'username'),
    disabled: bool(c, 'disabled'),
    syncAllowed: bool(c, 'sync_allowed'),
    proofAllowed: bool(c, 'proof_allowed'),
  };
}

/** my_account() JSON -> MyAccount. Unknown roles are dropped (ADR 018). */
export function parseMyAccount(value: unknown): MyAccount {
  const o = obj(value);
  const accountType = oneOf(o, 'account_type', accountTypes);
  const flags = obj(o.flags, 'flags');
  const caps = obj(o.capabilities, 'capabilities');
  const childAccount = parseChildAccount(o.child_account);
  // A child account without its child_account row cannot be routed safely.
  if (accountType === 'child' && !childAccount) throw new BadResponse('child_account');
  return {
    userId: uuid(o, 'user_id'),
    accountType,
    roles: filterStrings(o.roles, 'roles', appRoles),
    selfChildId: uuidOrNull(o, 'self_child_id'),
    childAccounts: intOrNull(o, 'child_accounts'),
    childAccount,
    flags: { brushingProofVideo: bool(flags, 'brushing_proof_video') },
    capabilities: {
      createChildAccounts: bool(caps, 'create_child_accounts'),
      registerProofs: bool(caps, 'register_proofs'),
    },
    limits: parseLimits(o.limits),
  };
}

function parseChildSummary(value: unknown): ChildSummary {
  const o = obj(value, 'child');
  return {
    childId: uuid(o, 'child_id'),
    isSelf: bool(o, 'is_self'),
    birthYear: intOrNull(o, 'birth_year'),
    birthMonth: intOrNull(o, 'birth_month'),
    consents: filterStrings(o.consents, 'consents', consentTypes),
    hasChildAccount: bool(o, 'has_child_account'),
    childAccountDisabled: boolOrNull(o, 'child_account_disabled'),
    username: strOrNull(o, 'username'),
    lastScreeningAt: timeOrNull(o, 'last_screening_at'),
    lastScreeningLevel: oneOfOrNull(o, 'last_screening_level', serverLevels),
    lastBrushingAt: timeOrNull(o, 'last_brushing_at'),
    openRequests: int(o, 'open_requests'),
    unseenRequests: int(o, 'unseen_requests'),
    unviewedProofs: int(o, 'unviewed_proofs'),
    deletionPending: bool(o, 'deletion_pending'),
  };
}

function parseScreeningRequest(value: unknown): ScreeningRequest {
  const o = obj(value, 'request');
  return {
    id: uuid(o, 'id'),
    childId: uuid(o, 'child_id'),
    reasonCode: oneOf(o, 'reason_code', requestReasons),
    painLevel: intOrNull(o, 'pain_level'),
    status: oneOf(o, 'status', requestStatuses),
    createdAt: time(o, 'created_at'),
    seenAt: timeOrNull(o, 'seen_at'),
    respondedAt: timeOrNull(o, 'responded_at'),
    screeningId: uuidOrNull(o, 'screening_id'),
    expiresAt: time(o, 'expires_at'),
  };
}

function parseBrushingProof(value: unknown): BrushingProof {
  const o = obj(value, 'proof');
  return {
    id: uuid(o, 'id'),
    childId: uuid(o, 'child_id'),
    brushingEventId: uuid(o, 'brushing_event_id'),
    objectPath: str(o, 'object_path'),
    mime: oneOf(o, 'mime', proofMimes),
    sizeBytes: int(o, 'size_bytes'),
    durationS: int(o, 'duration_s'),
    status: oneOf(o, 'status', proofStatuses),
    uploadedAt: time(o, 'uploaded_at'),
    expiresAt: time(o, 'expires_at'),
    viewedAt: timeOrNull(o, 'viewed_at'),
    objectPresent: bool(o, 'object_present'),
  };
}

const slots: readonly BrushingSlot[] = ['morning', 'evening', 'other'];

function parseHistoryItem(value: unknown): HistoryItem | null {
  const o = obj(value, 'item');
  const kind = o.kind;
  // Forward compatible: a kind added by a newer backend is skipped, not an error.
  if (typeof kind !== 'string' || !(historyKinds as readonly string[]).includes(kind)) return null;
  const id = uuid(o, 'id');
  const occurredAt = time(o, 'occurred_at');
  const d = obj(o.data, 'data');
  switch (kind as HistoryKind) {
    case 'screening':
      return {
        kind: 'screening',
        id,
        occurredAt,
        data: {
          level: oneOf(d, 'level', serverLevels),
          redFlag: boolOrNull(d, 'red_flag') ?? false,
          modelVersion: strOrNull(d, 'model_version'),
          rulesVersion: strOrNull(d, 'rules_version'),
          findingsCount: intOrNull(d, 'findings_count') ?? 0,
          requestId: uuidOrNull(d, 'request_id'),
        },
      };
    case 'brushing':
      return {
        kind: 'brushing',
        id,
        occurredAt,
        data: {
          durationS: int(d, 'duration_s'),
          spiritScore: intOrNull(d, 'spirit_score'),
          slot: oneOfOrNull(d, 'slot', slots) ?? 'other',
          cameraMode: boolOrNull(d, 'camera_mode') ?? false,
          countsForStreak: bool(d, 'counts_for_streak'),
          hasProof: bool(d, 'has_proof'),
        },
      };
    case 'referral':
      return {
        kind: 'referral',
        id,
        occurredAt,
        data: {
          level: oneOf(d, 'level', serverLevels),
          reasonCodes: strings(d.reason_codes, 'reason_codes'),
          facilityCode: strOrNull(d, 'facility_code'),
          screeningId: uuidOrNull(d, 'screening_id'),
        },
      };
    case 'screening_request':
      return {
        kind: 'screening_request',
        id,
        occurredAt,
        data: {
          reasonCode: oneOf(d, 'reason_code', requestReasons),
          painLevel: intOrNull(d, 'pain_level'),
          status: oneOf(d, 'status', requestStatuses),
          seenAt: timeOrNull(d, 'seen_at'),
          respondedAt: timeOrNull(d, 'responded_at'),
          screeningId: uuidOrNull(d, 'screening_id'),
          expiresAt: time(d, 'expires_at'),
        },
      };
    case 'brushing_proof':
      return {
        kind: 'brushing_proof',
        id,
        occurredAt,
        data: {
          brushingEventId: uuid(d, 'brushing_event_id'),
          status: oneOf(d, 'status', proofStatuses),
          mime: oneOf(d, 'mime', proofMimes),
          sizeBytes: int(d, 'size_bytes'),
          durationS: int(d, 'duration_s'),
          viewedAt: timeOrNull(d, 'viewed_at'),
          expiresAt: time(d, 'expires_at'),
        },
      };
  }
}

/** child_history() JSON -> HistoryPage. */
export function parseHistoryPage(value: unknown): HistoryPage {
  const o = obj(value);
  const items = arr(o.items ?? [], 'items')
    .map(parseHistoryItem)
    .filter((i): i is HistoryItem => i !== null);
  return { items, nextBefore: timeOrNull(o, 'next_before') };
}

function parseStreak(value: unknown): BrushingStreak {
  const o = obj(value);
  return {
    current: int(o, 'current'),
    longest: int(o, 'longest'),
    lastDay: timeOrNull(o, 'last_day'),
    todayDone: bool(o, 'today_done'),
    week: arr(o.week ?? [], 'week').map((w) => {
      const day = obj(w, 'week');
      return { date: str(day, 'date'), done: bool(day, 'done'), brushings: int(day, 'brushings') };
    }),
    minDurationS: int(o, 'min_duration_s'),
    tz: str(o, 'tz'),
  };
}

function rows<T>(parse: (v: unknown) => T) {
  return (data: unknown): T[] => (data === null || data === undefined ? [] : arr(data, 'rows').map(parse));
}

// ---------------------------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------------------------

/** my_account(): account type, roles, capabilities, limits (routing source of truth). */
export function myAccount(): Promise<ApiResult<MyAccount>> {
  return callRpc('my_account', undefined, parseMyAccount);
}

/**
 * ensure_self_profile(): teen only, idempotent. Pass a NEW uuid (newUuid()); ALWAYS use the
 * returned id (an existing self profile keeps its old id). Errors: age_out_of_range,
 * deletion_pending, forbidden (not a teen), invalid_argument.
 */
export function ensureSelfProfile(
  childId: string,
  birthYear: number,
  birthMonth: number | null,
): Promise<ApiResult<string>> {
  if (!isUuid(childId)) return Promise.resolve(fail('invalid_argument'));
  return callRpc(
    'ensure_self_profile',
    { p_child_id: childId.toLowerCase(), p_birth_year: birthYear, p_birth_month: birthMonth },
    (data) => {
      if (!isUuid(data)) throw new BadResponse('ensure_self_profile');
      return data.toLowerCase();
    },
  );
}

/** list_children(): guardian's children / teen's self profile, with badge counts. */
export function listChildren(): Promise<ApiResult<ChildSummary[]>> {
  return callRpc('list_children', undefined, rows(parseChildSummary));
}

export type ChildHistoryQuery = {
  childId: string;
  /** `nextBefore` of the previous page. */
  before?: string | null;
  /** 1..100 (server clamps; default 30). */
  limit?: number;
  /** null/undefined = every kind this account may see. */
  kinds?: readonly HistoryKind[] | null;
  /** Lower bound (ISO timestamp). */
  from?: string | null;
};

/** child_history(): merged timeline, newest first, keyset pagination. */
export function childHistory(q: ChildHistoryQuery): Promise<ApiResult<HistoryPage>> {
  return callRpc(
    'child_history',
    {
      p_child: q.childId,
      p_before: q.before ?? null,
      p_limit: q.limit ?? 30,
      p_kinds: q.kinds ? [...q.kinds] : null,
      p_from: q.from ?? null,
    },
    parseHistoryPage,
  );
}

/** brushing_streak(): server streak in calendar days of `tz` (default: device zone). */
export function brushingStreak(childId: string, tz: string = deviceTimeZone()): Promise<ApiResult<BrushingStreak>> {
  return callRpc('brushing_streak', { p_child: childId, p_tz: tz }, parseStreak);
}

export type ScreeningRequestQuery = {
  /** One child; omit for all of the caller's children (child accounts: their own). */
  childId?: string | null;
  statuses?: readonly RequestStatus[] | null;
  limit?: number;
};

/** list_screening_requests(): effective statuses, newest first. */
export function listScreeningRequests(q: ScreeningRequestQuery = {}): Promise<ApiResult<ScreeningRequest[]>> {
  return callRpc(
    'list_screening_requests',
    { p_child: q.childId ?? null, p_status: q.statuses ? [...q.statuses] : null, p_limit: q.limit ?? 30 },
    rows(parseScreeningRequest),
  );
}

/** ack_screening_request(): 'seen' when the guardian opens it, 'cancel' when not needed. */
export function ackScreeningRequest(id: string, action: 'seen' | 'cancel'): Promise<ApiResult<ScreeningRequestAck>> {
  return callRpc('ack_screening_request', { p_id: id, p_action: action }, (data) => {
    const o = obj(data);
    return {
      id: uuid(o, 'id'),
      status: oneOf(o, 'status', requestStatuses),
      seenAt: timeOrNull(o, 'seen_at'),
      respondedAt: timeOrNull(o, 'responded_at'),
    };
  });
}

export type BrushingProofQuery = {
  childId: string;
  /** Next page: the `uploadedAt` of the last proof of the previous page. */
  before?: string | null;
  limit?: number;
};

/** list_brushing_proofs(): live clips of one child (guardian) or of the teen's self profile. */
export function listBrushingProofs(q: BrushingProofQuery): Promise<ApiResult<BrushingProof[]>> {
  return callRpc(
    'list_brushing_proofs',
    { p_child: q.childId, p_before: q.before ?? null, p_limit: q.limit ?? 30 },
    rows(parseBrushingProof),
  );
}

/** mark_proof_viewed(): call after the clip started playing. */
export function markProofViewed(proofId: string): Promise<ApiResult<ProofViewedResult>> {
  return callRpc('mark_proof_viewed', { p_proof: proofId }, (data) => {
    const o = obj(data);
    return { id: uuid(o, 'id'), status: oneOf(o, 'status', proofStatuses), viewedAt: timeOrNull(o, 'viewed_at') };
  });
}

/** delete_brushing_proof(): hides the clip at once; the file is purged by the server. */
export function deleteBrushingProof(proofId: string): Promise<ApiResult<ProofDeletedResult>> {
  return callRpc('delete_brushing_proof', { p_proof: proofId }, (data) => {
    const o = obj(data);
    return { id: uuid(o, 'id'), status: oneOf(o, 'status', proofStatuses), deletedAt: timeOrNull(o, 'deleted_at') };
  });
}

/** deletion_scope enum of request_deletion (SUPABASE_API.md §3.2). */
export const deletionScopes = ['child', 'account'] as const;
export type DeletionScope = (typeof deletionScopes)[number];

/** What to delete: one own child (guardian) / the teen's self profile, or the whole account. */
export type DeletionTarget = { scope: 'child'; childId: string } | { scope: 'account' };

/**
 * request_deletion(p_scope, p_child_id) (SUPABASE_API.md §3.2, ACCOUNTS_AND_FLOWS.md §9):
 * resolves to the deletion_request id. Sync for the subject stops at once (deletion_pending);
 * the server finishes within hours (pg_cron, process-deletion for photos and proof videos).
 * - child: the profile and all its data, its child login account, brushing proof videos and
 *   screening requests.
 * - account: every child, child account and proof, the roles, the ledger and the auth account.
 * Idempotent: a pending/processing request for the same subject returns its existing id.
 * Errors: forbidden (not the caller's child, or a child account calling), invalid_argument
 * (child_id_not_allowed_for_account_scope), not_authenticated. Never logs.
 */
export function requestDeletion(target: DeletionTarget): Promise<ApiResult<string>> {
  if (target.scope === 'child' && !isUuid(target.childId)) return Promise.resolve(fail('invalid_argument'));
  if (!(deletionScopes as readonly string[]).includes(target.scope)) return Promise.resolve(fail('invalid_argument'));
  const args = target.scope === 'child' ? { p_scope: 'child', p_child_id: target.childId.toLowerCase() } : { p_scope: 'account' };
  return callRpc('request_deletion', args, (data) => {
    if (!isUuid(data)) throw new BadResponse('request_deletion');
    return data.toLowerCase();
  });
}

// ---------------------------------------------------------------------------------------------
// Storage: brushing_proofs
// ---------------------------------------------------------------------------------------------

export const PROOF_BUCKET = 'brushing_proofs';
/** Signed URL lifetime: the backend allows at most 300 s. Make a new one for every playback. */
export const PROOF_SIGNED_URL_TTL_S = 300;

const PROOF_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov)$/;

/** True for `<owner_id>/<child_id>/<proof_id>.mp4|.mov` (lower case), the only accepted path. */
export function isProofObjectPath(path: string): boolean {
  return PROOF_PATH_RE.test(path);
}

/** Storage error -> ApiFailure. */
export function mapStorageError(error: unknown): ApiFailure {
  const e = error && typeof error === 'object' ? (error as { message?: unknown; statusCode?: unknown; status?: unknown }) : {};
  const message = typeof e.message === 'string' ? e.message : '';
  const statusCode = typeof e.statusCode === 'string' ? e.statusCode : typeof e.status === 'number' ? String(e.status) : '';
  if (/bucket not found/i.test(message)) return fail('not_deployed');
  if (statusCode === '404' || /not.?found/i.test(message)) return fail('not_found');
  if (statusCode === '401') return fail('not_authenticated');
  if (statusCode === '403' || /row-level security|unauthori[sz]ed/i.test(message)) return fail('forbidden');
  if (looksLikeNetworkError(message)) return fail('network');
  return fail('unknown');
}

/** Short-lived (300 s) signed URL for a proof clip. Do not store, share or log the URL. */
export async function proofSignedUrl(objectPath: string): Promise<ApiResult<string>> {
  const client = supabase;
  if (!client) return fail('not_configured');
  if (!isProofObjectPath(objectPath)) return fail('invalid_argument');
  try {
    const { data, error } = await withTimeout(
      client.storage.from(PROOF_BUCKET).createSignedUrl(objectPath, PROOF_SIGNED_URL_TTL_S),
      REQUEST_TIMEOUT_MS,
    );
    if (error) return mapStorageError(error);
    const url = data && typeof data === 'object' ? (data as { signedUrl?: unknown }).signedUrl : undefined;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return fail('bad_response');
    return { ok: true, data: url };
  } catch {
    return fail('network');
  }
}

// ---------------------------------------------------------------------------------------------
// Edge Functions
// ---------------------------------------------------------------------------------------------

const functionCodeSet: ReadonlySet<string> = new Set(functionErrorCodes);

/** Retry-After as seconds (delta-seconds or HTTP date); undefined when absent/invalid. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,7}$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** Edge Function HTTP response -> ApiFailure (exported for tests). */
export function mapFunctionError(status: number, body: unknown, retryAfter?: string | null): ApiFailure {
  const raw = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const known = typeof raw === 'string' && functionCodeSet.has(raw) ? (raw as (typeof functionErrorCodes)[number]) : null;
  const extra: { status: number; retryAfterS?: number } = { status };
  if (status === 429) {
    const seconds = parseRetryAfter(retryAfter);
    if (seconds !== undefined) extra.retryAfterS = seconds;
  }
  // The platform answers 404 (no `error` code of ours) when the function is not deployed.
  if (status === 404 && known !== 'child_not_found') return fail('not_deployed', extra);
  if (known) return fail(known, extra);
  if (status === 400) return fail('invalid_body', extra);
  if (status === 401) return fail('unauthorized', extra);
  if (status === 403) return fail('forbidden', extra);
  if (status === 405) return fail('method_not_allowed', extra);
  if (status === 429) return fail('too_many_attempts', extra);
  if (status === 502 || status === 503 || status === 504) return fail('upstream_unavailable', extra);
  if (status >= 500) return fail('internal', extra);
  return fail('unknown', extra);
}

type FunctionResponse = { ok: true; status: number; body: unknown } | ApiFailure;

async function postFunction(name: 'child-accounts' | 'child-login', body: Json, bearer: string): Promise<FunctionResponse> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return fail('not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${config.supabaseUrl.replace(/\/+$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return fail('network');
  }
  let parsed: unknown = null;
  try {
    const text = await res.text();
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return mapFunctionError(res.status, parsed, res.headers?.get?.('Retry-After') ?? null);
  return { ok: true, status: res.status, body: parsed };
}

async function currentAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function callChildAccounts<T>(body: Json, parse: (data: unknown) => T): Promise<ApiResult<T>> {
  if (!supabase || !config.supabaseUrl || !config.supabaseAnonKey) return fail('not_configured');
  const token = await currentAccessToken();
  if (!token) return fail('not_authenticated');
  const res = await postFunction('child-accounts', body, token);
  if (!res.ok) return res;
  try {
    return { ok: true, data: parse(res.body) };
  } catch {
    return fail('bad_response');
  }
}

function okBody(data: unknown) {
  const o = obj(data);
  if (o.ok !== true) throw new BadResponse('ok');
  return o;
}

/**
 * child-accounts Edge Function (guardian JWT). Inputs are checked locally first with the same
 * rules as the server (invalid_username / weak_password / invalid_argument without a round trip).
 * Prerequisite for create: the child profile is `applied` on the server (consent b synced).
 */
export const childAccounts = {
  /** 201 -> { childId, username } (username as normalised by the server). */
  create(input: { childId: string; username: string; password: string }): Promise<ApiResult<{ childId: string; username: string }>> {
    if (!isUuid(input.childId)) return Promise.resolve(fail('invalid_argument'));
    if (checkChildUsername(input.username) !== null) return Promise.resolve(fail('invalid_username'));
    if (!isChildPasswordValid(input.password)) return Promise.resolve(fail('weak_password'));
    return callChildAccounts(
      {
        action: 'create',
        child_id: input.childId.toLowerCase(),
        username: normalizeChildUsername(input.username),
        password: input.password,
      },
      (data) => {
        const o = obj(data);
        return { childId: uuid(o, 'child_id'), username: str(o, 'username') };
      },
    );
  },

  /** New password chosen by the guardian (children have no "forgot password"). */
  resetPassword(input: { childId: string; password: string }): Promise<ApiResult<true>> {
    if (!isUuid(input.childId)) return Promise.resolve(fail('invalid_argument'));
    if (!isChildPasswordValid(input.password)) return Promise.resolve(fail('weak_password'));
    return callChildAccounts(
      { action: 'reset_password', child_id: input.childId.toLowerCase(), password: input.password },
      (data) => {
        okBody(data);
        return true as const;
      },
    );
  },

  /** Takes effect at once (RLS denies the child, Auth session blocked). -> { disabled }. */
  setDisabled(input: { childId: string; disabled: boolean }): Promise<ApiResult<{ disabled: boolean }>> {
    if (!isUuid(input.childId)) return Promise.resolve(fail('invalid_argument'));
    return callChildAccounts(
      { action: 'set_disabled', child_id: input.childId.toLowerCase(), disabled: input.disabled },
      (data) => ({ disabled: bool(okBody(data), 'disabled') }),
    );
  },

  /** Deletes the child's LOGIN only; the profile and its data stay (use request_deletion for data). */
  remove(input: { childId: string }): Promise<ApiResult<true>> {
    if (!isUuid(input.childId)) return Promise.resolve(fail('invalid_argument'));
    return callChildAccounts({ action: 'delete', child_id: input.childId.toLowerCase() }, (data) => {
      okBody(data);
      return true as const;
    });
  },
};

/** Session returned by child-login (no email, no guardian data). */
export type ChildLoginSession = {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds, when given. */
  expiresAt: number | null;
  userId: string;
  username: string;
};

/** Maximum password length child-login accepts (characters). */
const CHILD_LOGIN_PASSWORD_MAX = 256;

/**
 * child-login Edge Function (anon key). One uniform 401 `invalid_credentials` for every cause;
 * 429 `too_many_attempts` carries `retryAfterS`; 400 `invalid_body`; 502 `upstream_unavailable`.
 * Malformed input is refused locally as `invalid_body` (no attempt is spent on the server).
 * The caller turns the tokens into a session (auth-service signInChild).
 */
export async function childLogin(input: {
  parentEmail: string;
  username: string;
  password: string;
  captchaToken?: string | null;
}): Promise<ApiResult<ChildLoginSession>> {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return fail('not_configured');
  const parentEmail = normalizeEmail(input.parentEmail);
  if (!/^[^\s@]{1,64}@[^\s@]+\.[^\s@]+$/.test(parentEmail) || parentEmail.length > 254) return fail('invalid_body');
  if (!isChildUsernameShape(input.username)) return fail('invalid_body');
  if (input.password.length === 0 || input.password.length > CHILD_LOGIN_PASSWORD_MAX) return fail('invalid_body');
  const body: Json = {
    parent_email: parentEmail,
    username: normalizeChildUsername(input.username),
    password: input.password,
  };
  if (input.captchaToken) body.captcha_token = input.captchaToken;
  const res = await postFunction('child-login', body, config.supabaseAnonKey);
  if (!res.ok) return res;
  try {
    const o = obj(res.body);
    const user = obj(o.user, 'user');
    const child = obj(o.child, 'child');
    const accessToken = str(o, 'access_token');
    const refreshToken = str(o, 'refresh_token');
    if (!accessToken || !refreshToken) throw new BadResponse('tokens');
    return {
      ok: true,
      data: {
        accessToken,
        refreshToken,
        expiresAt: intOrNull(o, 'expires_at'),
        userId: uuid(user, 'id'),
        username: str(child, 'username'),
      },
    };
  } catch {
    return fail('bad_response');
  }
}
