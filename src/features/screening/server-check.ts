// When the screening may use the DentisAI API, and how its answer becomes the result
// (ADR 019/020). Pure decisions live here so they are testable.
import type { EvaluateResult } from '@/core/api/screening-api';
import { triageRules, type TriageOutput } from '@/domain/triage';

export type TriageSource = 'server' | 'device';

const rankOf = new Map(triageRules.levels.map((l) => [l.id, l.rank]));
const topRank = Math.max(...triageRules.levels.map((l) => l.rank));

export type ServerAccess = {
  apiConfigured: boolean;
  signedIn: boolean;
  isChildAccount: boolean;
  /** Local consent (b) "kirim data" for the screened child (or the teen's self profile). */
  consentB: boolean;
};

/**
 * The API takes the user's Supabase JWT: a signed-in parent/teen (child accounts have no access
 * and never screen), with consent (b) covering sending the photo and answers (ADR 020).
 */
export function canUseServer(a: ServerAccess): boolean {
  return a.apiConfigured && a.signedIn && !a.isChildAccount && a.consentB;
}

/**
 * Screenings without a photo go to /v1/screening/evaluate. A red flag or an emergency cannot go
 * higher, so it never waits for the network (red flag wins, offline).
 */
export function shouldEvaluateOnServer(a: ServerAccess & { redFlagShortCircuit: boolean; localLevel: string }): boolean {
  if (!canUseServer(a) || a.redFlagShortCircuit) return false;
  return (rankOf.get(a.localLevel) ?? topRank) < topRank;
}

export type ServerDecision =
  | { kind: 'result'; output: TriageOutput; source: TriageSource }
  /** API.md §4: an engine rejection never shows a level; the app shows the safe referral screen. */
  | { kind: 'fail_safe'; code: string };

/** The server's answer is the result; without one (offline, 5xx...) the device result stands. */
export function applyServerResult(local: TriageOutput, result: EvaluateResult): ServerDecision {
  if (result.kind === 'ok') return { kind: 'result', output: result.evaluation.output, source: 'server' };
  if (result.kind === 'fail_safe') return { kind: 'fail_safe', code: `server_${result.code}` };
  return { kind: 'result', output: local, source: 'device' };
}
