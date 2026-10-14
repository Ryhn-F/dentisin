// State of the one screening in progress, shared by the flow screens. In memory only; the photo
// file is deleted on retake and when the session ends (reset).
import { create } from 'zustand';

import type { ChildProfile, ScreeningRecord } from '@/domain/models';
import type { Answer } from '@/domain/triage';
import { getDetector } from '@/ml/detector';
import { discardPhoto, type PreparedPhoto } from '@/ml/photo';
import type { PixelImage, QualityResult } from '@/ml/quality-gate';
import { useMockData } from '@/mock/store';

import {
  ageInMonths,
  analyzePhoto,
  buildTriageInput,
  hasRedFlag,
  runTriage,
  type Answers,
  type Outcome,
  type Pain,
  type PhotoAnalysis,
  withLowestForUnasked,
} from './pipeline';

export type Capture = { uri: string; width: number; height: number };
export type SaveState = 'saved' | 'no_consent' | 'no_child' | null;
/** How the flow reached the result: photo used, photo skipped, photo kept failing the gate, or red flag. */
export type PhotoChoice = 'use' | 'skip' | 'quality_failed' | 'red_flag';

type SessionState = {
  startedAt: string | null;
  child: Pick<ChildProfile, 'id' | 'nickname'> | null;
  ageMonths: number | null;
  answers: Answers;
  pain: Pain | null;
  capture: Capture | null;
  pixels: PixelImage | null;
  quality: QualityResult | null;
  attempts: number;
  photoChoice: PhotoChoice | null;
  analysis: PhotoAnalysis | null;
  outcome: Outcome | null;
  record: ScreeningRecord | null;
  saveState: SaveState;

  start: (child: ChildProfile | null, now?: Date) => void;
  setAnswer: (questionId: string, answer: Answer) => void;
  setPain: (pain: Pain) => void;
  setCapture: (photo: PreparedPhoto, quality: QualityResult) => void;
  discardCapture: () => void;
  finish: (choice: PhotoChoice) => Promise<Outcome>;
  reset: () => void;
};

const initial = {
  startedAt: null,
  child: null,
  ageMonths: null,
  answers: {},
  pain: null,
  capture: null,
  pixels: null,
  quality: null,
  attempts: 0,
  photoChoice: null,
  analysis: null,
  outcome: null,
  record: null,
  saveState: null,
} satisfies Partial<SessionState>;

const toBox = (b: { x: number; y: number; w: number; h: number }): [number, number, number, number] => [b.x, b.y, b.w, b.h];

export const useScreeningSession = create<SessionState>((set, get) => ({
  ...initial,

  start: (child, now = new Date()) => {
    discardPhoto(get().capture?.uri);
    set({
      ...initial,
      startedAt: now.toISOString(),
      child: child ? { id: child.id, nickname: child.nickname } : null,
      ageMonths: child ? ageInMonths(child.birthYear, child.birthMonth, now) : null,
    });
  },

  setAnswer: (questionId, answer) => set((s) => ({ answers: { ...s.answers, [questionId]: answer } })),
  setPain: (pain) => set({ pain }),

  setCapture: (photo, quality) => {
    discardPhoto(get().capture?.uri);
    set((s) => ({
      capture: { uri: photo.uri, width: photo.width, height: photo.height },
      pixels: photo.pixels,
      quality,
      attempts: s.attempts + 1,
    }));
  },

  discardCapture: () => {
    discardPhoto(get().capture?.uri);
    set({ capture: null, pixels: null, quality: null });
  },

  finish: async (choice) => {
    const s = get();
    const usePhoto = choice === 'use' && !!s.quality?.passed;
    const analysis: PhotoAnalysis = usePhoto
      ? await analyzePhoto(s.pixels, getDetector())
      : {
          photoStatus: choice === 'quality_failed' ? 'quality_failed' : 'not_taken',
          detections: [],
          detectorAvailable: false,
        };
    // Only a red-flag short-circuit may leave questions unasked (see withLowestForUnasked).
    const asked = choice === 'red_flag' ? withLowestForUnasked(s.answers, s.pain) : { answers: s.answers, pain: s.pain };
    const input = buildTriageInput({
      answers: asked.answers,
      pain: asked.pain,
      ageMonths: s.ageMonths,
      photoStatus: analysis.photoStatus,
      detections: analysis.detections,
    });
    const outcome = runTriage(input);

    let record: ScreeningRecord | null = null;
    let saveState: SaveState = null;
    if (outcome.kind === 'result') {
      const store = useMockData.getState();
      if (!s.child) saveState = 'no_child';
      else if (!store.consents[s.child.id]?.a) saveState = 'no_consent';
      else {
        const screenedAt = new Date().toISOString();
        record = {
          id: `screening-${Date.now()}`,
          childId: s.child.id,
          screenedAt,
          level: outcome.output.level as ScreeningRecord['level'],
          redFlag: hasRedFlag(outcome.output),
          reasons: outcome.output.reasons,
          adviceIds: outcome.output.advice_ids,
          referralTemplateId: outcome.output.referral_template_id,
          rulesVersion: outcome.output.rules_version,
          modelVersion: analysis.detectorAvailable ? getDetector().modelVersion : null,
          photoTaken: choice === 'use' || choice === 'quality_failed',
          photoStatus: analysis.photoStatus,
          findings: analysis.detections.map((d) => ({ class: d.class, confidence: d.confidence, box: toBox(d.box) })),
          // What the parent answered; questions skipped after a red flag are left out.
          answers: s.answers,
          pain: s.pain,
          ageMonths: s.ageMonths,
          synced: false,
        };
        store.addScreening(record);
        saveState = 'saved';
      }
    }
    // Pixels are not needed after analysis; the review photo stays until the session ends.
    set({ photoChoice: choice, analysis, outcome, record, saveState, pixels: null });
    return outcome;
  },

  reset: () => {
    discardPhoto(get().capture?.uri);
    set(initial);
  },
}));
