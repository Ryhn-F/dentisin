// End of a brushing session: record it (streak) and, when a proof clip was recorded, check it on
// the phone and hand it to the sync bridge + upload queue (ACCOUNTS_AND_FLOWS.md §2.4, §2.8).
//
// Order (SYNC_EVENTS.md §5.6): addBrushing -> brushing_recorded (store hook) ->
// brushing_proof_registered (depends on it) -> upload after `applied` (./proof-uploads.ts).
// The session is always recorded first: a video problem never costs the child its streak.

import { recordBrushingProof } from '@/core/sync/bridge';
import { outbox } from '@/core/sync/outbox';
import { newUuid } from '@/core/util/uuid';
import { useLocalData, type NewBrushingInput } from '@/data/local-store';
import type { AccountLimits, BrushingRecord } from '@/domain/models';

import { MIN_PROOF_S, MIN_RECORD_S, proofMimeForUri } from './brushing-session';
import type { CameraAvailability, ProofAudience } from './camera-availability';
import { expoProofFiles } from './proof-files';
import { proofUploads, type EnqueueProofInput, type ProofUpload } from './proof-uploads';

export type RecordedClip = {
  /** File written by expo-camera (app cache). */
  uri: string;
  /** Active recording time in seconds. */
  durationS: number;
};

export type ProofSkipReason = 'too_short' | 'too_large' | 'too_long' | 'missing' | 'not_sent';

export type ProofOutcome =
  | { kind: 'none' }
  | { kind: 'queued'; proofId: string; audience: ProofAudience }
  | { kind: 'skipped'; reason: ProofSkipReason };

export type FinishResult = { brushing: BrushingRecord | null; proof: ProofOutcome };

export type ProofTarget = Extract<CameraAvailability, { available: true }>;

export type FinishInput = {
  /** Active child of a timer session (null = no profile: nothing is recorded). */
  childId: string | null;
  elapsedS: number;
  clip: RecordedClip | null;
  /** Camera availability frozen when recording started (null in timer mode). */
  target: ProofTarget | null;
  limits: Pick<AccountLimits, 'proofMaxBytes' | 'proofMaxDurationS'>;
  /** Signed-in user (upload queue scope). */
  userId: string | null;
  /** Whether the session ran in camera mode (mirror or recording). */
  cameraMode?: boolean;
};

export type FinishDeps = {
  addBrushing: (childId: string, input: NewBrushingInput) => BrushingRecord;
  recordBrushingProof: typeof recordBrushingProof;
  fileSize: (uri: string) => number | null;
  removeFile: (uri: string) => void;
  enqueueUpload: (input: EnqueueProofInput) => Promise<ProofUpload | null>;
  flush: () => void;
  newId: () => string;
};

const defaultDeps: FinishDeps = {
  addBrushing: (childId, input) => useLocalData.getState().addBrushing(childId, input),
  recordBrushingProof,
  fileSize: (uri) => expoProofFiles.size(uri),
  removeFile: (uri) => expoProofFiles.remove(uri),
  enqueueUpload: (input) => proofUploads.enqueue(input),
  flush: () => {
    // Send now instead of after the outbox's debounce; failures are handled by the outbox.
    void outbox.flush();
  },
  newId: newUuid,
};

export async function finishBrushingSession(input: FinishInput, deps: FinishDeps = defaultDeps): Promise<FinishResult> {
  const { clip, target } = input;
  const skip = (reason: ProofSkipReason, removeClip = true): ProofOutcome => {
    if (clip && removeClip) deps.removeFile(clip.uri);
    return { kind: 'skipped', reason };
  };

  // A proof belongs to the child the camera was allowed for; a timer session to the active child.
  const childId = clip && target ? target.childId : input.childId;
  const elapsedS = Math.max(0, Math.round(input.elapsedS));
  if (!childId || elapsedS < MIN_RECORD_S) {
    return { brushing: null, proof: clip ? skip('too_short') : { kind: 'none' } };
  }

  const brushing = deps.addBrushing(childId, {
    durationS: elapsedS,
    cameraMode: input.cameraMode ?? (clip !== null),
  });
  if (!clip) return { brushing, proof: { kind: 'none' } };
  if (!target || !input.userId) return { brushing, proof: skip('not_sent') };

  // Checked on the phone first: nothing over the limits is ever sent (§2.4 step 2).
  if (clip.durationS < MIN_PROOF_S) return { brushing, proof: skip('too_short') };
  const durationS = Math.max(1, Math.round(clip.durationS));
  const sizeBytes = deps.fileSize(clip.uri);
  if (sizeBytes === null || sizeBytes < 1) return { brushing, proof: skip('missing') };
  if (sizeBytes > input.limits.proofMaxBytes) return { brushing, proof: skip('too_large') };
  if (durationS > input.limits.proofMaxDurationS) return { brushing, proof: skip('too_long') };

  const mime = proofMimeForUri(clip.uri);
  const proofId = deps.newId();
  const eventId = deps.recordBrushingProof({
    proofId,
    childId,
    brushingRecordId: brushing.id,
    sizeBytes,
    durationS,
    mime,
  });
  if (!eventId) return { brushing, proof: skip('not_sent') };

  const item = await deps.enqueueUpload({
    userId: input.userId,
    proofId,
    eventId,
    childId,
    ownerId: target.ownerId,
    audience: target.audience,
    mime,
    sourceUri: clip.uri,
    sizeBytes,
    durationS,
  });
  // The queue deletes the clip itself when it cannot take it.
  if (!item) return { brushing, proof: skip('not_sent', false) };
  deps.flush();
  return { brushing, proof: { kind: 'queued', proofId: item.proofId, audience: target.audience } };
}
