// Bundled triage rules (assets/rules/triage-rules.json = backend/triage/dist/rules.json, kept
// in sync by scripts/sync-backend-assets.js and checked by __tests__/rules-assets.test.ts).
// Signed-manifest updates (app/CLAUDE.md §6.8) will replace this floor once that ships.
import rulesJson from '@/assets/rules/triage-rules.json';

import { resolveParams } from './engine';
import type { TriageRules } from './types';

export * from './engine';
export * from './types';

export const triageRules = rulesJson as unknown as TriageRules;

/** Production params: the rules' values, or each param's cautious `if_unset` while unset. */
export const triageParams = resolveParams(triageRules);

/** True until a dentist approves the rules (release_check passes). */
export const rulesAreDraft = triageRules.status !== 'APPROVED';

export function adviceText(id: string): string | null {
  return triageRules.advice.find((a) => a.id === id)?.text ?? null;
}
