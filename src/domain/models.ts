// App-side domain types, aligned with backend/supabase/migrations/20261008000200_core_tables.sql.
// Fields the backend never stores (e.g. `nickname`) are marked LOCAL ONLY.

export type BrushingSlot = 'morning' | 'evening' | 'other';

/** public.app_role. Read-only for the app (user_role has no client write grants). */
export type AppRole = 'guardian' | 'kader' | 'facility_viewer' | 'admin';
export const appRoles: readonly AppRole[] = ['guardian', 'kader', 'facility_viewer', 'admin'];

export type ConsentType = 'a' | 'b' | 'c';

export type ChildProfile = {
  /** Pseudonymous UUID (child_profile.id). */
  id: string;
  /** LOCAL ONLY — never synced (sync_events rejects names). */
  nickname: string;
  birthYear: number | null;
  birthMonth: number | null;
  /** Allergy codes (recommender filters.allergen_codes). */
  allergies: string[];
};

export type BrushingRecord = {
  id: string;
  childId: string;
  /** ISO timestamp (UTC). */
  startedAt: string;
  durationS: number;
  /** 0–100 "skor semangat"; null in timer-only (no camera) mode. */
  spiritScore: number | null;
  slot: BrushingSlot;
  cameraMode: boolean;
  synced: boolean;
};

export type ConsentState = Record<ConsentType, boolean>;

// Mirrors recommender/rules.json filters.allergen_codes (status: needs_review).
export const allergenCodes = ['flavor_mint', 'cinnamon', 'fruit_flavor', 'propylene_glycol', 'sls'] as const;
export type AllergenCode = (typeof allergenCodes)[number];

/**
 * One completed screening, kept on the device (needs consent (a)). Mirrors the
 * `screening_recorded` sync event (backend/docs/api/SYNC_EVENTS.md §3.3); the photo itself is
 * never stored. `findings[].box` is overlay geometry only (ADR 014).
 */
export type ScreeningRecord = {
  id: string;
  childId: string;
  /** ISO timestamp (UTC). */
  screenedAt: string;
  level: 'emergency' | 'urgent' | 'scheduled' | 'routine';
  redFlag: boolean;
  reasons: { id: string; text: string }[];
  adviceIds: string[];
  referralTemplateId: string;
  rulesVersion: string;
  /** null while no detector ships. */
  modelVersion: string | null;
  photoTaken: boolean;
  photoStatus: 'assessed' | 'not_taken' | 'quality_failed';
  findings: { class: 'caries_permanent' | 'caries_primary'; confidence: number; box: [number, number, number, number] }[];
  /** Answers given; questions skipped after a red flag are absent. */
  answers: Partial<Record<string, 'yes' | 'no' | 'unknown'>>;
  /** null when the flow stopped at a red flag before the pain question. */
  pain: number | 'unknown' | null;
  ageMonths: number | null;
  synced: boolean;
};
