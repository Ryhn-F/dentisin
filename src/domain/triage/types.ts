// Shapes of backend/triage/dist/rules.json (schema_version 1) and of the engine contract
// (dist/input.schema.json, dist/output.schema.json). Only the fields the engine reads are typed.

export type Answer = 'yes' | 'no' | 'unknown';
export type PhotoStatus = 'assessed' | 'not_taken' | 'quality_failed';
export type DetectionClass = 'caries_permanent' | 'caries_primary';
export type Dentition = 'primary' | 'permanent';

export type LevelSpec = {
  id: string;
  rank: number;
  label: string;
  referral_template_id: string;
  advice: string[];
};

export type QuestionSpec = { id: string; group: string; question: string };

export type ParamSpec =
  | { type: 'number' | 'integer'; min: number; max: number; value: number | null; if_unset: number; status: string }
  | { type: 'level'; allowed: string[]; value: string | null; if_unset: string; status: string };

export type Condition = { type: string; [key: string]: unknown };

export type RuleSpec = {
  id: string;
  stage: string;
  level?: string;
  level_param?: string;
  when: Condition;
  message: string;
  advice: string[];
};

export type TriageRules = {
  schema_version: number;
  version: string;
  status: string;
  notice: string;
  levels: LevelSpec[];
  answers: string[];
  questions: QuestionSpec[];
  photo_statuses: { id: string; assessed: boolean; description: string }[];
  pain_scale: { name: string; min: number; max: number };
  input_limits: { age_months_min: number; age_months_max: number };
  detection_classes: { id: string; dentition: Dentition; label: string; min_confidence_param: string }[];
  contacts: { emergency_numbers: { value: string[]; status: string; note: string } };
  params: Record<string, ParamSpec>;
  advice: { id: string; text: string; uses_contact?: string }[];
  always_advice: string[];
  photo_assessed_advice: string[];
  rules: RuleSpec[];
};

export type Params = Record<string, number | string>;

/** Engine input: detections are {class, confidence} ONLY (ADR 014: box geometry never enters triage). */
export type TriageInput = {
  detections: { class: DetectionClass; confidence: number }[];
  photo_status: PhotoStatus;
  symptoms: Record<string, Answer>;
  age_months: number | null;
  pain: number | 'unknown';
};

export type Lesion = {
  detection_index: number;
  class: DetectionClass;
  dentition: Dentition;
  confidence: number;
  counted: boolean;
};

export type TriageOutput = {
  level: string;
  reasons: { id: string; text: string }[];
  lesions: Lesion[];
  advice_ids: string[];
  referral_template_id: string;
  rules_version: string;
};
