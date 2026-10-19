// Screening flow logic, pure and testable. Order follows backend/api/docs/API.md §12 and
// app/CLAUDE.md §3.3: questionnaire -> photo (red flags no longer short-circuit, ADR 021) -> quality gate ->
// detector (DentisAI API, ADR 020) -> triage. Every level comes from the triage engine; this
// file only decides which step comes next and assembles the engine input.
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
import type { Detection } from '@/ml/detector';

export const redFlagQuestions = triageRules.questions.filter((q) => q.group === 'red_flag');
export const symptomQuestions = triageRules.questions.filter((q) => q.group !== 'red_flag');

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
  /** Findings from the server detector (with overlay boxes); empty without an assessed photo. */
  detections: Detection[];
  /** Detector model version reported by the API; null when no photo was assessed. */
  modelVersion: string | null;
};

export const noPhotoAnalysis = (photoStatus: PhotoStatus): PhotoAnalysis => ({ photoStatus, detections: [], modelVersion: null });

/**
 * Engine input. Boxes stay with the app for the overlay and are stripped here (ADR 014: box
 * size never reaches triage). A photo that was taken but not sent to the detector counts as
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
