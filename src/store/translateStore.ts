import { create } from 'zustand';

// Progress of a notebook translation. Batches land out of order and each one is
// applied as it arrives, so the only honest thing to show is how many nodes are
// accounted for out of how many were sent.

type TranslateState = {
  active: boolean;
  done: number;
  total: number;
};

type TranslateActions = {
  begin: (total: number) => void;
  advance: (n: number) => void;
  finish: () => void;
};

export const useTranslateStore = create<TranslateState & TranslateActions>()((set) => ({
  active: false,
  done: 0,
  total: 0,
  begin: (total) => set({ active: true, done: 0, total }),
  advance: (n) => set((s) => ({ done: Math.min(s.done + n, s.total) })),
  finish: () => set({ active: false, done: 0, total: 0 }),
}));
