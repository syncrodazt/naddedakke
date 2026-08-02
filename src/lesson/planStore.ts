import { create } from 'zustand';

// Whether the plan panel is up, and whether a run of "teach it all" is going.
//
// Kept out of the graph store because none of it is part of the notebook: the
// plan itself belongs to the session and is persisted, but whether the list is
// currently on screen is a property of this window.

type PlanState = {
  open: boolean;
  /** The planning call is in flight — there is a lesson but not yet a route. */
  planning: boolean;
  /** How far a "teach every step" run has got, or null when none is running. */
  run: { done: number; total: number } | null;
  /** Set when the learner stops a run; the loop checks it between steps. */
  cancelled: boolean;
};

type PlanActions = {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setPlanning: (planning: boolean) => void;
  startRun: (total: number) => void;
  noteRunStep: (done: number) => void;
  endRun: () => void;
  cancelRun: () => void;
};

export const usePlanStore = create<PlanState & PlanActions>()((set) => ({
  open: false,
  planning: false,
  run: null,
  cancelled: false,

  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
  setPlanning: (planning) => set({ planning }),

  startRun: (total) => set({ run: { done: 0, total }, cancelled: false, open: true }),
  noteRunStep: (done) => set((s) => (s.run ? { run: { ...s.run, done } } : {})),
  endRun: () => set({ run: null, cancelled: false }),
  cancelRun: () => set({ cancelled: true }),
}));
