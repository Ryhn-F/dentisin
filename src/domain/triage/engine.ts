// Pure, deterministic triage engine — a 1:1 port of backend/triage/src/triage/engine.py.
// Every clinical value, question, class and message lives in the bundled rules.json; this
// module only implements the fixed condition vocabulary. No I/O, clock or randomness; inputs
// are never mutated. Parity: __tests__/triage-parity.test.ts runs backend/triage/tests/cases.json.
//
// Algorithm (same as the reference):
// 1. Validate params and input (typed errors, never a silent lower level).
// 2. Assess each detection: counted iff confidence >= min_confidence of its class.
// 3. Walk rules in file order; a firing rule contributes its level (fixed or a param).
// 4. Final level = highest rank among fired rules (red flags are always the top level).
// 5. reasons = every fired rule; advice = advice of fired rules at the final level, then the
//    level's advice, then photo_assessed_advice (assessed photo only), then always_advice,
//    de-duplicated keeping the first occurrence.
import type { Condition, Lesion, Params, RuleSpec, TriageOutput, TriageRules } from './types';

const INPUT_FIELDS = ['detections', 'photo_status', 'symptoms', 'age_months', 'pain'] as const;
const DETECTION_FIELDS = ['class', 'confidence'];
const UNKNOWN = 'unknown';
const ANY_CLASS = 'any';

export class TriageError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = new.target.name;
    this.code = code;
  }
}
/** The engine input is invalid. The engine never returns a result for it. */
export class TriageInputError extends TriageError {}
/** The resolved parameter set is invalid or incomplete. */
export class TriageParamsError extends TriageError {}

type Obj = Record<string, unknown>;

// JSON number semantics shared with the Python reference: booleans are not numbers,
// only finite values count, and integral floats (96.0) are integers.
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIntegral = (v: unknown): v is number => Number.isInteger(v);
const inRange = (v: number, low: number, high: number) => low <= v && v <= high;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

function levelRanks(rules: TriageRules): Record<string, number> {
  return Object.fromEntries(rules.levels.map((level) => [level.id, level.rank]));
}

// ------------------------------------------------------------------------------- params
/** Throws TriageParamsError unless `params` is a complete, valid value set. */
export function checkParams(rules: TriageRules, params: Params): void {
  const specs = rules.params;
  for (const name of Object.keys(params)) {
    if (!has(specs, name)) throw new TriageParamsError('PARAM_UNKNOWN', `unknown param '${name}'`);
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (!has(params, name)) throw new TriageParamsError('PARAM_MISSING', `param '${name}' has no value`);
    const value: unknown = params[name];
    const numeric = spec.type === 'integer' ? isIntegral(value) : isNumber(value);
    const valid =
      spec.type === 'level'
        ? typeof value === 'string' && spec.allowed.includes(value)
        : numeric && inRange(value as number, spec.min, spec.max);
    if (!valid) throw new TriageParamsError('PARAM_INVALID', `param '${name}' has invalid value ${String(value)}`);
  }
}

/**
 * Concrete values: override -> rules value -> `if_unset` (always the more cautious choice).
 * `overrides` is for tests only (backend/triage/tests/fixtures/params_profiles.json);
 * production passes nothing so values come from the bundled rules.
 */
export function resolveParams(rules: TriageRules, overrides?: Record<string, unknown> | null): Params {
  const specs = rules.params;
  const chosen = overrides ?? {};
  for (const name of Object.keys(chosen)) {
    if (!has(specs, name)) throw new TriageParamsError('PARAM_UNKNOWN', `unknown param '${name}'`);
  }
  const resolved: Params = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = has(chosen, name) ? chosen[name] : spec.value;
    resolved[name] = (value ?? spec.if_unset) as number | string;
  }
  checkParams(rules, resolved);
  return resolved;
}

// -------------------------------------------------------------------------------- input
type CheckedInput = {
  detections: { class: string; confidence: number }[];
  photo_status: string;
  symptoms: Record<string, string>;
  age_months: number | null;
  pain: number | typeof UNKNOWN;
};

