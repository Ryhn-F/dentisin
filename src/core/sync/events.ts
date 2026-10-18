// sync_events payload builders and validators (backend/docs/api/SYNC_EVENTS.md §1, §3, §4).
//
// Pure functions: no store, no network, no logging. A builder takes camelCase domain input,
// normalises it (lower-case UUIDs, ISO 8601 UTC timestamps, integer durations, sanitised codes),
// builds a payload object with ONLY the whitelisted keys of its type, validates it with the
// same rules the server applies, and returns the exact JSON text that is sent on every attempt.
// The server hashes `type + "|" + payload` per event_id (SYNC_EVENTS.md §4), so the outbox
// stores `payloadJson` and never rebuilds a payload for an existing event_id.
//
// Builders throw SyncEventError for input that cannot become a valid payload. The error names
// the event type and the offending key, never a value (no ids, codes or numbers in messages).

import { utf8ByteLength } from '@/core/auth/validation';
import { isUuid, newUuid } from '@/core/util/uuid';
import {
  CONSENT_TEXT_VERSION_RE,
  consentTypes,
  proofMimes,
  requestReasons,
  serverLevels,
  toServerLevel,
  type AccountLimits,
  type AppLevel,
  type BrushingRecord,
  type BrushingSlot,
  type ConsentType,
  type ProofMime,
  type RequestReason,
  type ScreeningRecord,
} from '@/domain/models';

// ---------------------------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------------------------

export const syncEventTypes = [
  'consent_changed',
  'child_upserted',
  'screening_recorded',
  'brushing_recorded',
  'referral_created',
  'image_upload_registered',
  'screening_requested',
  'brushing_proof_registered',
] as const;
export type SyncEventType = (typeof syncEventTypes)[number];

/** One event ready for the outbox. `payloadJson` is final: it is sent byte for byte on retries. */
export type BuiltEvent<T extends SyncEventType = SyncEventType> = {
  eventId: string;
  type: T;
  childId: string;
  payloadJson: string;
};

export type ConsentAction = 'grant' | 'withdraw';

/** Per-event payload limit (`octet_length(payload::text)`, SYNC_EVENTS.md §1). */
export const MAX_PAYLOAD_BYTES = 8192;
/** Codes: allergy codes, reason codes, finding classes (no free text). */
export const CODE_RE = /^[a-z][a-z0-9_]{1,39}$/;
/** `model_version` / `rules_version` (private.is_version_tag). */
export const VERSION_TAG_RE = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}([-+][0-9A-Za-z.-]{1,32})?$/;
export const FACILITY_CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,31}$/;
/** What builders emit: Date#toISOString() output (UTC, with Z). */
export const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const LOWER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `model_version` is NOT NULL on the server (screening.model_version, is_version_tag). While
 * the app ships no detector (ScreeningRecord.modelVersion === null) it sends this tag, which is
 * valid per VERSION_TAG_RE and says "no model was used" instead of inventing a version.
 */
export const NO_MODEL_VERSION = '0.0.0-none';

/** Timestamps must parse, be >= 2020-01-01 and <= now + 1 day (private.sane_ts). */
export const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
export const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

export const MAX_ALLERGIES = 10;
export const MAX_REASON_CODES = 20;
export const MAX_FINDINGS = 50;
export const MAX_BRUSHING_DURATION_S = 1800;
/** Hard cap the server applies to proof sizes regardless of settings (50 MiB). */
export const PROOF_HARD_MAX_BYTES = 52_428_800;

/** Whitelisted payload keys per type (SYNC_EVENTS.md §3); any other key is schema_invalid. */
export const payloadKeys: Record<SyncEventType, { required: readonly string[]; optional: readonly string[] }> = {
  consent_changed: { required: ['child_id', 'consent_type', 'action'], optional: ['text_version', 'at', 'method'] },
  child_upserted: { required: ['child_id'], optional: ['birth_year', 'birth_month', 'allergies'] },
  screening_recorded: {
    required: ['screening_id', 'child_id', 'screened_at', 'model_version', 'rules_version', 'level'],
    optional: ['red_flag', 'findings', 'request_id'],
  },
  brushing_recorded: {
    required: ['brushing_id', 'child_id', 'started_at', 'duration_s'],
    optional: ['spirit_score', 'slot', 'camera_mode'],
  },
  referral_created: {
    required: ['referral_id', 'child_id', 'level'],
    optional: ['screening_id', 'reason_codes', 'facility_code', 'referred_at'],
  },
  image_upload_registered: { required: ['upload_id', 'child_id', 'object_path'], optional: [] },
  screening_requested: { required: ['request_id', 'child_id', 'reason_code'], optional: ['pain_level'] },
  brushing_proof_registered: {
    required: ['proof_id', 'child_id', 'brushing_event_id', 'size_bytes', 'duration_s', 'mime'],
    optional: [],
  },
};

