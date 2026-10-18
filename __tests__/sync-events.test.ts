// sync_events payload builders and validators (src/core/sync/events.ts) against
// backend/docs/api/SYNC_EVENTS.md §3: whitelisted keys, formats, ranges, normalisation.
import {
  NO_MODEL_VERSION,
  SyncEventError,
  buildBrushingProofRegistered,
  buildBrushingRecorded,
  buildChildUpserted,
  buildConsentChanged,
  buildImageUploadRegistered,
  buildReferralCreated,
  buildScreeningRecorded,
  buildScreeningRequested,
  isWellFormedEvent,
  sanitizeCode,
  sanitizeCodes,
  validatePayload,
} from '@/core/sync/events';
import type { ScreeningRecord } from '@/domain/models';

const CHILD = 'c0c0c0c0-0000-4000-8000-000000000001';
const CHILD_UPPER = 'C0C0C0C0-0000-4000-8000-000000000001';
const UID = '0b0b0b0b-0000-4000-8000-000000000001';
const ID1 = '55555555-5555-4555-8555-555555555501';
const ID2 = '66666666-6666-4666-8666-666666666601';
const EVENT = '11111111-1111-4111-8111-111111111101';
const NOW = Date.parse('2026-10-18T05:00:00Z');
const opts = { now: NOW, eventId: EVENT };

const payload = (json: string) => JSON.parse(json) as Record<string, unknown>;

function screening(over: Partial<ScreeningRecord> = {}): ScreeningRecord {
  return {
    id: ID1,
    childId: CHILD,
    screenedAt: '2026-10-11T03:12:45.000Z',
    level: 'urgent',
    redFlag: false,
    reasons: [{ id: 'DET_CARIES_PRIMARY', text: 'x' }],
    adviceIds: [],
    referralTemplateId: 'r',
    rulesVersion: '0.2.0-draft',
    modelVersion: '0.1.0',
    photoTaken: true,
    photoStatus: 'assessed',
    findings: [{ class: 'caries_primary', confidence: 0.82, box: [0.31, 0.42, 0.08, 0.1] }],
    answers: { facial_swelling: 'no' },
    pain: 2,
    ageMonths: 100,
    synced: false,
    requestId: null,
    referralId: null,
    ...over,
  };
}

function expectError(fn: () => unknown, field: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SyncEventError);
    expect((e as SyncEventError).field).toBe(field);
    // Errors name the key, never a value.
    expect((e as Error).message).not.toMatch(/[0-9a-f]{8}-/i);
    return;
  }
  throw new Error('expected a SyncEventError');
}

describe('consent_changed', () => {
  it('builds a grant with text_version, at (UTC Z) and method in_app', () => {
    const ev = buildConsentChanged(
      { childId: CHILD_UPPER, consentType: 'd', action: 'grant', textVersion: 'consent-d-v0.1-draft-id', at: '2026-10-11T10:00:00+07:00' },
      opts,
    );
    expect(ev).toMatchObject({ eventId: EVENT, type: 'consent_changed', childId: CHILD });
    expect(payload(ev.payloadJson)).toEqual({
      child_id: CHILD,
      consent_type: 'd',
      action: 'grant',
      text_version: 'consent-d-v0.1-draft-id',
      at: '2026-10-11T03:00:00.000Z',
      method: 'in_app',
    });
  });

  it('omits text_version on a withdrawal', () => {
    const ev = buildConsentChanged({ childId: CHILD, consentType: 'b', action: 'withdraw', textVersion: 'x', at: new Date(NOW) }, opts);
    expect(payload(ev.payloadJson)).not.toHaveProperty('text_version');
  });

  it('refuses a grant without a valid text version, or a time out of range', () => {
    expectError(() => buildConsentChanged({ childId: CHILD, consentType: 'b', action: 'grant' }, opts), 'text_version');
    expectError(
      () => buildConsentChanged({ childId: CHILD, consentType: 'b', action: 'grant', textVersion: 'has space' }, opts),
      'text_version',
    );
    expectError(
      () => buildConsentChanged({ childId: CHILD, consentType: 'b', action: 'grant', textVersion: 'v1', at: '2019-12-31T00:00:00Z' }, opts),
      'at',
    );
    expectError(
      () => buildConsentChanged({ childId: CHILD, consentType: 'b', action: 'grant', textVersion: 'v1', at: '2026-10-20T00:00:00Z' }, opts),
      'at',
    );
    expectError(() => buildConsentChanged({ childId: 'not-a-uuid', consentType: 'b', action: 'withdraw' }, opts), 'child_id');
  });

  it('rejects paper_via_kader and unknown keys in the validator', () => {
    const base = { child_id: CHILD, consent_type: 'a', action: 'withdraw' };
    expect(validatePayload('consent_changed', base, { now: NOW })).toBeNull();
    expect(validatePayload('consent_changed', { ...base, method: 'paper_via_kader' }, { now: NOW })).toBe('method');
    expect(validatePayload('consent_changed', { ...base, nickname: 'Adik' }, { now: NOW })).toBe('unknown_key');
    expect(validatePayload('consent_changed', { ...base, consent_type: 'e' }, { now: NOW })).toBe('consent_type');
  });
});

