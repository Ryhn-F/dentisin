// Online re-check of a finished screening against the DentisAI API (ADR 019). The device always
// evaluates first (offline-first); the server is asked only when it could change something and
// the family agreed to send data. Pure decisions live here so they are testable.
import type { EvaluateResult, ServerEvaluation } from '@/core/api/screening-api';
import { triageRules, type TriageOutput } from '@/domain/triage';

export type TriageSource = 'server' | 'device';

const rankOf = new Map(triageRules.levels.map((l) => [l.id, l.rank]));
const topRank = Math.max(...triageRules.levels.map((l) => l.rank));

export type AskServerArgs = {
  apiConfigured: boolean;
  signedIn: boolean;
  isChildAccount: boolean;
  /** Local consent (b) "kirim data teknis" for the screened child (or the teen's self profile). */
  consentB: boolean;
  redFlagShortCircuit: boolean;
  localLevel: string;
};

/**
 * Ask the server only when: the API is configured; a signed-in parent/teen (the API takes the
 * user's Supabase JWT; child accounts have no access and never screen); consent (b) covers sending
 * screening data; and the device result is not already the top level. A red flag or an emergency
 * cannot go higher, so it never waits for the network (red flag wins, offline).
 */
export function shouldAskServer(a: AskServerArgs): boolean {
  if (!a.apiConfigured || !a.signedIn || a.isChildAccount || !a.consentB) return false;
  if (a.redFlagShortCircuit) return false;
  return (rankOf.get(a.localLevel) ?? topRank) < topRank;
}

/**
 * Same rules on both sides, so the levels normally match. If they ever differ (rules drift), the
 * more urgent one is shown: a re-check may raise a level, never lower it. On a tie the server's
 * output is used (reference engine).
 */
export function chooseOutput(local: TriageOutput, server: ServerEvaluation): { output: TriageOutput; source: TriageSource } {
  const localRank = rankOf.get(local.level) ?? topRank;
  const serverRank = rankOf.get(server.output.level) ?? -1;
  return serverRank >= localRank ? { output: server.output, source: 'server' } : { output: local, source: 'device' };
}

export type ServerDecision =
  | { kind: 'result'; output: TriageOutput; source: TriageSource }
  /** API.md §4: an engine rejection never shows a level; the app shows the safe referral screen. */
  | { kind: 'fail_safe'; code: string };

export function applyServerResult(local: TriageOutput, result: EvaluateResult): ServerDecision {
  if (result.kind === 'ok') return { kind: 'result', ...chooseOutput(local, result.evaluation) };
  if (result.kind === 'fail_safe') return { kind: 'fail_safe', code: `server_${result.code}` };
  return { kind: 'result', output: local, source: 'device' };
}