function checkInput(rules: TriageRules, data: unknown): CheckedInput {
  if (!isObject(data)) throw new TriageInputError('INPUT_NOT_OBJECT', 'input must be an object');
  for (const key of Object.keys(data)) {
    if (!(INPUT_FIELDS as readonly string[]).includes(key)) {
      throw new TriageInputError('UNKNOWN_FIELD', `unknown input field '${key}'`);
    }
  }
  for (const key of INPUT_FIELDS) {
    if (!has(data, key)) throw new TriageInputError('MISSING_FIELD', `missing input field '${key}'`);
  }

  const statuses = new Map(rules.photo_statuses.map((s) => [s.id, s.assessed]));
  const photoStatus = data.photo_status;
  if (typeof photoStatus !== 'string' || !statuses.has(photoStatus)) {
    throw new TriageInputError('PHOTO_STATUS_INVALID', `invalid photo_status ${String(photoStatus)}`);
  }

  const symptoms = data.symptoms;
  if (!isObject(symptoms)) throw new TriageInputError('SYMPTOMS_INVALID', 'symptoms must be an object');
  const questionIds = rules.questions.map((q) => q.id);
  for (const key of Object.keys(symptoms)) {
    if (!questionIds.includes(key)) throw new TriageInputError('UNKNOWN_SYMPTOM', `unknown symptom '${key}'`);
  }
  for (const key of questionIds) {
    if (!has(symptoms, key)) throw new TriageInputError('MISSING_SYMPTOM', `missing answer for '${key}'`);
    const answer = symptoms[key];
    if (typeof answer !== 'string' || !rules.answers.includes(answer)) {
      throw new TriageInputError('INVALID_ANSWER', `invalid answer ${String(answer)} for '${key}'`);
    }
  }

  const age = data.age_months;
  const limits = rules.input_limits;
  if (age !== null && !(isIntegral(age) && inRange(age, limits.age_months_min, limits.age_months_max))) {
    throw new TriageInputError('AGE_INVALID', `invalid age_months ${String(age)}`);
  }

  const pain = data.pain;
  const scale = rules.pain_scale;
  if (pain !== UNKNOWN && !(isIntegral(pain) && inRange(pain, scale.min, scale.max))) {
    throw new TriageInputError('PAIN_INVALID', `invalid pain ${String(pain)}`);
  }

  const detections = data.detections;
  if (!Array.isArray(detections)) throw new TriageInputError('DETECTIONS_INVALID', 'detections must be an array');
  const classIds = rules.detection_classes.map((c) => c.id);
  detections.forEach((det: unknown, index) => {
    if (!isObject(det) || Object.keys(det).sort().join() !== DETECTION_FIELDS.join()) {
      throw new TriageInputError(
        'DETECTION_INVALID',
        `detections[${index}] must have exactly the keys class, confidence (box geometry is not an engine input)`,
      );
    }
    if (typeof det.class !== 'string' || !classIds.includes(det.class)) {
      throw new TriageInputError('UNKNOWN_CLASS', `detections[${index}].class ${String(det.class)}`);
    }
    if (!isNumber(det.confidence) || !inRange(det.confidence, 0, 1)) {
      throw new TriageInputError('CONFIDENCE_INVALID', `detections[${index}].confidence`);
    }
  });
  if (detections.length > 0 && !statuses.get(photoStatus)) {
    throw new TriageInputError('DETECTIONS_WITHOUT_PHOTO', 'detections given but photo_status is not assessed');
  }
  return data as CheckedInput;
}

// ------------------------------------------------------------------------------ lesions
function assessDetections(rules: TriageRules, params: Params, data: CheckedInput): Lesion[] {
  const classes = new Map(rules.detection_classes.map((c) => [c.id, c]));
  return data.detections.map((det, index) => {
    const cls = classes.get(det.class)!;
    return {
      detection_index: index,
      class: det.class as Lesion['class'],
      dentition: cls.dentition,
      confidence: det.confidence,
      counted: det.confidence >= (params[cls.min_confidence_param] as number),
    };
  });
}