describe('child_upserted', () => {
  it('always sends all three keys (full replace) and sanitises allergy codes', () => {
    const ev = buildChildUpserted({ childId: CHILD, birthYear: 2016, birthMonth: 7, allergies: ['SLS', 'flavor mint', 'sls', '9bad'] }, opts);
    expect(payload(ev.payloadJson)).toEqual({ child_id: CHILD, birth_year: 2016, birth_month: 7, allergies: ['sls', 'flavor_mint'] });
  });

  it('drops a month without a year and sends nulls explicitly', () => {
    const ev = buildChildUpserted({ childId: CHILD, birthYear: null, birthMonth: 4, allergies: [] }, opts);
    expect(ev.payloadJson).toBe(`{"child_id":"${CHILD}","birth_year":null,"birth_month":null,"allergies":[]}`);
  });

  it('refuses years outside 2005..2035', () => {
    expectError(() => buildChildUpserted({ childId: CHILD, birthYear: 2004, birthMonth: null, allergies: [] }, opts), 'birth_year');
    expect(validatePayload('child_upserted', { child_id: CHILD, birth_year: 2016, birth_month: 13 })).toBe('birth_month');
  });
});

describe('screening_recorded', () => {
  it('maps the level, keeps only class/confidence/box and omits a null request_id', () => {
    const ev = buildScreeningRecorded(screening(), opts);
    const p = payload(ev.payloadJson);
    expect(p).toEqual({
      screening_id: ID1,
      child_id: CHILD,
      screened_at: '2026-10-11T03:12:45.000Z',
      model_version: '0.1.0',
      rules_version: '0.2.0-draft',
      level: 'orange',
      red_flag: false,
      findings: [{ class: 'caries_primary', confidence: 0.82, box: [0.31, 0.42, 0.08, 0.1] }],
    });
    expect(ev.payloadJson).not.toMatch(/rel_area|nickname|answers|reasons/);
  });

  it('sends the no-detector model version and request_id when set', () => {
    const ev = buildScreeningRecorded(screening({ modelVersion: null, requestId: ID2.toUpperCase(), level: 'emergency', redFlag: true }), opts);
    expect(payload(ev.payloadJson)).toMatchObject({ model_version: NO_MODEL_VERSION, request_id: ID2, level: 'red', red_flag: true });
    expect(validatePayload('screening_recorded', payload(ev.payloadJson), { now: NOW })).toBeNull();
  });

  it('refuses bad versions, findings and rel_area', () => {
    expectError(() => buildScreeningRecorded(screening({ rulesVersion: 'draft' }), opts), 'rules_version');
    expectError(
      () => buildScreeningRecorded(screening({ findings: [{ class: 'caries_primary', confidence: 1.2, box: [0, 0, 0, 0] }] }), opts),
      'findings',
    );
    const p = payload(buildScreeningRecorded(screening(), opts).payloadJson);
    const withArea = { ...p, findings: [{ class: 'caries_primary', confidence: 0.5, box: [0, 0, 0.1, 0.1], rel_area: 0.01 }] };
    expect(validatePayload('screening_recorded', withArea, { now: NOW })).toBe('findings');
    expect(validatePayload('screening_recorded', { ...p, level: 'purple' }, { now: NOW })).toBe('level');
  });
});

