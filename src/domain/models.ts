// App-side domain types, aligned with backend/supabase/migrations/20261008000200_core_tables.sql
// and the account model v2 (ADR 017/018, backend/docs/api/ACCOUNTS_AND_FLOWS.md).
// Fields the backend never stores (e.g. `nickname`) are marked LOCAL ONLY.
//
// Naming convention: domain types are camelCase. The backend speaks snake_case JSON; the API
// layer (src/core/account/api.ts) validates every response and converts it into these types.
// There are no exported snake_case wire types: nothing outside the API layer sees raw JSON.

export type BrushingSlot = 'morning' | 'evening' | 'other';

/** public.account_type (ADR 017). Read from my_account(); never guessed on the client. */
export type AccountType = 'guardian' | 'teen' | 'child';
export const accountTypes: readonly AccountType[] = ['guardian', 'teen', 'child'];

/**
 * public.app_role values the app can see (ADR 018: kader / facility_viewer can no longer be
 * granted). Parsers drop any other value. Read-only for the app.
 */
export type AppRole = 'guardian' | 'child' | 'admin';
export const appRoles: readonly AppRole[] = ['guardian', 'child', 'admin'];

/** a = keep on this phone, b = sync pseudonymous data, c = dataset photos, d = brushing proof video. */
export type ConsentType = 'a' | 'b' | 'c' | 'd';
export const consentTypes: readonly ConsentType[] = ['a', 'b', 'c', 'd'];

/** Who gives consent: a guardian for a child, or a teen (15–19) for their own self profile. */
export type ConsentGiver = 'guardian' | 'teen';

/**
 * `text_version` sent with `consent_changed` grants (SYNC_EVENTS.md §3.1). Exact ids from
 * backend/docs/regulatory/CONSENT_TEXT_DRAFT.md ("Daftar versi teks"); each matches
 * CONSENT_TEXT_VERSION_RE. A new wording means a new id there first.
 */
export const consentTextVersions = {
  guardian: {
    a: 'consent-a-v0.1-draft-id',
    b: 'consent-b-v0.2-draft-id',
    c: 'consent-c-v0.1-draft-id',
    d: 'consent-d-v0.1-draft-id',
  },
  teen: {
    a: 'consent-a-teen-v0.1-draft-id',
    b: 'consent-b-teen-v0.1-draft-id',
    c: 'consent-c-teen-v0.1-draft-id',
    d: 'consent-d-teen-v0.2-draft-id',
  },
} as const satisfies Record<ConsentGiver, Record<ConsentType, string>>;

/** Server-side check on `consent_changed.text_version` (SYNC_EVENTS.md §3.1). */
export const CONSENT_TEXT_VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;

export type ChildProfile = {
  /** Pseudonymous UUID (child_profile.id). */
  id: string;
  /** LOCAL ONLY — never synced (sync_events rejects names). */
  nickname: string;
  birthYear: number | null;
  birthMonth: number | null;
  /** Allergy codes (recommender filters.allergen_codes). */
  allergies: string[];
  /** child_profile.is_self: the teen's own profile (ensure_self_profile). Absent = false. */
  isSelf?: boolean;
};

export type BrushingRecord = {
  id: string;
  childId: string;
  /** ISO timestamp (UTC). */
  startedAt: string;
  durationS: number;
  /** 0–100 "skor semangat"; null in timer-only (no camera) mode. */
  spiritScore: number | null;
  slot: BrushingSlot;
  cameraMode: boolean;
  synced: boolean;
  /** brushing_proof id when a proof video was recorded for this session (ADR 017), else null. */
  proofId: string | null;
};

export type ConsentState = Record<ConsentType, boolean>;

/** Every consent starts off (app/CLAUDE.md §3.5; (b)–(d) are opt-in). */
export const emptyConsentState: ConsentState = { a: false, b: false, c: false, d: false };

// Mirrors recommender/rules.json filters.allergen_codes (status: needs_review).
export const allergenCodes = ['flavor_mint', 'cinnamon', 'fruit_flavor', 'propylene_glycol', 'sls'] as const;
export type AllergenCode = (typeof allergenCodes)[number];

/** Triage level as the app's rule engine names it (triage/rules.yaml). */
export type AppLevel = 'emergency' | 'urgent' | 'scheduled' | 'routine';
/** public.triage_level: the server's colour names for the same four levels. */
export type ServerLevel = 'red' | 'orange' | 'yellow' | 'green';
export const serverLevels: readonly ServerLevel[] = ['red', 'orange', 'yellow', 'green'];

const toServer: Record<AppLevel, ServerLevel> = {
  emergency: 'red',
  urgent: 'orange',
  scheduled: 'yellow',
  routine: 'green',
};
const fromServer: Record<ServerLevel, AppLevel> = {
  red: 'emergency',
  orange: 'urgent',
  yellow: 'scheduled',
  green: 'routine',
};