/** Thrown by builders. `field` is a payload key (or 'payload' / 'event_id'); never a value. */
export class SyncEventError extends Error {
  readonly eventType: SyncEventType;
  readonly field: string;
  constructor(eventType: SyncEventType, field: string) {
    super(`invalid ${eventType} payload: ${field}`);
    this.name = 'SyncEventError';
    this.eventType = eventType;
    this.field = field;
  }
}

/** Options shared by every builder. */
export type BuildOptions = {
  /** Reuse a known event id (tests); default newUuid(). */
  eventId?: string;
  /** Clock for the timestamp range check (ms since epoch). */
  now?: number;
};

// ---------------------------------------------------------------------------------------------
// Normalisers
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function timestampOk(value: unknown, now: number): boolean {
  if (typeof value !== 'string' || !ISO_UTC_RE.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= MIN_TIMESTAMP_MS && ms <= now + MAX_FUTURE_MS;
}

/** Lower-case UUID, or throws. */
function uuidField(type: SyncEventType, field: string, value: unknown): string {
  if (!isUuid(value)) throw new SyncEventError(type, field);
  return value.toLowerCase();
}

/** Any parseable date -> Date#toISOString() (UTC, Z), or throws. Range is checked by validate. */
function isoField(type: SyncEventType, field: string, value: unknown): string {
  if (!(typeof value === 'string' || value instanceof Date)) throw new SyncEventError(type, field);
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) throw new SyncEventError(type, field);
  return new Date(ms).toISOString();
}

/**
 * Sanitises one code to ^[a-z][a-z0-9_]{1,39}$: lower-cased, other characters replaced by '_',
 * truncated to 40. Returns null when it still does not fit (e.g. it starts with a digit).
 */
export function sanitizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
  return CODE_RE.test(code) ? code : null;
}

/** Sanitised, de-duplicated codes (order kept), at most `max`. Invalid ones are dropped. */
export function sanitizeCodes(raw: readonly unknown[], max: number): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const code = sanitizeCode(item);
    if (code && !out.includes(code)) out.push(code);
    if (out.length === max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Validators (server rules, SYNC_EVENTS.md §3)
// ---------------------------------------------------------------------------------------------

function validateKeys(type: SyncEventType, payload: Record<string, unknown>): string | null {
  const { required, optional } = payloadKeys[type];
  for (const key of Object.keys(payload)) {
    if (!required.includes(key) && !optional.includes(key)) return 'unknown_key';
  }
  for (const key of required) {
    if (payload[key] === undefined || payload[key] === null) return key;
  }
  return null;
}

/** Optional key: absent or null counts as empty (SYNC_EVENTS.md §3). */
function present(payload: Record<string, unknown>, key: string): boolean {
  return payload[key] !== undefined && payload[key] !== null;
}

function validateFindings(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_FINDINGS) return false;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    if (Object.keys(item).some((k) => k !== 'class' && k !== 'confidence' && k !== 'box')) return false;
    if (typeof item.class !== 'string' || !CODE_RE.test(item.class)) return false;
    if (item.confidence !== undefined && !isUnitNumber(item.confidence)) return false;
    if (item.box !== undefined && !(Array.isArray(item.box) && item.box.length === 4 && item.box.every(isUnitNumber))) {
      return false;
    }
    return true;
  });
}

function validateCodeArray(value: unknown, max: number): boolean {
  return Array.isArray(value) && value.length <= max && value.every((c) => typeof c === 'string' && CODE_RE.test(c));
}

export type ValidateOptions = {
  now?: number;
  /** Server limits for brushing_proof_registered (size and duration). */
  limits?: Pick<AccountLimits, 'proofMaxBytes' | 'proofMaxDurationS'>;
};