describe('brushing_recorded', () => {
  const base = {
    id: ID2,
    childId: CHILD,
    startedAt: '2026-10-11T00:30:00Z',
    durationS: 119.6,
    spiritScore: 76.6,
    slot: 'morning' as const,
    cameraMode: true,
  };

  it('rounds durations and scores to integers', () => {
    const ev = buildBrushingRecorded(base, opts);
    expect(payload(ev.payloadJson)).toEqual({
      brushing_id: ID2,
      child_id: CHILD,
      started_at: '2026-10-11T00:30:00.000Z',
      duration_s: 120,
      spirit_score: 77,
      slot: 'morning',
      camera_mode: true,
    });
  });

  it('caps very long sessions at 1800 s and refuses invalid durations', () => {
    expect(payload(buildBrushingRecorded({ ...base, durationS: 5000 }, opts).payloadJson).duration_s).toBe(1800);
    expectError(() => buildBrushingRecorded({ ...base, durationS: Number.NaN }, opts), 'duration_s');
    expectError(() => buildBrushingRecorded({ ...base, durationS: -1 }, opts), 'duration_s');
    expectError(() => buildBrushingRecorded({ ...base, spiritScore: 101 }, opts), 'spirit_score');
    expect(validatePayload('brushing_recorded', { ...payload(buildBrushingRecorded(base, opts).payloadJson), duration_s: 1.5 })).toBe(
      'duration_s',
    );
  });
});

describe('referral_created', () => {
  it('lower-cases reason codes and drops invalid ones', () => {
    const ev = buildReferralCreated(
      {
        referralId: ID2,
        childId: CHILD,
        screeningId: ID1,
        level: 'urgent',
        reasonCodes: ['DET_CARIES_PRIMARY', 'RF_FACIAL_SWELLING', 'det_caries_primary', '1x', ''],
        facilityCode: 'PKM-3201-01',
        referredAt: '2026-10-11T03:15:00Z',
      },
      opts,
    );
    expect(payload(ev.payloadJson)).toEqual({
      referral_id: ID2,
      child_id: CHILD,
      screening_id: ID1,
      level: 'orange',
      reason_codes: ['det_caries_primary', 'rf_facial_swelling'],
      facility_code: 'PKM-3201-01',
      referred_at: '2026-10-11T03:15:00.000Z',
    });
  });

  it('refuses a malformed facility code', () => {
    expectError(
      () => buildReferralCreated({ referralId: ID2, childId: CHILD, screeningId: null, level: 'routine', reasonCodes: [], facilityCode: 'pkm 1' }, opts),
      'facility_code',
    );
  });

  it('caps reason codes at 20', () => {
    const codes = Array.from({ length: 30 }, (_, i) => `code_${i}`);
    expect(sanitizeCodes(codes, 20)).toHaveLength(20);
    expect(sanitizeCode('A'.repeat(60))).toHaveLength(40);
    expect(sanitizeCode('_x')).toBeNull();
  });
});

describe('image_upload_registered', () => {
  it('accepts <uid>/<child_id>/<upload_id>.jpg only', () => {
    const ev = buildImageUploadRegistered({ uploadId: ID1, childId: CHILD, objectPath: `${UID}/${CHILD}/${ID1}.jpg` }, opts);
    expect(payload(ev.payloadJson).object_path).toBe(`${UID}/${CHILD}/${ID1}.jpg`);
    expectError(() => buildImageUploadRegistered({ uploadId: ID1, childId: CHILD, objectPath: `${UID}/${CHILD}/${ID2}.jpg` }, opts), 'object_path');
    expectError(() => buildImageUploadRegistered({ uploadId: ID1, childId: CHILD, objectPath: `${UID}/${CHILD}/${ID1}.png` }, opts), 'object_path');
  });
});