/** App level -> server level (SYNC_EVENTS.md §3.3: emergency->red ... routine->green). */
export function toServerLevel(level: AppLevel): ServerLevel {
  return toServer[level];
}

/** Server level -> app level (inverse of toServerLevel). */
export function fromServerLevel(level: ServerLevel): AppLevel {
  return fromServer[level];
}

/**
 * One completed screening, kept on the device (needs consent (a)). Mirrors the
 * `screening_recorded` sync event (backend/docs/api/SYNC_EVENTS.md §3.3); the photo itself is
 * never stored. `findings[].box` is overlay geometry only (ADR 014).
 */
export type ScreeningRecord = {
  id: string;
  childId: string;
  /** ISO timestamp (UTC). */
  screenedAt: string;
  level: AppLevel;
  redFlag: boolean;
  reasons: { id: string; text: string }[];
  adviceIds: string[];
  referralTemplateId: string;
  rulesVersion: string;
  /** null while no detector ships. */
  modelVersion: string | null;
  photoTaken: boolean;
  photoStatus: 'assessed' | 'not_taken' | 'quality_failed';
  findings: { class: 'caries_permanent' | 'caries_primary'; confidence: number; box: [number, number, number, number] }[];
  /** Answers given; questions skipped after a red flag are absent. */
  answers: Partial<Record<string, 'yes' | 'no' | 'unknown'>>;
  /** null when the flow stopped at a red flag before the pain question. */
  pain: number | 'unknown' | null;
  ageMonths: number | null;
  synced: boolean;
  /** screening_request this screening answers (sent as `request_id`, ADR 017), else null. */
  requestId: string | null;
  /** referral_id of the `referral_created` event made for this screening, else null. */
  referralId: string | null;
  /** LOCAL ONLY. Who produced the level: the device, or the DentisAI API re-check (ADR 019). */
  triageSource?: 'server' | 'device';
};

// ---------------------------------------------------------------------------------------------
// Account model v2 (ADR 017/018). Shapes mirror ACCOUNTS_AND_FLOWS.md §2.6, §2.7, §3, §4 and the
// RPCs in supabase/migrations/20261017000500_account_model_v2_rpc.sql (+ 20261018*).
// ---------------------------------------------------------------------------------------------

/** my_account().child_account — present only for child accounts. */
export type ChildAccountInfo = {
  childId: string;
  /** Owner of the child profile: first segment of the proof Storage path. */
  guardianId: string;
  username: string;
  disabled: boolean;
  /** Not disabled, consent (b) active, no deletion pending: the outbox may send. */
  syncAllowed: boolean;
  /** Flag brushing_proof_video on, consents (b)+(d) active, not disabled, no deletion pending. */
  proofAllowed: boolean;
};

/** my_account().limits — server settings; read these instead of hard-coding numbers. */
export type AccountLimits = {
  teenMinAge: number;
  teenMaxAge: number;
  maxChildAccountsPerGuardian: number;
  streakMinDurationS: number;
  requestMaxPerChildPerDay: number;
  requestExpiryDays: number;
  proofMaxBytes: number;
  proofMaxDurationS: number;
  proofMaxPerChildPerDay: number;
  proofRetentionDays: number;
};

/**
 * Defaults from ACCOUNTS_AND_FLOWS.md §3 (teen ages per ADR 018). Fallback ONLY until
 * my_account() has been read once; the server value always wins.
 */
export const DEFAULT_LIMITS: AccountLimits = {
  teenMinAge: 15,
  teenMaxAge: 19,
  maxChildAccountsPerGuardian: 6,
  streakMinDurationS: 60,
  requestMaxPerChildPerDay: 5,
  requestExpiryDays: 14,
  proofMaxBytes: 10_485_760,
  proofMaxDurationS: 180,
  proofMaxPerChildPerDay: 3,
  proofRetentionDays: 7,
};

/** my_account(): one call that decides routing and which buttons exist. */
export type MyAccount = {
  userId: string;
  accountType: AccountType;
  roles: AppRole[];
  /** Teen's own profile id; null until ensure_self_profile ran (and always null for others). */
  selfChildId: string | null;
  /** Number of child accounts the caller created; null for child accounts. */
  childAccounts: number | null;
  childAccount: ChildAccountInfo | null;
  flags: { brushingProofVideo: boolean };
  capabilities: { createChildAccounts: boolean; registerProofs: boolean };
  limits: AccountLimits;
  /**
   * true when the backend has no my_account() yet (pre-ADR 017 deployment, PGRST202): every
   * account there is a guardian, so the app synthesises one with all capabilities off.
   */
  legacy?: true;
};

/** list_children() row (guardian: own children; teen: the self profile). */
export type ChildSummary = {
  childId: string;
  isSelf: boolean;
  birthYear: number | null;
  birthMonth: number | null;
  /** Active consent types (withdrawn ones are absent). */
  consents: ConsentType[];
  hasChildAccount: boolean;
  /** null when the child has no account. */
  childAccountDisabled: boolean | null;
  /** Child-account username; shown only to the owning guardian. */
  username: string | null;
  lastScreeningAt: string | null;
  lastScreeningLevel: ServerLevel | null;
  lastBrushingAt: string | null;
  openRequests: number;
  unseenRequests: number;
  unviewedProofs: number;
  deletionPending: boolean;
};