/**
 * Checks one payload against the rules of its type. Returns null when valid, otherwise the
 * offending key ('payload' for a non-object, 'unknown_key' for a key outside the whitelist,
 * 'size' when the JSON text is over 8 KiB). Never returns a value.
 */
export function validatePayload(type: SyncEventType, payload: unknown, options: ValidateOptions = {}): string | null {
  if (!syncEventTypes.includes(type)) return 'type';
  if (!isRecord(payload)) return 'payload';
  const now = options.now ?? Date.now();
  const keyIssue = validateKeys(type, payload);
  if (keyIssue) return keyIssue;
  if (!(typeof payload.child_id === 'string' && LOWER_UUID_RE.test(payload.child_id))) return 'child_id';
  const issue = validateTyped(type, payload, now, options.limits);
  if (issue) return issue;
  if (utf8ByteLength(JSON.stringify(payload)) > MAX_PAYLOAD_BYTES) return 'size';
  return null;
}

function lowerUuid(value: unknown): boolean {
  return typeof value === 'string' && LOWER_UUID_RE.test(value);
}

function validateTyped(
  type: SyncEventType,
  p: Record<string, unknown>,
  now: number,
  limits: ValidateOptions['limits'],
): string | null {
  switch (type) {
    case 'consent_changed': {
      if (!consentTypes.includes(p.consent_type as ConsentType)) return 'consent_type';
      if (p.action !== 'grant' && p.action !== 'withdraw') return 'action';
      if (p.action === 'grant' && !present(p, 'text_version')) return 'text_version';
      if (present(p, 'text_version') && !(typeof p.text_version === 'string' && CONSENT_TEXT_VERSION_RE.test(p.text_version))) {
        return 'text_version';
      }
      if (present(p, 'at') && !timestampOk(p.at, now)) return 'at';
      // paper_via_kader is retired (ADR 018): only in_app is accepted.
      if (present(p, 'method') && p.method !== 'in_app') return 'method';
      return null;
    }
    case 'child_upserted': {
      if (present(p, 'birth_year') && !isIntIn(p.birth_year, 2005, 2035)) return 'birth_year';
      if (present(p, 'birth_month')) {
        if (!isIntIn(p.birth_month, 1, 12)) return 'birth_month';
        if (!present(p, 'birth_year')) return 'birth_month';
      }
      if (present(p, 'allergies') && !validateCodeArray(p.allergies, MAX_ALLERGIES)) return 'allergies';
      return null;
    }
    case 'screening_recorded': {
      if (!lowerUuid(p.screening_id)) return 'screening_id';
      if (!timestampOk(p.screened_at, now)) return 'screened_at';
      if (!(typeof p.model_version === 'string' && VERSION_TAG_RE.test(p.model_version))) return 'model_version';
      if (!(typeof p.rules_version === 'string' && VERSION_TAG_RE.test(p.rules_version))) return 'rules_version';
      if (!serverLevels.includes(p.level as never)) return 'level';
      if (present(p, 'red_flag') && typeof p.red_flag !== 'boolean') return 'red_flag';
      if (present(p, 'findings') && !validateFindings(p.findings)) return 'findings';
      if (present(p, 'request_id') && !lowerUuid(p.request_id)) return 'request_id';
      return null;
    }
    case 'brushing_recorded': {
      if (!lowerUuid(p.brushing_id)) return 'brushing_id';
      if (!timestampOk(p.started_at, now)) return 'started_at';
      if (!isIntIn(p.duration_s, 0, MAX_BRUSHING_DURATION_S)) return 'duration_s';
      if (present(p, 'spirit_score') && !isIntIn(p.spirit_score, 0, 100)) return 'spirit_score';
      if (present(p, 'slot') && p.slot !== 'morning' && p.slot !== 'evening' && p.slot !== 'other') return 'slot';
      if (present(p, 'camera_mode') && typeof p.camera_mode !== 'boolean') return 'camera_mode';
      return null;
    }
    case 'referral_created': {
      if (!lowerUuid(p.referral_id)) return 'referral_id';
      if (present(p, 'screening_id') && !lowerUuid(p.screening_id)) return 'screening_id';
      if (!serverLevels.includes(p.level as never)) return 'level';
      if (present(p, 'reason_codes') && !validateCodeArray(p.reason_codes, MAX_REASON_CODES)) return 'reason_codes';
      if (present(p, 'facility_code') && !(typeof p.facility_code === 'string' && FACILITY_CODE_RE.test(p.facility_code))) {
        return 'facility_code';
      }
      if (present(p, 'referred_at') && !timestampOk(p.referred_at, now)) return 'referred_at';
      return null;
    }
    case 'image_upload_registered': {
      if (!lowerUuid(p.upload_id)) return 'upload_id';
      // <uid>/<child_id>/<upload_id>.jpg|.jpeg, lower case (the uid itself is checked by the server).
      const path = p.object_path;
      const m = typeof path === 'string' ? /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|jpeg)$/.exec(path) : null;
      if (!m || !lowerUuid(m[1]) || m[2] !== p.child_id || m[3] !== p.upload_id) return 'object_path';
      return null;
    }
    case 'screening_requested': {
      if (!lowerUuid(p.request_id)) return 'request_id';
      if (!requestReasons.includes(p.reason_code as RequestReason)) return 'reason_code';
      if (present(p, 'pain_level') && !isIntIn(p.pain_level, 0, 10)) return 'pain_level';
      return null;
    }
    case 'brushing_proof_registered': {
      if (!lowerUuid(p.proof_id)) return 'proof_id';
      if (!lowerUuid(p.brushing_event_id)) return 'brushing_event_id';
      const maxBytes = Math.min(limits?.proofMaxBytes ?? PROOF_HARD_MAX_BYTES, PROOF_HARD_MAX_BYTES);
      if (!isIntIn(p.size_bytes, 1, maxBytes)) return 'size_bytes';
      if (!isIntIn(p.duration_s, 1, limits?.proofMaxDurationS ?? Number.MAX_SAFE_INTEGER)) return 'duration_s';
      if (!proofMimes.includes(p.mime as ProofMime)) return 'mime';
      return null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

function finish<T extends SyncEventType>(
  type: T,
  childId: string,
  payload: Record<string, unknown>,
  options: BuildOptions & ValidateOptions,
): BuiltEvent<T> {
  const eventId = options.eventId ?? newUuid();
  if (!isUuid(eventId)) throw new SyncEventError(type, 'event_id');
  const issue = validatePayload(type, payload, options);
  if (issue) throw new SyncEventError(type, issue);
  return { eventId: eventId.toLowerCase(), type, childId, payloadJson: JSON.stringify(payload) };
}

export type ConsentChangedInput = {
  childId: string;
  consentType: ConsentType;
  action: ConsentAction;
  /** Required for 'grant' (consentTextVersions); ignored for 'withdraw'. */
  textVersion?: string | null;
  /** When the parent/teen made the choice; default now. */
  at?: string | Date;
};

/** consent_changed (§3.1). Always `method: 'in_app'`; `text_version` only on grants. */
export function buildConsentChanged(input: ConsentChangedInput, options: BuildOptions = {}): BuiltEvent<'consent_changed'> {
  const type = 'consent_changed';
  const childId = uuidField(type, 'child_id', input.childId);
  const payload: Record<string, unknown> = {
    child_id: childId,
    consent_type: input.consentType,
    action: input.action,
  };
  if (input.action === 'grant') payload.text_version = input.textVersion ?? null;
  payload.at = isoField(type, 'at', input.at ?? new Date(options.now ?? Date.now()));
  payload.method = 'in_app';
  return finish(type, childId, payload, options);
}

export type ChildUpsertedInput = {
  childId: string;
  birthYear: number | null;
  birthMonth: number | null;
  allergies: readonly string[];
};

/**
 * child_upserted (§3.2). Full-replace semantics: all three keys are always sent. A month
 * without a year is dropped (the server requires the year first); allergy codes are
 * sanitised and capped at 10 so one bad code cannot block the profile.
 */
export function buildChildUpserted(input: ChildUpsertedInput, options: BuildOptions = {}): BuiltEvent<'child_upserted'> {
  const type = 'child_upserted';
  const childId = uuidField(type, 'child_id', input.childId);
  const year = input.birthYear ?? null;
  const payload = {
    child_id: childId,
    birth_year: year,
    birth_month: year === null ? null : (input.birthMonth ?? null),
    allergies: sanitizeCodes(input.allergies, MAX_ALLERGIES),
  };
  return finish(type, childId, payload, options);
}

export type ScreeningRecordedInput = Pick<
  ScreeningRecord,
  'id' | 'childId' | 'screenedAt' | 'modelVersion' | 'rulesVersion' | 'level' | 'redFlag' | 'findings' | 'requestId'
>;

/**
 * screening_recorded (§3.3). `request_id` is sent only when set: the key is optional, and a
 * pre-ADR 017 backend rejects it as an unknown key (final schema_invalid). Findings carry only
 * class, confidence and box (no rel_area, ADR 014).
 */
export function buildScreeningRecorded(
  input: ScreeningRecordedInput,
  options: BuildOptions = {},
): BuiltEvent<'screening_recorded'> {
  const type = 'screening_recorded';
  const childId = uuidField(type, 'child_id', input.childId);
  const payload: Record<string, unknown> = {
    screening_id: uuidField(type, 'screening_id', input.id),
    child_id: childId,
    screened_at: isoField(type, 'screened_at', input.screenedAt),
    model_version: input.modelVersion ?? NO_MODEL_VERSION,
    rules_version: input.rulesVersion,
    level: toServerLevel(input.level),
    red_flag: input.redFlag === true,
    findings: input.findings.map((f) => ({ class: f.class, confidence: f.confidence, box: [...f.box] })),
  };
  if (input.requestId) payload.request_id = uuidField(type, 'request_id', input.requestId);
  return finish(type, childId, payload, options);
}

export type BrushingRecordedInput = Pick<
  BrushingRecord,
  'id' | 'childId' | 'startedAt' | 'durationS' | 'spiritScore' | 'slot' | 'cameraMode'
>;

/**
 * brushing_recorded (§3.4). duration_s is rounded to an integer and capped at 1800 (a longer
 * session is still a valid brushing day); spirit_score is rounded. NaN/negative input throws.
 */
export function buildBrushingRecorded(input: BrushingRecordedInput, options: BuildOptions = {}): BuiltEvent<'brushing_recorded'> {
  const type = 'brushing_recorded';
  const childId = uuidField(type, 'child_id', input.childId);
  if (!(typeof input.durationS === 'number' && Number.isFinite(input.durationS) && input.durationS >= 0)) {
    throw new SyncEventError(type, 'duration_s');
  }
  let spirit: number | null = null;
  if (input.spiritScore !== null && input.spiritScore !== undefined) {
    if (!Number.isFinite(input.spiritScore)) throw new SyncEventError(type, 'spirit_score');
    spirit = Math.round(input.spiritScore);
  }
  const slot: BrushingSlot = input.slot ?? 'other';
  const payload = {
    brushing_id: uuidField(type, 'brushing_id', input.id),
    child_id: childId,
    started_at: isoField(type, 'started_at', input.startedAt),
    duration_s: Math.min(MAX_BRUSHING_DURATION_S, Math.round(input.durationS)),
    spirit_score: spirit,
    slot,
    camera_mode: input.cameraMode === true,
  };
  return finish(type, childId, payload, options);
}

export type ReferralCreatedInput = {
  referralId: string;
  childId: string;
  /** Screening this referral belongs to (send after its event is applied); null = none. */
  screeningId: string | null;
  level: AppLevel;
  /** Triage reason ids (e.g. RF_FACIAL_SWELLING); lower-cased and sanitised. */
  reasonCodes: readonly string[];
  facilityCode?: string | null;
  referredAt?: string | Date | null;
};

/** referral_created (§3.5). */
export function buildReferralCreated(input: ReferralCreatedInput, options: BuildOptions = {}): BuiltEvent<'referral_created'> {
  const type = 'referral_created';
  const childId = uuidField(type, 'child_id', input.childId);
  const payload: Record<string, unknown> = {
    referral_id: uuidField(type, 'referral_id', input.referralId),
    child_id: childId,
  };
  if (input.screeningId) payload.screening_id = uuidField(type, 'screening_id', input.screeningId);
  payload.level = toServerLevel(input.level);
  payload.reason_codes = sanitizeCodes(input.reasonCodes, MAX_REASON_CODES);
  if (input.facilityCode) payload.facility_code = input.facilityCode;
  if (input.referredAt) payload.referred_at = isoField(type, 'referred_at', input.referredAt);
  return finish(type, childId, payload, options);
}

export type ImageUploadRegisteredInput = { uploadId: string; childId: string; objectPath: string };

/**
 * image_upload_registered (§3.6). Only valid after the photo is in Storage; the
 * `dataset_contribution` flag is off until KEPK approval, so nothing in the app sends this yet.
 */
export function buildImageUploadRegistered(
  input: ImageUploadRegisteredInput,
  options: BuildOptions = {},
): BuiltEvent<'image_upload_registered'> {
  const type = 'image_upload_registered';
  const childId = uuidField(type, 'child_id', input.childId);
  const payload = {
    upload_id: uuidField(type, 'upload_id', input.uploadId),
    child_id: childId,
    object_path: input.objectPath,
  };
  return finish(type, childId, payload, options);
}

export type ScreeningRequestedInput = {
  requestId: string;
  childId: string;
  reasonCode: RequestReason;
  /** 0–10 or null (rounded). */
  painLevel: number | null;
};

/** screening_requested (§3.7, child accounts only). pain_level is omitted when null. */
export function buildScreeningRequested(
  input: ScreeningRequestedInput,
  options: BuildOptions = {},
): BuiltEvent<'screening_requested'> {
  const type = 'screening_requested';
  const childId = uuidField(type, 'child_id', input.childId);
  const payload: Record<string, unknown> = {
    request_id: uuidField(type, 'request_id', input.requestId),
    child_id: childId,
    reason_code: input.reasonCode,
  };
  if (input.painLevel !== null && input.painLevel !== undefined) {
    if (!Number.isFinite(input.painLevel)) throw new SyncEventError(type, 'pain_level');
    payload.pain_level = Math.round(input.painLevel);
  }
  return finish(type, childId, payload, options);
}

export type BrushingProofRegisteredInput = {
  proofId: string;
  childId: string;
  /** brushing_id of this child's brushing_recorded event (one proof per session). */
  brushingEventId: string;
  sizeBytes: number;
  /** Seconds; rounded to an integer (>= 1). */
  durationS: number;
  mime: ProofMime;
};

/**
 * brushing_proof_registered (§3.8). Pass `limits` (my_account().limits) to refuse a clip the
 * server would reject with limit_exceeded (final) before anything is queued.
 */
export function buildBrushingProofRegistered(
  input: BrushingProofRegisteredInput,
  options: BuildOptions & Pick<ValidateOptions, 'limits'> = {},
): BuiltEvent<'brushing_proof_registered'> {
  const type = 'brushing_proof_registered';
  const childId = uuidField(type, 'child_id', input.childId);
  if (!Number.isFinite(input.durationS)) throw new SyncEventError(type, 'duration_s');
  const payload = {
    proof_id: uuidField(type, 'proof_id', input.proofId),
    child_id: childId,
    brushing_event_id: uuidField(type, 'brushing_event_id', input.brushingEventId),
    size_bytes: input.sizeBytes,
    duration_s: Math.round(input.durationS),
    mime: input.mime,
  };
  return finish(type, childId, payload, options);
}

/**
 * Re-validates a stored outbox event (type known, payload JSON parses, child_id matches,
 * payload passes validatePayload). Used when the outbox hydrates from storage.
 */
export function isWellFormedEvent(event: { eventId: unknown; type: unknown; childId: unknown; payloadJson: unknown }): boolean {
  if (!isUuid(event.eventId) || typeof event.payloadJson !== 'string') return false;
  if (!syncEventTypes.includes(event.type as SyncEventType)) return false;
  try {
    const payload: unknown = JSON.parse(event.payloadJson);
    if (!isRecord(payload) || payload.child_id !== event.childId) return false;
    // Timestamps are not re-checked against the clock here: an event queued long ago is
    // still the same event (the server decides).
    return validatePayload(event.type as SyncEventType, payload, { now: Number.MAX_SAFE_INTEGER - MAX_FUTURE_MS }) === null;
  } catch {
    return false;
  }
}