describe('screening_requested', () => {
  it('sends reason code and pain level (omitted when null)', () => {
    const ev = buildScreeningRequested({ requestId: ID1, childId: CHILD, reasonCode: 'toothache', painLevel: 6 }, opts);
    expect(payload(ev.payloadJson)).toEqual({ request_id: ID1, child_id: CHILD, reason_code: 'toothache', pain_level: 6 });
    const noPain = buildScreeningRequested({ requestId: ID1, childId: CHILD, reasonCode: 'other', painLevel: null }, opts);
    expect(payload(noPain.payloadJson)).not.toHaveProperty('pain_level');
  });

  it('refuses pain levels above 10 and unknown reasons', () => {
    expectError(() => buildScreeningRequested({ requestId: ID1, childId: CHILD, reasonCode: 'toothache', painLevel: 11 }, opts), 'pain_level');
    expect(validatePayload('screening_requested', { request_id: ID1, child_id: CHILD, reason_code: 'headache' })).toBe('reason_code');
  });
});

describe('brushing_proof_registered', () => {
  const input = { proofId: ID1, childId: CHILD, brushingEventId: ID2, sizeBytes: 3_400_000, durationS: 119.7, mime: 'video/mp4' as const };

  it('builds all required keys with integer duration', () => {
    const ev = buildBrushingProofRegistered(input, opts);
    expect(payload(ev.payloadJson)).toEqual({
      proof_id: ID1,
      child_id: CHILD,
      brushing_event_id: ID2,
      size_bytes: 3_400_000,
      duration_s: 120,
      mime: 'video/mp4',
    });
  });

  it('refuses clips over the server limits, zero sizes and other formats', () => {
    const limits = { proofMaxBytes: 10_485_760, proofMaxDurationS: 180 };
    expectError(() => buildBrushingProofRegistered({ ...input, sizeBytes: 11_000_000 }, { ...opts, limits }), 'size_bytes');
    expectError(() => buildBrushingProofRegistered({ ...input, durationS: 181 }, { ...opts, limits }), 'duration_s');
    expectError(() => buildBrushingProofRegistered({ ...input, sizeBytes: 0 }, opts), 'size_bytes');
    expectError(() => buildBrushingProofRegistered({ ...input, mime: 'video/webm' as never }, opts), 'mime');
  });
});

describe('envelope helpers', () => {
  it('stores the exact JSON text and recognises it again', () => {
    const ev = buildBrushingRecorded(
      { id: ID2, childId: CHILD, startedAt: '2026-10-11T00:30:00Z', durationS: 120, spiritScore: null, slot: 'other', cameraMode: false },
      { now: NOW },
    );
    expect(JSON.stringify(JSON.parse(ev.payloadJson))).toBe(ev.payloadJson);
    expect(isWellFormedEvent(ev)).toBe(true);
    expect(isWellFormedEvent({ ...ev, childId: ID1 })).toBe(false);
    expect(isWellFormedEvent({ ...ev, type: 'nope' })).toBe(false);
    expect(isWellFormedEvent({ ...ev, payloadJson: '{' })).toBe(false);
  });

  it('refuses payloads over 8 KiB', () => {
    const big = { child_id: CHILD, birth_year: null, birth_month: null, allergies: [] as string[] };
    expect(validatePayload('child_upserted', big)).toBeNull();
    const x = Math.PI / 4; // 18 characters as JSON
    const findings = Array.from({ length: 50 }, () => ({ class: 'c'.repeat(40), confidence: x, box: [x, x, x, x] }));
    const p = payload(buildScreeningRecorded(screening(), opts).payloadJson);
    expect(validatePayload('screening_recorded', { ...p, findings }, { now: NOW })).toBe('size');
  });
});