/** screening_requested.reason_code (codes only, no free text). */
export type RequestReason = 'toothache' | 'sensitive_teeth' | 'bleeding_gums' | 'swelling' | 'other';
export const requestReasons: readonly RequestReason[] = [
  'toothache',
  'sensitive_teeth',
  'bleeding_gums',
  'swelling',
  'other',
];

/** public.request_status; always the EFFECTIVE status (pending/seen past expiry = expired). */
export type RequestStatus = 'pending' | 'seen' | 'done' | 'cancelled' | 'expired';
export const requestStatuses: readonly RequestStatus[] = ['pending', 'seen', 'done', 'cancelled', 'expired'];

/** list_screening_requests() row. */
export type ScreeningRequest = {
  id: string;
  childId: string;
  reasonCode: RequestReason;
  painLevel: number | null;
  status: RequestStatus;
  createdAt: string;
  seenAt: string | null;
  respondedAt: string | null;
  screeningId: string | null;
  expiresAt: string;
};

/** ack_screening_request() result. */
export type ScreeningRequestAck = {
  id: string;
  status: RequestStatus;
  seenAt: string | null;
  respondedAt: string | null;
};

/** public.proof_status. */
export type ProofStatus = 'uploaded' | 'viewed' | 'deleted' | 'expired';
export const proofStatuses: readonly ProofStatus[] = ['uploaded', 'viewed', 'deleted', 'expired'];

export type ProofMime = 'video/mp4' | 'video/quicktime';
export const proofMimes: readonly ProofMime[] = ['video/mp4', 'video/quicktime'];

/** list_brushing_proofs() row (live clips only). */
export type BrushingProof = {
  id: string;
  childId: string;
  brushingEventId: string;
  /** Path in bucket brushing_proofs, for proofSignedUrl(). Never log or show it. */
  objectPath: string;
  mime: ProofMime;
  sizeBytes: number;
  durationS: number;
  status: ProofStatus;
  uploadedAt: string;
  expiresAt: string;
  viewedAt: string | null;
  /** false = registered but the file has not arrived yet ("belum selesai diunggah"). */
  objectPresent: boolean;
};

/** mark_proof_viewed() result. */
export type ProofViewedResult = { id: string; status: ProofStatus; viewedAt: string | null };
/** delete_brushing_proof() result. */
export type ProofDeletedResult = { id: string; status: ProofStatus; deletedAt: string | null };

/** child_history() kinds. */
export type HistoryKind = 'screening' | 'brushing' | 'referral' | 'screening_request' | 'brushing_proof';
export const historyKinds: readonly HistoryKind[] = [
  'screening',
  'brushing',
  'referral',
  'screening_request',
  'brushing_proof',
];

type HistoryBase<K extends HistoryKind, D> = {
  kind: K;
  id: string;
  /** ISO timestamp. */
  occurredAt: string;
  data: D;
};

/** One child_history() item; `data` per kind follows the ACCOUNTS_AND_FLOWS.md §2.7 table. */
export type HistoryItem =
  | HistoryBase<
      'screening',
      {
        level: ServerLevel;
        redFlag: boolean;
        modelVersion: string | null;
        rulesVersion: string | null;
        findingsCount: number;
        requestId: string | null;
      }
    >
  | HistoryBase<
      'brushing',
      {
        durationS: number;
        spiritScore: number | null;
        slot: BrushingSlot;
        cameraMode: boolean;
        countsForStreak: boolean;
        hasProof: boolean;
      }
    >
  | HistoryBase<
      'referral',
      { level: ServerLevel; reasonCodes: string[]; facilityCode: string | null; screeningId: string | null }
    >
  | HistoryBase<
      'screening_request',
      {
        reasonCode: RequestReason;
        painLevel: number | null;
        status: RequestStatus;
        seenAt: string | null;
        respondedAt: string | null;
        screeningId: string | null;
        expiresAt: string;
      }
    >
  | HistoryBase<
      'brushing_proof',
      {
        brushingEventId: string;
        status: ProofStatus;
        mime: ProofMime;
        sizeBytes: number;
        durationS: number;
        viewedAt: string | null;
        expiresAt: string;
      }
    >;

/** child_history() page; pass `nextBefore` as `before` for the next page until it is null. */
export type HistoryPage = { items: HistoryItem[]; nextBefore: string | null };

/** brushing_streak() result (server calendar days in `tz`). */
export type BrushingStreak = {
  current: number;
  longest: number;
  /** Last counted day (YYYY-MM-DD) or null. */
  lastDay: string | null;
  todayDone: boolean;
  /** Seven days, oldest first. */
  week: { date: string; done: boolean; brushings: number }[];
  minDurationS: number;
  tz: string;
};
