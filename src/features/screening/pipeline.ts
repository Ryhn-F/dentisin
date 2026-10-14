// Screening flow logic, pure and testable. Order follows backend/api/docs/API.md §12 and
// app/CLAUDE.md §3.3: questionnaire -> red flags short-circuit -> photo -> quality gate ->
// detector -> triage. Every level comes from the triage engine; this file only decides
// which step comes next and assembles the engine input.
import {
  TriageError,
  evaluate,
  triageParams,
  triageRules,
  type Answer,
  type PhotoStatus,
  type TriageInput,
  type TriageOutput,
} from '@/domain/triage';
import type { Detection, Detector } from '@/ml/detector';
import type { PixelImage } from '@/ml/quality-gate';

export const redFlagQuestions = triageRules.questions.filter((q) => q.group === 'red_flag');
export const symptomQuestions = triageRules.questions.filter((q) => q.group !== 'red_flag');

const topLevel = triageRules.levels.reduce((a, b) => (b.rank > a.rank ? b : a)).id;

export type Pain = number | 'unknown';
export type Answers = Partial<Record<string, Answer>>;

/** Age in whole months from birth year + month; null when unknown or out of the engine's range. */
export function ageInMonths(birthYear: number | null, birthMonth: number | null, now = new Date()): number | null {
  if (!birthYear || !birthMonth) return null;
  const months = (now.getFullYear() - birthYear) * 12 + (now.getMonth() + 1 - birthMonth);
  const { age_months_min: min, age_months_max: max } = triageRules.input_limits;
  return months >= min && months <= max ? months : null;
}

export function allAnswered(answers: Answers, questions = triageRules.questions): boolean {
  return questions.every((q) => answers[q.id] !== undefined);
}

/**
 * True when the answers so far already reach the top level (emergency) whatever comes next.
 * Unanswered questions count as "no" and missing pain as 0 — the lowest possible inputs — and
 * the engine is monotone in answers (no <= unknown <= yes) and pain (backend property tests),
 * so an emergency here stays an emergency. Detections can never lower the level either, so the
 * photo is skipped (same short-circuit as /v1/screening/analyze).
 */
export function isEmergencyAlready(answers: Answers, pain: Pain | null): boolean {
  const lowest = withLowestForUnasked(answers, pain);
  const out = evaluate(
    triageRules,
    { detections: [], photo_status: 'not_taken', symptoms: lowest.answers, age_months: null, pain: lowest.pain },
    triageParams,
  );
  return out.level === topLevel;
}

/**
 * Questions the flow skipped after a red flag were never asked. Only for that short-circuit,
 * they enter the engine as the lowest values ("no", pain 0): the level is already the top level
 * and cannot change, and the reasons stay limited to what the parent actually answered. This is
 * never applied to answered questions ("tidak tahu" always stays "unknown").
 */
export function withLowestForUnasked(answers: Answers, pain: Pain | null): { answers: Record<string, Answer>; pain: Pain } {
  return {
    answers: Object.fromEntries(triageRules.questions.map((q) => [q.id, answers[q.id] ?? 'no'])),
    pain: pain ?? 0,
  };
}

export type PhotoAnalysis = {
  photoStatus: PhotoStatus;
  detections: Detection[];
  /** False when no detector ships or it failed: the photo was taken but not assessed. */
  detectorAvailable: boolean;
};

/** Runs the detector on a photo that passed the quality gate. Never invents detections. */
export async function analyzePhoto(pixels: PixelImage | null, detector: Detector): Promise<PhotoAnalysis> {
  if (!pixels || !detector.available) return { photoStatus: 'not_taken', detections: [], detectorAvailable: false };
  try {
    const detections = await detector.detect(pixels);
    return { photoStatus: 'assessed', detections, detectorAvailable: true };
  } catch {
    // Fail closed: an unassessed photo can only keep the level the same or higher.
    return { photoStatus: 'not_taken', detections: [], detectorAvailable: false };
  }
}

/**
 * Engine input. Boxes stay with the app for the overlay and are stripped here (ADR 014: box
 * size never reaches triage). A photo that was taken but not assessed by a model counts as
 * no photo for triage (`not_taken`); the engine treats it exactly like `quality_failed`.
 */
export function buildTriageInput(args: {
  answers: Answers;
  pain: Pain | null;
  ageMonths: number | null;
  photoStatus: PhotoStatus;
  detections: Detection[];
}): TriageInput {
  return {
    detections: args.detections.map((d) => ({ class: d.class, confidence: d.confidence })),
    photo_status: args.photoStatus,
    symptoms: args.answers as Record<string, Answer>,
    age_months: args.ageMonths,
    // Missing pain is invalid input on purpose: the engine throws instead of guessing 0.
    pain: args.pain as Pain,
  };
}

export type Outcome =
  | { kind: 'result'; output: TriageOutput; input: TriageInput }
  | { kind: 'error'; code: string };

/** Engine errors never become a lower level: the UI shows the safe referral screen instead. */
export function runTriage(input: TriageInput): Outcome {
  try {
    return { kind: 'result', output: evaluate(triageRules, input, triageParams), input };
  } catch (error) {
    return { kind: 'error', code: error instanceof TriageError ? error.code : 'unexpected' };
  }
}

export function hasRedFlag(output: TriageOutput): boolean {
  return output.reasons.some((r) => r.id.startsWith('RF_'));
}
