// State of the one screening in progress, shared by the flow screens. In memory only; the photo
// file is deleted on retake and when the session ends (reset). A photo that passed the on-device
// quality gate is assessed by the DentisAI API (POST /v1/screening/photo, ADR 020).
import { create } from 'zustand';

import { useAccount } from '@/core/account/account-store';
import { evaluateScreening, screenPhoto, type UnavailableReason } from '@/core/api/screening-api';
import { useSession } from '@/core/auth/session-store';
import { isApiConfigured } from '@/core/config';
import { recordScreening } from '@/core/sync/bridge';
import { isUuid, newUuid } from '@/core/util/uuid';
import { useLocalData } from '@/data/local-store';
import type { ChildProfile, ScreeningRecord } from '@/domain/models';
import type { Answer } from '@/domain/triage';
import { discardPhoto, type PreparedPhoto, type UploadPhoto } from '@/ml/photo';
import type { QualityResult } from '@/ml/quality-gate';

import {
  ageInMonths,
  buildTriageInput,
  hasRedFlag,
  noPhotoAnalysis,
  runTriage,
  type Answers,
  type Outcome,
  type Pain,
  type PhotoAnalysis,
  withLowestForUnasked,
} from './pipeline';
import { applyServerResult, canUseServer, shouldEvaluateOnServer, type ServerAccess, type TriageSource } from './server-check';

export type Capture = { uri: string; width: number; height: number };
/**
 * Where the finished result went:
 * - saved: kept on this phone (consent (a)); the local store hands it to the sync bridge;
 * - sent_only: consent (a) off but (b) on: screening_recorded queued, nothing kept locally;
 * - no_consent: neither kept nor sent (no (a), and (b) off / signed out / guest);
 * - no_child: no child profile chosen.
 */
export type SaveState = 'saved' | 'sent_only' | 'no_consent' | 'no_child' | null;
/**
 * How the flow reached the result: photo assessed by the server, photo skipped, photo kept
 * failing the gate, photo could not be sent (the parent chose to go on without it), or red flag.
 */
export type PhotoChoice = 'use' | 'skip' | 'quality_failed' | 'not_sent' | 'red_flag';
/** `finish('use')` could not reach the server: nothing changed, the review screen offers a retry. */
export type PhotoUnavailable = { kind: 'unavailable'; reason: UnavailableReason };
export type FinishResult = Outcome | PhotoUnavailable;
export type StartOptions = {
  /**
   * Screening request (from a child account) this screening answers: sent as request_id on
   * screening_recorded so the server marks the request done (ACCOUNTS_AND_FLOWS.md §2.5).
   * Ignored unless it is a uuid and a child is chosen.
   */
  requestId?: string | null;
};

type SessionState = {
  startedAt: string | null;
  child: Pick<ChildProfile, 'id' | 'nickname'> | null;
  requestId: string | null;
  ageMonths: number | null;
  answers: Answers;
  pain: Pain | null;
  capture: Capture | null;
  /** The analysis JPEG sent to the API; dropped once the screening is finished. */
  upload: UploadPhoto | null;
  quality: QualityResult | null;
  attempts: number;
  photoChoice: PhotoChoice | null;
  analysis: PhotoAnalysis | null;
  outcome: Outcome | null;
  /** Kept on this phone (consent (a)); null otherwise. */
  record: ScreeningRecord | null;
  saveState: SaveState;
  /**
   * saveState 'sent_only': the queued screening_recorded event id (the result screen follows
   * its outbox state). The record itself exists only in this session's memory.
   */
  sentEventId: string | null;
  /** Who produced the shown result: the DentisAI API, or the device when it was unreachable. */
  triageSource: TriageSource | null;

  start: (child: ChildProfile | null, now?: Date, opts?: StartOptions) => void;
  setAnswer: (questionId: string, answer: Answer) => void;
  setPain: (pain: Pain) => void;
  setCapture: (photo: PreparedPhoto, quality: QualityResult) => void;
  discardCapture: () => void;
  finish: (choice: PhotoChoice) => Promise<FinishResult>;
  /** Mirrors a referral made for the saved record (see ./referral-sync.ts). */
  setReferralId: (screeningId: string, referralId: string) => void;
  reset: () => void;
};