// --------------------------------------------------------------------------- conditions
type Context = {
  rules: TriageRules;
  params: Params;
  symptoms: Record<string, string>;
  pain: number | typeof UNKNOWN;
  age: number | null;
  photoAssessed: boolean;
  lesions: Lesion[];
  ranks: Record<string, number>;
  firedLevels: string[];
};

const num = (ctx: Context, name: unknown) => ctx.params[name as string] as number;

const CONDITIONS: Record<string, (when: Condition, ctx: Context) => boolean> = {
  symptom_answer: (when, ctx) => (when.answers as string[]).includes(ctx.symptoms[when.symptom as string]),
  any_symptom_answer: (when, ctx) =>
    ctx.rules.questions.some(
      (q) => q.group === when.group && (when.answers as string[]).includes(ctx.symptoms[q.id]),
    ),
  pain_score_at_least: (when, ctx) => ctx.pain !== UNKNOWN && ctx.pain >= num(ctx, when.param),
  pain_score_in_range: (when, ctx) =>
    ctx.pain !== UNKNOWN && num(ctx, when.min_param) <= ctx.pain && ctx.pain < num(ctx, when.below_param),
  pain_unknown: (_when, ctx) => ctx.pain === UNKNOWN,
  detection_count_at_least: (when, ctx) => {
    const threshold = has(when, 'count') ? (when.count as number) : num(ctx, when.count_param);
    const count = ctx.lesions.filter((l) => l.counted && (when.class === ANY_CLASS || when.class === l.class)).length;
    return count >= threshold;
  },
  age_outside_validated_range: (when, ctx) => {
    if (!ctx.photoAssessed) return false;
    if (ctx.age === null) return true;
    return !inRange(ctx.age, num(ctx, when.min_param), num(ctx, when.max_param));
  },
  photo_not_assessed: (_when, ctx) => !ctx.photoAssessed,
  no_higher_level_rule_fired: (_when, ctx) => {
    const lowest = Math.min(...Object.values(ctx.ranks));
    return ctx.firedLevels.every((level) => ctx.ranks[level] <= lowest);
  },
};

/** Level contributed by a rule: fixed `level` or `params[level_param]`. */
export function ruleLevel(rule: RuleSpec, params: Params): string {
  return rule.level_param !== undefined ? String(params[rule.level_param]) : String(rule.level);
}

// ----------------------------------------------------------------------------- evaluate
/** Evaluate one screening. Throws TriageInputError / TriageParamsError instead of guessing. */
export function evaluate(rules: TriageRules, triageInput: unknown, params: Params): TriageOutput {
  checkParams(rules, params);
  const data = checkInput(rules, triageInput);
  const lesions = assessDetections(rules, params, data);
  const ctx: Context = {
    rules,
    params,
    symptoms: data.symptoms,
    pain: data.pain,
    age: data.age_months,
    photoAssessed: rules.photo_statuses.some((s) => s.id === data.photo_status && s.assessed),
    lesions,
    ranks: levelRanks(rules),
    firedLevels: [],
  };

  const fired: [RuleSpec, string][] = [];
  for (const rule of rules.rules) {
    if (CONDITIONS[rule.when.type](rule.when, ctx)) {
      const level = ruleLevel(rule, params);
      fired.push([rule, level]);
      ctx.firedLevels.push(level);
    }
  }

  // The default rule guarantees at least one rule fires (validated by the backend loader).
  const finalLevel = ctx.firedLevels.reduce((best, level) => (ctx.ranks[level] > ctx.ranks[best] ? level : best));
  const levelCfg = rules.levels.find((level) => level.id === finalLevel)!;

  const advice: string[] = [];
  for (const [rule, level] of fired) {
    if (level === finalLevel) advice.push(...rule.advice);
  }
  advice.push(...levelCfg.advice);
  if (ctx.photoAssessed) advice.push(...rules.photo_assessed_advice);
  advice.push(...rules.always_advice);

  return {
    level: finalLevel,
    reasons: fired.map(([rule]) => ({ id: rule.id, text: rule.message })),
    lesions,
    advice_ids: [...new Set(advice)],
    referral_template_id: levelCfg.referral_template_id,
    rules_version: rules.version,
  };
}
