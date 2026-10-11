// On-device caries detector interface (ADR 001/014). No model ships yet (backend/ml/exports is
// empty), so the only implementation is `nullDetector`: it reports itself unavailable and the
// screening flow treats the photo as not assessed. It never invents detections.
//
// When a permissively licensed model is released, add a react-native-fast-tflite implementation
// here that follows backend/ml/detection/DECODE_SPEC.md, and refuse to use it when:
//   - labels.json `distribution` is "internal_experiment_only" on a public build, or
//   - any `thresholds.score.*` is null outside an internal build,
//   - the signed manifest or a SHA-256 check fails (app/CLAUDE.md §6.8).
import type { DetectionClass } from '@/domain/triage';

import type { PixelImage } from './quality-gate';

/** Box normalised to the photo, [0..1]. UI overlay ONLY — never passed to triage (ADR 014). */
export type Box = { x: number; y: number; w: number; h: number };

export type Detection = { class: DetectionClass; confidence: number; box: Box };

export type Detector = {
  readonly available: boolean;
  readonly name: string;
  readonly modelVersion: string | null;
  detect(image: PixelImage): Promise<Detection[]>;
};

export class DetectorUnavailableError extends Error {
  readonly code = 'detector_unavailable';
}

export const nullDetector: Detector = {
  available: false,
  name: 'null',
  modelVersion: null,
  detect: () => Promise.reject(new DetectorUnavailableError('No detector is bundled in this build.')),
};

export function getDetector(): Detector {
  return nullDetector;
}
