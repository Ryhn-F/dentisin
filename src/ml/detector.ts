// Caries findings (ADR 001/014). The detector runs on the DentisAI API (POST /v1/screening/photo,
// ADR 020): the app receives each finding's class, confidence and box. Boxes are for the photo
// overlay ONLY and never reach triage (ADR 014).
import type { DetectionClass } from '@/domain/triage';

/** Box normalised to the photo, [0..1]. UI overlay ONLY — never passed to triage (ADR 014). */
export type Box = { x: number; y: number; w: number; h: number };

export type Detection = { class: DetectionClass; confidence: number; box: Box };
