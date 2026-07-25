import { create } from 'zustand';
import type { GoalPlan } from '../gyakusan/plan';

// A back-cast plan the model has proposed but the learner has not accepted.
// CLAUDE.md is explicit that a decomposition is reviewed before it is inserted:
// the model is guessing at someone's finances or timeline, so its numbers are a
// starting point to argue with, never something to drop silently onto a canvas.

type GoalState = {
  busy: boolean;
  proposal: GoalPlan | null;
  error: string | null;
};

type GoalActions = {
  setBusy: (busy: boolean) => void;
  propose: (plan: GoalPlan) => void;
  setError: (message: string | null) => void;
  dismiss: () => void;
};

export const useGoalStore = create<GoalState & GoalActions>()((set) => ({
  busy: false,
  proposal: null,
  error: null,

  setBusy: (busy) => set({ busy }),
  propose: (proposal) => set({ proposal, error: null, busy: false }),
  setError: (error) => set({ error, busy: false }),
  dismiss: () => set({ proposal: null, error: null, busy: false }),
}));