const initial = {
  startedAt: null,
  child: null,
  requestId: null,
  ageMonths: null,
  answers: {},
  pain: null,
  capture: null,
  upload: null,
  quality: null,
  attempts: 0,
  photoChoice: null,
  analysis: null,
  outcome: null,
  record: null,
  saveState: null,
  sentEventId: null,
  triageSource: null,
} satisfies Partial<SessionState>;

/** Live access to the API for this child (account, session and consent (b) stores). */
export function serverAccessFor(childId: string | null): ServerAccess {
  return {
    apiConfigured: isApiConfigured,
    signedIn: useSession.getState().status === 'signedIn',
    isChildAccount: useAccount.getState().me?.accountType === 'child',
    consentB: !!childId && !!useLocalData.getState().consents[childId]?.b,
  };
}

const toBox = (b: { x: number; y: number; w: number; h: number }): [number, number, number, number] => [b.x, b.y, b.w, b.h];

export const useScreeningSession = create<SessionState>((set, get) => ({
  ...initial,

  start: (child, now = new Date(), opts = {}) => {
    discardPhoto(get().capture?.uri);
    const requestId = child && isUuid(opts.requestId) ? opts.requestId.toLowerCase() : null;
    set({
      ...initial,
      startedAt: now.toISOString(),
      child: child ? { id: child.id, nickname: child.nickname } : null,
      requestId,
      ageMonths: child ? ageInMonths(child.birthYear, child.birthMonth, now) : null,
    });
  },

  setAnswer: (questionId, answer) => set((s) => ({ answers: { ...s.answers, [questionId]: answer } })),
  setPain: (pain) => set({ pain }),

  setCapture: (photo, quality) => {
    discardPhoto(get().capture?.uri);
    set((s) => ({
      capture: { uri: photo.uri, width: photo.width, height: photo.height },
      upload: photo.upload,
      quality,
      attempts: s.attempts + 1,
    }));
  },

  discardCapture: () => {
    discardPhoto(get().capture?.uri);
    set({ capture: null, upload: null, quality: null });
  },

  finish: async (choice) => {
    const s = get();
    const access = serverAccessFor(s.child?.id ?? null);
    // Only a red-flag short-circuit may leave questions unasked (see withLowestForUnasked).
    const asked = choice === 'red_flag' ? withLowestForUnasked(s.answers, s.pain) : { answers: s.answers, pain: s.pain };
    let analysis: PhotoAnalysis;
    let outcome: Outcome;
    let triageSource: TriageSource | null;

    if (choice === 'use') {
      // The photo passed the on-device gate: the server assesses it (quality gate, detector,
      // reference triage). Unreachable -> nothing changes; the review screen offers a retry.
      if (!s.quality?.passed || !s.upload || !canUseServer(access)) return { kind: 'unavailable', reason: 'not_configured' };
      const result = await screenPhoto({
        photoBase64: s.upload.base64,
        photoWidth: s.upload.width,
        photoHeight: s.upload.height,
        symptoms: asked.answers as Record<string, Answer>,
        ageMonths: s.ageMonths,
        pain: asked.pain as Pain,
      });
      if (result.kind === 'unavailable') return result;
      if (result.kind === 'fail_safe') {
        analysis = noPhotoAnalysis('not_taken');
        outcome = { kind: 'error', code: `server_${result.code}` };
        triageSource = null;
      } else {
        const { screening } = result;
        analysis = { photoStatus: screening.photoStatus, detections: screening.detections, modelVersion: screening.modelVersion };
        const input = buildTriageInput({ ...asked, ageMonths: s.ageMonths, photoStatus: analysis.photoStatus, detections: analysis.detections });
        outcome = { kind: 'result', output: screening.output, input };
        triageSource = 'server';
      }
    } else {
      analysis = noPhotoAnalysis(choice === 'quality_failed' ? 'quality_failed' : 'not_taken');
      const input = buildTriageInput({ ...asked, ageMonths: s.ageMonths, photoStatus: analysis.photoStatus, detections: [] });
      outcome = runTriage(input);
      triageSource = outcome.kind === 'result' ? 'device' : null;
      // Without a photo the server evaluates the same input; offline, the device result stands.
      if (
        outcome.kind === 'result' &&
        shouldEvaluateOnServer({ ...access, redFlagShortCircuit: choice === 'red_flag', localLevel: outcome.output.level })
      ) {
        const decision = applyServerResult(outcome.output, await evaluateScreening(outcome.input));
        if (decision.kind === 'fail_safe') {
          outcome = { kind: 'error', code: decision.code };
          triageSource = null;
        } else {
          outcome = { ...outcome, output: decision.output };
          triageSource = decision.source;
        }
      }
    }

    let record: ScreeningRecord | null = null;
    let saveState: SaveState = null;
    let sentEventId: string | null = null;
    if (outcome.kind === 'result') {
      const store = useLocalData.getState();
      if (!s.child) saveState = 'no_child';
      else {
        const screenedAt = new Date().toISOString();
        const built: ScreeningRecord = {
          id: newUuid(),
          childId: s.child.id,
          screenedAt,
          level: outcome.output.level as ScreeningRecord['level'],
          redFlag: hasRedFlag(outcome.output),
          reasons: outcome.output.reasons,
          adviceIds: outcome.output.advice_ids,
          referralTemplateId: outcome.output.referral_template_id,
          rulesVersion: outcome.output.rules_version,
          modelVersion: analysis.modelVersion,
          photoTaken: choice === 'use' || choice === 'quality_failed' || choice === 'not_sent',
          photoStatus: analysis.photoStatus,
          findings: analysis.detections.map((d) => ({ class: d.class, confidence: d.confidence, box: toBox(d.box) })),
          // What the parent answered; questions skipped after a red flag are left out.
          answers: s.answers,
          pain: s.pain,
          ageMonths: s.ageMonths,
          synced: false,
          requestId: s.requestId,
          referralId: null,
          triageSource: triageSource ?? 'device',
        };
        if (store.consents[s.child.id]?.a) {
          // Consent (a) = keep on this phone. The local store hands the record to the sync
          // bridge, which queues screening_recorded only while consent (b) is on (red_flag,
          // findings and request_id mapped in core/sync/events).
          store.addScreening(built);
          record = built;
          saveState = 'saved';
        } else {
          // Consent (a) off: nothing is kept on this phone. Consent (b) = send pseudonymous data,
          // so the result still goes to the account, and a request it answers becomes 'done'
          // (ACCOUNTS_AND_FLOWS.md §2.5). The bridge applies the same gating as for kept records
          // (signed in, adult account, child allowed, (b) on) and returns null otherwise. The
          // outbox entry that holds the event until the server applies it is part of sending,
          // not "keeping": it leaves the phone once applied (or is purged on a (b) withdrawal).
          // The record is not in the local store, so markSynced is a no-op for it and reconcile
          // (which walks the store) never re-queues it.
          sentEventId = recordScreening(built);
          saveState = sentEventId ? 'sent_only' : 'no_consent';
        }
      }
    }
    // The upload copy is not needed any more; the review photo stays until the session ends.
    set({ photoChoice: choice, analysis, outcome, record, saveState, sentEventId, triageSource, upload: null });
    return outcome;
  },

  setReferralId: (screeningId, referralId) =>
    set((s) => (s.record?.id === screeningId ? { record: { ...s.record, referralId } } : {})),

  reset: () => {
    discardPhoto(get().capture?.uri);
    set(initial);
  },
}));

/** True when a photo can be assessed (the guide hides the camera otherwise). */
export function useCanSendPhoto(): boolean {
  const childId = useScreeningSession((s) => s.child?.id ?? null);
  const signedIn = useSession((s) => s.status === 'signedIn');
  const isChildAccount = useAccount((s) => s.me?.accountType === 'child');
  const consentB = useLocalData((s) => !!childId && !!s.consents[childId]?.b);
  return canUseServer({ apiConfigured: isApiConfigured, signedIn, isChildAccount, consentB });
}
