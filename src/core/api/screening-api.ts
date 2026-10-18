// Client for the DentisAI ML/AI API screening re-check (backend/api/docs/API.md §5, ADR 019):
// POST /v1/screening/evaluate runs the Python reference triage on the same input the device
// already evaluated. The body is the triage engine input only — answers, pain, age in months and
// on-device findings as {class, confidence}: never a photo, box, name or id. The API is stateless.
// Never throws and never logs (inputs are health data).
import { config } from '@/core/config';
import { supabase } from '@/core/auth/supabase';
import { triageRules, type TriageInput, type TriageOutput } from '@/domain/triage';

export const EVALUATE_PATH = '/v1/screening/evaluate';
/** Rural signal is slow; past this the device result stands (offline-first). */
export const EVALUATE_TIMEOUT_MS = 8000;

export type ServerEvaluation = {
  output: TriageOutput;
  rulesStatus: string;
  clinicallyValidated: boolean;
};

export type UnavailableReason =
  | 'not_configured'
  | 'no_session'
  | 'not_enabled'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'bad_response';

export type EvaluateResult =
  | { kind: 'ok'; evaluation: ServerEvaluation }
  /** The server engine rejected the input (422 + fail_safe): show the safe referral screen. */
  | { kind: 'fail_safe'; code: string }
  | { kind: 'unavailable'; reason: UnavailableReason };

type Deps = {
  fetchImpl?: typeof fetch;
  getAccessToken?: () => Promise<string | null>;
  baseUrl?: string | null;
  timeoutMs?: number;
};

const levelIds = new Set(triageRules.levels.map((l) => l.id));

async function defaultAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function parseReasons(v: unknown): TriageOutput['reasons'] | null {
  if (!Array.isArray(v)) return null;
  const out: TriageOutput['reasons'] = [];
  for (const r of v) {
    if (!isRecord(r) || !isString(r.id) || !isString(r.text)) return null;
    out.push({ id: r.id, text: r.text });
  }
  return out;
}

function parseLesions(v: unknown): TriageOutput['lesions'] | null {
  if (!Array.isArray(v)) return null;
  const out: TriageOutput['lesions'] = [];
  for (const l of v) {
    if (
      !isRecord(l) ||
      typeof l.detection_index !== 'number' ||
      (l.class !== 'caries_permanent' && l.class !== 'caries_primary') ||
      (l.dentition !== 'primary' && l.dentition !== 'permanent') ||
      typeof l.confidence !== 'number' ||
      typeof l.counted !== 'boolean'
    ) {
      return null;
    }
    out.push({ detection_index: l.detection_index, class: l.class, dentition: l.dentition, confidence: l.confidence, counted: l.counted });
  }
  return out;
}

/** Validates a 200 body (API.md §4-5). Anything unexpected is `null`, never a guessed level. */
export function parseEvaluation(body: unknown): ServerEvaluation | null {
  if (!isRecord(body) || !isRecord(body.triage) || !isRecord(body.rules_version)) return null;
  const t = body.triage;
  const reasons = parseReasons(t.reasons);
  const lesions = parseLesions(t.lesions);
  const rulesVersion = body.rules_version.triage;
  if (
    !isString(t.level) ||
    !levelIds.has(t.level) ||
    !reasons ||
    !lesions ||
    !Array.isArray(t.advice_ids) ||
    !t.advice_ids.every(isString) ||
    !isString(t.referral_template_id) ||
    !isString(rulesVersion) ||
    !isString(body.rules_status) ||
    typeof body.clinically_validated !== 'boolean'
  ) {
    return null;
  }
  return {
    output: {
      level: t.level,
      reasons,
      lesions,
      advice_ids: t.advice_ids as string[],
      referral_template_id: t.referral_template_id,
      rules_version: rulesVersion,
    },
    rulesStatus: body.rules_status,
    clinicallyValidated: body.clinically_validated,
  };
}

function errorOf(body: unknown): { code: string | null; failSafe: boolean } {
  const err = isRecord(body) && isRecord(body.error) ? body.error : null;
  return {
    code: err && isString(err.code) ? err.code : null,
    failSafe: !!err && isRecord(err.fail_safe) && err.fail_safe.action === 'show_referral_screen',
  };
}

export async function evaluateScreening(input: TriageInput, deps: Deps = {}): Promise<EvaluateResult> {
  const baseUrl = deps.baseUrl === undefined ? config.apiBaseUrl : deps.baseUrl;
  if (!baseUrl) return { kind: 'unavailable', reason: 'not_configured' };
  const token = await (deps.getAccessToken ?? defaultAccessToken)();
  if (!token) return { kind: 'unavailable', reason: 'no_session' };

  // Exactly the engine input: boxes never leave the device (ADR 014; the API rejects them).
  const body = {
    detections: input.detections.map((d) => ({ class: d.class, confidence: d.confidence })),
    photo_status: input.photo_status,
    symptoms: input.symptoms,
    age_months: input.age_months,
    pain: input.pain,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? EVALUATE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${baseUrl}${EVALUATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return { kind: 'unavailable', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (res.ok) {
    const evaluation = parseEvaluation(parsed);
    return evaluation ? { kind: 'ok', evaluation } : { kind: 'unavailable', reason: 'bad_response' };
  }
  const { code, failSafe } = errorOf(parsed);
  // Only an engine rejection of the input follows the fail-safe screen. A 503 (rules or Supabase
  // unavailable on the server) means the server could not evaluate at all: like being offline,
  // the device result stands (offline-first, ADR 019).
  if (res.status === 422 && failSafe) return { kind: 'fail_safe', code: code ?? 'invalid_input' };
  if (res.status === 404) return { kind: 'unavailable', reason: 'not_enabled' };
  if (res.status === 401) return { kind: 'unavailable', reason: 'unauthorized' };
  if (res.status === 403) return { kind: 'unavailable', reason: 'forbidden' };
  if (res.status === 429) return { kind: 'unavailable', reason: 'rate_limited' };
  if (res.status === 422) return { kind: 'unavailable', reason: 'bad_response' };
  return { kind: 'unavailable', reason: 'server' };
}
