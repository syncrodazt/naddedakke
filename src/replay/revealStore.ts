import { create } from 'zustand';

// Progressive-reveal ("re-learn") mode: the whole graph is loaded, but only the
// first N original nodes (by seq) are shown; the learner reveals more on demand.
// Unlike replay this is INTERACTIVE — you can still highlight and ask なんで？
// while revealing. Nodes created after reveal started (seq > baseSeq, i.e. your
// new branches) are always visible so re-learning can branch freely.
//
// This is view-only state — never persisted.

type RevealState = {
  active: boolean;
  baseSeq: number; // max seq among the originally-loaded nodes
  count: number; // how many original nodes are revealed (>= 1)
};

type RevealActions = {
  begin: (baseSeq: number) => void;
  next: () => void;
  setCount: (count: number) => void;
  showAll: () => void;
};

export const useRevealStore = create<RevealState & RevealActions>()((set) => ({
  active: false,
  baseSeq: 0,
  count: 1,

  begin: (baseSeq) => set({ active: true, baseSeq, count: 1 }),
  next: () => set((s) => ({ count: s.count + 1 })),
  setCount: (count) => set({ count: Math.max(1, count) }),
  showAll: () => set({ active: false }),
}));
