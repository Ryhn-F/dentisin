import { create } from 'zustand';

// "Your account is being deleted" for the welcome screen: the deletion screen is gone once the
// account deletion signed the user out. In memory only (no data, just a flag).

type DeletionNoticeState = { accountDeleted: boolean; show: () => void; dismiss: () => void };

export const useDeletionNotice = create<DeletionNoticeState>((set) => ({
  accountDeleted: false,
  show: () => set({ accountDeleted: true }),
  dismiss: () => set({ accountDeleted: false }),
}));
