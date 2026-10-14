// Everything the referral letter shows, from the live session or a saved History record.
// The letter template is app-owned and offline (backend/CLAUDE.md §8); clinical texts still
// come from the rules file via the stored triage output.
import type { TriageLevel } from '@/core/theme';
import type { ScreeningRecord } from '@/domain/models';
import type { Answer } from '@/domain/triage';

import type { Pain } from './pipeline';
import type { PhotoChoice } from './session-store';

export type ReferralPhoto = 'assessed' | 'not_assessed' | 'not_taken' | 'quality_failed';

export type ReferralData = {
  screenedAt: string;
  childName: string | null;
  ageMonths: number | null;
  level: TriageLevel;
  reasons: readonly { id: string; text: string }[];
  answers: Partial<Record<string, Answer>>;
  pain: Pain | null;
  photo: ReferralPhoto;
  rulesVersion: string;
};

export function photoFromSession(choice: PhotoChoice | null, detectorAvailable: boolean): ReferralPhoto {
  if (choice === 'use') return detectorAvailable ? 'assessed' : 'not_assessed';
  if (choice === 'quality_failed') return 'quality_failed';
  return 'not_taken';
}

export function photoFromRecord(r: Pick<ScreeningRecord, 'photoTaken' | 'photoStatus'>): ReferralPhoto {
  if (r.photoStatus === 'assessed') return 'assessed';
  if (r.photoStatus === 'quality_failed') return 'quality_failed';
  return r.photoTaken ? 'not_assessed' : 'not_taken';
}

export function referralFromRecord(r: ScreeningRecord, childName: string | null): ReferralData {
  return {
    screenedAt: r.screenedAt,
    childName,
    ageMonths: r.ageMonths,
    level: r.level,
    reasons: r.reasons,
    answers: r.answers,
    pain: r.pain,
    photo: photoFromRecord(r),
    rulesVersion: r.rulesVersion,
  };
}
