import { id } from '@/core/i18n/id';
import { proofFailureText, proofSkipText, proofUploadText } from '@/features/brushing/proof-copy';
import type { ProofUpload } from '@/features/brushing/proof-uploads';

jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: {}, UploadType: { BINARY_CONTENT: 0 } }));

const r = id.recording;

const item = (over: Partial<ProofUpload>): ProofUpload => ({
  proofId: 'p',
  eventId: 'e',
  childId: 'c',
  ownerId: 'o',
  audience: 'parent',
  mime: 'video/mp4',
  fileUri: null,
  sizeBytes: 1,
  durationS: 1,
  createdAt: 0,
  state: 'waiting',
  progress: 0,
  attempts: 0,
  nextAttemptAt: null,
  retryReason: null,
  failure: null,
  finishedAt: null,
  ...over,
});

describe('proof copy', () => {
  it('limit_exceeded says the session still counts', () => {
    expect(proofFailureText('limit_exceeded', 'parent')).toBe('Video hari ini sudah cukup. Sesi sikat gigi tetap tercatat.');
  });

  it('consent_required tells the child to ask the parent, the teen to turn it on', () => {
    expect(proofFailureText('consent_required', 'parent')).toBe(r.failures.consentParent);
    expect(proofFailureText('consent_required', 'self')).toBe(r.failures.consentSelf);
  });

  it.each([
    ['feature_disabled', r.failures.featureDisabled],
    ['forbidden', r.failures.forbidden],
    ['deletion_pending', r.failures.deletionPending],
    ['expired', r.failures.expired],
    ['file_missing', r.failures.fileMissing],
    ['schema_invalid', r.failures.other],
    ['dependency_rejected', r.failures.other],
    ['not_registered', r.failures.other],
    ['upload_refused', r.failures.other],
  ] as const)('%s', (failure, text) => {
    expect(proofFailureText(failure, 'parent')).toBe(text);
  });

  it('upload states', () => {
    expect(proofUploadText(null, 'parent')).toBe(r.status.preparing);
    expect(proofUploadText(item({ state: 'waiting' }), 'parent')).toBe(r.status.waiting);
    expect(proofUploadText(item({ state: 'uploading', progress: 0.374 }), 'parent')).toBe(r.status.uploading(37));
    expect(proofUploadText(item({ state: 'retrying' }), 'parent')).toBe(r.status.retrying);
    expect(proofUploadText(item({ state: 'done' }), 'parent')).toBe(r.status.doneParent);
    expect(proofUploadText(item({ state: 'done' }), 'self')).toBe(r.status.doneSelf);
    expect(proofUploadText(item({ state: 'failed', failure: 'limit_exceeded' }), 'self')).toBe(r.failures.limitExceeded);
  });

  it('skip reasons', () => {
    expect(proofSkipText('too_large')).toBe(r.skipped.tooLarge);
    expect(proofSkipText('too_long')).toBe(r.skipped.tooLong);
    expect(proofSkipText('too_short')).toBe(r.skipped.tooShort);
    expect(proofSkipText('missing')).toBe(r.skipped.missing);
    expect(proofSkipText('not_sent')).toBe(r.skipped.notSent);
  });
});
