// PHASE 2 PROTOTYPE DATA — in-memory only, reset on app restart.
// Replaced in phase 4 by the local encrypted DB + outbox (app_plan.md §5, §6).
import { create } from 'zustand';

import type { BrushingRecord, BrushingSlot, ChildProfile, ConsentState, ConsentType } from '@/domain/models';

function daysAgo(days: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function seedBrushing(childId: string): BrushingRecord[] {
  const records: BrushingRecord[] = [];
  // Mostly complete days, a couple of missed evenings, nothing tonight yet.
  for (let day = 0; day < 12; day++) {
    const skipEvening = day === 0 || day === 4 || day === 9;
    records.push({
      id: `${childId}-m-${day}`,
      childId,
      startedAt: daysAgo(day, 6, 40 + (day % 3) * 5),
      durationS: 110 + ((day * 7) % 25),
      spiritScore: null,
      slot: 'morning',
      cameraMode: false,
      synced: day > 1,
    });
    if (!skipEvening) {
      records.push({
        id: `${childId}-e-${day}`,
        childId,
        startedAt: daysAgo(day, 19, 30 + (day % 4) * 5),
        durationS: 120 + ((day * 5) % 15),
        spiritScore: null,
        slot: 'evening',
        cameraMode: false,
        synced: day > 1,
      });
    }
  }
  return records;
}

const seedKids: ChildProfile[] = [
  { id: 'mock-child-1', nickname: 'Adik', birthYear: 2018, birthMonth: 3, allergies: [] },
  { id: 'mock-child-2', nickname: 'Kakak', birthYear: 2015, birthMonth: 11, allergies: ['flavor_mint'] },
];

type MockState = {
  kids: ChildProfile[];
  activeChildId: string | null;
  brushing: BrushingRecord[];
  consents: Record<string, ConsentState>;
  setActiveChild: (id: string) => void;
  upsertChild: (child: ChildProfile) => void;
  setConsent: (childId: string, type: ConsentType, value: boolean) => void;
  addBrushing: (childId: string, durationS: number) => void;
};

function slotFor(date: Date): BrushingSlot {
  const h = date.getHours();
  if (h >= 6 && h < 10) return 'morning';
  if (h >= 19 && h < 23) return 'evening';
  return 'other';
}

export const useMockData = create<MockState>((set) => ({
  kids: seedKids,
  activeChildId: seedKids[0].id,
  brushing: [...seedBrushing('mock-child-1'), ...seedBrushing('mock-child-2')],
  consents: {
    'mock-child-1': { a: true, b: false, c: false },
    'mock-child-2': { a: true, b: false, c: false },
  },
  setActiveChild: (id) => set({ activeChildId: id }),
  upsertChild: (child) =>
    set((s) => {
      const exists = s.kids.some((k) => k.id === child.id);
      return {
        kids: exists ? s.kids.map((k) => (k.id === child.id ? child : k)) : [...s.kids, child],
        activeChildId: s.activeChildId ?? child.id,
        // Every consent starts off for a new child (app/CLAUDE.md §3.5).
        consents: s.consents[child.id] ? s.consents : { ...s.consents, [child.id]: { a: false, b: false, c: false } },
      };
    }),
  setConsent: (childId, type, value) =>
    set((s) => ({
      consents: { ...s.consents, [childId]: { ...(s.consents[childId] ?? { a: false, b: false, c: false }), [type]: value } },
    })),
  addBrushing: (childId, durationS) =>
    set((s) => {
      const now = new Date();
      return {
        brushing: [
          {
            id: `${childId}-${now.getTime()}`,
            childId,
            startedAt: now.toISOString(),
            durationS,
            spiritScore: null,
            slot: slotFor(now),
            cameraMode: false,
            synced: false,
          },
          ...s.brushing,
        ],
      };
    }),
}));

export function newChildId(): string {
  // Prototype id; phase 4 uses crypto UUIDs (child_profile.id is a uuid).
  return `mock-child-${Date.now()}`;
}
