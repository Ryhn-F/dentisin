// Upload states / failures -> the sentences in id.recording (shared by the done screen and any
// other screen that shows useProofUploads()).

import { id } from '@/core/i18n/id';

import type { ProofAudience } from './camera-availability';
import type { ProofSkipReason } from './finish-session';
import type { ProofUpload, ProofUploadFailure } from './proof-uploads';

const r = id.recording;

export function proofFailureText(failure: ProofUploadFailure | null, audience: ProofAudience): string {
  switch (failure) {
    case 'limit_exceeded':
      return r.failures.limitExceeded;
    case 'consent_required':
      return audience === 'self' ? r.failures.consentSelf : r.failures.consentParent;
    case 'feature_disabled':
      return r.failures.featureDisabled;
    case 'forbidden':
      return r.failures.forbidden;
    case 'deletion_pending':
      return r.failures.deletionPending;
    case 'expired':
      return r.failures.expired;
    case 'file_missing':
      return r.failures.fileMissing;
    default:
      return r.failures.other;
  }
}

export function proofSkipText(reason: ProofSkipReason): string {
  switch (reason) {
    case 'too_short':
      return r.skipped.tooShort;
    case 'too_large':
      return r.skipped.tooLarge;
    case 'too_long':
      return r.skipped.tooLong;
    case 'missing':
      return r.skipped.missing;
    case 'not_sent':
      return r.skipped.notSent;
  }
}

/** One-line status of an upload (null item = still being prepared). */
export function proofUploadText(item: ProofUpload | null, audience: ProofAudience): string {
  if (!item) return r.status.preparing;
  switch (item.state) {
    case 'waiting':
      return r.status.waiting;
    case 'uploading':
      return r.status.uploading(Math.round(item.progress * 100));
    case 'retrying':
      return r.status.retrying;
    case 'done':
      return audience === 'self' ? r.status.doneSelf : r.status.doneParent;
    case 'failed':
      return proofFailureText(item.failure, audience);
  }
}
