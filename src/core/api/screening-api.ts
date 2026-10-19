// Client for the DentisAI ML/AI API screening routes (backend/api/docs/API.md, ADR 019/020):
// - POST /v1/screening/photo: the photo (base64 JPEG, metadata stripped) + answers, pain and age
//   in months. The server runs its quality gate, the caries detector and the reference triage,
//   and returns the result with the findings' boxes. The API never stores the photo.
// - POST /v1/screening/evaluate: the triage engine input only (no photo), for screenings
//   without a photo.
// Never a name, child id or email. Never throws and never logs (inputs are health data).
import { config } from '@/core/config';
import { supabase } from '@/core/auth/supabase';
import { triageRules, type PhotoStatus, type TriageInput, type TriageOutput } from '@/domain/triage';
import type { Detection } from '@/ml/detector';

export const EVALUATE_PATH = '/v1/screening/evaluate';
export const PHOTO_PATH = '/v1/screening/photo';
/** Rural signal is slow; past this the device result stands (offline-first). */
export const EVALUATE_TIMEOUT_MS = 8000;
/** Upload (~100 KB) + detector on a slow line. */
export const PHOTO_TIMEOUT_MS = 30000;

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
  | 'timeout'
  | 'bad_response';

export type EvaluateResult =
  | { kind: 'ok'; evaluation: ServerEvaluation }
  /** The server engine rejected the input (422 + fail_safe): show the safe referral screen. */
  | { kind: 'fail_safe'; code: string }
  | { kind: 'unavailable'; reason: UnavailableReason };

export type PhotoScreening = ServerEvaluation & {
  /** `assessed` when the detector ran; `quality_failed` when the server's quality gate refused it. */
  photoStatus: PhotoStatus;
  /** Findings with boxes normalised to the sent photo ([0..1]); boxes are overlay only (ADR 014). */
  detections: Detection[];
  modelVersion: string | null;
};

export type PhotoResult =
  | { kind: 'ok'; screening: PhotoScreening }
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

type Posted = { kind: 'response'; status: number; ok: boolean; body: unknown } | { kind: 'unavailable'; reason: UnavailableReason };

async function postJson(path: string, payload: unknown, deps: Deps, defaultTimeout: number): Promise<Posted> {
  const baseUrl = deps.baseUrl === undefined ? config.apiBaseUrl : deps.baseUrl;
  if (!baseUrl) return { kind: 'unavailable', reason: 'not_configured' };
  const token = await (deps.getAccessToken ?? defaultAccessToken)();
  if (!token) return { kind: 'unavailable', reason: 'no_session' };

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? defaultTimeout);
  let res: Response;
  try {
    res = await (deps.fetchImpl ?? fetch)(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch {
    return { kind: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { kind: 'response', status: res.status, ok: res.ok, body };
}

/**
 * Non-2xx: 422 + fail_safe means the engine rejected the input (show the safe referral screen).
 * Everything else, including a 503 (rules, quality gate or detector unavailable on the server),
 * means the server could not evaluate at all: like being offline (ADR 019/020).
 */
function errorResult(status: number, body: unknown): { kind: 'fail_safe'; code: string } | { kind: 'unavailable'; reason: UnavailableReason } {
  const { code, failSafe } = errorOf(body);
  if (status === 422 && failSafe) return { kind: 'fail_safe', code: code ?? 'invalid_input' };
  if (status === 404) return { kind: 'unavailable', reason: 'not_enabled' };
  if (status === 401) return { kind: 'unavailable', reason: 'unauthorized' };
  if (status === 403) return { kind: 'unavailable', reason: 'forbidden' };
  if (status === 429) return { kind: 'unavailable', reason: 'rate_limited' };
  if (status === 422 || status === 413) return { kind: 'unavailable', reason: 'bad_response' };
  return { kind: 'unavailable', reason: 'server' };
}

export async function evaluateScreening(input: TriageInput, deps: Deps = {}): Promise<EvaluateResult> {
  // Exactly the engine input: boxes never leave the device (ADR 014; the API rejects them).
  const body = {
    detections: input.detections.map((d) => ({ class: d.class, confidence: d.confidence })),
    photo_status: input.photo_status,
    symptoms: input.symptoms,
    age_months: input.age_months,
    pain: input.pain,
  };
  const posted = await postJson(EVALUATE_PATH, body, deps, EVALUATE_TIMEOUT_MS);
  if (posted.kind === 'unavailable') return posted;
  if (posted.ok) {
    const evaluation = parseEvaluation(posted.body);
    return evaluation ? { kind: 'ok', evaluation } : { kind: 'unavailable', reason: 'bad_response' };
  }
  return errorResult(posted.status, posted.body);
}

const photoStatuses = new Set<string>(triageRules.photo_statuses.map((p) => p.id));
const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

/** Overlay boxes (pixels of the sent photo) -> normalised findings. `null` on anything unexpected. */
function parseOverlay(v: unknown, width: number, height: number): Detection[] | null {
  if (v === null || v === undefined) return [];
  if (!isRecord(v) || !Array.isArray(v.detections)) return null;
  const out: Detection[] = [];
  for (const d of v.detections) {
    if (
      !isRecord(d) ||
      (d.class !== 'caries_permanent' && d.class !== 'caries_primary') ||
      typeof d.confidence !== 'number' ||
      !isRecord(d.box)
    ) {
      return null;
    }
    const { x1, y1, x2, y2 } = d.box;
    if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number') return null;
    const [left, right] = [clamp(x1, width), clamp(x2, width)];
    const [top, bottom] = [clamp(y1, height), clamp(y2, height)];
    out.push({
      class: d.class,
      confidence: d.confidence,
      box: { x: left / width, y: top / height, w: (right - left) / width, h: (bottom - top) / height },
    });
  }
  return out;
}

/** Validates a /photo 200 body. Anything unexpected is `null`, never a guessed level. */
export function parsePhotoScreening(body: unknown, photo: { width: number; height: number }): PhotoScreening | null {
  const evaluation = parseEvaluation(body);
  if (!evaluation || !isRecord(body) || photo.width <= 0 || photo.height <= 0) return null;
  const status = body.photo_status;
  if (!isString(status) || !photoStatuses.has(status)) return null;
  const detections = parseOverlay(body.overlay, photo.width, photo.height);
  if (!detections || (status !== 'assessed' && detections.length > 0)) return null;
  const modelVersion = isRecord(body.detector) && isString(body.detector.model_version) ? body.detector.model_version : null;
  return { ...evaluation, photoStatus: status as PhotoStatus, detections, modelVersion };
}

export type PhotoRequest = {
  /** Standard base64 of the JPEG that passed the on-device quality gate (metadata stripped). */
  photoBase64: string;
  photoWidth: number;
  photoHeight: number;
  symptoms: TriageInput['symptoms'];
  ageMonths: number | null;
  pain: TriageInput['pain'];
};

export async function screenPhoto(req: PhotoRequest, deps: Deps = {}): Promise<PhotoResult> {
  const body = { photo: req.photoBase64, symptoms: req.symptoms, age_months: req.ageMonths, pain: req.pain };
  const posted = await postJson(PHOTO_PATH, body, deps, PHOTO_TIMEOUT_MS);
  if (posted.kind === 'unavailable') return posted;
  if (posted.ok) {
    const screening = parsePhotoScreening(posted.body, { width: req.photoWidth, height: req.photoHeight });
    return screening ? { kind: 'ok', screening } : { kind: 'unavailable', reason: 'bad_response' };
  }
  return errorResult(posted.status, posted.body);
}
