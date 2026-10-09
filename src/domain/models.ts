// App-side domain types, aligned with backend/supabase/migrations/20261008000200_core_tables.sql.
// Fields the backend never stores (e.g. `nickname`) are marked LOCAL ONLY.

export type BrushingSlot = 'morning' | 'evening' | 'other';

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
